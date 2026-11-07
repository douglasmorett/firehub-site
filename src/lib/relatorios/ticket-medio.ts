/**
 * TICKET MÉDIO — por dia e por garçom: faturamento, atendimentos, pessoas,
 * ticket por atendimento, ticket por pessoa e P.A. (produtos por atendimento).
 * Puro, sem banco: a rota (api/store/relatorios/ticket-medio) busca, aqui só
 * se conta. Travado em scripts/teste-ticket-medio.ts.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O "Ticket médio" do SWFast (o sistema de onde o Alex, da Hambúrgueria
 * Avenida, veio — 11/2026) mostra, por data e por operador, o faturamento, a
 * quantidade de pessoas e o ticket por pessoa. Aqui o ticket existia só por
 * pedido, no Faturamento por dia; pessoas e P.A. não existiam.
 *
 * ── A régua é a de todo relatório ───────────────────────────────────────────
 *
 * Nada de conta nova de venda (lib/relatorios/regua-da-venda.ts):
 *   - FATURAMENTO = Σ `totalAmount` dos pedidos que entram na venda, no dia
 *     do PEDIDO (dia operacional, vira às 5h), mesa aberta ou fechada — o
 *     mesmo valor do Faturamento por dia e do Vendas por período;
 *   - ATENDIMENTOS = `atendimentosDaVenda`: o pedido comum é um, a mesa é UM
 *     no dia do primeiro lançamento dentro do período, por mais rodadas que
 *     tenha. Ticket por atendimento = faturamento ÷ atendimentos — o "Ticket
 *     médio" de lá, no centavo;
 *   - P.A. = unidades de item (`quantidadeDeItens`) ÷ atendimentos.
 *
 * ── Pessoas ─────────────────────────────────────────────────────────────────
 *
 * Só a MESA tem pessoas (lib/pessoas-da-mesa.ts: o "Quantas pessoas?" da
 * abertura, senão as pessoas nomeadas na conta). Balcão, entrega e retirada
 * não têm — e não se inventa 1 por pedido: a pizza família da entrega não é
 * de uma pessoa. O ticket por pessoa é o lançado nas MESAS COM nº de pessoas
 * ÷ essas pessoas, e a mesa conta no dia (e no garçom) em que conta como
 * atendimento — o lançado dela no período vai junto, para a divisão ser da
 * mesma mesa em cima e embaixo. Sem nenhuma mesa com o número, a tela diz
 * "sem nº de pessoas".
 *
 * ── Por garçom ──────────────────────────────────────────────────────────────
 *
 * O garçom é o da CONTA da mesa (TableSession.waiterId — o pedido não grava
 * quem lançou). O que não é de mesa vai para "Fora do salão" e a mesa sem
 * garçom para "Mesa sem garçom": as linhas somam o total, nada some.
 */
import { naLoja } from "@/lib/relatorios/base";
import {
  atendimentosDaVenda, cent, entraNaVenda, quantidadeDeItens, reais, ticketMedio,
  type ItemDaRegua, type PedidoDaRegua,
} from "@/lib/relatorios/regua-da-venda";
import { pessoasDaConta } from "@/lib/pessoas-da-mesa";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type PedidoDoTicket = PedidoDaRegua & { items?: ItemDaRegua[] | null };

