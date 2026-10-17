/**
 * PAUSA PELO ESTOQUE — o lado do banco (a regra está em lib/pausa-pelo-estoque.ts).
 *
 * Duas tabelas próprias, criadas no boot por SQL cru (mesma categoria de
 * lib/assessor/estrutura-no-banco.ts: `CREATE TABLE IF NOT EXISTS`, idempotente):
 *
 *   "PausaPeloEstoqueLoja"       o interruptor da loja (sem linha = desligado).
 *   "ProdutoPausadoPeloEstoque"  a marca "quem pausou foi o estoque", por
 *                                produto, com os insumos que faltavam.
 *
 * Tabelas próprias, e não coluna nova em MenuProduct ou User: o Prisma monta o
 * SELECT com todas as escalares do schema, e uma coluna faltando derrubaria o
 * cardápio inteiro (o incidente do MenuProduct.sortOrder). Faltando estas, só a
 * pausa automática para. Por isso também tudo aqui é SQL cru: não depende do
 * Prisma Client gerado.
 *
 * NADA AQUI QUEBRA A VENDA: `conferirPausaPeloEstoque` nunca lança — erro só
 * loga. A baixa do pedido chama `avisarMovimentoDeEstoque`, que nem espera.
 */
import { prisma } from "@/lib/prisma";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";
import { mudarPausaDosProdutos } from "@/lib/pausar-produtos";
import { decidirPausaPeloEstoque, insumoAcabou, type FichaDoProduto } from "@/lib/pausa-pelo-estoque";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "PausaPeloEstoqueLoja" (
     "franchiseeId" TEXT NOT NULL,
     "ligado" BOOLEAN NOT NULL DEFAULT false,
     "atualizadoPor" TEXT,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "PausaPeloEstoqueLoja_pkey" PRIMARY KEY ("franchiseeId")
   )`,
  `CREATE TABLE IF NOT EXISTS "ProdutoPausadoPeloEstoque" (
     "menuProductId" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "insumos" JSONB NOT NULL DEFAULT '[]',
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ProdutoPausadoPeloEstoque_pkey" PRIMARY KEY ("menuProductId")
   )`,
  `CREATE INDEX IF NOT EXISTS "ProdutoPausadoPeloEstoque_franchiseeId_idx" ON "ProdutoPausadoPeloEstoque"("franchiseeId")`,
  `DO $$ BEGIN
     ALTER TABLE "ProdutoPausadoPeloEstoque" ADD CONSTRAINT "ProdutoPausadoPeloEstoque_menuProductId_fkey"
       FOREIGN KEY ("menuProductId") REFERENCES "MenuProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];

let pronto = false;

export async function garantirEstruturaDaPausaPeloEstoque(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) {
    pronto = true;
    return true;
  }
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
    console.log("[Boot] ✅ Tabelas da pausa pelo estoque garantidas.");
  } catch (err: any) {
    console.error(`[Boot] 🛑 Estrutura da pausa pelo estoque falhou: ${err?.message}`);
  }
  return pronto;
}

export async function pausaPeloEstoqueLigada(franchiseeId: string): Promise<boolean> {
  if (!franchiseeId || !(await garantirEstruturaDaPausaPeloEstoque())) return false;
  const r = await prisma.$queryRaw<{ ligado: boolean }[]>`
    SELECT "ligado" FROM "PausaPeloEstoqueLoja" WHERE "franchiseeId" = ${franchiseeId}`;
  return r[0]?.ligado === true;
}

async function marcasDaLoja(franchiseeId: string): Promise<Map<string, string[]>> {
  const r = await prisma.$queryRaw<{ menuProductId: string; insumos: unknown }[]>`
    SELECT "menuProductId", "insumos" FROM "ProdutoPausadoPeloEstoque" WHERE "franchiseeId" = ${franchiseeId}`;
  return new Map(r.map((m) => [m.menuProductId, Array.isArray(m.insumos) ? (m.insumos as unknown[]).map(String) : []]));
}

