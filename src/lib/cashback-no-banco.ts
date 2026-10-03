/**
 * Cashback de um telefone numa loja — a única parte do cashback que fala com o
 * banco. A regra mora em lib/cashback.ts.
 *
 * O telefone é a identidade, como na Trilha Premiada: o cardápio não tem
 * sessão de cliente, e /api/customer-order é rota pública. Por isso o corpo do
 * pedido só PEDE para usar o saldo; quanto existe e quanto pode ser usado é o
 * servidor que calcula aqui.
 *
 * ── Os lançamentos à mão (tabela CashbackAjuste) ────────────────────────────
 *
 * A loja dá e tira saldo pela aba Clientes do painel (saldo trazido de outro
 * sistema, cortesia, correção). Cada lançamento é uma linha — nunca um
 * contador — e entra no MESMO cálculo dos pedidos (lib/cashback.ts), então o
 * saldo que o painel mostra é o que o cardápio deixa usar.
 *
 * A tabela não está no schema.prisma de propósito, como a memória do robô
 * (lib/memoria-da-conversa-no-banco.ts): o acesso é por SQL cru, o boot cria a
 * tabela, e se ela faltar a leitura devolve "nenhum lançamento" — o cardápio e
 * o pedido seguem com o saldo dos pedidos, sem 500 no checkout.
 */

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  extratoDoCashback,
  gastoEm30Dias,
  lerCashback,
  saldoDoCashback,
  taxaDoCliente,
  type AjusteDoCashback,
  type ExtratoDoCashback,
  type SaldoDoCashback,
} from "./cashback";
import { telefoneNacional } from "./lote-de-saldo";

export type CashbackDoCliente = SaldoDoCashback & {
  /** % que o próximo pedido gera (com o bônus VIP, se houver). */
  taxa: number;
};

// ── A tabela ────────────────────────────────────────────────────────────────

/**
 * A hora como o Prisma grava: TIMESTAMP sem fuso, em UTC. Um Date solto no SQL
 * cru vira timestamptz e o Postgres o converte pelo fuso DA SESSÃO — num banco
 * em America/Sao_Paulo o lançamento de agora apareceria 3 horas antes.
 */
export const horaEmUtc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

let tabelaOk = false;

/** A tabela dos lançamentos existe? Uma vez por processo — e só marca DEPOIS de conseguir. */
export async function garantirTabelaDeAjustes(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CashbackAjuste" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "telefone" TEXT NOT NULL,
      "nome" TEXT,
      "valor" DOUBLE PRECISION NOT NULL,
      "semVencimento" BOOLEAN NOT NULL DEFAULT false,
      "motivo" TEXT,
      "criadoPor" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "CashbackAjuste_pkey" PRIMARY KEY ("id")
    )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "CashbackAjuste_lojaId_telefone_idx" ON "CashbackAjuste"("lojaId", "telefone")`,
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Cashback] 🛑 Tabela CashbackAjuste falhou: ${err?.message}`);
    return false;
  }
}

type LinhaDeAjuste = AjusteDoCashback & { id: string; telefone: string; nome: string | null };

/**
 * Quem lê: o cliente do Prisma, ou a transação do lançamento — que lê o saldo
 * na MESMA conexão que segura a trava (outra conexão do pool poderia faltar).
 */
type Banco = Pick<typeof prisma, "$queryRaw" | "customerOrder">;

/** Os lançamentos da loja para um telefone (pelos 8 últimos dígitos, como os pedidos), ou todos. */
async function ajustesDaLoja(lojaId: string, final8?: string, db: Banco = prisma): Promise<LinhaDeAjuste[]> {
  if (!(await garantirTabelaDeAjustes())) return [];
  try {
    return final8
      ? await db.$queryRaw<LinhaDeAjuste[]>`
          SELECT "id", "telefone", "nome", "valor", "semVencimento", "motivo", "criadoPor", "createdAt"
          FROM "CashbackAjuste"
          WHERE "lojaId" = ${lojaId} AND "telefone" LIKE ${"%" + final8}
          ORDER BY "createdAt" ASC`
      : await db.$queryRaw<LinhaDeAjuste[]>`
          SELECT "id", "telefone", "nome", "valor", "semVencimento", "motivo", "criadoPor", "createdAt"
          FROM "CashbackAjuste"
          WHERE "lojaId" = ${lojaId}
          ORDER BY "createdAt" ASC`;
  } catch (err: any) {
    console.error(`[Cashback] leitura dos lançamentos falhou: ${err?.message}`);
    return [];
  }
}

// ── Os pedidos ──────────────────────────────────────────────────────────────

// Os campos que lib/canal-do-pedido.ts precisa para saber se o pedido é do site.
const CAMPOS_DO_PEDIDO = {
  id: true, status: true, source: true, deliveryType: true, totalAmount: true,
  createdAt: true, updatedAt: true, deliveredAt: true, cashbackEarned: true, cashbackUsed: true,
  ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true, openDeliveryOrderId: true,
  dailyOrderNumber: true,
} as const;