/** A conta de mesa de um pedido: o garçom e as pessoas. */
export type ContaDoTicket = {
  waiterId?: string | null;
  garcom?: string | null;
  pessoas?: number | null;
  convidados?: number | null;
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type NumerosDoTicket = {
  faturamento: number;
  atendimentos: number;
  /** Pedidos (cada rodada de mesa é um). */
  lancamentos: number;
  /** Atendimentos de mesa (contas). */
  mesas: number;
  pessoas: number;
  /** Das mesas, quantas têm o nº de pessoas. */
  mesasComPessoas: number;
  ticketPorAtendimento: number | null;
  /** null = "sem nº de pessoas". */
  ticketPorPessoa: number | null;
  itens: number;
  pa: number | null;
};

export type DiaDoTicket = NumerosDoTicket & { dia: string; diaSemana: number };

export const FORA_DO_SALAO = "__fora__";
export const MESA_SEM_GARCOM = "__sem__";

export type GarcomDoTicket = NumerosDoTicket & { chave: string; nome: string; waiterId: string | null };

export type TicketMedio = {
  total: NumerosDoTicket;
  /** Só os dias com atendimento, do mais antigo para o mais novo. */
  porDia: DiaDoTicket[];
  /** Do maior faturamento para o menor; "Fora do salão" sempre por último. */
  porGarcom: GarcomDoTicket[];
};

// ── A CONTA ─────────────────────────────────────────────────────────────────

type Acumulado = { c: number; atendimentos: number; lancamentos: number; mesas: number; pessoas: number; mesasComPessoas: number; cComPessoas: number; itens: number };
const novo = (): Acumulado => ({ c: 0, atendimentos: 0, lancamentos: 0, mesas: 0, pessoas: 0, mesasComPessoas: 0, cComPessoas: 0, itens: 0 });

function numeros(a: Acumulado): NumerosDoTicket {
  return {
    faturamento: reais(a.c),
    atendimentos: a.atendimentos,
    lancamentos: a.lancamentos,
    mesas: a.mesas,
    pessoas: a.pessoas,
    mesasComPessoas: a.mesasComPessoas,
    ticketPorAtendimento: a.atendimentos > 0 ? ticketMedio(reais(a.c), a.atendimentos) : null,
    ticketPorPessoa: a.pessoas > 0 ? ticketMedio(reais(a.cComPessoas), a.pessoas) : null,
    itens: Math.round(a.itens * 100) / 100,
    pa: a.atendimentos > 0 ? Math.round((a.itens / a.atendimentos) * 10) / 10 : null,
  };
}

/**
 * O ticket médio de um recorte de pedidos (já filtrado por período, tipo,
 * canal, marca e horário — lib/relatorios/servidor.ts, pedidosDoRelatorio).
 * `contas` traz o garçom e as pessoas de cada mesa (TableSession.id).
 */
export function ticketMedioDoPeriodo(e: { pedidos: PedidoDoTicket[]; contas: Map<string, ContaDoTicket>; tz: string | null | undefined }): TicketMedio {
  const validos = e.pedidos.filter(entraNaVenda);
  const at = atendimentosDaVenda(validos);
  const diaDe = (p: PedidoDoTicket) => naLoja(p.createdAt, e.tz);

  // O dia em que cada mesa conta como atendimento (o do 1º lançamento no
  // recorte): o lançado dela vai para o ticket por pessoa desse dia.
  const diaDaMesa = new Map<string, { dia: string; diaSemana: number }>();
  for (const p of validos) if (p.tableSessionId && at.abre.has(p.id)) diaDaMesa.set(p.tableSessionId, diaDe(p));

  const total = novo();
  const porDia = new Map<string, Acumulado & { diaSemana: number }>();
  const porGarcom = new Map<string, Acumulado & { nome: string; waiterId: string | null }>();

  const garcomDe = (p: PedidoDoTicket) => {
    if (!p.tableSessionId) return { chave: FORA_DO_SALAO, nome: "Fora do salão (balcão, entrega, retirada)", waiterId: null };
    const conta = e.contas.get(p.tableSessionId);
    if (!conta?.waiterId) return { chave: MESA_SEM_GARCOM, nome: "Mesa sem garçom", waiterId: null };
    return { chave: conta.waiterId, nome: conta.garcom?.trim() || "Garçom", waiterId: conta.waiterId };
  };
  const doDia = (dia: string, diaSemana: number) => {
    let a = porDia.get(dia);
    if (!a) { a = { ...novo(), diaSemana }; porDia.set(dia, a); }
    return a;
  };
  const doGarcom = (g: { chave: string; nome: string; waiterId: string | null }) => {
    let a = porGarcom.get(g.chave);
    if (!a) { a = { ...novo(), nome: g.nome, waiterId: g.waiterId }; porGarcom.set(g.chave, a); }
    return a;
  };

  for (const p of validos) {
    const { dia, diaSemana } = diaDe(p);
    const g = garcomDe(p);
    const c = cent(p.totalAmount);
    const itens = quantidadeDeItens(p);
    const abre = at.abre.has(p.id);
    const conta = p.tableSessionId ? e.contas.get(p.tableSessionId) : undefined;
    const pessoas = p.tableSessionId ? pessoasDaConta(conta ?? {}) : null;

    for (const a of [total, doDia(dia, diaSemana), doGarcom(g)]) {
      a.c += c;
      a.lancamentos++;
      a.itens += itens;
      if (abre) {
        a.atendimentos++;
        if (p.tableSessionId) a.mesas++;
        if (pessoas !== null) { a.pessoas += pessoas; a.mesasComPessoas++; }
      }
    }
    // O lançado da mesa com pessoas: no total, no garçom (o da conta, fixo) e
    // no dia em que a mesa conta como atendimento — não no dia da rodada.
    if (pessoas !== null && p.tableSessionId) {
      const d = diaDaMesa.get(p.tableSessionId) ?? { dia, diaSemana };
      total.cComPessoas += c;
      doGarcom(g).cComPessoas += c;
      doDia(d.dia, d.diaSemana).cComPessoas += c;
    }
  }

  return {
    total: numeros(total),
    porDia: [...porDia.entries()]
      .filter(([, a]) => a.lancamentos > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, a]) => ({ dia, diaSemana: a.diaSemana, ...numeros(a) })),
    porGarcom: [...porGarcom.entries()]
      .map(([chave, a]) => ({ chave, nome: a.nome, waiterId: a.waiterId, ...numeros(a) }))
      .sort((a, b) => Number(a.chave === FORA_DO_SALAO) - Number(b.chave === FORA_DO_SALAO) || b.faturamento - a.faturamento || a.nome.localeCompare(b.nome, "pt-BR")),
  };
}