/**
 * Os produtos que o estoque pausou agora (marca gravada). A aba Fichas técnicas
 * lista só os ativos e os mostra com etiqueta, senão o produto pausado sumia de
 * lá (Douglas, 17/10/2026). Nunca lança: sem tabela, lista vazia.
 */
export async function produtosPausadosPeloEstoque(franchiseeId: string): Promise<string[]> {
  try {
    if (!franchiseeId || !(await garantirEstruturaDaPausaPeloEstoque())) return [];
    return [...(await marcasDaLoja(franchiseeId)).keys()];
  } catch {
    return [];
  }
}

/** O lojista decidiu na mão (painel ou Bill): o produto deixa de ser "pausado pelo estoque". */
export async function esquecerPausaPeloEstoque(franchiseeId: string, produtoIds: string[]): Promise<void> {
  if (!franchiseeId || !produtoIds.length) return;
  try {
    if (!(await garantirEstruturaDaPausaPeloEstoque())) return;
    await prisma.$executeRaw`
      DELETE FROM "ProdutoPausadoPeloEstoque"
       WHERE "franchiseeId" = ${franchiseeId} AND "menuProductId" = ANY(${produtoIds}::text[])`;
  } catch (err: any) {
    console.error(`[PausaPeloEstoque] Falha ao apagar marca (loja ${franchiseeId}): ${err?.message}`);
  }
}

/** Fichas, saldos e marcas que a decisão precisa. `tocados` null = loja inteira. */
async function montarEntrada(franchiseeId: string, tocados: string[] | null) {
  const marcas = await marcasDaLoja(franchiseeId);
  const marcados = [...marcas.keys()];

  let candidatos: string[];
  if (tocados === null) {
    const r = await prisma.productRecipe.findMany({
      where: { menuProduct: { franchiseeId } },
      select: { menuProductId: true },
      distinct: ["menuProductId"],
    });
    candidatos = r.map((x) => x.menuProductId);
  } else if (tocados.length) {
    const r = await prisma.productRecipe.findMany({
      where: { stockItemId: { in: tocados }, menuProduct: { franchiseeId } },
      select: { menuProductId: true },
      distinct: ["menuProductId"],
    });
    candidatos = r.map((x) => x.menuProductId);
  } else {
    candidatos = [];
  }

  const ids = [...new Set([...candidatos, ...marcados])];
  if (!ids.length) return { marcas, entrada: null };

  // Espelho de marketplace (o iFood tem o cardápio dele) não entra como
  // candidato a pausa; o que já está marcado entra sempre, para poder voltar.
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId, id: { in: ids }, OR: [SEM_PRODUTO_DE_INTEGRACAO, { id: { in: marcados.length ? marcados : ["-"] } }] },
    select: { id: true, name: true, active: true, recipeItems: { select: { stockItemId: true } } },
  });
  const fichas: FichaDoProduto[] = produtos.map((p) => ({
    produtoId: p.id,
    ativo: p.active,
    insumos: [...new Set(p.recipeItems.map((r) => r.stockItemId))],
  }));

  const todosInsumos = [...new Set(fichas.flatMap((f) => f.insumos))];
  const itens = todosInsumos.length
    ? await prisma.stockItem.findMany({
        where: { id: { in: todosInsumos }, franchiseeId, NOT: { active: false } },
        select: { id: true, name: true, quantity: true, unit: true },
      })
    : [];
  const saldos = new Map(itens.map((i) => [i.id, i.quantity]));

  return {
    marcas,
    produtos,
    itens,
    entrada: {
      saldos,
      fichas,
      marcados: new Set(marcados),
      tocados: tocados === null ? null : new Set(tocados),
    },
  };
}

// Uma conferência por loja de cada vez: duas vendas fechando no mesmo segundo
// não decidem em cima do mesmo retrato e não brigam pela mesma marca.
const filaPorLoja = new Map<string, Promise<unknown>>();

export type ResultadoDaConferencia = { pausados: string[]; reativados: string[] };

