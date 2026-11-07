/**
 * DIFERENÇAS DE CAIXA DO PERÍODO — por operador, por dia e por forma: o que o
 * sistema esperava, o que foi contado e a diferença. O SWFast soma o período
 * por operador; o Histórico de caixas do FireHub mostrava um caixa por vez, e
 * o dono que queria saber "quem mais deixou faltar este mês" somava na mão.
 *
 * Nenhuma regra nova de conferência: cada caixa é lido por
 * lib/conferencia-do-caixa.ts (conferenciaGravada), o mesmo do Histórico, da
 * 2ª via e do aviso ao dono. Então:
 *   • forma em branco não é "contei zero" — fica fora da diferença;
 *   • caixa sem conferência (fechou sozinho, ninguém digitou, ou as cinco
 *     linhas em zero do caixa antigo) entra contado À PARTE, com o esperado,
 *     e nunca como falta;
 *   • a diferença é a GRAVADA no fechamento (a do aviso ao dono).
 *
 * O OPERADOR é quem abriu o caixa (CashSession.abertoPor, desde 17/10/2026);
 * no caixa de antes, quem fechou (closedBy). O dia é o dia operacional da
 * ABERTURA (vira às 5h), como "Caixa de 06/11" no Histórico.
 *
 * O esperado por forma de cada operador é também o "Faturamento por tipo de
 * pagamento por operador" do SWF: o que passou pela gaveta e pela maquininha
 * no turno de cada um (o pedido não grava quem vendeu; o caixa grava).
 *
 * Puro: recebe as linhas da CashSession já buscadas.
 */
import { naLoja } from "@/lib/relatorios/base";
import { cent, reais } from "@/lib/relatorios/regua-da-venda";
import { FORMAS_DA_CONFERENCIA, conferenciaGravada, FECHADO_PELO_SISTEMA, type ChaveDaConferencia } from "@/lib/conferencia-do-caixa";

export type CaixaParaDiferencas = Record<string, unknown> & {
  id: string;
  openedAt: Date | string;
  closedAt: Date | string | null;
  closedBy?: string | null;
  /** Nome de quem abriu (lerQuemAbriu), quando se sabe. */
  abertoPorNome?: string | null;
};

export type FormaDaDiferenca = {
  chave: ChaveDaConferencia;
  nome: string;
  /** Tudo o que o sistema esperava nesta forma (inclusive no caixa sem conferência). */
  esperado: number;
  /** O esperado só onde a forma foi contada — o lado de lá da diferença. */
  esperadoConferido: number;
  contado: number;
  diferenca: number;
};

export type SomaDasDiferencas = {
  caixas: number;
  conferidos: number;
  semConferencia: number;
  /** Esperado das formas contadas × contado × diferença gravada. */
  esperado: number;
  contado: number;
  diferenca: number;
  /** Soma só das faltas (negativo) e só das sobras, caixa a caixa. */
  faltas: number;
  sobras: number;
  /** Pago online nos turnos (não passa pela gaveta: fora da conferência). */
  online: number;
  formas: FormaDaDiferenca[];
};

export type CaixaDaDiferenca = {
  id: string;
  dia: string;
  operador: string;
  fechadoPor: string | null;
  abertoEm: string;
  fechadoEm: string | null;
  situacao: "CONFERIDO" | "PARCIAL" | "SEM_CONFERENCIA";
  esperado: number;
  contado: number;
  diferenca: number | null;
  online: number;
  formas: { chave: ChaveDaConferencia; nome: string; esperado: number; contado: number | null; diferenca: number | null }[];
};

export type ResultadoDasDiferencas = {
  caixas: CaixaDaDiferenca[];
  porOperador: (SomaDasDiferencas & { operador: string })[];
  porDia: (SomaDasDiferencas & { dia: string })[];
  total: SomaDasDiferencas;
};

const SEM_NOME = "Não identificado";

/** Quem responde pelo caixa: quem abriu; no caixa antigo, quem fechou (o "sistema" não é gente). */
export function operadorDoCaixa(c: Pick<CaixaParaDiferencas, "abertoPorNome" | "closedBy">): string {
  const abriu = String(c.abertoPorNome || "").trim();
  if (abriu) return abriu;
  const fechou = String(c.closedBy || "").trim();
  if (fechou && fechou !== FECHADO_PELO_SISTEMA && !fechou.startsWith("sistema")) return fechou;
  return SEM_NOME;
}

