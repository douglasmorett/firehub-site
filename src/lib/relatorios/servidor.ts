/**
 * O lado do servidor de todo relatório: quem pode ver, de quais lojas, em que
 * janela de tempo e quais pedidos — com a régua única de lib/relatorios/base.ts.
 *
 * ── O desenho que substitui o de antes ──────────────────────────────────────
 *
 * /store/relatorios mandava 365 dias de pedidos, com TODAS as ~90 colunas, para
 * o navegador somar (medido em 24/09/2026: ~7,6 MB por abertura na Hakim
 * Centro, ~25 MB lidos do banco; ADMIN recebia todas as lojas). Cada relatório
 * novo é uma rota que busca SÓ a janela pedida, SÓ as colunas que usa, soma no
 * servidor e devolve o resultado pronto. É o desenho do relatório de mesas
 * (api/store/mesas/relatorio), que já fazia certo.
 *
 * ── O dia operacional ───────────────────────────────────────────────────────
 *
 * O dia vira às 5h no fuso da LOJA: a venda da 1h da manhã é do expediente de
 * ontem, como no caixa e no relatório de mesas. A Saipos faz o mesmo pelo
 * início do turno.
 *
 * ── Mais de uma loja ────────────────────────────────────────────────────────
 *
 * A conta com várias lojas (User.accountGroupId) escolhe a loja ativa pelo
 * cookie `firehub_active_store` — "all" soma todas, como o "Acompanhamento de
 * vendas multilojas" da Saipos. O filtro "Lojas" do relatório escolhe dentro
 * das lojas da conta, nunca fora dela.
 *
 * "Lojas da conta" é o grupo de QUEM PEDE, a mesma regra do seletor de lojas
 * (api/store/switch): `usuario.accountGroupId || loja do dono`. Saía do grupo
 * da loja DONA, e o funcionário de uma filial lia a matriz e as irmãs pelo
 * `?lojas=` ou pelo cookie — o dono da filial escolheu dar acesso à filial.
 *
 * ── O funcionário precisa da caixinha ───────────────────────────────────────
 *
 * As páginas de relatório só abrem para o funcionário com "Relatórios" ou
 * "Financeiro" marcados (lib/permissao-da-tela.ts, conferido no proxy.ts). As
 * rotas daqui conferiam só o papel: o funcionário sem a caixinha chamava a API
 * direto e lia o faturamento. A regra é a MESMA da página (`funcionarioAbre`),
 * com as permissões lidas do banco agora — não as do login.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inicioDoDiaDaLoja } from "@/lib/fuso";
import { lojasDeOrigemDaConta } from "@/lib/lojas-de-origem-da-conta";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { chaveDaLoja } from "@/lib/origem-do-relatorio";
import type { LojaDeOrigem } from "@/lib/loja-de-origem";
import {
  STATUS_FORA_DA_VENDA, HORA_DA_VIRADA, canalDoRelatorio, dentroDaFaixa, hojeNaLoja, lerFiltros, naLoja, tipoDeVenda,
  type FiltrosDoRelatorio,
} from "@/lib/relatorios/base";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Teto da janela: um ano e pouco. Mais que isso é exportação, não relatório. */
export const MAX_DIAS = 400;

export type LojaDaConta = { id: string; nome: string };

export type ContextoDoRelatorio = {
  usuarioId: string;
  papel: string;
  /** A loja "dona" de quem consulta (funcionário → a loja do dono). */
  donoId: string;
  /** As lojas que esta conta enxerga. Uma só na maioria das contas. */
  lojasDaConta: LojaDaConta[];
  /** A loja ativa (cookie) ou "all". */
  lojaAtiva: string;
  /** Fuso da loja dona. */
  tz: string;
  /** "Hoje" no dia operacional da loja. */
  hoje: string;
  /** Marcas: lojas de iFood/99 e a própria (lib/lojas-de-origem-da-conta.ts). */
  lojasDeOrigem: LojaDeOrigem[];
  filtros: FiltrosDoRelatorio;
  /** As lojas cujos pedidos entram, já resolvidas. */
  lojaIds: string[];
  /** A janela [inicio, fim) do período, no dia operacional. */
  inicio: Date;
  fim: Date;
};

type Resultado<T> = { ok: true; valor: T } | { ok: false; resposta: NextResponse };

const erro = (status: number, mensagem: string): { ok: false; resposta: NextResponse } =>
  ({ ok: false, resposta: NextResponse.json({ error: mensagem }, { status }) });

/**
 * O início do DIA OPERACIONAL de uma data do calendário, no fuso da loja.
 * Meio-dia local está dentro daquele dia em qualquer offset (−02/−03), então
 * serve de âncora para `inicioDoDiaDaLoja` achar a meia-noite certa.
 */
