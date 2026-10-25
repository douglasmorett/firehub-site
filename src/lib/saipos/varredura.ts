/**
 * lib/saipos/varredura.ts — manda os pedidos do FireHub para o PDV Saipos da loja.
 *
 * Mesma ideia do Open Delivery de saída (lib/open-delivery-saida/eventos.ts):
 * VARREDURA, não gancho em cada rota. O pedido nasce por uma dúzia de
 * caminhos (site, robô, PDV, painel...); o cron (a cada 20 s) lê o que ainda
 * não foi enviado e manda. A chave única (integração, pedido) torna a volta
 * idempotente: rodar duas vezes não duplica envio, e o próprio Saipos recusa
 * order_id repetido (904, tratado como enviado).
 *
 * O que acontece com cada pedido (SaiposPedido.status):
 *   ENVIADO     o Saipos aceitou (ou já tinha: 904; ou espera caixa aberto: 920).
 *   REPETIR     rede ou 5xx do Saipos: tenta de novo (30 s, 1, 2, 5, 10, 20, 30 min...).
 *   ERRO        o Saipos recusou o DADO (902, 923...): não adianta repetir; o admin vê o motivo.
 *   SEM_CODIGO  um item não tem código PDV no cardápio do Saipos: tenta de novo a cada 10 min
 *               (relendo o cardápio da loja) por 3 h, e o admin vê qual item.
 *   IGNORADO    pedido que não vai para o Saipos (iFood, mesa...).
 * Pedido ENVIADO que depois foi cancelado no FireHub: POST /cancel-order uma vez.
 *
 * Só pedidos criados DEPOIS de ligar: o que já existia não é despejado no PDV.
 *
 * Acesso por SQL cru (as tabelas nascem em garantir-colunas); o `secret` do
 * parceiro vem de SAIPOS_SECRET (um para todas as lojas) e o `idPartner` de
 * cada loja fica cifrado no cofre.
 */
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoSaipos } from "@/lib/garantir-colunas";
import { decifrar } from "@/lib/cofre";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { baixarCatalogo, cancelarPedido, destinoDaResposta, enviarPedido, type Resposta } from "./cliente";
import { indiceDoCatalogo, type IndiceDoCatalogo, type LinhaDoCatalogo } from "./codigos";
import { modoNoSaipos, pedidoNoFormatoSaipos } from "./pedido";

export type IntegracaoSaipos = {
  id: string;
  franchiseeId: string;
  codStore: string;
  idPartnerCifrado: string;
  ativo: boolean;
  ligadoEm: Date;
  catalogo: string | null;
  catalogoEm: Date | null;
  catalogoErro: string | null;
  ultimaVarredura: Date | null;
};

const COLUNAS = `"id","franchiseeId","codStore","idPartnerCifrado","ativo","ligadoEm","catalogo","catalogoEm","catalogoErro","ultimaVarredura"`;

export const segredoDoParceiro = () => String(process.env.SAIPOS_SECRET || "").trim();

export async function integracoesAtivasDoSaipos(): Promise<IntegracaoSaipos[]> {
  if (!segredoDoParceiro() || !(await garantirEstruturaDoSaipos())) return [];
  return prisma.$queryRawUnsafe<IntegracaoSaipos[]>(`SELECT ${COLUNAS} FROM "SaiposIntegracao" WHERE "ativo" = true`);
}

export async function integracaoDaLojaNoSaipos(franchiseeId: string): Promise<IntegracaoSaipos | null> {
  if (!(await garantirEstruturaDoSaipos())) return null;
  const r = await prisma.$queryRawUnsafe<IntegracaoSaipos[]>(`SELECT ${COLUNAS} FROM "SaiposIntegracao" WHERE "franchiseeId" = $1 LIMIT 1`, franchiseeId);
  return r[0] ?? null;
}

// ── Tempo de espera entre tentativas ──────────────────────────────────────────

const ESPERA_MIN = [0.5, 1, 2, 5, 10, 20, 30];
export const MAXIMO_DE_TENTATIVAS = 12;
export const proximaTentativa = (tentativas: number, agora = Date.now()) =>
  new Date(agora + (ESPERA_MIN[Math.min(Math.max(tentativas - 1, 0), ESPERA_MIN.length - 1)] ?? 30) * 60_000);