type Acc = {
  caixas: number; conferidos: number; sem: number; esp: number; cont: number; dif: number; faltas: number; sobras: number; online: number;
  formas: Map<ChaveDaConferencia, { esp: number; espConf: number; cont: number; dif: number }>;
};
const novo = (): Acc => ({ caixas: 0, conferidos: 0, sem: 0, esp: 0, cont: 0, dif: 0, faltas: 0, sobras: 0, online: 0, formas: new Map() });

function fechar(a: Acc): SomaDasDiferencas {
  return {
    caixas: a.caixas, conferidos: a.conferidos, semConferencia: a.sem,
    esperado: reais(a.esp), contado: reais(a.cont), diferenca: reais(a.dif), faltas: reais(a.faltas), sobras: reais(a.sobras), online: reais(a.online),
    formas: FORMAS_DA_CONFERENCIA.map((f) => {
      const x = a.formas.get(f.chave) || { esp: 0, espConf: 0, cont: 0, dif: 0 };
      return { chave: f.chave, nome: f.nome, esperado: reais(x.esp), esperadoConferido: reais(x.espConf), contado: reais(x.cont), diferenca: reais(x.dif) };
    }),
  };
}

export function diferencasDeCaixa(linhas: CaixaParaDiferencas[], tz: string | null | undefined): ResultadoDasDiferencas {
  const total = novo();
  const porOperador = new Map<string, { nome: string; acc: Acc }>();
  const porDia = new Map<string, Acc>();
  const caixas: CaixaDaDiferenca[] = [];

  for (const s of linhas) {
    const conf = conferenciaGravada(s);
    const dia = naLoja(s.openedAt, tz).dia;
    const operador = operadorDoCaixa(s);
    const chaveDoOperador = operador.toLowerCase();
    if (!porOperador.has(chaveDoOperador)) porOperador.set(chaveDoOperador, { nome: operador, acc: novo() });
    if (!porDia.has(dia)) porDia.set(dia, novo());
    const sem = conf.situacao === "SEM_CONFERENCIA";

    for (const a of [total, porOperador.get(chaveDoOperador)!.acc, porDia.get(dia)!]) {
      a.caixas++;
      if (sem) a.sem++; else a.conferidos++;
      a.online += cent(conf.online);
      if (!sem) {
        a.esp += cent(conf.esperadoConferido);
        a.cont += cent(conf.contado);
        const d = cent(conf.diferenca ?? 0);
        a.dif += d;
        if (d < 0) a.faltas += d; else a.sobras += d;
      }
      for (const l of conf.linhas) {
        const f = a.formas.get(l.chave) || { esp: 0, espConf: 0, cont: 0, dif: 0 };
        f.esp += cent(l.esperado);
        if (l.contado != null) { f.espConf += cent(l.esperado); f.cont += cent(l.contado); f.dif += cent(l.diferenca ?? 0); }
        a.formas.set(l.chave, f);
      }
    }

    caixas.push({
      id: s.id, dia, operador, fechadoPor: s.closedBy ? String(s.closedBy) : null,
      abertoEm: new Date(s.openedAt).toISOString(), fechadoEm: s.closedAt ? new Date(s.closedAt).toISOString() : null,
      situacao: conf.situacao, esperado: conf.esperadoConferido, contado: conf.contado, diferenca: conf.diferenca, online: conf.online,
      formas: conf.linhas.map((l) => ({ chave: l.chave, nome: l.nome, esperado: l.esperado, contado: l.contado, diferenca: l.diferenca })),
    });
  }

  caixas.sort((x, y) => y.abertoEm.localeCompare(x.abertoEm));
  return {
    caixas,
    // Quem mais deixou faltar primeiro: é a pergunta que traz o dono aqui.
    porOperador: [...porOperador.values()].map(({ nome, acc }) => ({ operador: nome, ...fechar(acc) })).sort((x, y) => x.diferenca - y.diferenca || y.caixas - x.caixas),
    porDia: [...porDia.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([dia, acc]) => ({ dia, ...fechar(acc) })),
    total: fechar(total),
  };
}
