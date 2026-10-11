/**
 * O CMO — custo da mão de obra da loja no período.
 *
 *     CMO = Σ custo mensal de cada pessoa × (1 ÷ dias do mês) por dia em que ela
 *           estava na folha dentro do período
 *         + diárias e extras lançados nas despesas no período
 *
 * Custo mensal = salário × (1 + encargos %) + benefícios + (vale-transporte − o
 * desconto dele no salário, 6% por padrão). Assim a semana leva
 * 7/30 (ou 7/31) do mês, e quem entrou na quarta só conta a partir de quarta.
 *
 * Entregador não entra: é custo de entrega, que tem relatório próprio.
 *
 * Puro. Testado em scripts/teste-cmv-real.ts.
 */
import { somarDias } from "@/lib/relatorios/base";

export type PessoaParaCmo = {
  id: string;
  nome: string;
  funcao?: string | null;
  salario: number;
  encargosPct: number;
  beneficios: number;
  valeTransporte?: number | null;
  descontoVtPct?: number | null;
  desde: string;
  ate: string | null;
};

export type DiariaParaCmo = { dia: string; valor: number; categoria: string; descricao?: string | null };

/** As categorias de despesa lançada que são mão de obra (DespesasLancadas.tsx). */
export const CATEGORIAS_DE_MAO_DE_OBRA = ["diária / ajudante", "diaria / ajudante", "mão de obra", "mao de obra", "extra / freelancer", "freelancer"];

export function ehMaoDeObra(categoria: string | null | undefined): boolean {
  const c = String(categoria || "").trim().toLowerCase();
  return CATEGORIAS_DE_MAO_DE_OBRA.includes(c);
}

/** O desconto do VT que a lei permite tirar do salário, quando a loja não diz outro. */
export const DESCONTO_VT_PADRAO = 6;

/**
 * O que o vale-transporte custa para a loja: o que ela compra menos o que sai do
 * salário (o % do salário, e nunca mais que o próprio VT).
 */
export function custoDoVt(p: Pick<PessoaParaCmo, "salario" | "valeTransporte" | "descontoVtPct">): number {
  const vt = Number(p.valeTransporte) || 0;
  if (vt <= 0) return 0;
  const pct = p.descontoVtPct == null ? DESCONTO_VT_PADRAO : Number(p.descontoVtPct) || 0;
  return vt - Math.min(vt, (Number(p.salario) || 0) * (pct / 100));
}

export function custoMensal(p: Pick<PessoaParaCmo, "salario" | "encargosPct" | "beneficios" | "valeTransporte" | "descontoVtPct">): number {
  const s = Number(p.salario) || 0;
  const e = Number(p.encargosPct) || 0;
  const b = Number(p.beneficios) || 0;
  return s * (1 + e / 100) + b + custoDoVt(p);
}

function diasNoMes(dia: string): number {
  const [a, m] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export type CmoDoPeriodo = {
  total: number;
  folha: number;
  diarias: number;
  porPessoa: { id: string; nome: string; funcao: string | null; valor: number; dias: number }[];
};

export function cmoDoPeriodo(pessoas: PessoaParaCmo[], diarias: DiariaParaCmo[], de: string, ate: string): CmoDoPeriodo {
  const porPessoa = pessoas.map((p) => ({ id: p.id, nome: p.nome, funcao: p.funcao ?? null, valor: 0, dias: 0 }));
  if (de <= ate) {
    for (let d = de, guarda = 0; d <= ate && guarda < 800; d = somarDias(d, 1), guarda++) {
      const fator = 1 / diasNoMes(d);
      pessoas.forEach((p, i) => {
        if (p.desde && d < p.desde) return;
        if (p.ate && d > p.ate) return;
        porPessoa[i].valor += custoMensal(p) * fator;
        porPessoa[i].dias++;
      });
    }
  }
  const folha = porPessoa.reduce((s, p) => s + p.valor, 0);
  const extras = diarias.filter((x) => x.dia >= de && x.dia <= ate && ehMaoDeObra(x.categoria)).reduce((s, x) => s + (Number(x.valor) || 0), 0);
  return {
    total: r2(folha + extras),
    folha: r2(folha),
    diarias: r2(extras),
    porPessoa: porPessoa.map((p) => ({ ...p, valor: r2(p.valor) })).filter((p) => p.dias > 0),
  };
}