const CATALOGO_VALE_MS = 12 * 3_600_000;
const RELER_SE_FALTA_CODIGO_MS = 10 * 60_000;
const SEM_CODIGO_DESISTE_MS = 3 * 3_600_000;

const indices = new Map<string, { em: number; indice: IndiceDoCatalogo }>();

function indiceDaIntegracao(integ: IntegracaoSaipos): IndiceDoCatalogo | null {
  if (!integ.catalogo) return null;
  const chave = `${integ.id}:${integ.catalogoEm ? new Date(integ.catalogoEm).getTime() : 0}`;
  const guardado = indices.get(chave);
  if (guardado) return guardado.indice;
  try {
    const linhas = JSON.parse(integ.catalogo) as LinhaDoCatalogo[];
    const indice = indiceDoCatalogo(Array.isArray(linhas) ? linhas : []);
    indices.set(chave, { em: Date.now(), indice });
    return indice;
  } catch {
    return null;
  }
}

/** Lê o cardápio da loja no Saipos e guarda. Devolve a integração atualizada ou o erro. */
export async function atualizarCatalogo(integ: IntegracaoSaipos): Promise<{ ok: true; integ: IntegracaoSaipos; linhas: number } | { ok: false; erro: string }> {
  const idPartner = decifrar(integ.idPartnerCifrado);
  const secret = segredoDoParceiro();
  if (!idPartner || !secret) return { ok: false, erro: "falta o idPartner da loja ou o SAIPOS_SECRET do servidor" };
  const r = await baixarCatalogo(idPartner, secret);
  if (!r.ok) {
    const erro = descreverErro(r.erro);
    await prisma.$executeRawUnsafe(`UPDATE "SaiposIntegracao" SET "catalogoErro" = $1, "updatedAt" = NOW() WHERE "id" = $2`, erro, integ.id);
    return { ok: false, erro };
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "SaiposIntegracao" SET "catalogo" = $1, "catalogoEm" = NOW(), "catalogoErro" = NULL, "updatedAt" = NOW() WHERE "id" = $2`,
    JSON.stringify(r.linhas), integ.id,
  );
  const nova = await integracaoDaLojaNoSaipos(integ.franchiseeId);
  return { ok: true, integ: nova || integ, linhas: r.linhas.length };
}

export function descreverErro(r: Resposta): string {
  const partes = [r.status ? `HTTP ${r.status}` : "sem resposta", r.codigo != null ? `código ${r.codigo}` : "", r.mensagem || ""].filter(Boolean);
  return partes.join(" · ").slice(0, 300);
}

// ── Gravação do que aconteceu com cada pedido ─────────────────────────────────

async function gravar(integ: IntegracaoSaipos, orderId: string, d: { status: string; tentativas?: number; proximaEm?: Date | null; erro?: string | null; avisos?: string[]; enviado?: boolean }) {
  const id = `sp_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36).slice(-4)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SaiposPedido" ("id","integracaoId","franchiseeId","orderId","status","tentativas","proximaEm","erro","avisos","enviadoEm")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,${d.enviado ? "NOW()" : "NULL"})
     ON CONFLICT ("integracaoId","orderId") DO UPDATE SET
       "status" = EXCLUDED."status", "tentativas" = EXCLUDED."tentativas", "proximaEm" = EXCLUDED."proximaEm",
       "erro" = EXCLUDED."erro", "avisos" = EXCLUDED."avisos",
       "enviadoEm" = COALESCE("SaiposPedido"."enviadoEm", EXCLUDED."enviadoEm"), "updatedAt" = NOW()`,
    id, integ.id, integ.franchiseeId, orderId, d.status, d.tentativas ?? 0, d.proximaEm ?? null, d.erro ?? null,
    d.avisos && d.avisos.length ? d.avisos.join(" | ").slice(0, 900) : null,
  );
}

const SELECT_DO_PEDIDO = {
  items: { include: { menuProduct: { select: { name: true } } } },
} as const;

/** Tenta enviar UM pedido e grava o resultado. */
async function processar(integ: IntegracaoSaipos, orderId: string, tentativasAntes: number, loja: any, indice: IndiceDoCatalogo | null): Promise<string> {
  const pedido: any = await prisma.customerOrder.findFirst({ where: { id: orderId, franchiseeId: integ.franchiseeId }, include: SELECT_DO_PEDIDO as any });
  if (!pedido) { await gravar(integ, orderId, { status: "IGNORADO", erro: "pedido não encontrado" }); return `${orderId.slice(-6)} sumiu`; }
  const cancelado = (STATUS_CANCELADOS as readonly string[]).includes(String(pedido.status || "").toUpperCase());
  if (cancelado || !modoNoSaipos(pedido)) {
    await gravar(integ, orderId, { status: "IGNORADO", erro: cancelado ? "cancelado antes de ser enviado" : "não vai para o Saipos" });
    return "";
  }
  if (!indice) {
    await gravar(integ, orderId, { status: "SEM_CODIGO", tentativas: tentativasAntes + 1, proximaEm: new Date(Date.now() + RELER_SE_FALTA_CODIGO_MS), erro: "o cardápio da loja no Saipos ainda não foi lido" });
    return `${pedido.dailyOrderNumber ?? orderId.slice(-6)}: sem cardápio do Saipos`;
  }
  const montado = pedidoNoFormatoSaipos(pedido, loja, { codStore: integ.codStore }, indice);
  if (!montado.ok) {
    await gravar(integ, orderId, { status: "SEM_CODIGO", tentativas: tentativasAntes + 1, proximaEm: new Date(Date.now() + RELER_SE_FALTA_CODIGO_MS), erro: `sem código no Saipos: ${montado.faltando.join(", ")}`.slice(0, 500) });
    return `#${pedido.dailyOrderNumber}: sem código (${montado.faltando.join(", ")})`;
  }
  const idPartner = decifrar(integ.idPartnerCifrado);
  if (!idPartner) { await gravar(integ, orderId, { status: "ERRO", erro: "idPartner ilegível (cofre)" }); return ""; }
  const resposta = await enviarPedido(idPartner, segredoDoParceiro(), montado.payload);
  const destino = destinoDaResposta(resposta);
  const tentativas = tentativasAntes + 1;
  if (destino === "ENVIADO") {
    await gravar(integ, orderId, { status: "ENVIADO", tentativas, avisos: montado.avisos, enviado: true });
    return `#${pedido.dailyOrderNumber}: enviado${resposta.codigo ? ` (${resposta.codigo})` : ""}`;
  }
  if (destino === "REPETIR" && tentativas < MAXIMO_DE_TENTATIVAS) {
    await gravar(integ, orderId, { status: "REPETIR", tentativas, proximaEm: proximaTentativa(tentativas), erro: descreverErro(resposta), avisos: montado.avisos });
    return `#${pedido.dailyOrderNumber}: tenta de novo (${descreverErro(resposta)})`;
  }
  await gravar(integ, orderId, { status: "ERRO", tentativas, erro: descreverErro(resposta), avisos: montado.avisos });
  return `#${pedido.dailyOrderNumber}: ERRO (${descreverErro(resposta)})`;
}

