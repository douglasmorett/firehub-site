/**
 * CAIXA POR USUÁRIO — o que precisa do banco. As regras (de quem é o caixa,
 * qual é o principal, de qual caixa é cada venda) são puras e moram em
 * lib/caixa-por-usuario-regras.ts, com o porquê da funcionalidade.
 *
 * Tabela fora do schema.prisma, criada no primeiro uso (como
 * MotoboyAcertoPago em lib/acerto-pago.ts):
 *   CaixaDoLancamento — uma linha por venda lançada por um login com a chave
 *                       ligada: o pedido (tipo PEDIDO) ou a conta de mesa
 *                       fechada (tipo MESA), e o caixa em que ela caiu.
 * Fora do schema de propósito: o CustomerOrder é a tabela mais lida do
 * FireHub, e uma coluna nova nela faria todo SELECT de pedido depender do
 * boot ter criado a coluna. Aqui, só a loja com a chave ligada lê e grava; a
 * loja com a chave desligada nunca toca nesta tabela.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lerBalcaoConfig } from "@/lib/balcao-config";
import { chaveDoVinculo, donoDoCaixa, separarDoCaixa, type CaixaNaLinhaDoTempo, type TipoDoLancamento } from "@/lib/caixa-por-usuario-regras";

let tabelaOk = false;

export async function garantirTabelaDoCaixaPorUsuario(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    // Import na hora: esta lib entra no esperado do turno (lib/esperado-do-turno.ts),
    // e a loja com a chave desligada nunca precisa da DDL nem do que ela puxa.
    const { executarDDL } = await import("@/lib/ddl-do-boot");
    await executarDDL("caixa-por-usuario", [
      `CREATE TABLE IF NOT EXISTS "CaixaDoLancamento" (
      "tipo" TEXT NOT NULL,
      "refId" TEXT NOT NULL,
      "cashSessionId" TEXT NOT NULL,
      "franchiseeId" TEXT NOT NULL,
      "usuarioId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CaixaDoLancamento_pkey" PRIMARY KEY ("tipo", "refId")
    )`,
      `CREATE INDEX IF NOT EXISTS "CaixaDoLancamento_cashSessionId_idx" ON "CaixaDoLancamento"("cashSessionId")`,
    ]);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Caixa por usuário] 🛑 Tabela CaixaDoLancamento falhou: ${err?.message}`);
    return false;
  }
}

/**
 * A loja ligou "Cada usuário tem o seu próprio caixa"? Sempre a escolha do
 * DONO (`ownerId || id`), como o resto do balcaoConfig. Falha de leitura =
 * desligado: é o comportamento de sempre, e o caixa nunca para por isto.
 */
export async function caixaPorUsuarioLigado(lojaId: string): Promise<boolean> {
  try {
    const dono = await prisma.user.findUnique({ where: { id: lojaId }, select: { balcaoConfig: true } as any });
    return lerBalcaoConfig((dono as any)?.balcaoConfig).caixaPorUsuario;
  } catch (err: any) {
    console.warn("[Caixa por usuário] não consegui ler a chave:", err?.code || err?.message);
    return false;
  }
}

/**
 * O caixa aberto que vale para ESTE login.
 *
 * Chave desligada (ou ninguém logado — garçom pelo link, site, sistema): o
 * caixa da loja, exatamente a consulta de sempre (o aberto mais recente).
 * Chave ligada: só o caixa que ESTE login abriu; o do colega não serve.
 */
