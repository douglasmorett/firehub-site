/**
 * Indique e Ganhe — a parte que fala com o banco. A regra está em
 * lib/indicacao.ts.
 *
 * ── O código de cada telefone (tabela CodigoDeIndicacao) ────────────────────
 *
 * Um código curto e estável por telefone e loja, criado na primeira vez que o
 * cardápio pergunta (GET /api/store-customer com a indicação ligada). Não vai
 * no schema.prisma, como o CashbackAjuste (lib/cashback-no-banco.ts): SQL cru,
 * a tabela nasce aqui, e se faltar o cardápio só não mostra o link — o
 * checkout segue sem indicação, sem 500.
 *
 * ── O pedido do amigo (coluna CustomerOrder.indicacao) ──────────────────────
 *
 * O primeiro pedido do amigo grava `indicacao` (ResgateDaIndicacao). É dela
 * que sai o crédito de quem indicou — `pedidosIndicadosPor` acha os pedidos
 * pelo `indicador` (8 últimos dígitos), e o saldo do cashback soma.
 */

import { randomInt } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { finalDoTelefone } from "./pedidos-do-telefone";
import { idsDosPedidosDoTelefone } from "./pedidos-do-telefone-no-banco";
import {
  avaliarIndicacao,
  creditosDaIndicacao,
  gerarCodigo,
  indicacoesDoIndicador,
  lerIndicacao,
  lerReferencia,
  primeiroNome,
  type Indicador,
  type IndicacaoFeita,
  type PedidoIndicado,
  type VeredictoDaIndicacao,
} from "./indicacao";
import type { CreditosExtras } from "./cashback";

let tabelaOk = false;

/** A tabela dos códigos existe? Uma vez por processo — e só marca DEPOIS de conseguir. */
export async function garantirTabelaDeCodigos(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CodigoDeIndicacao" (
      "lojaId" TEXT NOT NULL,
      "final" TEXT NOT NULL,
      "telefone" TEXT NOT NULL,
      "codigo" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
      CONSTRAINT "CodigoDeIndicacao_pkey" PRIMARY KEY ("lojaId", "final")
    )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "CodigoDeIndicacao_lojaId_codigo_key" ON "CodigoDeIndicacao"("lojaId", "codigo")`,
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Indicação] 🛑 Tabela CodigoDeIndicacao falhou: ${err?.message}`);
    return false;
  }
}

/** O código deste telefone nesta loja — cria na primeira vez. `null` sem tabela ou sem telefone. */
export async function codigoDoTelefone(lojaId: string, telefone: string): Promise<string | null> {
  const final = finalDoTelefone(telefone);
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (!final || !lojaId || !(await garantirTabelaDeCodigos())) return null;
  try {
    const achar = async () => {
      const [l] = await prisma.$queryRaw<{ codigo: string }[]>`
        SELECT "codigo" FROM "CodigoDeIndicacao" WHERE "lojaId" = ${lojaId} AND "final" = ${final} LIMIT 1`;
      return l?.codigo ?? null;
    };
    const existente = await achar();
    if (existente) return existente;
    // Código repetido na loja (raro: 31^6) só faz o INSERT não entrar — sorteia de novo.
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      await prisma.$executeRaw`
        INSERT INTO "CodigoDeIndicacao" ("lojaId", "final", "telefone", "codigo")
        VALUES (${lojaId}, ${final}, ${digitos.slice(-13)}, ${gerarCodigo(randomInt)})
        ON CONFLICT DO NOTHING`;
      const criado = await achar();
      if (criado) return criado;
    }
    return null;
  } catch (err: any) {
    console.error(`[Indicação] código do telefone falhou: ${err?.message}`);
    return null;
  }
}

/** O nome do último pedido deste telefone na loja (o primeiro nome vai na comanda do amigo). */
async function nomeDoTelefone(lojaId: string, telefone: string): Promise<string | null> {
  const ids = await idsDosPedidosDoTelefone(lojaId, telefone, 5);
  if (!ids.length) return null;
  const pedidos = await prisma.customerOrder.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { customerName: true },
  });
  for (const p of pedidos) {
    const nome = primeiroNome(p.customerName);
    if (nome) return nome;
  }
  return null;
}

/** Quem indicou, pelo que veio no `?ref=` (código ou telefone do link antigo). */
export async function indicadorDaReferencia(lojaId: string, bruto: unknown): Promise<{ codigo: string; indicador: Indicador } | null> {
  const ref = lerReferencia(bruto);
  if (!ref || !lojaId) return null;
  if (ref.tipo === "telefone") {
    return { codigo: ref.final, indicador: { final: ref.final, telefone: null, nome: await nomeDoTelefone(lojaId, ref.final) } };
  }
  if (!(await garantirTabelaDeCodigos())) return null;
  const [l] = await prisma.$queryRaw<{ final: string; telefone: string }[]>`
    SELECT "final", "telefone" FROM "CodigoDeIndicacao" WHERE "lojaId" = ${lojaId} AND "codigo" = ${ref.codigo} LIMIT 1`;
  if (!l) return null;
  return { codigo: ref.codigo, indicador: { final: l.final, telefone: l.telefone, nome: await nomeDoTelefone(lojaId, l.telefone) } };
}

/**
 * A indicação neste pedido do site: confere tudo no servidor (loja ligada,
 * código, primeiro pedido do telefone, mínimo, auto-indicação). `null` quando
 * não há código ou a loja não tem o programa — o checkout nem pergunta nada.
 */
