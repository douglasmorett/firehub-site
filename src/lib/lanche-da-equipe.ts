/**
 * O LANCHE DOS MOTOBOYS — a tela /loja/<slug>/equipe (QR na parede da loja).
 *
 * Pedido do Douglas para a Hakim Centro (11/10/2026): o motoboy entra com o
 * login dele (o mesmo do app do entregador), vê o cardápio do site e pede o
 * lanche do dia pelo sistema — para ninguém pedir direto na cozinha e nada
 * sair sem anotar.
 *
 *   - limite por dia (R$ 22,90 na Hakim), pelo preço normal do site;
 *   - a categoria "Promoção do Dia" (a esfiha de R$ 1,90) não aparece e o
 *     servidor recusa;
 *   - comer na loja ou levar (sem cobrar embalagem por enquanto — Douglas,
 *     12/10/2026);
 *   - o que passar do limite é descontado no acerto do motoboy
 *     (lib/relatorio-do-entregador.ts);
 *   - opção "1 bebida por dia no crédito" (Douglas, 16/10/2026; vem ligada):
 *     a segunda bebida do dia — solta ou o Guaravita dentro do combo — sai do
 *     crédito e vai para o FIADO do motoboy, com aviso e "Aceito" antes
 *     (contaDoLanche, em lib/lanche-da-equipe-regras.ts). O lançamento do
 *     fiado é um CustomerOrder à parte (como o "Lançar dívida" da tela Fiado),
 *     ligado em LancheDaEquipe.fiadoPedidoId; cancelar o lanche no painel
 *     cancela o lançamento (cancelarFiadoDoLanche).
 *
 * ── Como fica gravado ────────────────────────────────────────────────────────
 * Um CustomerOrder normal (cozinha, quadro e impressão pegam sozinhos), com
 * source "EQUIPE", o nome "Equipe — <motoboy>", o desconto do que coube no
 * limite em `discountTotal` e o `totalAmount` = o que passou do limite (o que
 * o motoboy paga). Forma "Conta Funcionário (acerto do motoboy)": a régua do
 * caixa lê "funcion" como FIADO, fora da conferência da gaveta.
 *
 * A ligação pedido ↔ motoboy fica na tabela LancheDaEquipe (criada no primeiro
 * uso, fora do schema.prisma, como CashbackAjuste e ClienteDaLoja). Pedido
 * cancelado no painel sai do consumo do dia e do acerto.
 *
 * O "dia" é o do expediente da loja: vira às 5h (lib/fuso.ts).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dataDaLoja, viradaDoExpedienteDaLoja, FUSO_PADRAO } from "@/lib/fuso";
import { horaEmUtc } from "@/lib/cashback-no-banco";

export {
  LOJAS_COM_LANCHE_DA_EQUIPE, SOURCE_DO_LANCHE, FORMA_DO_LANCHE, LANCHE_PADRAO, lerConfigDoLanche, ehPromocaoDoDia, dividirNoLimite,
  contaDoLanche, avisoDaBebidaFora, CODIGO_BEBIDA_FORA, bebidasDoItem, type ConfigDoLanche, type BebidasDoCardapio,
} from "@/lib/lanche-da-equipe-regras";
import { LOJAS_COM_LANCHE_DA_EQUIPE, LANCHE_PADRAO, SOURCE_DO_LANCHE, lerConfigDoLanche, chaveDaBebida, bebidasDoItem, type ConfigDoLanche, type BebidasDoCardapio } from "@/lib/lanche-da-equipe-regras";

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** O dia do expediente ("2026-10-11") de um instante, no fuso da loja — vira às 5h. */
export function diaDoExpediente(tz: string | null | undefined, agora: Date = new Date()): string {
  return dataDaLoja(tz || FUSO_PADRAO, viradaDoExpedienteDaLoja(tz || FUSO_PADRAO, agora));
}

// ── Banco ───────────────────────────────────────────────────────────────────

let tabelaOk = false;

