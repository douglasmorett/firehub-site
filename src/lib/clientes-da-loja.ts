/**
 * A BASE DE CLIENTES DA LOJA — a aba Clientes do painel.
 *
 * Não existe tabela de "cliente da loja": StoreCustomer é uma só para a
 * plataforma inteira (telefone único, sem loja). O cliente de uma loja é
 * quem aparece em pelo menos um destes, juntado pelo telefone (DDD + número):
 *
 *   1. pedidos DESTA loja (CustomerOrder), menos mesa (o nome é "Mesa 5") e
 *      iFood (o telefone é o 0800 mascarado do app, não do cliente);
 *   2. cadastros que a loja trouxe de outro sistema (StoreCustomer.lojaDeOrigemId);
 *   3. telefones em que a loja já lançou saldo à mão (CashbackAjuste).
 *
 * O saldo de cashback vem de lib/cashback-no-banco.ts (saldosDaLoja), pela
 * mesma chave do cardápio — o número que a lista mostra é o que o cliente
 * consegue usar.
 *
 * O telefone está gravado de qualquer jeito ("(22) 99276-1161",
 * "5522992761161"): o SQL normaliza com a classe '[^0-9]' (a mesma de
 * api/store/clientes/buscar — '\D' não limpava a máscara no Postgres).
 */
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { extratoDoCliente, garantirTabelaDeAjustes, horaEmUtc, saldosDaLoja } from "@/lib/cashback-no-banco";
import { lerCashback, type ExtratoDoCashback } from "@/lib/cashback";
import { nomeDoCanal } from "@/lib/canal-do-pedido";
import { telefoneNacional } from "@/lib/lote-de-saldo";
import { nomeDoItem } from "@/lib/nome-do-item";
import { parseComboSelections } from "@/lib/parse-combo";

export type SessaoDosClientes = { lojaId: string; quem: string; storeLoyalty: unknown };

/**
 * A loja de quem está logado — e só se pode ver a aba. O proxy barra a TELA
 * para funcionário; rota de API não passa por ele, por isso a mesma regra
 * é conferida aqui.
 */
export async function sessaoDosClientes(): Promise<SessaoDosClientes | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return null;
  const u = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true, name: true, email: true, role: true, permissions: true },
  });
  if (!u) return null;
  if (u.role === "STAFF" && !funcionarioAbre("/store/clientes", u.permissions)) return null;
  const lojaId = u.ownerId || u.id;
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeLoyalty: true } });
  return { lojaId, quem: u.name || u.email, storeLoyalty: loja?.storeLoyalty ?? null };
}

export type FiltroDeClientes = "todos" | "com_saldo" | "pediram" | "nunca" | "sumidos";
export type OrdemDeClientes = "recentes" | "pedidos" | "gasto" | "saldo" | "nome";

export const FILTROS: FiltroDeClientes[] = ["todos", "com_saldo", "pediram", "nunca", "sumidos"];
export const ORDENS: OrdemDeClientes[] = ["recentes", "pedidos", "gasto", "saldo", "nome"];

/** Dias sem pedir para o cliente contar como "sumido". */
export const DIAS_PARA_SUMIDO = 30;

export type ClienteDaLista = {
  telefone: string;
  nome: string | null;
  pedidos: number;
  gasto: number;
  ultimo: string | null;
  primeiro: string | null;
  importado: boolean;
  saldo: number;
};

export type ResumoDosClientes = {
  clientes: number;
  pediram: number;
  ativos30: number;
  sumidos: number;
  novos30: number;
  comSaldo: number;
  saldoTotal: number;
};

const CANCELADO = Prisma.sql`upper(COALESCE("status", '')) IN ('CANCELADO', 'CANCELED', 'RECUSADO', 'REJEITADO')`;