async function pedidosDoTelefone(franchiseeId: string, final8: string, db: Banco = prisma) {
  // O telefone fica gravado como o cliente digitou: "(22) 99999-1234",
  // "22999991234", "+55 22 9…". Comparar texto ("contém os 8 últimos dígitos")
  // não acha o que tem hífen no meio — é preciso comparar só os DÍGITOS.
  const doTelefone = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CustomerOrder"
    WHERE "franchiseeId" = ${franchiseeId}
      AND regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + final8}
    ORDER BY "createdAt" DESC
    LIMIT 500`;
  if (!doTelefone.length) return [];
  return db.customerOrder.findMany({
    where: { id: { in: doTelefone.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    select: CAMPOS_DO_PEDIDO,
  });
}

/** A chave do cliente no cashback: os 8 últimos dígitos do telefone (a mesma do cardápio). */
export function chaveDoSaldo(telefone: string | null | undefined): string | null {
  const digitos = String(telefone || "").replace(/\D/g, "");
  return digitos.length >= 8 ? digitos.slice(-8) : null;
}

// ── O cardápio e o pedido ───────────────────────────────────────────────────

export async function cashbackDoCliente(
  franchiseeId: string,
  storeLoyalty: unknown,
  telefone: string,
  agora = new Date(),
): Promise<CashbackDoCliente | null> {
  const regra = lerCashback(storeLoyalty);
  if (!regra.ativo) return null;
  const final = chaveDoSaldo(telefone);
  if (!final) return null;

  // O cliente que só tem o saldo trazido de outro sistema ainda não tem
  // pedido aqui — por isso os lançamentos contam mesmo sem pedido nenhum.
  const [pedidos, ajustes] = await Promise.all([pedidosDoTelefone(franchiseeId, final), ajustesDaLoja(franchiseeId, final)]);
  if (!pedidos.length && !ajustes.length) return { saldo: 0, proximoVencimento: null, taxa: taxaDoCliente(regra, 0) };

  const saldo = saldoDoCashback(regra, pedidos, agora, ajustes);
  return { ...saldo, taxa: taxaDoCliente(regra, gastoEm30Dias(pedidos, agora)) };
}

// ── O painel (aba Clientes) ─────────────────────────────────────────────────

/**
 * O extrato de um cliente na loja. Calcula mesmo com o cashback desligado: a
 * loja pode lançar o saldo antes de ligar, e o painel avisa que o cardápio
 * ainda não deixa usar.
 */
export async function extratoDoCliente(
  lojaId: string,
  storeLoyalty: unknown,
  telefone: string,
  agora = new Date(),
  db: Banco = prisma,
): Promise<ExtratoDoCashback> {
  const final = chaveDoSaldo(telefone);
  if (!final) return { saldo: 0, proximoVencimento: null, movimentos: [], aReceber: 0 };
  // Em sequência, não em paralelo: na transação as duas leituras dividem uma conexão.
  const pedidos = await pedidosDoTelefone(lojaId, final, db);
  const ajustes = await ajustesDaLoja(lojaId, final, db);
  return extratoDoCashback(lerCashback(storeLoyalty), pedidos, ajustes, agora);
}

/**
 * O saldo de TODOS os clientes da loja que já mexeram com cashback, pela
 * chave do telefone. Só entram os pedidos que geraram ou usaram cashback e os
 * lançamentos — é pouca coisa perto da base inteira, e é o que a lista
 * precisa para a coluna de saldo e o filtro "com saldo".
 */
export async function saldosDaLoja(
  lojaId: string,
  storeLoyalty: unknown,
  agora = new Date(),
): Promise<Map<string, SaldoDoCashback & { nome: string | null; telefone: string }>> {
  const regra = lerCashback(storeLoyalty);
  const [pedidos, ajustes] = await Promise.all([
    prisma.customerOrder.findMany({
      where: { franchiseeId: lojaId, OR: [{ cashbackEarned: { gt: 0 } }, { cashbackUsed: { gt: 0 } }] },
      select: { ...CAMPOS_DO_PEDIDO, customerPhone: true, customerName: true },
      orderBy: { createdAt: "asc" },
      take: 20_000,
    }),
    ajustesDaLoja(lojaId),
  ]);
  type Grupo = { pedidos: typeof pedidos; ajustes: LinhaDeAjuste[]; nome: string | null; telefone: string };
  const grupos = new Map<string, Grupo>();
  const grupo = (final: string, telefone: string) => {
    let g = grupos.get(final);
    if (!g) grupos.set(final, (g = { pedidos: [], ajustes: [], nome: null, telefone }));
    return g;
  };
  for (const p of pedidos) {
    const final = chaveDoSaldo(p.customerPhone);
    if (!final) continue;
    const g = grupo(final, p.customerPhone);
    g.pedidos.push(p);
    if (p.customerName) g.nome = p.customerName;
  }
  for (const a of ajustes) {
    const final = chaveDoSaldo(a.telefone);
    if (!final) continue;
    const g = grupo(final, a.telefone);
    g.ajustes.push(a);
    if (!g.nome && a.nome) g.nome = a.nome;
  }
  const saldos = new Map<string, SaldoDoCashback & { nome: string | null; telefone: string }>();
  for (const [final, g] of grupos) {
    saldos.set(final, { ...saldoDoCashback(regra, g.pedidos, agora, g.ajustes), nome: g.nome, telefone: g.telefone });
  }
  return saldos;
}

export type NovoAjuste = {
  lojaId: string;
  storeLoyalty: unknown;
  /** DDD + número, só dígitos. */
  telefone: string;
  nome?: string | null;
  /** Positivo dá saldo, negativo tira. */
  valor: number;
  semVencimento?: boolean;
  motivo?: string | null;
  criadoPor?: string | null;
};

export type ResultadoDoAjuste = { ok: true; saldo: number } | { ok: false; erro: string; saldo?: number };

export const VALOR_MAXIMO_DO_LANCAMENTO = 5_000;

/**
 * Grava um lançamento. Tirar mais do que o cliente tem é recusado — o saldo
 * nunca fica negativo pelo painel. A trava por telefone impede que dois
 * cliques ao mesmo tempo tirem o mesmo saldo duas vezes.
 */
export async function lancarAjuste(n: NovoAjuste, agora = new Date()): Promise<ResultadoDoAjuste> {
  const valor = Math.round(Number(n.valor) * 100) / 100;
  if (!Number.isFinite(valor) || valor === 0) return { ok: false, erro: "Informe um valor." };
  if (Math.abs(valor) > VALOR_MAXIMO_DO_LANCAMENTO) {
    return { ok: false, erro: `Valor acima de R$ ${VALOR_MAXIMO_DO_LANCAMENTO.toLocaleString("pt-BR")} — confira o número.` };
  }
  // Gravado como DDD + número, a mesma forma da lista de clientes.
  const telefone = telefoneNacional(n.telefone);
  const final = chaveDoSaldo(telefone);
  if (!telefone || !final) return { ok: false, erro: "Telefone inválido — use DDD + número." };
  if (!(await garantirTabelaDeAjustes())) return { ok: false, erro: "Não foi possível gravar agora. Tente de novo." };

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashback:" + n.lojaId + ":" + final}))`;
      const antes = await extratoDoCliente(n.lojaId, n.storeLoyalty, telefone, agora, tx as unknown as Banco);
      if (valor < 0 && -valor > antes.saldo + 0.004) {
        return {
          ok: false as const,
          erro: `O cliente tem R$ ${antes.saldo.toFixed(2).replace(".", ",")} de saldo — não dá para tirar mais que isso.`,
          saldo: antes.saldo,
        };
      }
      await tx.$executeRaw`
        INSERT INTO "CashbackAjuste" ("id", "lojaId", "telefone", "nome", "valor", "semVencimento", "motivo", "criadoPor", "createdAt")
        VALUES (${randomUUID()}, ${n.lojaId}, ${telefone}, ${n.nome?.trim().slice(0, 120) || null},
                ${valor}, ${valor > 0 && n.semVencimento === true}, ${n.motivo?.trim().slice(0, 200) || null},
                ${n.criadoPor?.slice(0, 120) || null}, ${horaEmUtc(agora)})`;
      return { ok: true as const, saldo: Math.round((antes.saldo + valor) * 100) / 100 };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/**
 * Créditos de uma lista colada ("Importar saldos"), num INSERT por bloco.
 * Só crédito: não há saldo a conferir, então não precisa da trava por
 * telefone — e 2.000 linhas uma a uma, cada uma com a sua ida ao banco,
 * passariam do tempo da requisição.
 */
