import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { regimeNumerico } from "@/lib/fiscal-config";
import { cfopValido, csosnValido, cstIcmsValido, origemValida, pendenciasDoProduto } from "@/lib/fiscal-validacao";
import { problemaDaCombinacao } from "@/lib/nfce/ncm-sugerido";
import { alterarFiscalConfig, ConflitoNaGravacao } from "@/lib/nfce/gravar-config-fiscal";

const so = (v: unknown) => [...String(v ?? "")].filter((c) => c >= "0" && c <= "9").join("");
const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

/**
 * A marca do NCM ASSISTIDO: o produto recebeu o NCM por sugestão (lote por
 * categoria) e ainda não foi revisado. Mora em `fiscalConfig.ncmAssistido`
 * (por id do produto) porque MenuProduct não tem onde guardar — e mudar o
 * schema por uma marca de revisão não vale a migração. A tela mostra
 * "sugestão aplicada — revisar com o contador" enquanto o NCM gravado for o da
 * marca; editar o produto à mão (ou "revisado") tira a marca.
 */
type MarcaDaSugestao = { ncm: string; regra: string; em: string; por?: string | null };

function marcasValidas(bruto: unknown): Record<string, MarcaDaSugestao> {
  const saida: Record<string, MarcaDaSugestao> = {};
  for (const [id, m] of Object.entries(objeto(bruto))) {
    const marca = objeto(m);
    if (typeof marca.ncm === "string" && typeof marca.regra === "string") {
      saida[id] = { ncm: marca.ncm, regra: marca.regra, em: String(marca.em ?? ""), por: marca.por ?? null };
    }
  }
  return saida;
}

async function sessaoDaLoja() {
  const session = await getServerSession(authOptions);
  if (!session) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, role: true, email: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  return { user, franchiseeId: user.ownerId || user.id };
}