/** O telefone da coluna como DDD+número: só dígitos, sem o 55 da frente. */
const nacional = (coluna: Prisma.Sql) => Prisma.sql`
  (CASE WHEN length(regexp_replace(${coluna}, '[^0-9]', '', 'g')) IN (12, 13)
          AND left(regexp_replace(${coluna}, '[^0-9]', '', 'g'), 2) = '55'
        THEN substr(regexp_replace(${coluna}, '[^0-9]', '', 'g'), 3)
        ELSE regexp_replace(${coluna}, '[^0-9]', '', 'g') END)`;

const COM_ACENTO = "áàâãäéèêëíìîïóòôõöúùûüç";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuuc";
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** As CTEs da base: um cliente por telefone, com o que os pedidos dizem dele. */
function base(lojaId: string, chaves: string[], saldos: number[]) {
  return Prisma.sql`
    WITH ped AS (
      SELECT ${nacional(Prisma.sql`"customerPhone"`)} AS tel,
             count(*) FILTER (WHERE NOT ${CANCELADO})::int AS pedidos,
             COALESCE(sum("totalAmount") FILTER (WHERE NOT ${CANCELADO}), 0)::float8 AS gasto,
             max("createdAt") FILTER (WHERE NOT ${CANCELADO}) AS ultimo,
             min("createdAt") AS primeiro,
             (array_agg("customerName" ORDER BY "createdAt" DESC))[1] AS nome
      FROM "CustomerOrder"
      WHERE "franchiseeId" = ${lojaId}
        AND "tableSessionId" IS NULL
        AND "ifoodOrderId" IS NULL
      GROUP BY 1
    ),
    cad AS (
      SELECT DISTINCT ON (tel) tel, nome
      FROM (
        SELECT ${nacional(Prisma.sql`"phone"`)} AS tel, "name" AS nome, "createdAt"
        FROM "StoreCustomer" WHERE "lojaDeOrigemId" = ${lojaId}
      ) x
      ORDER BY tel, "createdAt"
    ),
    aj AS (
      SELECT DISTINCT ON ("telefone") "telefone" AS tel, "nome"
      FROM "CashbackAjuste" WHERE "lojaId" = ${lojaId}
      ORDER BY "telefone", "createdAt" DESC
    ),
    sal AS (
      SELECT * FROM unnest(${chaves}::text[], ${saldos}::float8[]) AS s(chave, saldo)
    ),
    junta AS (
      SELECT COALESCE(ped.tel, cad.tel, aj.tel) AS tel,
             -- "Cliente"/"Balcão" do pedido perde para o nome do cadastro.
             CASE WHEN ped.nome IS NULL OR btrim(ped.nome) = ''
                       OR ped.nome ~* '^(cliente|consumidor|balc[aã]o|sem nome|n[aã]o informado)$'
                  THEN COALESCE(cad.nome, aj.nome, ped.nome)
                  ELSE ped.nome END AS nome,
             COALESCE(ped.pedidos, 0) AS pedidos,
             COALESCE(ped.gasto, 0)::float8 AS gasto,
             ped.ultimo, ped.primeiro,
             (cad.tel IS NOT NULL) AS importado
      FROM ped
      FULL OUTER JOIN cad ON cad.tel = ped.tel
      FULL OUTER JOIN aj ON aj.tel = COALESCE(ped.tel, cad.tel)
    ),
    clientes AS (
      SELECT j.*, COALESCE(sal.saldo, 0)::float8 AS saldo
      FROM junta j
      LEFT JOIN sal ON sal.chave = right(j.tel, 8)
      WHERE length(j.tel) BETWEEN 10 AND 11 AND left(j.tel, 1) <> '0'
    )`;
}

export type ConsultaDaLista = {
  q?: string | null;
  filtro?: FiltroDeClientes;
  ordem?: OrdemDeClientes;
  pagina?: number;
  porPagina?: number;
};