export async function lancarCreditosEmLote(
  lojaId: string,
  linhas: { telefone: string; valor: number; nome?: string | null }[],
  opcoes: { motivo?: string | null; semVencimento?: boolean; criadoPor?: string | null },
  agora = new Date(),
): Promise<number> {
  if (!(await garantirTabelaDeAjustes())) throw new Error("tabela CashbackAjuste indisponível");
  const validas = linhas
    .map((l) => ({ ...l, telefone: telefoneNacional(l.telefone), valor: Math.round(Number(l.valor) * 100) / 100 }))
    .filter((l) => l.telefone && Number.isFinite(l.valor) && l.valor > 0 && l.valor <= VALOR_MAXIMO_DO_LANCAMENTO);
  const motivo = opcoes.motivo?.trim().slice(0, 200) || null;
  const criadoPor = opcoes.criadoPor?.slice(0, 120) || null;
  let gravadas = 0;
  for (let i = 0; i < validas.length; i += 500) {
    const bloco = validas.slice(i, i + 500);
    const valores = bloco.map(
      (l) => Prisma.sql`(${randomUUID()}, ${lojaId}, ${l.telefone}, ${l.nome?.trim().slice(0, 120) || null}, ${l.valor},
                         ${opcoes.semVencimento === true}, ${motivo}, ${criadoPor}, ${horaEmUtc(agora)})`,
    );
    gravadas += await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "CashbackAjuste" ("id", "lojaId", "telefone", "nome", "valor", "semVencimento", "motivo", "criadoPor", "createdAt")
      VALUES ${Prisma.join(valores)}`);
  }
  return gravadas;
}
