/**
 * GIRO DE MESAS — mesa a mesa, quantas contas cada uma fechou no período, quanto
 * rendeu, quanto tempo ficou ocupada e quanto cada pessoa gastou. Puro, sem
 * banco: a rota (api/store/relatorios/giro-de-mesas) busca, aqui só se conta.
 * Travado em scripts/teste-giro-de-mesas.ts.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O Alex (Hambúrgueria Avenida, ~1.236 vendas/mês, quase tudo mesa) veio do
 * SWFast, que tem o "Giro de mesas": por mesa, giro, faturamento e ticket.
 * Aqui havia o Histórico de mesas (conta a conta) e o Relatório de Mesas (por
 * garçom), mas nenhuma visão POR MESA. O dono pediu para trazer e fazer melhor
 * (11/2026). O que este tem a mais que o SWF:
 *   - o resumo do salão no topo (giro médio, permanência, ticket por pessoa,
 *     P.A. e R$ por hora de mesa ocupada);
 *   - as mesas que mais rendem e as PARADAS marcadas — inclusive a mesa que
 *     não abriu nenhuma vez no período, que no ranking do SWF nem aparece;
 *   - R$ por hora ocupada: a mesa que gira pouco mas fica cheia de gente
 *     gastando não é a mesma coisa que a mesa vazia.
 *
 * ── Os números são os do Histórico e do Relatório de Mesas ──────────────────
 *
 * A unidade é a CONTA FECHADA no período (pelo `closedAt`, dia operacional que
 * vira às 5h no fuso da loja), como o Histórico de mesas e o topo do Relatório
 * de Mesas: giro é conta que terminou. O faturamento da mesa é o CONSUMO das
 * contas (`consumoDaConta`, lib/relatorios/relatorio-de-mesas.ts — a régua
 * única: Σ `totalAmount` dos pedidos que são venda, sem taxa de serviço,
 * gorjeta e troco; o desconto do fechamento fica à parte). A soma das linhas
 * fecha com o "Consumo nas mesas" do Relatório de Mesas para as mesmas contas.
 *
 * Fora do giro, contadas à parte:
 *   - a conta LIBERADA sem nenhum lançamento (mesa aberta por engano): não foi
 *     atendimento — a régua de venda também não a conta (`atendimentosDaVenda`
 *     só vê mesa com lançamento);
 *   - a COMANDA numerada (Table.tipo = "COMANDA", lib/comanda.ts): é o cartão
 *     de UMA pessoa no self-service, não um lugar do salão — giro de cartão não
 *     diz nada sobre o salão.
 *
 * ── As contas de cada coluna ────────────────────────────────────────────────
 *
 * - Giro: contas fechadas na mesa. Giro por dia: ÷ os DIAS DE SALÃO ABERTO
 *   (dias do período com pelo menos uma conta fechada em qualquer mesa) — o
 *   restaurante que fecha segunda não tem a média puxada para baixo por ela.
 * - Ticket por conta: consumo ÷ contas (`ticketMedio`, centavo inteiro).
 * - Ticket por pessoa: consumo das contas COM nº de pessoas ÷ essas pessoas
 *   (lib/pessoas-da-mesa.ts). Conta sem o número fica de fora dos dois lados
 *   da divisão — misturar daria o ticket de uma mesa de 4 dividido por ninguém.
 *   Sem nenhuma, a tela diz "sem nº de pessoas".
 * - P.A. (produtos por atendimento): itens das contas ÷ contas — as unidades
 *   de item dos pedidos que são venda (`quantidadeDeItens`).
 * - Permanência: média de (fechou − abriu) das contas, em minutos.
 * - R$ por hora ocupada: consumo ÷ Σ horas abertas das contas.
 */
import { diasNoPeriodo, naLoja } from "@/lib/relatorios/base";
import { cent, quantidadeDeItens, reais, situacaoDoPedido, temValorImpossivel, ticketMedio, type ItemDaRegua } from "@/lib/relatorios/regua-da-venda";
import { consumoDaConta } from "@/lib/relatorios/relatorio-de-mesas";
import { pessoasDaConta } from "@/lib/pessoas-da-mesa";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

/** Uma mesa do salão (Table). As ativas entram mesmo sem conta: é assim que a parada aparece. */
export type MesaDoSalao = {
  id: string;
  numero: number;
  nome?: string | null;
  /** Nome da loja, só quando o relatório soma mais de uma (Mesa 5 existe nas duas). */
  loja?: string | null;
  /** Table.tipo = "COMANDA": fora do giro (cartão de uma pessoa, não lugar). */
  comanda?: boolean;
};

export type PedidoDaContaDoGiro = {
  status?: string | null;
  totalAmount?: number | null;
  discountTotal?: number | null;
  items?: ItemDaRegua[] | null;
};