export async function listarClientes(
  sessao: SessaoDosClientes,
  consulta: ConsultaDaLista,
  agora = new Date(),
): Promise<{ clientes: ClienteDaLista[]; total: number; resumo: ResumoDosClientes }> {
  await garantirTabelaDeAjustes();
  const mapa = await saldosDaLoja(sessao.lojaId, sessao.storeLoyalty, agora);
  const chaves: string[] = [];
  const valores: number[] = [];
  let saldoTotal = 0;
  let comSaldo = 0;
  for (const [chave, s] of mapa) {
    if (s.saldo <= 0) continue;
    chaves.push(chave);
    valores.push(s.saldo);
    saldoTotal += s.saldo;
    comSaldo++;
  }

  const limite = new Date(agora.getTime() - DIAS_PARA_SUMIDO * 86_400_000);
  const filtro = consulta.filtro && FILTROS.includes(consulta.filtro) ? consulta.filtro : "todos";
  const ordem = consulta.ordem && ORDENS.includes(consulta.ordem) ? consulta.ordem : "recentes";
  const porPagina = Math.min(50_000, Math.max(1, Math.floor(consulta.porPagina || 50)));
  const pagina = Math.max(1, Math.floor(consulta.pagina || 1));

  const condicoes: Prisma.Sql[] = [Prisma.sql`TRUE`];
  const q = String(consulta.q || "").trim().slice(0, 60);
  const digitos = q.replace(/\D/g, "");
  if (q && digitos.length >= 3 && !/\p{L}/u.test(q)) {
    const semPais = digitos.length >= 12 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
    condicoes.push(Prisma.sql`c.tel LIKE ${"%" + semPais + "%"}`);
  } else if (q && /\p{L}/u.test(q)) {
    condicoes.push(Prisma.sql`translate(lower(COALESCE(c.nome, '')), ${COM_ACENTO}, ${SEM_ACENTO}) LIKE ${"%" + semAcento(q) + "%"}`);
  }
  if (filtro === "com_saldo") condicoes.push(Prisma.sql`c.saldo > 0.004`);
  if (filtro === "pediram") condicoes.push(Prisma.sql`c.pedidos > 0`);
  if (filtro === "nunca") condicoes.push(Prisma.sql`c.pedidos = 0`);
  if (filtro === "sumidos") condicoes.push(Prisma.sql`c.pedidos > 0 AND c.ultimo < ${horaEmUtc(limite)}`);

  const ordenar = {
    recentes: Prisma.sql`c.ultimo DESC NULLS LAST, c.saldo DESC, lower(c.nome) ASC NULLS LAST`,
    pedidos: Prisma.sql`c.pedidos DESC, c.gasto DESC`,
    gasto: Prisma.sql`c.gasto DESC, c.pedidos DESC`,
    saldo: Prisma.sql`c.saldo DESC, c.ultimo DESC NULLS LAST`,
    nome: Prisma.sql`lower(c.nome) ASC NULLS LAST`,
  }[ordem];

  type Linha = Omit<ClienteDaLista, "ultimo" | "primeiro"> & { tel: string; ultimo: Date | null; primeiro: Date | null; total: number };
  type LinhaDoResumo = { clientes: number; pediram: number; ativos30: number; sumidos: number; novos30: number };

  const [linhas, [resumo]] = await Promise.all([
    prisma.$queryRaw<Linha[]>(Prisma.sql`
      ${base(sessao.lojaId, chaves, valores)}
      SELECT c.tel, c.nome, c.pedidos, c.gasto, c.ultimo, c.primeiro, c.importado, c.saldo,
             count(*) OVER()::int AS total
      FROM clientes c
      WHERE ${Prisma.join(condicoes, " AND ")}
      ORDER BY ${ordenar}
      LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`),
    prisma.$queryRaw<LinhaDoResumo[]>(Prisma.sql`
      ${base(sessao.lojaId, chaves, valores)}
      SELECT count(*)::int AS clientes,
             count(*) FILTER (WHERE c.pedidos > 0)::int AS pediram,
             count(*) FILTER (WHERE c.ultimo >= ${horaEmUtc(limite)})::int AS ativos30,
             count(*) FILTER (WHERE c.pedidos > 0 AND c.ultimo < ${horaEmUtc(limite)})::int AS sumidos,
             count(*) FILTER (WHERE c.primeiro >= ${horaEmUtc(limite)})::int AS novos30
      FROM clientes c`),
  ]);

  return {
    clientes: linhas.map((l) => ({
      telefone: l.tel,
      nome: l.nome,
      pedidos: Number(l.pedidos) || 0,
      gasto: Math.round((Number(l.gasto) || 0) * 100) / 100,
      ultimo: l.ultimo ? new Date(l.ultimo).toISOString() : null,
      primeiro: l.primeiro ? new Date(l.primeiro).toISOString() : null,
      importado: Boolean(l.importado),
      saldo: Math.round((Number(l.saldo) || 0) * 100) / 100,
    })),
    total: linhas[0]?.total ?? 0,
    resumo: {
      clientes: resumo?.clientes ?? 0,
      pediram: resumo?.pediram ?? 0,
      ativos30: resumo?.ativos30 ?? 0,
      sumidos: resumo?.sumidos ?? 0,
      novos30: resumo?.novos30 ?? 0,
      comSaldo,
      saldoTotal: Math.round(saldoTotal * 100) / 100,
    },
  };
}