export async function indicacaoNoPedido(e: {
  lojaId: string;
  storeLoyalty: unknown;
  telefone: string;
  referencia: unknown;
  produtos: number;
  produtosAPagar: number;
  comCupomDePrimeiroPedido: boolean;
}): Promise<VeredictoDaIndicacao | null> {
  const regra = lerIndicacao(e.storeLoyalty);
  if (!regra.ativo || !lerReferencia(e.referencia)) return null;
  const achado = await indicadorDaReferencia(e.lojaId, e.referencia);
  const anteriores = await pedidosAnterioresDoTelefone(e.lojaId, e.telefone);
  return avaliarIndicacao({
    regra,
    codigo: achado?.codigo || "",
    telefoneDoAmigo: e.telefone,
    indicador: achado?.indicador ?? null,
    pedidosAnteriores: anteriores,
    produtos: e.produtos,
    produtosAPagar: e.produtosAPagar,
    comCupomDePrimeiroPedido: e.comCupomDePrimeiroPedido,
  });
}

/** Os status dos pedidos deste telefone na loja (qualquer canal) — para o "primeiro pedido". */
async function pedidosAnterioresDoTelefone(lojaId: string, telefone: string) {
  const ids = await idsDosPedidosDoTelefone(lojaId, telefone, 50);
  if (!ids.length) return [];
  return prisma.customerOrder.findMany({ where: { id: { in: ids } }, select: { status: true } });
}

/**
 * O que o cardápio mostra ao amigo ANTES de fechar: vale ou não, e quanto.
 * A mesma conta do checkout, com os produtos ainda desconhecidos (o mínimo
 * sai junto, e o cardápio confere com a sacola).
 */
export async function indicacaoParaOCardapio(lojaId: string, storeLoyalty: unknown, telefone: string, referencia: unknown) {
  const regra = lerIndicacao(storeLoyalty);
  if (!regra.ativo || !lerReferencia(referencia)) return null;
  const achado = await indicadorDaReferencia(lojaId, referencia);
  const anteriores = await pedidosAnterioresDoTelefone(lojaId, telefone);
  const v = avaliarIndicacao({
    regra,
    codigo: achado?.codigo || "",
    telefoneDoAmigo: telefone,
    indicador: achado?.indicador ?? null,
    pedidosAnteriores: anteriores,
    // O mínimo o cardápio confere com a sacola: aqui só as outras regras.
    produtos: Math.max(regra.minimo, 0.01),
    produtosAPagar: regra.descontoDoAmigo,
  });
  return {
    valido: v.ok,
    motivo: v.ok ? null : v.motivo,
    nome: achado?.indicador.nome ?? null,
    desconto: regra.descontoDoAmigo,
    minimo: regra.minimo,
  };
}

// ── O crédito de quem indicou ───────────────────────────────────────────────

const CAMPOS_DO_INDICADO = {
  id: true, status: true, deliveryType: true, createdAt: true, updatedAt: true, deliveredAt: true,
  dailyOrderNumber: true, customerName: true, indicacao: true,
} as const;

/** Os pedidos que gravaram indicação para este telefone (8 últimos dígitos), nesta loja. */
export async function pedidosIndicadosPor(lojaId: string, telefone: string): Promise<PedidoIndicado[]> {
  const final = finalDoTelefone(telefone);
  if (!final || !lojaId) return [];
  try {
    const linhas = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "CustomerOrder"
      WHERE "franchiseeId" = ${lojaId} AND "indicacao" IS NOT NULL AND "indicacao"->>'indicador' = ${final}
      ORDER BY "createdAt" ASC
      LIMIT 2000`);
    if (!linhas.length) return [];
    return prisma.customerOrder.findMany({ where: { id: { in: linhas.map((l) => l.id) } }, select: CAMPOS_DO_INDICADO });
  } catch (err: any) {
    // Coluna ainda não criada pelo boot: sem indicação, o saldo segue o de sempre.
    console.error(`[Indicação] leitura dos indicados falhou: ${err?.message}`);
    return [];
  }
}

/** As indicações deste telefone e o que elas põem no saldo do cashback. */
export async function indicacoesDoTelefone(lojaId: string, telefone: string): Promise<{ feitas: IndicacaoFeita[]; extras: CreditosExtras }> {
  const final = finalDoTelefone(telefone);
  if (!final) return { feitas: [], extras: { creditos: [], aReceber: 0 } };
  const feitas = indicacoesDoIndicador(await pedidosIndicadosPor(lojaId, telefone), final);
  return { feitas, extras: creditosDaIndicacao(feitas) };
}

/** Todos os pedidos com indicação da loja, por quem indicou — para a lista de saldos da aba Clientes. */
export async function indicacoesDaLoja(lojaId: string): Promise<Map<string, CreditosExtras>> {
  const mapa = new Map<string, CreditosExtras>();
  try {
    const pedidos = await prisma.customerOrder.findMany({
      where: { franchiseeId: lojaId, NOT: { indicacao: { equals: Prisma.AnyNull } } },
      select: CAMPOS_DO_INDICADO,
      orderBy: { createdAt: "asc" },
      take: 20_000,
    });
    const porIndicador = new Map<string, PedidoIndicado[]>();
    for (const p of pedidos) {
      const quem = (p.indicacao as any)?.indicador;
      if (typeof quem !== "string") continue;
      const lista = porIndicador.get(quem) || [];
      lista.push(p);
      porIndicador.set(quem, lista);
    }
    for (const [final, lista] of porIndicador) mapa.set(final, creditosDaIndicacao(indicacoesDoIndicador(lista, final)));
  } catch (err: any) {
    console.error(`[Indicação] indicações da loja falharam: ${err?.message}`);
  }
  return mapa;
}