export async function GET() {
  try {
    const s = await sessaoDaLoja();
    if ("erro" in s) return s.erro;
    const { franchiseeId } = s;

    const [products, loja] = await Promise.all([
      prisma.menuProduct.findMany({
        where: { franchiseeId, active: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      prisma.user.findUnique({ where: { id: franchiseeId }, select: { fiscalConfig: true } }),
    ]);
    const fc = objeto(loja?.fiscalConfig);

    return NextResponse.json({
      success: true,
      products,
      // O NCM assistido roda na tela (lib/nfce/ncm-sugerido é puro): ela
      // precisa do regime (MEI muda CFOP/CSOSN) e da UF (o que se sabe de ST).
      ncmAssistido: marcasValidas(fc.ncmAssistido),
      regime: regimeNumerico(fc.regimeTributario),
      uf: typeof fc.uf === "string" ? fc.uf.trim().toUpperCase() : null,
    });
  } catch (err: any) {
    console.error("[Fiscal Produtos GET]", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const s = await sessaoDaLoja();
    if ("erro" in s) return s.erro;
    const { user, franchiseeId } = s;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });

    if (Array.isArray(body.lote)) return aplicarLote(body, { user, franchiseeId });
    if (Array.isArray(body.revisados)) return marcarRevisados(body.revisados, { user, franchiseeId });

    // O produto AVULSO é a mesma decisão do lote, um de cada vez: NCM, CFOP,
    // CSOSN e CEST errados saem em toda nota daquele produto (e a SEFAZ recusa
    // a nota inteira por um CEST que falta — rejeição 806). O lote já era só do
    // titular; o avulso não conferia, e o funcionário reclassificava produto
    // por produto.
    const bloqueio = soTitular(user.role, "Alterar a classificação fiscal de um produto");
    if (bloqueio) return bloqueio;

    const { productId, ncm, cest, cfop, origem, csosn, pis, cofins } = body;

    if (!productId) return NextResponse.json({ error: "Product ID obrigatório" }, { status: 400 });

    // ── NADA DE NCM DE MENTIRA ───────────────────────────────────────────────
    // Aqui era `ncm: ncm || "2106.90.90"`. Produto salvo com o campo vazio
    // recebia esse NCM em silêncio e passava a aparecer como "Regular" na tela
    // fiscal — o lojista via o cardápio inteiro verde sem ter cadastrado um NCM
    // sequer. 2106.90.90 é "preparações alimentícias não especificadas": serve
    // para quase nada e classifica errado quase tudo, e classificação errada é
    // problema do lojista com a Receita, não nosso.
    //
    // Agora: NCM vazio fica vazio, e a tela mostra o produto como pendente.
    const problemas: string[] = [];

    if (ncm && so(ncm).length !== 8) problemas.push("NCM precisa ter 8 dígitos.");
    // As regras da lib (as mesmas que a emissão aplica). A validação local
    // aceitava CFOP de entrada (1102) e CSOSN inexistente — o erro só
    // aparecia na hora de emitir, com a fila esperando.
    if (cfop && !cfopValido(cfop)) problemas.push("CFOP: 4 dígitos começando em 5, 6 ou 7 (venda é saída).");
    if (cest && so(cest).length !== 7) problemas.push("CEST precisa ter 7 dígitos (ou ficar vazio).");
    if (csosn && !(csosnValido(csosn) || cstIcmsValido(csosn))) {
      problemas.push("Situação tributária: CSOSN de 3 dígitos (Simples) ou CST de 2 dígitos (Regime Normal).");
    }
    if (origem !== undefined && origem !== null && origem !== "" && !origemValida(origem)) {
      problemas.push("Origem da mercadoria: 0 a 8.");
    }
    // CSOSN 500 sem CEST: a SEFAZ recusa a nota inteira (rejeição 806).
    const combinacao = "csosn" in body && "cest" in body ? problemaDaCombinacao({ csosn, cest }) : null;
    if (combinacao) problemas.push(combinacao);
    if (problemas.length > 0) {
      return NextResponse.json({ error: "dados_invalidos", mensagem: problemas.join(" ") }, { status: 400 });
    }

    // Só grava o que veio no corpo. O update antigo escrevia TODOS os campos
    // em toda chamada: um PUT que só trazia o NCM resetava CFOP/CSOSN/PIS/
    // COFINS personalizados para os padrões, em silêncio.
    const data: any = {};
    if ("ncm" in body) data.ncm = ncm ? so(ncm) : null;
    if ("cest" in body) data.cest = cest ? so(cest) : null;
    // 5102 (venda dentro do estado) e 102 (Simples, sem crédito) são os
    // valores certos para a esmagadora maioria de restaurante.
    if ("cfop" in body) data.cfop = cfop ? so(cfop) : "5102";
    if ("origem" in body) data.origem = String(origem ?? "0") || "0";
    if ("csosn" in body) data.csosn = csosn ? String(csosn).trim() : "102";
    if ("pis" in body) data.pis = pis || "49";
    if ("cofins" in body) data.cofins = cofins || "49";

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nenhum campo fiscal para atualizar." }, { status: 400 });
    }

    const updated = await prisma.menuProduct.updateMany({
      where: { id: productId, franchiseeId },
      data,
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Produto não encontrado nesta loja" }, { status: 404 });
    }

    // Editar o produto à mão é a revisão dele: a marca de "sugestão aplicada"
    // sai (se existia). Falhar aqui não desfaz a gravação do produto.
    if ("ncm" in body) {
      try {
        await tirarMarcas(franchiseeId, [String(productId)]);
      } catch (e: any) {
        console.error("[Fiscal Produtos] marca do NCM assistido não saiu:", String(e?.message ?? "").slice(0, 200));
      }
    }

    return NextResponse.json({ success: true, count: updated.count });
  } catch (err: any) {
    console.error("[Fiscal Produtos PUT]", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

async function tirarMarcas(franchiseeId: string, ids: string[]): Promise<number> {
  return alterarFiscalConfig(franchiseeId, (bruto) => {
    const atual = objeto(bruto);
    const marcas = marcasValidas(atual.ncmAssistido);
    const presentes = ids.filter((id) => id in marcas);
    if (presentes.length === 0) return { gravar: null, resposta: 0 };
    for (const id of presentes) delete marcas[id];
    return { gravar: { ...atual, ncmAssistido: marcas }, resposta: presentes.length };
  });
}

/** Classificar produto (avulso ou em lote) e marcar revisado é decisão do titular (com o contador), não do balcão. */
function soTitular(role: string | null | undefined, oQue = "Aplicar a classificação fiscal em lote") {
  if (role === "STAFF") {
    return NextResponse.json(
      { error: "sem_permissao", mensagem: `${oQue} é decisão do responsável pela loja — de preferência com o contador.` },
      { status: 403 }
    );
  }
  return null;
}

const MAXIMO_DO_LOTE = 500;

/**
 * PUT { lote: [{ productId, ncm, cest, cfop, csosn, regra }], ... } — a
 * sugestão do NCM assistido aplicada a vários produtos (uma categoria).
 *
 * TUDO ou NADA: cada linha passa pelas mesmas regras do produto avulso (NCM de
 * 8 dígitos, CFOP de saída, CEST de 7, CSOSN da tabela) e pela conferência da
 * nota (lib/fiscal-validacao → pendenciasDoProduto: CSOSN×CFOP, MEI) e, com
 * CSOSN 500, o CEST obrigatório (rejeição 806). Uma linha ruim recusa o lote
 * inteiro, dizendo qual — meio cardápio classificado e meio não é pior que
 * nenhum.
 *
 * Cada produto gravado ganha a marca de sugestão (`fiscalConfig.ncmAssistido`).
 */
async function aplicarLote(body: Record<string, any>, ctx: { user: { id: string; role: string | null; email: string | null }; franchiseeId: string }) {
  const bloqueio = soTitular(ctx.user.role);
  if (bloqueio) return bloqueio;
  const linhas = body.lote as unknown[];
  if (linhas.length === 0) return NextResponse.json({ error: "lote_vazio", mensagem: "Nenhum produto no lote." }, { status: 400 });
  if (linhas.length > MAXIMO_DO_LOTE) {
    return NextResponse.json({ error: "lote_grande", mensagem: `No máximo ${MAXIMO_DO_LOTE} produtos por vez.` }, { status: 400 });
  }

  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { fiscalConfig: true } });
  const regime = regimeNumerico(objeto(loja?.fiscalConfig).regimeTributario) ?? 1;

  const ids = linhas.map((l) => String(objeto(l).productId ?? ""));
  const produtos = await prisma.menuProduct.findMany({
    where: { id: { in: ids.filter(Boolean) }, franchiseeId: ctx.franchiseeId },
    select: { id: true, name: true },
  });
  const nomes = new Map(produtos.map((p) => [p.id, p.name]));

  const problemas: string[] = [];
  const gravar: Array<{ id: string; data: Record<string, string | null>; regra: string; ncm: string }> = [];
  const vistos = new Set<string>();
  for (const bruta of linhas) {
    const l = objeto(bruta);
    const id = String(l.productId ?? "");
    const nome = nomes.get(id);
    if (!id || !nome) {
      problemas.push(`Produto ${id || "(sem id)"} não encontrado nesta loja.`);
      continue;
    }
    if (vistos.has(id)) continue;
    vistos.add(id);
    const ncm = so(l.ncm);
    const cest = so(l.cest);
    const cfop = so(l.cfop);
    const csosn = l.csosn === null || l.csosn === undefined || l.csosn === "" ? null : String(l.csosn).trim();
    const erros: string[] = [];
    if (ncm.length !== 8) erros.push("NCM precisa ter 8 dígitos");
    if (cest && cest.length !== 7) erros.push("CEST precisa ter 7 dígitos");
    if (!cfopValido(cfop)) erros.push("CFOP de saída com 4 dígitos");
    if (csosn !== null && !(csosnValido(csosn) || cstIcmsValido(csosn))) erros.push("CSOSN/CST fora da tabela");
    if (erros.length === 0 && csosn !== null) {
      for (const p of pendenciasDoProduto({ ncm, cfop, cest, csosn, origem: 0, unidadeComercial: "UN" }, regime)) erros.push(p.mensagem);
      const c = problemaDaCombinacao({ csosn, cest });
      if (c) erros.push(c);
    }
    if (erros.length > 0) {
      problemas.push(`${nome}: ${erros.join("; ")}.`);
      continue;
    }
    const data: Record<string, string | null> = { ncm, cest: cest || null, cfop };
    // CRT 2/3: a sugestão não traz CSOSN (é CST) — o que está gravado fica.
    if (csosn !== null) data.csosn = csosn;
    gravar.push({ id, data, regra: String(l.regra ?? "manual").slice(0, 40), ncm });
  }
  if (problemas.length > 0) {
    return NextResponse.json(
      { error: "lote_invalido", mensagem: `Nada foi gravado: ${problemas.length} produto(s) com problema.`, problemas: problemas.slice(0, 30) },
      { status: 400 }
    );
  }

  await prisma.$transaction(
    gravar.map((g) => prisma.menuProduct.updateMany({ where: { id: g.id, franchiseeId: ctx.franchiseeId }, data: g.data }))
  );

  const agora = new Date().toISOString();
  try {
    await alterarFiscalConfig(ctx.franchiseeId, (bruto) => {
      const atual = objeto(bruto);
      const marcas = marcasValidas(atual.ncmAssistido);
      for (const g of gravar) marcas[g.id] = { ncm: g.ncm, regra: g.regra, em: agora, por: ctx.user.email ?? ctx.user.id };
      return { gravar: { ...atual, ncmAssistido: marcas }, resposta: null };
    });
  } catch (e: any) {
    // Os produtos já estão gravados; a marca é aviso de revisão. Falhou? A
    // tela mostra o produto como "Regular" — e a resposta diz para revisar.
    if (!(e instanceof ConflitoNaGravacao)) console.error("[Fiscal Produtos lote] marca não gravada:", String(e?.message ?? "").slice(0, 200));
    return NextResponse.json({
      success: true,
      count: gravar.length,
      aviso: "Os produtos foram gravados, mas não consegui marcá-los como sugestão. Revise-os com o contador mesmo assim.",
    });
  }

  return NextResponse.json({
    success: true,
    count: gravar.length,
    mensagem: `${gravar.length} produto(s) com a sugestão aplicada. Eles ficam marcados como "sugestão — revisar com o contador" até você revisar.`,
  });
}

/** PUT { revisados: [ids] } — o contador conferiu: sai a marca de sugestão. */
async function marcarRevisados(ids: unknown[], ctx: { user: { role: string | null }; franchiseeId: string }) {
  const bloqueio = soTitular(ctx.user.role);
  if (bloqueio) return bloqueio;
  const lista = ids.map((x) => String(x ?? "")).filter(Boolean).slice(0, MAXIMO_DO_LOTE);
  try {
    const n = await tirarMarcas(ctx.franchiseeId, lista);
    return NextResponse.json({ success: true, count: n, mensagem: `${n} produto(s) marcados como revisados.` });
  } catch (e: any) {
    if (e instanceof ConflitoNaGravacao) return NextResponse.json({ error: "conflito", mensagem: e.message }, { status: 409 });
    throw e;
  }
}