export function inicioOperacional(dia: string, tz: string | null | undefined): Date {
  const meioDia = new Date(`${dia}T12:00:00-03:00`);
  return new Date(inicioDoDiaDaLoja(tz, meioDia).getTime() + HORA_DA_VIRADA * 60 * 60 * 1000);
}

/** A janela [inicio, fim) de "de" a "ate", inclusive, no dia operacional. */
export function janelaDoPeriodo(de: string, ate: string, tz: string | null | undefined): { inicio: Date; fim: Date } {
  return { inicio: inicioOperacional(de, tz), fim: new Date(inicioOperacional(ate, tz).getTime() + DIA_MS) };
}

/**
 * Quem está pedindo, de quais lojas, com quais filtros. Devolve a resposta de
 * erro pronta quando não pode.
 *
 * Podem ver: o dono (FRANCHISEE), o funcionário (STAFF, sempre da loja do
 * dono, e só com "Relatórios" ou "Financeiro" marcados) e o ADMIN — este, na
 * loja ativa do cookie, ou na própria. O ADMIN não recebe mais "todas as lojas
 * do sistema" por padrão: era o que podia estourar a memória do servidor.
 */
export async function contextoDoRelatorio(req: NextRequest): Promise<Resultado<ContextoDoRelatorio>> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return erro(401, "Não autorizado");

  const usuario = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, ownerId: true, accountGroupId: true, permissions: true },
  });
  if (!usuario) return erro(404, "Usuário não encontrado");
  if (!["FRANCHISEE", "ADMIN", "STAFF"].includes(String(usuario.role))) return erro(403, "Sem acesso aos relatórios");
  // A caixinha do funcionário: a mesma regra da página /store/relatorios.
  if (usuario.role === "STAFF" && !funcionarioAbre("/store/relatorios", usuario.permissions)) {
    return erro(403, "Sem acesso aos relatórios: peça ao dono da loja para marcar \"Relatórios\" (ou \"Financeiro\") no seu cadastro em Equipe.");
  }

  const cookieLoja = req.cookies.get("firehub_active_store")?.value || "";
  const ehAdmin = usuario.role === "ADMIN";

  // A loja dona: a do usuário, a do dono (funcionário) ou, para o ADMIN, a loja
  // ativa que ele escolheu no seletor.
  let donoId = usuario.ownerId || usuario.id;
  if (ehAdmin && cookieLoja && cookieLoja !== "all") donoId = cookieLoja;

  const dono = await prisma.user.findUnique({
    where: { id: donoId },
    select: { id: true, storeName: true, name: true, storeTimezone: true, accountGroupId: true },
  });
  if (!dono) return erro(404, "Loja não encontrada");

  // O grupo de QUEM PEDE (a regra do api/store/switch), não o da loja dona: o
  // funcionário da filial (sem accountGroupId próprio) fica só na filial; o
  // dono da filial (a linha dela aponta para a matriz) continua vendo o grupo.
  // O ADMIN escolhe a loja pelo cookie e vê o grupo DELA, como antes.
  const masterId = ehAdmin ? dono.accountGroupId || dono.id : usuario.accountGroupId || donoId;
  const grupo = await prisma.user.findMany({
    where: { OR: [{ id: masterId }, { accountGroupId: masterId }] },
    select: { id: true, storeName: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const lojasDaConta: LojaDaConta[] = (grupo.length ? grupo : [dono]).map((l) => ({ id: l.id, nome: l.storeName || l.name || "Minha loja" }));
  const idsDaConta = new Set(lojasDaConta.map((l) => l.id));

  const tz = dono.storeTimezone || "America/Sao_Paulo";
  const hoje = hojeNaLoja(tz);
  const filtros = lerFiltros(req.nextUrl.searchParams, hoje);

  // Quais lojas entram: o filtro (dentro da conta), senão a loja ativa, senão a dona.
  const lojaAtiva = ehAdmin ? donoId : (cookieLoja && (cookieLoja === "all" || idsDaConta.has(cookieLoja)) ? cookieLoja : donoId);
  let lojaIds = filtros.lojas.filter((id) => idsDaConta.has(id));
  if (lojaIds.length === 0) lojaIds = lojaAtiva === "all" ? [...idsDaConta] : [idsDaConta.has(lojaAtiva) ? lojaAtiva : donoId];

  const { inicio, fim } = janelaDoPeriodo(filtros.de, filtros.ate, tz);
  if (fim.getTime() - inicio.getTime() > MAX_DIAS * DIA_MS) {
    return erro(400, `Período maior que ${MAX_DIAS} dias. Escolha um intervalo menor.`);
  }

  // As marcas (lojas do iFood/99) do MESMO grupo que esta conta enxerga.
  const lojasDeOrigem = await lojasDeOrigemDaConta(dono.id, masterId === dono.id ? null : masterId).catch(() => []);

  return {
    ok: true,
    valor: {
      usuarioId: usuario.id, papel: String(usuario.role), donoId: dono.id,
      lojasDaConta, lojaAtiva, tz, hoje, lojasDeOrigem, filtros, lojaIds, inicio, fim,
    },
  };
}

/**
 * As colunas do pedido que os FILTROS comuns leem (tipo de venda, canal, marca,
 * horário). Cada relatório soma as dele por cima — nunca `include` sem select.
 */
export const COLUNAS_DOS_FILTROS = {
  id: true,
  franchiseeId: true,
  createdAt: true,
  status: true,
  totalAmount: true,
  deliveryType: true,
  source: true,
  tableSessionId: true,
  totemLicenseId: true,
  ifoodOrderId: true,
  ifoodReference: true,
  openDeliveryOrderId: true,
  openDeliveryChannel: true,
  ifoodStoreMerchant: true,
  food99AppShopId: true,
  food99ShopId: true,
} as const;

export type PedidoBase = {
  id: string;
  franchiseeId: string;
  createdAt: Date;
  status: string;
  totalAmount: number;
  deliveryType: string | null;
  source: string | null;
  tableSessionId: string | null;
  totemLicenseId: string | null;
  ifoodOrderId: string | null;
  ifoodReference: string | null;
  openDeliveryOrderId: string | null;
  openDeliveryChannel: string | null;
  ifoodStoreMerchant: string | null;
  food99AppShopId: string | null;
  food99ShopId: string | null;
};

/**
 * Os pedidos do período, das lojas do contexto, já filtrados por tipo de
 * venda, canal, marca e faixa de horário. `select` soma colunas às dos
 * filtros. `incluirForaDaVenda` traz também cancelados e intenções — para os
 * relatórios que CONTAM cancelamento; quem soma venda nunca liga isto.
 */
export async function pedidosDoRelatorio<S extends Record<string, unknown>>(
  ctx: ContextoDoRelatorio,
  opts: { select?: S; incluirForaDaVenda?: boolean; janela?: { inicio: Date; fim: Date } } = {},
): Promise<Array<PedidoBase & Record<string, any>>> {
  const janela = opts.janela ?? { inicio: ctx.inicio, fim: ctx.fim };
  const pedidos = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: { in: ctx.lojaIds },
      createdAt: { gte: janela.inicio, lt: janela.fim },
      ...(opts.incluirForaDaVenda ? {} : { status: { notIn: [...STATUS_FORA_DA_VENDA] } }),
    },
    select: { ...COLUNAS_DOS_FILTROS, ...(opts.select || {}) } as any,
    orderBy: { createdAt: "asc" },
  });
  return filtrarPedidos(pedidos as any[], ctx);
}