export async function caixaAbertoPara(lojaId: string, usuarioId: string | null | undefined, ligado?: boolean) {
  const modo = ligado ?? (usuarioId ? await caixaPorUsuarioLigado(lojaId) : false);
  if (!modo || !usuarioId) {
    return prisma.cashSession.findFirst({ where: { franchiseeId: lojaId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
  }
  const abertos = await prisma.cashSession.findMany({ where: { franchiseeId: lojaId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
  return abertos.find((c) => donoDoCaixa(c.abertoPor) === usuarioId) ?? null;
}

/**
 * Grava em qual caixa caiu esta venda. Nunca lança: a venda já foi gravada, e
 * sem o vínculo ela vai para o caixa principal (a regra do que não tem dono)
 * — fica no caixa errado, mas em UM caixa, sem sumir nem contar duas vezes.
 */
export async function vincularAoCaixa(tipo: TipoDoLancamento, refId: string, cashSessionId: string, lojaId: string, usuarioId: string | null): Promise<boolean> {
  try {
    if (!(await garantirTabelaDoCaixaPorUsuario())) return false;
    // A conta de mesa reaberta e fechada de novo fica no caixa do último fechamento.
    await prisma.$executeRaw`
      INSERT INTO "CaixaDoLancamento" ("tipo", "refId", "cashSessionId", "franchiseeId", "usuarioId")
      VALUES (${tipo}, ${refId}, ${cashSessionId}, ${lojaId}, ${usuarioId})
      ON CONFLICT ("tipo", "refId") DO UPDATE SET "cashSessionId" = EXCLUDED."cashSessionId", "usuarioId" = EXCLUDED."usuarioId"
    `;
    return true;
  } catch (err: any) {
    console.error(`[Caixa por usuário] não consegui vincular ${tipo} ${refId} ao caixa ${cashSessionId}:`, err?.message);
    return false;
  }
}

/**
 * Com a chave ligada, vincula a venda que ESTE login acabou de lançar ao
 * caixa aberto dele. Chave desligada: não faz nada (nem abre a tabela).
 */
export async function vincularVendaDoUsuario(tipo: TipoDoLancamento, refId: string, lojaId: string, usuarioId: string | null | undefined): Promise<void> {
  if (!usuarioId) return;
  try {
    if (!(await caixaPorUsuarioLigado(lojaId))) return;
    const caixa = await caixaAbertoPara(lojaId, usuarioId, true);
    if (caixa && donoDoCaixa(caixa.abertoPor) === usuarioId) await vincularAoCaixa(tipo, refId, caixa.id, lojaId, usuarioId);
  } catch (err: any) {
    console.error(`[Caixa por usuário] vínculo de ${tipo} ${refId}:`, err?.message);
  }
}

/** Os vínculos dos pedidos e contas de mesa pedidos, por `chaveDoVinculo`. Sem a tabela, vazio. */
async function vinculosDe(lojaId: string, pedidos: string[], mesas: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (pedidos.length === 0 && mesas.length === 0) return mapa;
  if (!(await garantirTabelaDoCaixaPorUsuario())) return mapa;
  const linhas = await prisma.$queryRaw<{ tipo: TipoDoLancamento; refId: string; cashSessionId: string }[]>(Prisma.sql`
    SELECT "tipo", "refId", "cashSessionId" FROM "CaixaDoLancamento"
    WHERE "franchiseeId" = ${lojaId}
      AND (("tipo" = 'PEDIDO' AND "refId" = ANY(${pedidos})) OR ("tipo" = 'MESA' AND "refId" = ANY(${mesas})))`);
  for (const l of linhas) mapa.set(chaveDoVinculo(l.tipo, l.refId), l.cashSessionId);
  return mapa;
}

/**
 * Do que a varredura do turno achou pelo horário, só o que é deste caixa por
 * usuário (lib/esperado-do-turno.ts). Busca os caixas da loja que cruzam a
 * janela (para saber quem era o principal em cada instante) e os vínculos.
 *
 * Se a leitura dos vínculos falhar, segue sem eles — tudo vai para o
 * principal: o número fica no caixa errado, mas cada venda continua em UM
 * caixa. Nunca devolve tudo (isso contaria a venda nos dois caixas).
 */
export async function separarParaOCaixaDoUsuario<P extends { id: string; createdAt: Date; parentOrderId?: string | null; tableSessionId?: string | null }, M extends { id?: string; closedAt?: Date | string | null }>(
  lojaId: string,
  caixa: { id: string; openedAt: Date; abertoPor?: unknown },
  ate: Date | null | undefined,
  pedidos: P[],
  mesas: M[],
): Promise<{ pedidos: P[]; mesas: M[] }> {
  const fim = ate ?? new Date();
  const caixas: CaixaNaLinhaDoTempo[] = await prisma.cashSession.findMany({
    where: {
      franchiseeId: lojaId,
      openedAt: { lte: fim },
      OR: [{ closedAt: null }, { closedAt: { gt: caixa.openedAt } }],
    },
    select: { id: true, openedAt: true, closedAt: true, abertoPor: true },
  });
  if (!caixas.some((c) => c.id === caixa.id)) caixas.push({ id: caixa.id, openedAt: caixa.openedAt, closedAt: ate ?? null, abertoPor: caixa.abertoPor });
  let vinculos = new Map<string, string>();
  try {
    const idsDePedido = new Set<string>();
    for (const o of pedidos) { idsDePedido.add(o.id); if (o.parentOrderId) idsDePedido.add(o.parentOrderId); }
    const idsDeMesa = new Set<string>();
    for (const o of pedidos) if (o.tableSessionId) idsDeMesa.add(o.tableSessionId);
    for (const m of mesas) if (m.id) idsDeMesa.add(m.id);
    vinculos = await vinculosDe(lojaId, [...idsDePedido], [...idsDeMesa]);
  } catch (err: any) {
    console.error("[Caixa por usuário] não consegui ler os vínculos — tudo no caixa principal:", err?.message);
  }
  return separarDoCaixa(caixa.id, lojaId, pedidos, mesas, caixas, vinculos);
}