// ── Um cliente ──────────────────────────────────────────────────────────────

export type DetalheDoCliente = {
  encontrado: boolean;
  telefone: string;
  nome: string | null;
  aniversario: string | null;
  importado: boolean;
  clienteDesde: string | null;
  pedidos: {
    id: string;
    numero: number | null;
    em: string;
    status: string;
    total: number;
    tipo: string;
    canal: string;
    pagamento: string | null;
    cashbackGerado: number;
    cashbackUsado: number;
  }[];
  enderecos: string[];
  numeros: { pedidos: number; gasto: number; ticketMedio: number; primeiro: string | null; ultimo: string | null; cancelados: number };
  cashback: ExtratoDoCashback & { ativo: boolean; validadeDias: number; taxa: number; maxResgatePct: number };
};

const CANCELADOS = new Set(["CANCELADO", "CANCELED", "RECUSADO", "REJEITADO"]);

/** O nome dado no lançamento — o do cliente que só tem o saldo trazido de outro sistema. */
async function nomeDoLancamento(lojaId: string, final: string): Promise<string | null> {
  try {
    const [l] = await prisma.$queryRaw<{ nome: string }[]>`
      SELECT "nome" FROM "CashbackAjuste"
      WHERE "lojaId" = ${lojaId} AND "telefone" LIKE ${"%" + final} AND "nome" IS NOT NULL
      ORDER BY "createdAt" DESC LIMIT 1`;
    return l?.nome || null;
  } catch {
    return null;
  }
}

/**
 * Tudo o que a loja sabe de um telefone. Só devolve dados quando o número é
 * cliente DESTA loja (pedido, cadastro trazido por ela ou lançamento): o
 * StoreCustomer é global, e a consulta por telefone solto mostraria o
 * cadastro que o cliente fez em outra loja.
 */
