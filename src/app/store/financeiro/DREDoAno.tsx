"use client";
/**
 * O DRE DO ANO, MÊS A MÊS — o "Balancete" do SWFast: as linhas do DRE nas
 * linhas, os 12 meses nas colunas e o total do ano.
 *
 * Nenhuma conta nova: cada mês é o DRE daquele mês, pela mesma rota da troca
 * de período (/api/store/financeiro/periodo) e pela mesma calcularDRE
 * (lib/financeiro/dre.ts) — o mês aqui é o mesmo número de "Este mês" na aba
 * DRE Geral. Os meses vêm um a um (dois de cada vez), do mais antigo ao atual;
 * o mês que ainda não começou fica vazio. O mês INCOMPLETO (sem custo, sem
 * comissão ou sem taxa) vem marcado: o resultado dele ainda não é lucro.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { calcularDRE, type ComissoesDosApps, type CustoFixo, type TaxasDosApps, type DadosDoPeriodo, type ResultadoDoDRE } from "@/lib/financeiro/dre";
import { somarDias } from "@/lib/relatorios/base";
import type { DespesaDTO } from "./DespesasLancadas";
import { fmtR } from "./ui";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const vermelho = "#C92E09";
const verde = "#0F766E";

type Linha = { rotulo: string; valor: (d: ResultadoDoDRE) => number; tipo?: "total" | "sub" | "pct"; sinal?: -1 };

/** As linhas do demonstrativo da aba DRE Geral, na mesma ordem e com os mesmos nomes. */
const LINHAS: Linha[] = [
  { rotulo: "(+) Valor vendido", valor: (d) => d.valorVendido, tipo: "total" },
  { rotulo: "Vendas", valor: (d) => d.vendas, tipo: "sub" },
  { rotulo: "Ticket médio", valor: (d) => d.ticketMedio, tipo: "sub" },
  { rotulo: "(-) Taxa de entrega que fica com o app", valor: (d) => d.freteDoApp, sinal: -1 },
  { rotulo: "(-) Taxa de serviço do app", valor: (d) => d.taxaDoApp, sinal: -1 },
  { rotulo: "(-) Desconto no fechamento das mesas", valor: (d) => d.descontoNaMesa, sinal: -1 },
  { rotulo: "(+) Cupom pago pelo app", valor: (d) => d.cupomDoApp },
  { rotulo: "(=) RECEITA DA LOJA", valor: (d) => d.receitaDaLoja, tipo: "total" },
  { rotulo: "(-) CMV", valor: (d) => d.cmv, sinal: -1 },
  { rotulo: "(=) LUCRO BRUTO", valor: (d) => d.lucroBruto, tipo: "total" },
  { rotulo: "(-) Comissão e taxas dos apps", valor: (d) => d.totalComissoes, sinal: -1 },
  { rotulo: "(-) Taxas de pagamento", valor: (d) => d.totalTaxas, sinal: -1 },
  { rotulo: "(-) Entregadores", valor: (d) => d.entregadores.total, sinal: -1 },
  { rotulo: "(=) MARGEM DE CONTRIBUIÇÃO", valor: (d) => d.margemDeContribuicao, tipo: "total" },
  { rotulo: "(-) Mensalidade FireHub", valor: (d) => d.mensalidade.total, sinal: -1 },
  { rotulo: "(-) Despesas lançadas", valor: (d) => d.despesas.total, sinal: -1 },
  { rotulo: "(-) Custos fixos", valor: (d) => d.custosFixos.total, sinal: -1 },
  { rotulo: "(=) RESULTADO", valor: (d) => d.resultado, tipo: "total" },
  { rotulo: "Margem do resultado", valor: (d) => d.margens.resultado, tipo: "pct" },
];

const ultimoDoMes = (mes: string) => somarDias(`${somarDias(`${mes}-28`, 4).slice(0, 7)}-01`, -1);