/**
 * Aplica a regra depois de um movimento de estoque. `tocados` = insumos que o
 * movimento mexeu (null = loja inteira). Nunca lança.
 */
export function conferirPausaPeloEstoque(franchiseeId: string, tocados: string[] | null): Promise<ResultadoDaConferencia> {
  const vazio: ResultadoDaConferencia = { pausados: [], reativados: [] };
  if (!franchiseeId) return Promise.resolve(vazio);
  const anterior = filaPorLoja.get(franchiseeId) || Promise.resolve();
  const agora = anterior
    .catch(() => {})
    .then(() => conferirAgora(franchiseeId, tocados))
    .catch((err: any) => {
      console.error(`[PausaPeloEstoque] Erro na conferência da loja ${franchiseeId}: ${err?.message || err}`);
      return vazio;
    });
  filaPorLoja.set(franchiseeId, agora);
  agora.finally(() => { if (filaPorLoja.get(franchiseeId) === agora) filaPorLoja.delete(franchiseeId); });
  return agora;
}

/** Para a baixa do pedido: dispara e não espera. O pedido fecha igual. */
export function avisarMovimentoDeEstoque(franchiseeId: string | null | undefined, tocados: string[] | null): void {
  if (!franchiseeId) return;
  void conferirPausaPeloEstoque(franchiseeId, tocados);
}

async function conferirAgora(franchiseeId: string, tocados: string[] | null): Promise<ResultadoDaConferencia> {
  if (!(await pausaPeloEstoqueLigada(franchiseeId))) return { pausados: [], reativados: [] };
  const { entrada } = await montarEntrada(franchiseeId, tocados);
  if (!entrada) return { pausados: [], reativados: [] };

  const d = decidirPausaPeloEstoque(entrada);
  const pausados: string[] = [];
  const reativados: string[] = [];

  if (d.pausar.length) {
    const mudaram = await mudarPausaDosProdutos(franchiseeId, d.pausar.map((p) => p.produtoId), false);
    const faltandoPor = new Map(d.pausar.map((p) => [p.produtoId, p.faltando]));
    // Marca só o que ESTA pausa mudou: o que já estava pausado é do lojista.
    for (const p of mudaram) {
      const insumos = JSON.stringify(faltandoPor.get(p.id) || []);
      await prisma.$executeRaw`
        INSERT INTO "ProdutoPausadoPeloEstoque" ("menuProductId", "franchiseeId", "insumos")
        VALUES (${p.id}, ${franchiseeId}, ${insumos}::jsonb)
        ON CONFLICT ("menuProductId") DO NOTHING`;
      pausados.push(p.name);
    }
  }

  if (d.reativar.length) {
    const mudaram = await mudarPausaDosProdutos(franchiseeId, d.reativar, true);
    reativados.push(...mudaram.map((p) => p.name));
  }

  const apagar = [...d.reativar, ...d.desmarcar];
  if (apagar.length) await esquecerPausaPeloEstoque(franchiseeId, apagar);

  if (pausados.length) console.log(`[PausaPeloEstoque] Loja ${franchiseeId}: pausou ${pausados.join(", ")}`);
  if (reativados.length) console.log(`[PausaPeloEstoque] Loja ${franchiseeId}: reativou ${reativados.join(", ")}`);
  return { pausados, reativados };
}

/** Liga ou desliga. Ligar já confere a loja inteira (o que está zerado pausa agora). */
export async function ligarPausaPeloEstoque(franchiseeId: string, ligado: boolean, quem: string | null): Promise<ResultadoDaConferencia> {
  if (!(await garantirEstruturaDaPausaPeloEstoque())) throw new Error("A pausa pelo estoque ainda não está disponível. Tente de novo em alguns minutos.");
  await prisma.$executeRaw`
    INSERT INTO "PausaPeloEstoqueLoja" ("franchiseeId", "ligado", "atualizadoPor", "atualizadoEm")
    VALUES (${franchiseeId}, ${ligado}, ${quem}, CURRENT_TIMESTAMP)
    ON CONFLICT ("franchiseeId") DO UPDATE SET "ligado" = EXCLUDED."ligado", "atualizadoPor" = EXCLUDED."atualizadoPor", "atualizadoEm" = CURRENT_TIMESTAMP`;
  // Desligar não reativa nada: o insumo continua zerado. As marcas ficam, e o
  // que está pausado pelo estoque segue aparecendo na tela para o lojista decidir.
  if (!ligado) return { pausados: [], reativados: [] };
  return conferirPausaPeloEstoque(franchiseeId, null);
}