export async function detalheDoCliente(sessao: SessaoDosClientes, telefoneBruto: string, agora = new Date()): Promise<DetalheDoCliente | null> {
  const tel = telefoneNacional(telefoneBruto);
  if (!tel) return null;
  const final = tel.slice(-8);

  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CustomerOrder"
    WHERE "franchiseeId" = ${sessao.lojaId}
      AND "tableSessionId" IS NULL
      AND regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + final}
    ORDER BY "createdAt" DESC
    LIMIT 300`;
  const [pedidos, extrato] = await Promise.all([
    ids.length
      ? prisma.customerOrder.findMany({
          where: { id: { in: ids.map((r) => r.id) } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, dailyOrderNumber: true, createdAt: true, status: true, totalAmount: true, deliveryType: true,
            paymentMethod: true, customerName: true, customerAddress: true, customerId: true,
            source: true, ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true, openDeliveryOrderId: true,
            cashbackEarned: true, cashbackUsed: true,
          },
        })
      : Promise.resolve([]),
    extratoDoCliente(sessao.lojaId, sessao.storeLoyalty, tel, agora),
  ]);

  const idsDeCadastro = [...new Set(pedidos.map((p) => p.customerId).filter(Boolean))] as string[];
  type Cadastro = { name: string | null; birthDate: string | null; createdAt: Date; lojaDeOrigemId: string | null };
  const [cadastro] = await prisma.$queryRaw<Cadastro[]>(Prisma.sql`
    SELECT "name", "birthDate", "createdAt", "lojaDeOrigemId" FROM "StoreCustomer"
    WHERE ("lojaDeOrigemId" = ${sessao.lojaId} AND right(regexp_replace("phone", '[^0-9]', '', 'g'), 8) = ${final})
       ${idsDeCadastro.length ? Prisma.sql`OR "id" IN (${Prisma.join(idsDeCadastro)})` : Prisma.empty}
    ORDER BY ("lojaDeOrigemId" = ${sessao.lojaId}) DESC NULLS LAST, "createdAt" ASC
    LIMIT 1`);

  const regra = lerCashback(sessao.storeLoyalty);
  const cashback = { ...extrato, ativo: regra.ativo, validadeDias: regra.validadeDias, taxa: regra.taxa, maxResgatePct: regra.maxResgatePct };

  if (!pedidos.length && !cadastro && !extrato.movimentos.length) {
    return {
      encontrado: false, telefone: tel, nome: null, aniversario: null, importado: false, clienteDesde: null,
      pedidos: [], enderecos: [], numeros: { pedidos: 0, gasto: 0, ticketMedio: 0, primeiro: null, ultimo: null, cancelados: 0 },
      cashback,
    };
  }

  const validos = pedidos.filter((p) => !CANCELADOS.has(String(p.status || "").toUpperCase()));
  const gasto = Math.round(validos.reduce((t, p) => t + (Number(p.totalAmount) || 0), 0) * 100) / 100;
  const generico = /^(cliente|consumidor|balc[aã]o|sem nome|n[aã]o informado)$/i;
  const nomeDoPedido = pedidos.find((p) => p.customerName && !generico.test(p.customerName.trim()))?.customerName ?? null;
  const enderecos: string[] = [];
  for (const p of pedidos) {
    const e = String(p.customerAddress || "").replace(/\s+/g, " ").trim();
    if (!e || String(p.deliveryType || "").toUpperCase() !== "DELIVERY") continue;
    if (!enderecos.some((x) => x.toLowerCase() === e.toLowerCase())) enderecos.push(e);
    if (enderecos.length >= 5) break;
  }
  const primeiro = pedidos.length ? pedidos[pedidos.length - 1].createdAt : null;
  const ultimo = validos.length ? validos[0].createdAt : null;
  const desde = [primeiro, cadastro?.lojaDeOrigemId === sessao.lojaId ? cadastro.createdAt : null]
    .filter(Boolean)
    .map((d) => new Date(d as Date).getTime())
    .sort((a, b) => a - b)[0];

  return {
    encontrado: true,
    telefone: tel,
    nome: nomeDoPedido || cadastro?.name || (await nomeDoLancamento(sessao.lojaId, final)),
    aniversario: cadastro?.birthDate || null,
    importado: cadastro?.lojaDeOrigemId === sessao.lojaId,
    clienteDesde: desde ? new Date(desde).toISOString() : null,
    pedidos: pedidos.slice(0, 50).map((p) => ({
      id: p.id,
      numero: p.dailyOrderNumber ?? null,
      em: new Date(p.createdAt).toISOString(),
      status: String(p.status || ""),
      total: Number(p.totalAmount) || 0,
      tipo: String(p.deliveryType || ""),
      canal: nomeDoCanal(p),
      pagamento: p.paymentMethod || null,
      cashbackGerado: Number(p.cashbackEarned) || 0,
      cashbackUsado: Number(p.cashbackUsed) || 0,
    })),
    enderecos,
    numeros: {
      pedidos: validos.length,
      gasto,
      ticketMedio: validos.length ? Math.round((gasto / validos.length) * 100) / 100 : 0,
      primeiro: primeiro ? new Date(primeiro).toISOString() : null,
      ultimo: ultimo ? new Date(ultimo).toISOString() : null,
      cancelados: pedidos.length - validos.length,
    },
    cashback,
  };
}

// ── Um pedido do cliente ────────────────────────────────────────────────────
//
// Pedido do Luiz (Divinos Burger, 03/10/2026): a ficha mostrava os pedidos do
// cliente com data, pagamento e total, mas não abria nenhum. Para compensar
// uma taxa cobrada errado ele precisava saber O QUE foi pedido e quanto foi a
// entrega — e a única saída era caçar o pedido pela data na tela de Pedidos.

export type PedidoDoCliente = {
  id: string;
  numero: number | null;
  em: string;
  status: string;
  canal: string;
  tipo: string;
  pagamento: string | null;
  troco: number | null;
  endereco: string | null;
  observacao: string | null;
  itens: { qtd: number; nome: string; total: number; opcoes: { qtd: number; nome: string }[]; observacao: string | null }[];
  produtos: number;
  taxaDeEntrega: number;
  desconto: number;
  cashbackUsado: number;
  total: number;
};

/** Só pedido desta loja: o id vem do navegador. */
export async function pedidoDoCliente(sessao: SessaoDosClientes, id: string): Promise<PedidoDoCliente | null> {
  if (!id) return null;
  const p = await prisma.customerOrder.findFirst({
    where: { id, franchiseeId: sessao.lojaId },
    select: {
      id: true, dailyOrderNumber: true, createdAt: true, status: true, deliveryType: true, paymentMethod: true,
      changeAmount: true, customerAddress: true, notes: true, deliveryFee: true, discountTotal: true,
      cashbackUsed: true, totalAmount: true,
      source: true, ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true, openDeliveryOrderId: true,
      items: { select: { productName: true, quantity: true, price: true, notes: true, comboSelections: true, menuProduct: { select: { name: true } } } },
    },
  });
  if (!p) return null;

  const itens = p.items.map((it) => {
    const qtd = Number(it.quantity) || 1;
    return {
      qtd,
      nome: nomeDoItem(it),
      // `price` é o unitário com os adicionais (lib/preco-combo.ts).
      total: Math.round((Number(it.price) || 0) * qtd * 100) / 100,
      opcoes: parseComboSelections(it.comboSelections).map((o) => ({ qtd: Number(o.quantity) || 1, nome: o.name })),
      observacao: it.notes?.trim() || null,
    };
  });
  const entrega = String(p.deliveryType || "").toUpperCase() === "DELIVERY";
  return {
    id: p.id,
    numero: p.dailyOrderNumber ?? null,
    em: new Date(p.createdAt).toISOString(),
    status: String(p.status || ""),
    canal: nomeDoCanal(p),
    tipo: String(p.deliveryType || ""),
    pagamento: p.paymentMethod || null,
    troco: p.changeAmount ? Number(p.changeAmount) : null,
    endereco: entrega ? String(p.customerAddress || "").replace(/\s+/g, " ").trim() || null : null,
    observacao: p.notes?.trim() || null,
    itens,
    produtos: Math.round(itens.reduce((t, i) => t + i.total, 0) * 100) / 100,
    taxaDeEntrega: Number(p.deliveryFee) || 0,
    desconto: Number(p.discountTotal) || 0,
    cashbackUsado: Number(p.cashbackUsed) || 0,
    total: Number(p.totalAmount) || 0,
  };
}
