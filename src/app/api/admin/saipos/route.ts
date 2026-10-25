import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cifrar } from "@/lib/cofre";
import { garantirEstruturaDoSaipos } from "@/lib/garantir-colunas";
import { atualizarCatalogo, integracaoDaLojaNoSaipos, segredoDoParceiro } from "@/lib/saipos/varredura";
import { indiceDoCatalogo, relatorioDoCasamento, type LinhaDoCatalogo } from "@/lib/saipos/codigos";

/**
 * /api/admin/saipos — liga o FireHub ao PDV Saipos de uma loja. SÓ ADMIN.
 *
 * SENTIDO ÚNICO: FireHub → Saipos. Os pedidos feitos no FireHub (site, robô,
 * PDV, totem) chegam no PDV Saipos da loja. O contrário NÃO existe: o Saipos
 * não envia pedidos para fora (a API deles só recebe de parceiro), então o
 * que se lança direto no Saipos não aparece no FireHub.
 *
 * De propósito NÃO aparece na aba Integrações do lojista: a loja pede e a
 * equipe ativa por aqui (precisa do idPartner que a loja gera no Saipos em
 * Conta Saipos › Canais de Vendas e Integrações, e do código da loja).
 *
 *   GET  ?franchiseeId=|slug=   estado da loja (ou, sem filtro, todas as ligadas)
 *   POST {acao:"ligar", franchiseeId|slug, codStore, idPartner}
 *        {acao:"catalogo", franchiseeId|slug}   relê o cardápio do Saipos e mostra o casamento
 *        {acao:"desligar", franchiseeId|slug}
 *        {acao:"reenviar", franchiseeId|slug}   pedidos em ERRO/SEM_CODIGO voltam para a fila
 */
export const dynamic = "force-dynamic";

const AVISO_SENTIDO = "Sentido único: FireHub → Saipos. Os pedidos do FireHub chegam no PDV Saipos; o Saipos não envia pedidos para o FireHub (a API deles só recebe).";

async function exigirAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { email: session.user?.email || "" }, select: { role: true } });
  if (me?.role !== "ADMIN") return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  return null;
}

async function acharLoja(b: { franchiseeId?: string; slug?: string }) {
  const where = b.franchiseeId ? { id: String(b.franchiseeId) } : b.slug ? { slug: String(b.slug) } : null;
  if (!where) return null;
  return prisma.user.findFirst({ where, select: { id: true, storeName: true, slug: true } });
}

async function casamento(franchiseeId: string, catalogo: string | null) {
  if (!catalogo) return null;
  let linhas: LinhaDoCatalogo[] = [];
  try { linhas = JSON.parse(catalogo); } catch { return null; }
  const produtos = await prisma.menuProduct.findMany({ where: { franchiseeId }, select: { name: true, apenasEmCombo: true } });
  const r = relatorioDoCasamento(indiceDoCatalogo(linhas), produtos);
  return { casaram: r.casaram.length, semCodigo: r.semCodigo.slice(0, 80), opcoesSemCodigo: r.opcoesSemCodigo.slice(0, 80) };
}

async function estado(franchiseeId: string) {
  const integ = await integracaoDaLojaNoSaipos(franchiseeId);
  if (!integ) return { ligada: false };
  const contagem = await prisma.$queryRawUnsafe<{ status: string; n: number }[]>(
    `SELECT "status", COUNT(*)::int AS n FROM "SaiposPedido" WHERE "integracaoId" = $1 GROUP BY "status"`, integ.id);
  const problemas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "orderId","status","tentativas","erro","avisos","updatedAt" FROM "SaiposPedido"
      WHERE "integracaoId" = $1 AND "status" IN ('ERRO','SEM_CODIGO','REPETIR') ORDER BY "updatedAt" DESC LIMIT 20`, integ.id);
  return {
    ligada: integ.ativo,
    codStore: integ.codStore,
    ligadoEm: integ.ligadoEm,
    ultimaVarredura: integ.ultimaVarredura,
    catalogoEm: integ.catalogoEm,
    catalogoErro: integ.catalogoErro,
    pedidos: Object.fromEntries(contagem.map((c) => [c.status, c.n])),
    problemas,
    casamento: await casamento(franchiseeId, integ.catalogo),
  };
}

export async function GET(req: Request) {
  const negado = await exigirAdmin();
  if (negado) return negado;
  if (!(await garantirEstruturaDoSaipos())) return NextResponse.json({ error: "tabelas do Saipos indisponíveis" }, { status: 500 });
  const u = new URL(req.url);
  const loja = await acharLoja({ franchiseeId: u.searchParams.get("franchiseeId") || undefined, slug: u.searchParams.get("slug") || undefined });
  if (!loja) {
    const todas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "franchiseeId","codStore","ativo","ligadoEm","ultimaVarredura","catalogoErro" FROM "SaiposIntegracao" ORDER BY "ligadoEm" DESC`);
    return NextResponse.json({ aviso: AVISO_SENTIDO, secretNoServidor: Boolean(segredoDoParceiro()), lojas: todas });
  }
  return NextResponse.json({ aviso: AVISO_SENTIDO, loja, ...(await estado(loja.id)) });
}