export async function garantirTabelaDoLanche(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LancheDaEquipe" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "motoboyId" TEXT NOT NULL,
      "motoboyNome" TEXT,
      "pedidoId" TEXT NOT NULL,
      "dia" TEXT NOT NULL,
      "valor" DOUBLE PRECISION NOT NULL,
      "coberto" DOUBLE PRECISION NOT NULL,
      "excedente" DOUBLE PRECISION NOT NULL,
      "levar" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "LancheDaEquipe_pkey" PRIMARY KEY ("id")
    )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "LancheDaEquipe_pedidoId_key" ON "LancheDaEquipe"("pedidoId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LancheDaEquipe_lojaId_motoboyId_dia_idx" ON "LancheDaEquipe"("lojaId", "motoboyId", "dia")`);
    // A configuração mora à parte: o painel regrava User.appMotoboyConfig
    // inteiro (só as chaves que conhece) e apagaria o limite.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LancheDaEquipeConfig" (
      "lojaId" TEXT NOT NULL,
      "ativo" BOOLEAN NOT NULL DEFAULT false,
      "limite" DOUBLE PRECISION NOT NULL DEFAULT 22.9,
      "atualizadoPor" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "LancheDaEquipeConfig_pkey" PRIMARY KEY ("lojaId")
    )`);
    // A regra da bebida (16/10/2026): a opção e quantas bebidas cada pedido pôs no crédito.
    // DEFAULT true: a configuração que já existe (a da Hakim Centro) vem ligada ("deixa ligada no Hakim").
    await prisma.$executeRawUnsafe(`ALTER TABLE "LancheDaEquipeConfig" ADD COLUMN IF NOT EXISTS "umaBebidaPorDia" BOOLEAN NOT NULL DEFAULT true`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "LancheDaEquipe" ADD COLUMN IF NOT EXISTS "bebidasNoCredito" INTEGER NOT NULL DEFAULT 0`);
    // A bebida a mais vai para o fiado: quanto e qual lançamento (para cancelar junto).
    await prisma.$executeRawUnsafe(`ALTER TABLE "LancheDaEquipe" ADD COLUMN IF NOT EXISTS "fiado" DOUBLE PRECISION NOT NULL DEFAULT 0`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "LancheDaEquipe" ADD COLUMN IF NOT EXISTS "fiadoPedidoId" TEXT`);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Lanche] 🛑 Tabela LancheDaEquipe falhou: ${err?.message}`);
    return false;
  }
}

type Banco = Pick<typeof prisma, "$queryRaw">;

/** Cancelado nas três grafias não conta (a mesma régua dos relatórios). */
const NAO_CANCELADO = Prisma.sql`upper(COALESCE(o."status", '')) NOT IN ('CANCELADO', 'CANCELED', 'CANCELLED')`;

/**
 * O que o motoboy já usou do crédito no dia e quantas bebidas entraram nele,
 * sem os cancelados. Soma o `coberto`, não o valor cheio: a bebida paga por
 * fora não come o limite (antes da regra da bebida dava no mesmo — o que
 * passava do limite já era todo excedente).
 */
export async function consumoDoDia(lojaId: string, motoboyId: string, dia: string, db: Banco = prisma): Promise<{ usado: number; bebidas: number }> {
  const [l] = await db.$queryRaw<{ total: number | null; bebidas: number | null }[]>(Prisma.sql`
    SELECT COALESCE(sum(l."coberto"), 0)::float8 AS total, COALESCE(sum(l."bebidasNoCredito"), 0)::int AS bebidas
    FROM "LancheDaEquipe" l JOIN "CustomerOrder" o ON o."id" = l."pedidoId"
    WHERE l."lojaId" = ${lojaId} AND l."motoboyId" = ${motoboyId} AND l."dia" = ${dia} AND ${NAO_CANCELADO}`);
  return { usado: centavos(Number(l?.total) || 0), bebidas: Number(l?.bebidas) || 0 };
}

/** As palavras de bebida que a loja cadastrou na impressão (as mesmas da comanda). */
export async function palavrasDeBebidaDaLoja(lojaId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: lojaId }, select: { printerConfig: true } }).catch(() => null);
  const cfg = u?.printerConfig as { customBeverageKeywords?: unknown } | null;
  return typeof cfg?.customBeverageKeywords === "string" ? cfg.customBeverageKeywords : "";
}

/** O produto é bebida? A mesma régua da comanda (itemEhBebida); combo não é. */
export async function produtoEhBebida(produto: { name?: string | null; category?: string | null; isBeverage?: boolean | null }, palavras: string): Promise<boolean> {
  const { itemEhBebida } = await import("@/lib/roteamento-de-impressao");
  return itemEhBebida({ name: produto.name ?? "", category: produto.category ?? "", isBeverage: produto.isBeverage === true }, SOURCE_DO_LANCHE, palavras);
}

/**
 * As bebidas da loja (lib/lanche-da-equipe-regras.ts, BebidasDoCardapio): por
 * id (a bebida pedida solta) e por nome (a escolhida dentro do combo), com o
 * preço dela solta. Inclui as "só em combo". A tela recebe este mesmo mapa.
 */
export async function bebidasDoCardapio(lojaId: string): Promise<BebidasDoCardapio> {
  const palavras = await palavrasDeBebidaDaLoja(lojaId);
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: lojaId },
    select: { id: true, name: true, category: true, isBeverage: true, isCombo: true, price: true, priceDelivery: true, active: true },
    // Os ativos primeiro: mesmo nome em dois cadastros, vale o que está no ar.
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  const mapa: BebidasDoCardapio = { porId: {}, porNome: {} };
  for (const p of produtos) {
    // Combo nunca é a bebida (o "10 Esfirras + 2 bebidas" antigo, marcado como bebida no cadastro).
    if (p.isCombo || /\bcombo\b|\+/i.test(p.name || "")) continue;
    if (!(await produtoEhBebida(p, palavras))) continue;
    const preco = centavos(Number(p.priceDelivery) > 0 ? Number(p.priceDelivery) : Number(p.price) || 0);
    mapa.porId[p.id] = preco;
    const chave = chaveDaBebida(p.name);
    // Sem preço (a "Coca 2L" de R$ 0 desativada) não serve de preço da bebida do combo.
    if (chave && preco > 0 && mapa.porNome[chave] == null) mapa.porNome[chave] = preco;
  }
  return mapa;
}

/** O cadastro do motoboy no fiado (o espelho da equipe, lib/fiado-do-motoboy.ts). */
async function cadastroNoFiado(lojaId: string, motoboyId: string): Promise<{ id: string; name: string; phone: string | null } | null> {
  const { sincronizarEquipeNoFiado } = await import("@/lib/fiado-do-motoboy");
  const ligados = await sincronizarEquipeNoFiado([lojaId]);
  const ids = [...ligados.entries()].filter(([, v]) => v.origem === "MOTOBOY" && v.membroId === motoboyId).map(([id]) => id);
  if (ids.length === 0) return null;
  return prisma.storeEmployee.findFirst({
    where: { id: { in: ids }, franchiseeId: lojaId, active: true },
    select: { id: true, name: true, phone: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * O lanche foi cancelado: o lançamento da bebida no fiado cai junto (chamado
 * por /api/customer-order/status). Sem lançamento, não faz nada.
 */
export async function cancelarFiadoDoLanche(pedidoId: string): Promise<void> {
  if (!(await garantirTabelaDoLanche())) return;
  const [l] = await prisma.$queryRaw<{ fiadoPedidoId: string | null }[]>`
    SELECT "fiadoPedidoId" FROM "LancheDaEquipe" WHERE "pedidoId" = ${pedidoId}`.catch(() => []);
  if (!l?.fiadoPedidoId) return;
  await prisma.customerOrder.updateMany({
    where: { id: l.fiadoPedidoId, status: { not: "CANCELADO" } },
    data: { status: "CANCELADO", cancelledBy: "LOJA", cancelReason: "Lanche da equipe cancelado" },
  });
}

export type LancheDoHistorico = {
  pedidoId: string;
  numero: number | null;
  dia: string;
  em: string;
  levar: boolean;
  valor: number;
  coberto: number;
  excedente: number;
  /** A bebida a mais lançada no fiado (não sai do acerto). */
  fiado: number;
  cancelado: boolean;
  itens: { qtd: number; nome: string; opcoes: string[] }[];
  motoboyId: string;
  motoboyNome: string | null;
};

/** Os lanches de um período (o "Meus lanches" do motoboy, o painel e o acerto). */
export async function lanchesDoPeriodo(opts: {
  lojaId: string;
  motoboyId?: string | null;
  de: Date;
  ate: Date;
}): Promise<LancheDoHistorico[]> {
  if (!(await garantirTabelaDoLanche())) return [];
  const linhas = await prisma.$queryRaw<{
    pedidoId: string; dia: string; levar: boolean; valor: number; coberto: number; excedente: number; fiado: number | null;
    createdAt: Date; motoboyId: string; motoboyNome: string | null; status: string | null; numero: number | null;
  }[]>(Prisma.sql`
    SELECT l."pedidoId", l."dia", l."levar", l."valor", l."coberto", l."excedente", l."fiado", l."createdAt",
           l."motoboyId", l."motoboyNome", o."status", o."dailyOrderNumber" AS numero
    FROM "LancheDaEquipe" l JOIN "CustomerOrder" o ON o."id" = l."pedidoId"
    WHERE l."lojaId" = ${opts.lojaId}
      ${opts.motoboyId ? Prisma.sql`AND l."motoboyId" = ${opts.motoboyId}` : Prisma.empty}
      AND l."createdAt" >= ${horaEmUtc(opts.de)} AND l."createdAt" <= ${horaEmUtc(opts.ate)}
    ORDER BY l."createdAt" DESC
    LIMIT 500`);
  if (!linhas.length) return [];
  const itens = await prisma.customerOrderItem.findMany({
    where: { orderId: { in: linhas.map((l) => l.pedidoId) } },
    select: { orderId: true, quantity: true, productName: true, comboSelections: true, menuProduct: { select: { name: true } } },
  });
  const { parseComboSelections } = await import("@/lib/parse-combo");
  const porPedido = new Map<string, LancheDoHistorico["itens"]>();
  for (const it of itens) {
    const lista = porPedido.get(it.orderId) || [];
    lista.push({
      qtd: Number(it.quantity) || 1,
      nome: it.productName || it.menuProduct?.name || "Item",
      opcoes: parseComboSelections(it.comboSelections).map((o) => `${Number(o.quantity) > 1 ? `${o.quantity}x ` : ""}${o.name}`),
    });
    porPedido.set(it.orderId, lista);
  }
  return linhas.map((l) => ({
    pedidoId: l.pedidoId,
    numero: l.numero ?? null,
    dia: l.dia,
    em: new Date(l.createdAt).toISOString(),
    levar: Boolean(l.levar),
    valor: centavos(l.valor),
    coberto: centavos(l.coberto),
    excedente: centavos(l.excedente),
    fiado: centavos(Number(l.fiado) || 0),
    cancelado: ["CANCELADO", "CANCELED", "CANCELLED"].includes(String(l.status || "").toUpperCase()),
    itens: porPedido.get(l.pedidoId) || [],
    motoboyId: l.motoboyId,
    motoboyNome: l.motoboyNome,
  }));
}

/** O desconto do acerto: a soma do que passou do limite, sem os cancelados. */
export function descontoDoAcerto(lanches: Pick<LancheDoHistorico, "excedente" | "cancelado">[]): number {
  return centavos(lanches.filter((l) => !l.cancelado).reduce((t, l) => t + l.excedente, 0));
}

/** A conta da loja tem a tela e ela está ligada? */
export async function configDaLoja(lojaId: string): Promise<ConfigDoLanche & { disponivel: boolean }> {
  const disponivel = LOJAS_COM_LANCHE_DA_EQUIPE.has(lojaId);
  if (!disponivel || !(await garantirTabelaDoLanche())) return { ...LANCHE_PADRAO, disponivel };
  const [l] = await prisma.$queryRaw<ConfigDoLanche[]>`
    SELECT "ativo", "limite", "umaBebidaPorDia" FROM "LancheDaEquipeConfig" WHERE "lojaId" = ${lojaId}`.catch(() => []);
  return { ...lerConfigDoLanche(l), disponivel };
}

export async function salvarConfigDoLanche(lojaId: string, bruto: unknown, quem: string): Promise<ConfigDoLanche> {
  if (!LOJAS_COM_LANCHE_DA_EQUIPE.has(lojaId)) throw new Error("loja sem a tela do lanche");
  if (!(await garantirTabelaDoLanche())) throw new Error("tabela LancheDaEquipeConfig indisponível");
  const cfg = lerConfigDoLanche(bruto);
  await prisma.$executeRaw`
    INSERT INTO "LancheDaEquipeConfig" ("lojaId", "ativo", "limite", "umaBebidaPorDia", "atualizadoPor", "updatedAt")
    VALUES (${lojaId}, ${cfg.ativo}, ${cfg.limite}, ${cfg.umaBebidaPorDia}, ${quem}, NOW())
    ON CONFLICT ("lojaId") DO UPDATE SET "ativo" = EXCLUDED."ativo", "limite" = EXCLUDED."limite", "umaBebidaPorDia" = EXCLUDED."umaBebidaPorDia",
      "atualizadoPor" = EXCLUDED."atualizadoPor", "updatedAt" = NOW()`;
  return cfg;
}

// ── O pedido ────────────────────────────────────────────────────────────────

export type ItemDoLanche = { menuProductId?: unknown; quantity?: unknown; comboSelections?: unknown; notes?: unknown };

export type ResultadoDoLanche =
  | { ok: true; pedidoId: string; numero: number | null; valor: number; coberto: number; excedente: number; fiado: number; restante: number }
  | { ok: false; status: number; error: string; codigo?: string; valorDasBebidasFora?: number };

/**
 * Grava o lanche: confere a tela ligada, o caixa aberto e os itens (da loja,
 * no cardápio do site, sem a Promoção do Dia); preço do servidor pelo canal
 * do site; o limite do dia conferido dentro de uma trava por motoboy (dois
 * pedidos ao mesmo tempo não usam o mesmo saldo).
 */
export async function pedirLanche(opts: {
  lojaId: string;
  motoboy: { id: string; name: string };
  itens: ItemDoLanche[];
  levar: boolean;
  observacao?: unknown;
  /** O motoboy aceitou pagar por fora a bebida que passa de 1 no dia. */
  aceitouBebidaFora?: boolean;
}): Promise<ResultadoDoLanche> {
  const { lojaId, motoboy } = opts;
  const cfg = await configDaLoja(lojaId);
  if (!cfg.ativo) return { ok: false, status: 403, error: "O lanche pelo sistema está desligado. Fale com o gerente." };
  if (!Array.isArray(opts.itens) || opts.itens.length === 0) return { ok: false, status: 400, error: "Escolha pelo menos um item." };
  if (opts.itens.length > 30) return { ok: false, status: 400, error: "Pedido grande demais para lanche." };

  const { caixaEstaAberto } = await import("@/lib/caixa-aberto-servidor");
  if (!(await caixaEstaAberto(lojaId))) return { ok: false, status: 409, error: "O caixa da loja está fechado. O lanche só sai com a loja aberta." };
  if (!(await garantirTabelaDoLanche())) return { ok: false, status: 500, error: "Não deu para registrar o lanche agora." };

  const { SEM_PRODUTO_DE_INTEGRACAO, motivoForaDoCardapio } = await import("@/lib/cardapio-interno");
  const { aplicarPrecoDoCanalComCombo } = await import("@/lib/preco-por-canal");
  const { precoUnitarioDoItem, pisoDoPreco } = await import("@/lib/preco-combo");
  const { conferirEstoque } = await import("@/lib/estoque-restante");
  const { fusoDaLoja } = await import("@/lib/fuso-da-loja");
  const { ehPromocaoDoDia, contaDoLanche, avisoDaBebidaFora, CODIGO_BEBIDA_FORA, FORMA_DO_LANCHE } = await import("@/lib/lanche-da-equipe-regras");

  const fuso = await fusoDaLoja(lojaId);
  const ids = [...new Set(opts.itens.map((i) => String(i?.menuProductId ?? "")).filter(Boolean))];
  const produtos = await prisma.menuProduct.findMany({
    where: { id: { in: ids }, franchiseeId: lojaId, active: true, activeDelivery: true, AND: [{ NOT: { apenasEmCombo: true } }, SEM_PRODUTO_DE_INTEGRACAO] },
    include: { comboGroups: { include: { items: { include: { menuProduct: true } } } } },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));

  const mapaDeBebidas = cfg.umaBebidaPorDia ? await bebidasDoCardapio(lojaId) : null;
  const itens: { menuProductId: string; quantity: number; price: number; comboSelections: unknown; notes: string | null; bebidas: number[] }[] = [];
  for (const item of opts.itens) {
    const produto = porId.get(String(item?.menuProductId ?? ""));
    if (!produto) return { ok: false, status: 400, error: "Um item do pedido saiu do cardápio. Atualize a página e escolha de novo." };
    if (ehPromocaoDoDia(produto)) return { ok: false, status: 400, error: `"${produto.name}" é da Promoção do Dia, que não vale para o lanche da equipe.` };
    if (motivoForaDoCardapio(produto, fuso)) return { ok: false, status: 400, error: `"${produto.name}" não está saindo agora.` };
    const noCanal = aplicarPrecoDoCanalComCombo(produto as any, "delivery");
    let preco = precoUnitarioDoItem(noCanal as any, item.comboSelections as any);
    const minimo = pisoDoPreco(noCanal as any);
    if (preco < minimo) preco = minimo;
    itens.push({
      menuProductId: produto.id,
      quantity: Math.max(1, Math.min(20, Math.floor(Number(item.quantity) || 1))),
      price: centavos(preco),
      comboSelections: item.comboSelections ?? null,
      notes: item.notes ? String(item.notes).trim().slice(0, 200) || null : null,
      bebidas: bebidasDoItem({ menuProductId: produto.id, preco: centavos(preco), comboSelections: item.comboSelections }, mapaDeBebidas),
    });
  }

  const estoque = await conferirEstoque(lojaId, itens);
  if (!estoque.ok) return { ok: false, status: 409, error: estoque.mensagem };

  const naConta = itens.map((i) => ({ preco: i.price, qtd: i.quantity, bebidas: i.bebidas }));
  const valor = centavos(itens.reduce((t, i) => t + i.price * i.quantity, 0));
  const dia = diaDoExpediente(fuso);
  const observacao = String(opts.observacao ?? "").trim().slice(0, 300);
  const { generateDailyOrderNumberTx } = await import("@/lib/order-number");
  // Onde a bebida a mais vai parar: o fiado dele. Sem cadastro no fiado (não
  // deveria acontecer: o fiado espelha a equipe), cai no acerto, como antes.
  const fiadoDele = cfg.umaBebidaPorDia ? await cadastroNoFiado(lojaId, motoboy.id).catch(() => null) : null;
  const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

  const r = await prisma.$transaction(async (tx) => {
    // A trava do motoboy: o segundo pedido espera o primeiro gravar.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"lanche:" + motoboy.id}))`;
    const hoje = await consumoDoDia(lojaId, motoboy.id, dia, tx);
    const divisao = contaDoLanche({ itens: naConta, jaUsado: hoje.usado, limite: cfg.limite, umaBebidaPorDia: cfg.umaBebidaPorDia, bebidasHoje: hoje.bebidas });
    // A bebida a mais só sai com o "Aceito" do motoboy (a tela pergunta antes).
    if (divisao.bebidasFora > 0 && !opts.aceitouBebidaFora) return { recusa: divisao.valorDasBebidasFora };
    const numero = await generateDailyOrderNumberTx(tx as any, lojaId);
    const linhaDoTopo = opts.levar ? "🥡 PARA LEVAR" : "🍽️ COMER NA LOJA";
    const fiado = fiadoDele ? divisao.valorDasBebidasFora : 0;
    const excedente = centavos(divisao.excedente + (fiadoDele ? 0 : divisao.valorDasBebidasFora));
    const conta = excedente > 0
      ? `Lanche da equipe: ${reais(divisao.coberto)} no combinado + ${reais(excedente)} descontado no acerto`
      : "Lanche da equipe: dentro do combinado";
    const daBebida = divisao.bebidasFora > 0
      ? `🥤 ${divisao.bebidasFora} bebida${divisao.bebidasFora > 1 ? "s" : ""} fora do crédito (${reais(divisao.valorDasBebidasFora)}) — ${fiadoDele ? "lançada no fiado do motoboy" : "descontada no acerto"}`
      : "";
    const order = await tx.customerOrder.create({
      data: {
        franchiseeId: lojaId,
        dailyOrderNumber: numero,
        customerName: `Equipe — ${motoboy.name}`.slice(0, 80),
        customerPhone: "00000000000",
        customerAddress: opts.levar ? "Para levar" : "Comer na loja",
        deliveryType: "RETIRADA",
        paymentMethod: FORMA_DO_LANCHE,
        notes: [linhaDoTopo, conta, daBebida, observacao].filter(Boolean).join("\n"),
        deliveryFee: 0,
        // A bebida do fiado sai deste total (vai no lançamento do fiado, senão contaria duas vezes).
        discountTotal: centavos(divisao.coberto + fiado),
        totalAmount: excedente,
        status: "ACEITO",
        source: SOURCE_DO_LANCHE,
        items: {
          create: itens.map((i) => ({
            menuProductId: i.menuProductId,
            quantity: i.quantity,
            price: i.price,
            comboSelections: i.comboSelections ? (typeof i.comboSelections === "string" ? i.comboSelections : JSON.stringify(i.comboSelections)) : undefined,
            notes: i.notes,
          })),
        },
      },
      select: { id: true, dailyOrderNumber: true },
    });
    // O lançamento no fiado, igual ao "Lançar dívida" da tela Fiado.
    let fiadoPedidoId: string | null = null;
    if (fiadoDele && fiado > 0) {
      const lancamento = await tx.customerOrder.create({
        data: {
          franchiseeId: lojaId,
          employeeId: fiadoDele.id,
          customerName: fiadoDele.name,
          customerPhone: fiadoDele.phone || "",
          status: "ENTREGUE",
          source: "PDV",
          paymentMethod: "FIADO",
          totalAmount: fiado,
          notes: `🥤 Bebida fora do crédito do lanche (pedido #${numero ?? "—"}) — 1 bebida por dia no crédito`,
          items: { create: [] },
        },
        select: { id: true },
      });
      fiadoPedidoId = lancamento.id;
    }
    const id = `lde_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await tx.$executeRaw`
      INSERT INTO "LancheDaEquipe" ("id", "lojaId", "motoboyId", "motoboyNome", "pedidoId", "dia", "valor", "coberto", "excedente", "levar", "bebidasNoCredito", "fiado", "fiadoPedidoId", "createdAt")
      VALUES (${id}, ${lojaId}, ${motoboy.id}, ${motoboy.name}, ${order.id}, ${dia}, ${valor}, ${divisao.coberto}, ${excedente}, ${opts.levar}, ${divisao.bebidasNoCredito}, ${fiado}, ${fiadoPedidoId}, ${horaEmUtc(new Date())})`;
    return { order, divisao, excedente, fiado };
  });
  if ("recusa" in r) {
    const fora = r.recusa ?? 0;
    return { ok: false, status: 409, error: avisoDaBebidaFora(fora), codigo: CODIGO_BEBIDA_FORA, valorDasBebidasFora: fora };
  }

  const { deductStockForOrder } = await import("@/lib/stock");
  deductStockForOrder(r.order.id).catch((err) => console.error("[Lanche] baixa de estoque falhou:", err?.message || err));

  return {
    ok: true,
    pedidoId: r.order.id,
    numero: r.order.dailyOrderNumber ?? null,
    valor,
    coberto: r.divisao.coberto,
    excedente: r.excedente ?? 0,
    fiado: r.fiado ?? 0,
    restante: r.divisao.restanteDepois,
  };
}