/** A volta de UMA loja: cardápio, pedidos novos, repetições e cancelamentos. */
export async function cicloDoSaipos(integ0: IntegracaoSaipos, temTempo: () => boolean = () => true): Promise<string[]> {
  const log: string[] = [];
  let integ = integ0;
  const idPartner = decifrar(integ.idPartnerCifrado);
  if (!idPartner) return ["idPartner ilegível (cofre)"];

  // 1. O cardápio da loja no Saipos (códigos PDV): lê ao ligar, a cada 12 h, e antes de repetir quem estava sem código.
  const idade = integ.catalogoEm ? Date.now() - new Date(integ.catalogoEm).getTime() : Infinity;
  const faltaCodigo = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "SaiposPedido" WHERE "integracaoId" = $1 AND "status" = 'SEM_CODIGO' AND "proximaEm" <= NOW()`, integ.id);
  if (idade > CATALOGO_VALE_MS || ((faltaCodigo[0]?.n ?? 0) > 0 && idade > RELER_SE_FALTA_CODIGO_MS)) {
    const a = await atualizarCatalogo(integ);
    if (a.ok) { integ = a.integ; log.push(`cardápio do Saipos relido (${a.linhas} linhas)`); }
    else log.push(`cardápio do Saipos NÃO leu: ${a.erro}`);
  }
  const indice = indiceDaIntegracao(integ);

  const loja = await prisma.user.findUnique({ where: { id: integ.franchiseeId }, select: { storeName: true, city: true, storeAddress: true } });

  // 2. Pedidos novos (criados depois de ligar, ainda sem registro).
  const novos = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT c."id" FROM "CustomerOrder" c
      WHERE c."franchiseeId" = $1 AND c."createdAt" >= $2 AND c."parentOrderId" IS NULL
        AND c."status" NOT IN ('CRIANDO_IA','AGUARDANDO_PAGAMENTO')
        AND NOT EXISTS (SELECT 1 FROM "SaiposPedido" s WHERE s."integracaoId" = $3 AND s."orderId" = c."id")
      ORDER BY c."createdAt" ASC LIMIT 25`,
    integ.franchiseeId, integ.ligadoEm, integ.id);
  for (const n of novos) {
    if (!temTempo()) { log.push("tempo do ciclo acabou"); break; }
    const l = await processar(integ, n.id, 0, loja, indice);
    if (l) log.push(l);
  }

  // 3. Repetições: rede/5xx e quem estava sem código (por até 3 h).
  const repetir = await prisma.$queryRawUnsafe<{ orderId: string; tentativas: number; status: string; createdAt: Date }[]>(
    `SELECT "orderId","tentativas","status","createdAt" FROM "SaiposPedido"
      WHERE "integracaoId" = $1 AND "status" IN ('REPETIR','SEM_CODIGO') AND "proximaEm" <= NOW()
      ORDER BY "proximaEm" ASC LIMIT 25`, integ.id);
  for (const r of repetir) {
    if (!temTempo()) break;
    if (r.status === "SEM_CODIGO" && Date.now() - new Date(r.createdAt).getTime() > SEM_CODIGO_DESISTE_MS) {
      await prisma.$executeRawUnsafe(`UPDATE "SaiposPedido" SET "status" = 'ERRO', "proximaEm" = NULL, "updatedAt" = NOW() WHERE "integracaoId" = $1 AND "orderId" = $2`, integ.id, r.orderId);
      log.push(`${r.orderId.slice(-6)}: desistiu após 3 h sem código`);
      continue;
    }
    const l = await processar(integ, r.orderId, r.tentativas, loja, indice);
    if (l) log.push(l);
  }

  // 4. Cancelados depois de enviados: avisa o Saipos uma vez.
  const cancelados = await prisma.$queryRawUnsafe<{ orderId: string }[]>(
    `SELECT s."orderId" FROM "SaiposPedido" s JOIN "CustomerOrder" c ON c."id" = s."orderId"
      WHERE s."integracaoId" = $1 AND s."status" = 'ENVIADO' AND s."canceladoEm" IS NULL
        AND c."status" IN ('CANCELADO','CANCELLED','CANCELED') LIMIT 10`, integ.id);
  for (const c of cancelados) {
    if (!temTempo()) break;
    const r = await cancelarPedido(idPartner, segredoDoParceiro(), c.orderId, integ.codStore);
    if (r.ok) {
      await prisma.$executeRawUnsafe(`UPDATE "SaiposPedido" SET "canceladoEm" = NOW(), "updatedAt" = NOW() WHERE "integracaoId" = $1 AND "orderId" = $2`, integ.id, c.orderId);
      log.push(`${c.orderId.slice(-6)}: cancelamento enviado`);
    } else {
      log.push(`${c.orderId.slice(-6)}: cancelamento NÃO foi (${descreverErro(r)})`);
    }
  }

  await prisma.$executeRawUnsafe(`UPDATE "SaiposIntegracao" SET "ultimaVarredura" = NOW() WHERE "id" = $1`, integ.id);
  return log;
}