export type EstadoDaPausaPeloEstoque = {
  disponivel: boolean;
  ligado: boolean;
  /** Pausados pelo estoque agora, com o insumo que falta. */
  pausados: { produtoId: string; produto: string; faltando: { id: string; nome: string; saldo: number; unidade: string }[] }[];
  /** Desligado: o que pausaria se ligasse agora. */
  pausariaAoLigar: string[];
};

export async function estadoDaPausaPeloEstoque(franchiseeId: string): Promise<EstadoDaPausaPeloEstoque> {
  const vazio: EstadoDaPausaPeloEstoque = { disponivel: false, ligado: false, pausados: [], pausariaAoLigar: [] };
  if (!franchiseeId || !(await garantirEstruturaDaPausaPeloEstoque())) return vazio;
  const ligado = await pausaPeloEstoqueLigada(franchiseeId);
  const { marcas, entrada, produtos = [], itens = [] } = await montarEntrada(franchiseeId, null);
  if (!entrada) return { ...vazio, disponivel: true, ligado };

  const nomeDoProduto = new Map(produtos.map((p) => [p.id, p.name]));
  const item = new Map(itens.map((i) => [i.id, i]));
  const fichaPor = new Map(entrada.fichas.map((f) => [f.produtoId, f]));

  const pausados: EstadoDaPausaPeloEstoque["pausados"] = [];
  for (const [produtoId, gravados] of marcas) {
    const ficha = fichaPor.get(produtoId);
    if (!ficha || ficha.ativo) continue;
    // O que falta AGORA; se nada falta (ligou depois de repor, por exemplo), o
    // que faltava quando pausou.
    let ids = ficha.insumos.filter((i) => insumoAcabou(entrada.saldos, i));
    if (!ids.length) ids = gravados;
    pausados.push({
      produtoId,
      produto: nomeDoProduto.get(produtoId) || "Produto",
      faltando: ids.map((id) => {
        const i = item.get(id);
        return { id, nome: i?.name || "item arquivado", saldo: i?.quantity ?? 0, unidade: i?.unit || "" };
      }),
    });
  }
  pausados.sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));

  const pausariaAoLigar = ligado
    ? []
    : decidirPausaPeloEstoque(entrada).pausar.map((p) => nomeDoProduto.get(p.produtoId) || "Produto").sort((a, b) => a.localeCompare(b, "pt-BR"));

  return { disponivel: true, ligado, pausados, pausariaAoLigar };
}

/** Compra lançada (ou desfeita): confere os insumos dela. Nunca lança. */
export async function conferirPausaDaCompra(franchiseeId: string, invoiceId: string | null | undefined): Promise<ResultadoDaConferencia> {
  const vazio: ResultadoDaConferencia = { pausados: [], reativados: [] };
  if (!franchiseeId || !invoiceId) return vazio;
  try {
    if (!(await pausaPeloEstoqueLigada(franchiseeId))) return vazio;
    const movs = await prisma.stockTransaction.findMany({
      where: { stockInvoiceId: invoiceId },
      select: { stockItemId: true },
      distinct: ["stockItemId"],
    });
    return conferirPausaPeloEstoque(franchiseeId, movs.map((m) => m.stockItemId));
  } catch (err: any) {
    console.error(`[PausaPeloEstoque] Erro ao conferir a compra ${invoiceId}: ${err?.message || err}`);
    return vazio;
  }
}