export async function POST(req: Request) {
  const negado = await exigirAdmin();
  if (negado) return negado;
  if (!(await garantirEstruturaDoSaipos())) return NextResponse.json({ error: "tabelas do Saipos indisponíveis" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const loja = await acharLoja(b);
  if (!loja) return NextResponse.json({ error: "Loja não encontrada (franchiseeId ou slug)" }, { status: 404 });

  if (b.acao === "ligar") {
    if (!segredoDoParceiro()) return NextResponse.json({ error: "Falta SAIPOS_SECRET no servidor (o secret do FireHub como parceiro em developer.saipos.com)" }, { status: 400 });
    const codStore = String(b.codStore || "").trim();
    const idPartner = String(b.idPartner || "").trim();
    if (!codStore || !idPartner) return NextResponse.json({ error: "Informe codStore e idPartner da loja" }, { status: 400 });
    const id = `si_${Math.random().toString(36).slice(2, 12)}`;
    // Guarda DESLIGADA, testa a conexão lendo o cardápio, e só então liga: idPartner errado não vira loja "ligada" que não envia.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SaiposIntegracao" ("id","franchiseeId","codStore","idPartnerCifrado","ativo","ligadoEm")
       VALUES ($1,$2,$3,$4,false,NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "codStore" = EXCLUDED."codStore", "idPartnerCifrado" = EXCLUDED."idPartnerCifrado", "ativo" = false, "updatedAt" = NOW()`,
      id, loja.id, codStore, cifrar(idPartner));
    const integ = await integracaoDaLojaNoSaipos(loja.id);
    const lido = integ ? await atualizarCatalogo(integ) : ({ ok: false, erro: "não gravou" } as const);
    if (!lido.ok) return NextResponse.json({ error: `Não consegui ler o cardápio no Saipos (idPartner ou secret errado?): ${lido.erro}`, ligada: false }, { status: 400 });
    // ligadoEm = agora: só pedidos DEPOIS de ligar vão para o Saipos.
    await prisma.$executeRawUnsafe(`UPDATE "SaiposIntegracao" SET "ativo" = true, "ligadoEm" = NOW(), "updatedAt" = NOW() WHERE "franchiseeId" = $1`, loja.id);
    return NextResponse.json({ ok: true, aviso: AVISO_SENTIDO, loja, ...(await estado(loja.id)) });
  }

  const integ = await integracaoDaLojaNoSaipos(loja.id);
  if (!integ) return NextResponse.json({ error: "Esta loja não tem integração com o Saipos" }, { status: 404 });

  if (b.acao === "catalogo") {
    const r = await atualizarCatalogo(integ);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ ok: true, linhas: r.linhas, ...(await estado(loja.id)) });
  }
  if (b.acao === "desligar") {
    await prisma.$executeRawUnsafe(`UPDATE "SaiposIntegracao" SET "ativo" = false, "updatedAt" = NOW() WHERE "id" = $1`, integ.id);
    return NextResponse.json({ ok: true, ...(await estado(loja.id)) });
  }
  if (b.acao === "reenviar") {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "SaiposPedido" SET "status" = 'REPETIR', "tentativas" = 0, "proximaEm" = NOW(), "updatedAt" = NOW()
        WHERE "integracaoId" = $1 AND "status" IN ('ERRO','SEM_CODIGO')`, integ.id);
    return NextResponse.json({ ok: true, voltaramParaAFila: n });
  }
  return NextResponse.json({ error: "acao deve ser ligar, catalogo, desligar ou reenviar" }, { status: 400 });
}