/** Aplica os filtros comuns (tipo, canal, marca, horário) a pedidos já buscados. */
export function filtrarPedidos<P extends PedidoBase>(pedidos: P[], ctx: Pick<ContextoDoRelatorio, "filtros" | "tz" | "lojasDeOrigem">): P[] {
  const f = ctx.filtros;
  const tipos = new Set(f.tipos);
  const canais = new Set(f.canais);
  const marcas = new Set(f.marcas);
  const comHorario = Boolean(f.horaDe || f.horaAte);
  return pedidos.filter((p) => {
    if (tipos.size && !tipos.has(tipoDeVenda(p as any))) return false;
    if (canais.size && !canais.has(canalDoRelatorio(p as any))) return false;
    if (marcas.size && !marcas.has(chaveDaLoja(p as any, ctx.lojasDeOrigem))) return false;
    if (comHorario && !dentroDaFaixa(naLoja(p.createdAt, ctx.tz).minutos, f.horaDe, f.horaAte)) return false;
    return true;
  });
}

/** Busca em lotes de ids (o Postgres aceita listas grandes, mas não infinitas). */
export async function emLotes<T>(ids: string[], tamanho: number, buscar: (lote: string[]) => Promise<T[]>): Promise<T[]> {
  const saida: T[] = [];
  for (let i = 0; i < ids.length; i += tamanho) saida.push(...(await buscar(ids.slice(i, i + tamanho))));
  return saida;
}

/** O cabeçalho que toda resposta de relatório leva: a loja, o período e as lojas da conta. */
export function cabecalhoDoRelatorio(ctx: ContextoDoRelatorio) {
  const nomes = ctx.lojaIds.map((id) => ctx.lojasDaConta.find((l) => l.id === id)?.nome || "Loja");
  return {
    lojas: nomes,
    lojaIds: ctx.lojaIds,
    lojasDaConta: ctx.lojasDaConta,
    periodo: { de: ctx.filtros.de, ate: ctx.filtros.ate, horaDe: ctx.filtros.horaDe, horaAte: ctx.filtros.horaAte },
    hoje: ctx.hoje,
    tz: ctx.tz,
    marcas: ctx.lojasDeOrigem.map((l) => ({ chave: `loja:${l.chave}`, rotulo: `${l.emoji} ${l.nome}` })),
    geradoEm: new Date().toISOString(),
  };
}