export default function DREDoAno({ hoje, custosFixos, despesas, comissoes, taxasDosApps, paymentFees }: {
  hoje: string;
  custosFixos: CustoFixo[];
  despesas: DespesaDTO[];
  comissoes: ComissoesDosApps;
  taxasDosApps: TaxasDosApps;
  paymentFees: unknown;
}) {
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  /** "AAAA-MM" → os dados do mês (null = falhou). */
  const [porMes, setPorMes] = useState<Record<string, DadosDoPeriodo | null>>({});
  const [carregando, setCarregando] = useState<string | null>(null);
  const pedido = useRef(0);

  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`), [ano]);
  const mesDeHoje = hoje.slice(0, 7);

  // Busca o que falta do ano, dois meses por vez (cada mês é um DRE inteiro no servidor).
  useEffect(() => {
    const id = ++pedido.current;
    const faltam = meses.filter((m) => m <= mesDeHoje && !(m in porMes));
    if (!faltam.length) { setCarregando(null); return; }
    let i = 0;
    const proximo = async (): Promise<void> => {
      const m = faltam[i++];
      if (!m || id !== pedido.current) return;
      setCarregando(m);
      const ate = m === mesDeHoje ? hoje : ultimoDoMes(m);
      let dados: DadosDoPeriodo | null = null;
      try {
        const res = await fetch(`/api/store/financeiro/periodo?de=${m}-01&ate=${ate}`, { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (res.ok && j && !j.error) dados = j as DadosDoPeriodo;
      } catch { /* fica null: a coluna mostra "não carregou" */ }
      if (id !== pedido.current) return;
      setPorMes((p) => ({ ...p, [m]: dados }));
      return proximo();
    };
    Promise.all([proximo(), proximo()]).then(() => { if (id === pedido.current) setCarregando(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meses, mesDeHoje, hoje]);

  const dres = useMemo(() => meses.map((m) => {
    const d = porMes[m];
    return d ? calcularDRE({ dados: d, custosFixos, despesas, comissoes, taxasDosApps, paymentFees }) : null;
  }), [meses, porMes, custosFixos, despesas, comissoes, taxasDosApps, paymentFees]);

  const comDados = dres.filter((d): d is ResultadoDoDRE => Boolean(d));
  const total = (l: Linha) => {
    if (l.tipo === "pct") {
      const receita = comDados.reduce((s, d) => s + d.receitaDaLoja, 0);
      const resultado = comDados.reduce((s, d) => s + d.resultado, 0);
      return receita > 0 ? (resultado / receita) * 100 : 0;
    }
    if (l.rotulo === "Ticket médio") {
      const vendas = comDados.reduce((s, d) => s + d.vendas, 0);
      return vendas > 0 ? comDados.reduce((s, d) => s + d.valorVendido, 0) / vendas : 0;
    }
    return comDados.reduce((s, d) => s + l.valor(d), 0);
  };
  const algumIncompleto = comDados.some((d) => !d.completo);

  const fmt = (l: Linha, v: number) => {
    if (l.tipo === "pct") return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    if (l.rotulo === "Vendas") return v.toLocaleString("pt-BR");
    const s = l.sinal === -1 ? -v : v;
    return fmtR(s);
  };
  const cor = (l: Linha, v: number) => (l.tipo === "total" || l.tipo === "pct" ? (v >= 0 ? verde : vermelho) : l.sinal === -1 && v > 0 ? vermelho : "#0F172A");
  const cel: CSSProperties ={ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontSize: "0.8rem" };

  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1rem 1.1rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" onClick={() => setAno((a) => a - 1)} aria-label="Ano anterior"
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>◀</button>
        <strong style={{ fontSize: "1.15rem" }}>DRE de {ano}, mês a mês</strong>
        <button type="button" onClick={() => setAno((a) => a + 1)} disabled={ano >= Number(hoje.slice(0, 4))} aria-label="Próximo ano"
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", fontWeight: 700, fontFamily: "inherit", opacity: ano >= Number(hoje.slice(0, 4)) ? 0.4 : 1 }}>▶</button>
        {carregando && <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Carregando {MESES[Number(carregando.slice(5, 7)) - 1]}…</span>}
      </div>
      <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "#64748B" }}>
        Cada coluna é o DRE do mês inteiro (o mês atual, até hoje) — o mesmo número de &quot;Este mês&quot; no DRE Geral. O período escolhido no topo não vale aqui.
        {algumIncompleto && <span style={{ color: "#B45309", fontWeight: 700 }}> ⚠ Mês marcado com ⚠ está com o resultado incompleto (falta custo, comissão ou taxa): abra o mês no DRE Geral para ver o que falta.</span>}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
          <thead>
            <tr style={{ background: "#F8FAFC", color: "#475569" }}>
              <th style={{ ...cel, textAlign: "left", position: "sticky", left: 0, background: "#F8FAFC", minWidth: 230 }} />
              {meses.map((m, i) => {
                const d = dres[i];
                const futuro = m > mesDeHoje;
                return (
                  <th key={m} style={{ ...cel, fontWeight: 800 }} title={d && !d.completo ? d.pendencias.join("\n") : undefined}>
                    {MESES[i]}{d && !d.completo ? " ⚠" : ""}{futuro ? "" : porMes[m] === null ? " (erro)" : ""}
                  </th>
                );
              })}
              <th style={{ ...cel, fontWeight: 900, color: "#0F172A" }}>Ano</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS.map((l) => {
              const t = total(l);
              const forte = l.tipo === "total";
              return (
                <tr key={l.rotulo} style={{ borderTop: forte ? "2px solid #E2E8F0" : "1px solid #F1F5F9", background: forte ? "#FAFAF9" : undefined }}>
                  <td style={{ ...cel, textAlign: "left", fontWeight: forte ? 800 : l.tipo === "sub" ? 500 : 600, color: l.tipo === "sub" ? "#64748B" : "#0F172A", paddingLeft: l.tipo === "sub" ? 20 : 8, position: "sticky", left: 0, background: forte ? "#FAFAF9" : "#fff" }}>
                    {l.rotulo}
                  </td>
                  {meses.map((m, i) => {
                    const d = dres[i];
                    if (!d) return <td key={m} style={{ ...cel, color: "#CBD5E1" }}>{m > mesDeHoje ? "" : m in porMes ? "—" : "…"}</td>;
                    const v = l.valor(d);
                    return <td key={m} style={{ ...cel, fontWeight: forte ? 800 : 500, color: cor(l, v) }}>{fmt(l, v)}</td>;
                  })}
                  <td style={{ ...cel, fontWeight: 900, color: cor(l, t) }}>{fmt(l, t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