/** Uma conta FECHADA no período, com TODOS os pedidos dela (de qualquer dia). */
export type ContaDoGiro = {
  id: string;
  mesaId: string;
  abertaEm: Date | string;
  fechadaEm: Date | string;
  /** TableSession.pessoas — o "Quantas pessoas?" da abertura. */
  pessoas?: number | null;
  /** Quantas pessoas nomeadas (TableGuest) a conta tem. */
  convidados?: number | null;
  pedidos: PedidoDaContaDoGiro[];
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type DestaqueDaMesa = "rende" | "parada" | null;

/** Os números de um grupo de contas — uma mesa, ou o salão inteiro. */
export type NumerosDoGiro = {
  contas: number;
  /** Contas ÷ dias de salão aberto. null = nenhum dia aberto. */
  giroPorDia: number | null;
  faturamento: number;
  ticketPorConta: number | null;
  /** Σ pessoas das contas que têm o número. */
  pessoas: number;
  contasComPessoas: number;
  /** Consumo das contas com nº de pessoas ÷ essas pessoas. null = "sem nº de pessoas". */
  ticketPorPessoa: number | null;
  itens: number;
  /** Produtos por atendimento: itens ÷ contas. */
  pa: number | null;
  permanenciaMediaMin: number | null;
  horasOcupada: number;
  reaisPorHora: number | null;
};

export type LinhaDoGiro = NumerosDoGiro & {
  mesaId: string;
  numero: number;
  nome: string | null;
  loja: string | null;
  /** % do faturamento do salão. */
  participacao: number;
  destaque: DestaqueDaMesa;
  /** Por que a mesa foi marcada, em português de gente. */
  motivo: string | null;
};

export type ResumoDoSalao = NumerosDoGiro & {
  /** Mesas no ranking (as ativas mais as que tiveram conta). */
  mesas: number;
  mesasQueGiraram: number;
  /** Giro médio: contas ÷ mesas ÷ dias de salão aberto — "cada mesa virou N vezes por dia". */
  giroMedioPorMesa: number | null;
  diasAbertos: number;
  diasDoPeriodo: number;
  /** Contas fechadas sem nenhum lançamento: fora do giro. */
  liberadasSemConsumo: number;
  /** Contas de comanda numerada: fora do giro. */
  contasDeComanda: number;
};

export type GiroDeMesas = { resumo: ResumoDoSalao; mesas: LinhaDoGiro[] };

// ── A CONTA ─────────────────────────────────────────────────────────────────

const ehVenda = (o: PedidoDaContaDoGiro) => situacaoDoPedido(o.status) === "venda" && !temValorImpossivel(o);

/** Uma casa decimal — giro, P.A. e permanência são média, não dinheiro. */
const umaCasa = (n: number) => Math.round(n * 10) / 10;

type Acumulado = { contas: number; c: number; pessoas: number; contasComPessoas: number; cComPessoas: number; itens: number; minutos: number };
const novo = (): Acumulado => ({ contas: 0, c: 0, pessoas: 0, contasComPessoas: 0, cComPessoas: 0, itens: 0, minutos: 0 });

function numeros(a: Acumulado, diasAbertos: number): NumerosDoGiro {
  const horas = a.minutos / 60;
  return {
    contas: a.contas,
    giroPorDia: diasAbertos > 0 ? umaCasa(a.contas / diasAbertos) : null,
    faturamento: reais(a.c),
    ticketPorConta: a.contas > 0 ? ticketMedio(reais(a.c), a.contas) : null,
    pessoas: a.pessoas,
    contasComPessoas: a.contasComPessoas,
    ticketPorPessoa: a.pessoas > 0 ? ticketMedio(reais(a.cComPessoas), a.pessoas) : null,
    itens: Math.round(a.itens * 100) / 100,
    pa: a.contas > 0 ? umaCasa(a.itens / a.contas) : null,
    permanenciaMediaMin: a.contas > 0 ? Math.round(a.minutos / a.contas) : null,
    horasOcupada: umaCasa(horas),
    // Menos de 1 minuto ocupado não tem "por hora" que preste.
    reaisPorHora: a.minutos >= 1 ? reais(Math.round(a.c / horas)) : null,
  };
}

/**
 * O giro do período. `hoje` corta os dias do período que ainda não chegaram
 * (o "Este mês" no dia 7 tem 7 dias, não 30) — só para `diasDoPeriodo`, que é
 * informativo; o giro por dia usa os dias de salão aberto.
 */
export function giroDeMesas(e: { mesas: MesaDoSalao[]; contas: ContaDoGiro[]; tz: string | null | undefined; de: string; ate: string; hoje?: string }): GiroDeMesas {
  const mesaPorId = new Map(e.mesas.map((m) => [m.id, m]));
  const porMesa = new Map<string, Acumulado>();
  const salao = novo();
  const dias = new Set<string>();
  let liberadas = 0, deComanda = 0;

  for (const c of e.contas) {
    const mesa = mesaPorId.get(c.mesaId);
    if (mesa?.comanda) { deComanda++; continue; }
    const validos = c.pedidos.filter(ehVenda);
    if (validos.length === 0) { liberadas++; continue; }

    const consumo = cent(consumoDaConta(c.pedidos));
    const itens = validos.reduce((s, o) => s + quantidadeDeItens(o), 0);
    const aberta = new Date(c.abertaEm).getTime();
    const fechada = new Date(c.fechadaEm).getTime();
    const minutos = Number.isFinite(aberta) && Number.isFinite(fechada) ? Math.max(0, (fechada - aberta) / 60000) : 0;
    const pessoas = pessoasDaConta(c);
    dias.add(naLoja(c.fechadaEm, e.tz).dia);

    const a = porMesa.get(c.mesaId) ?? novo();
    for (const alvo of [a, salao]) {
      alvo.contas++;
      alvo.c += consumo;
      alvo.itens += itens;
      alvo.minutos += minutos;
      if (pessoas !== null) { alvo.pessoas += pessoas; alvo.contasComPessoas++; alvo.cComPessoas += consumo; }
    }
    porMesa.set(c.mesaId, a);
  }

  const diasAbertos = dias.size;
  // As mesas do ranking: as ativas do salão e as que tiveram conta (mesmo
  // desativada depois). Comanda nunca.
  const ids = new Set([...e.mesas.filter((m) => !m.comanda).map((m) => m.id), ...porMesa.keys()]);
  const linhas: LinhaDoGiro[] = [...ids].map((id) => {
    const m = mesaPorId.get(id);
    const n = numeros(porMesa.get(id) ?? novo(), diasAbertos);
    return {
      ...n,
      mesaId: id,
      numero: m?.numero ?? 0,
      nome: m?.nome?.trim() || null,
      loja: m?.loja?.trim() || null,
      participacao: salao.c > 0 ? umaCasa((cent(n.faturamento) / salao.c) * 100) : 0,
      destaque: null,
      motivo: null,
    };
  });

  marcarDestaques(linhas);

  // Quem mais rendeu primeiro; empate pelo número da mesa, para a ordem não pular.
  linhas.sort((a, b) => b.faturamento - a.faturamento || b.contas - a.contas || (a.loja || "").localeCompare(b.loja || "", "pt-BR") || a.numero - b.numero);

  const resumoNumeros = numeros(salao, diasAbertos);
  const ultimoDia = e.hoje && e.hoje < e.ate ? e.hoje : e.ate;
  return {
    resumo: {
      ...resumoNumeros,
      mesas: linhas.length,
      mesasQueGiraram: linhas.filter((l) => l.contas > 0).length,
      giroMedioPorMesa: linhas.length > 0 && diasAbertos > 0 ? Math.round((salao.contas / linhas.length / diasAbertos) * 100) / 100 : null,
      diasAbertos,
      diasDoPeriodo: ultimoDia >= e.de ? diasNoPeriodo(e.de, ultimoDia) : 0,
      liberadasSemConsumo: liberadas,
      contasDeComanda: deComanda,
    },
    mesas: linhas,
  };
}

/**
 * As que mais rendem e as paradas. Só com 3 mesas ou mais no salão: com duas,
 * "a melhor" e "a pior" são só as duas.
 *
 * - Rende mais: as de maior faturamento — 1 a cada 5 mesas que giraram, no
 *   máximo 3 —, que é onde vale pôr o garçom mais experiente.
 * - Parada: nenhuma conta no período, ou menos da METADE do giro médio por
 *   mesa — a mesa no canto, perto do banheiro, na corrente de ar. A metade é
 *   larga de propósito: marca o que destoa, não metade do salão.
 */
function marcarDestaques(linhas: LinhaDoGiro[]) {
  if (linhas.length < 3) return;
  const giraram = linhas.filter((l) => l.contas > 0);
  const mediaDeContas = linhas.reduce((s, l) => s + l.contas, 0) / linhas.length;

  for (const l of linhas) {
    if (l.contas === 0) { l.destaque = "parada"; l.motivo = "não abriu no período"; }
    else if (l.contas < mediaDeContas / 2) { l.destaque = "parada"; l.motivo = "girou menos da metade da média"; }
  }

  if (giraram.length < 3) return;
  const quantas = Math.min(3, Math.max(1, Math.round(giraram.length / 5)));
  const topo = [...giraram].sort((a, b) => b.faturamento - a.faturamento || b.contas - a.contas).slice(0, quantas);
  for (const l of topo) {
    // Uma conta enorme pode pôr no topo do R$ a mesa que quase não girou: o
    // aviso de parada vale mais (o lugar está ocioso), e ele fica.
    if (l.destaque) continue;
    l.destaque = "rende";
    l.motivo = "das que mais faturam";
  }
}

/** "Mesa 5", "Mesa 5 · Varanda", "Mesa 5 · Varanda (Centro)" — o nome da linha. */
export function nomeDaLinha(l: Pick<LinhaDoGiro, "numero" | "nome" | "loja">): string {
  return `Mesa ${l.numero}${l.nome ? ` · ${l.nome}` : ""}${l.loja ? ` (${l.loja})` : ""}`;
}

/** "1h25", "45 min" — a permanência como o dono fala. */
export function fmtPermanencia(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}
