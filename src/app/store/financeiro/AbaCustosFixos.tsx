"use client";
/**
 * Custos fixos mensais (aluguel, salários, energia…). O DRE os rateia mês a
 * mês pelos dias do período (lib/financeiro/dre.ts, mesesDoPeriodo).
 *
 * O valor é lido no formato brasileiro (lib/lote-de-saldo.ts,
 * lerValorEmReais): "1.200,00" virava R$ 1,20 com o parseFloat antigo.
 */
import { useState } from "react";
import { Building2, Plus, Trash2 } from "lucide-react";
import AjudaModulo from "@/components/AjudaModulo";
import { lerValorEmReais } from "@/lib/lote-de-saldo";
import { pontoDeEquilibrio, type CustoFixo, type ResultadoDoDRE } from "@/lib/financeiro/dre";
import { fmtPct, fmtR } from "./ui";

export default function AbaCustosFixos({ custos, onCustos, dre }: {
  custos: CustoFixo[];
  onCustos: (c: CustoFixo[]) => void;
  dre: ResultadoDoDRE | null;
}) {
  const [rotulo, setRotulo] = useState("");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const totalMensal = custos.reduce((s, c) => s + Math.round(c.value * 100), 0) / 100;
  const valorLido = lerValorEmReais(valor);
  const podeAdicionar = rotulo.trim().length > 0 && Number.isFinite(valorLido) && valorLido > 0;

  async function salvar(lista: CustoFixo[]) {
    setSalvando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/store/fixed-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixedCosts: lista }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setAviso({ ok: false, texto: j?.error || "Não foi possível salvar. Tente de novo." }); return false; }
      onCustos(Array.isArray(j?.fixedCosts) ? j.fixedCosts : lista);
      setAviso({ ok: true, texto: "Custos salvos." });
      return true;
    } catch {
      setAviso({ ok: false, texto: "Sem conexão. Tente de novo." });
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function adicionar() {
    if (!podeAdicionar) return;
    const ok = await salvar([...custos, { id: Date.now().toString(), label: rotulo.trim(), value: Math.round(valorLido * 100) / 100 }]);
    if (ok) { setRotulo(""); setValor(""); }
  }

  const equilibrio = dre ? pontoDeEquilibrio(dre, totalMensal) : null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <AjudaModulo
        icone="🏢"
        titulo="Custos fixos"
        oQueE="São as contas que você paga todo mês vendendo muito ou vendendo pouco: aluguel, salários, luz, internet, contador."
        paraQueServe="Com eles cadastrados, o DRE desconta a parte de cada mês do período e mostra quanto a loja precisa vender por mês para pagar essas contas — quando o custo dos produtos e a comissão dos apps também estiverem cadastrados."
        aviso="Cadastre o valor do MÊS inteiro, não do dia. O DRE divide pelos dias de cada mês do período."
        passos={[
          { titulo: "Liste tudo", texto: "aluguel, folha, energia, água, internet, contador, sistema, taxas." },
          { titulo: "Salve", texto: "o DRE passa a descontar esses custos do resultado do período." },
          { titulo: "Revise a cada mudança", texto: "contratou alguém ou o aluguel subiu? Atualize aqui." },
        ]}
      />
      <div style={{ background: "linear-gradient(135deg,#475569,#334155)", borderRadius: 16, padding: "1.5rem", color: "#fff", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Building2 size={24} />
          <h2 style={{ fontWeight: 900, fontSize: "1.2rem", margin: 0 }}>Custos fixos mensais</h2>
        </div>
        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.8)", margin: 0 }}>
          Entram no DRE pela parte de cada mês que o período toca: 7 dias de outubro são 7/31 do mês; 90 dias são quase três meses inteiros.
        </p>
        {custos.length > 0 && (
          <div style={{ marginTop: 12, background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Total mensal cadastrado:</span>
            <span style={{ fontSize: "1.1rem", fontWeight: 900 }}>{fmtR(totalMensal)}</span>
          </div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", marginBottom: "1.25rem" }}>
        <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: "0 0 1rem" }}>➕ Adicionar custo fixo</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={rotulo} onChange={(e) => setRotulo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adicionar()}
            placeholder="Descrição (ex: Aluguel, Salário João, Energia...)" maxLength={80}
            style={{ flex: 2, minWidth: 180, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit" }} />
          <div style={{ position: "relative", flex: 1, minWidth: 130 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#64748B", fontSize: "0.85rem", fontWeight: 700 }}>R$</span>
            <input value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adicionar()}
              placeholder="1.200,00" type="text" inputMode="decimal"
              style={{ width: "100%", padding: "10px 14px 10px 34px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <button onClick={adicionar} disabled={!podeAdicionar || salvando}
            style={{ padding: "10px 20px", borderRadius: 10, background: !podeAdicionar ? "#E2E8F0" : "#475569", color: !podeAdicionar ? "#94A3B8" : "#fff", border: "none", fontWeight: 700, fontSize: "0.88rem", cursor: podeAdicionar ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
            <Plus size={16} /> Adicionar
          </button>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "8px 0 0" }}>
          {valor && Number.isFinite(valorLido) && valorLido > 0 ? <>Vai entrar como <strong>{fmtR(valorLido)}</strong> por mês.</> : "Enter adiciona. Salvo automaticamente."}
        </p>
        {aviso && (
          <div role={aviso.ok ? "status" : "alert"} style={{ marginTop: 10, fontSize: "0.8rem", fontWeight: 700, color: aviso.ok ? "#0F766E" : "#B71C1C" }}>{aviso.texto}</div>
        )}
      </div>

      {custos.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 16, padding: "2.5rem", textAlign: "center", border: "1.5px dashed #E2E8F0" }}>
          <Building2 size={40} color="#CBD5E1" style={{ marginBottom: 12 }} />
          <p style={{ fontWeight: 700, color: "#64748B", margin: "0 0 6px" }}>Nenhum custo fixo cadastrado</p>
          <p style={{ fontSize: "0.82rem", color: "#94A3B8", margin: 0 }}>Adicione aluguel, salários, energia, internet, etc.</p>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>DESCRIÇÃO</span>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>VALOR / MÊS</span>
          </div>
          {custos.map((c, i) => (
            <div key={c.id || i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderTop: i === 0 ? "none" : "1px solid #F1F5F9" }}>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#475569" }}>{fmtR(c.value)}</span>
                <button onClick={() => salvar(custos.filter((x) => x !== c))} disabled={salvando} aria-label={`Remover ${c.label}`}
                  style={{ padding: 6, borderRadius: 8, background: "#FEF2F2", border: "none", cursor: "pointer" }}>
                  <Trash2 size={14} color="#C92E09" />
                </button>
              </div>
            </div>
          ))}
          <div style={{ padding: "14px 16px", background: "#F8FAFC", borderTop: "2px solid #E2E8F0", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 800, color: "#475569" }}>Total mensal</span>
            <span style={{ fontWeight: 900, fontSize: "1.05rem", color: "#475569" }}>{fmtR(totalMensal)}</span>
          </div>
        </div>
      )}

      {custos.length > 0 && dre && (
        <div style={{ background: "#FFF7E6", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "1rem 1.25rem", marginTop: "1.25rem", fontSize: "0.85rem", color: "#78350F" }}>
          <p style={{ fontWeight: 800, fontSize: "0.88rem", color: "#92400E", margin: "0 0 8px" }}>📊 No período escolhido ({dre.dias} {dre.dias === 1 ? "dia" : "dias"})</p>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>Custos fixos do período ({dre.custosFixos.mesesEquivalentes.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} de mês):</span>
            <strong>- {fmtR(dre.custosFixos.total)}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>{dre.completo ? "Resultado do período:" : "Resultado parcial (incompleto):"}</span>
            <strong style={{ color: dre.completo ? (dre.resultado >= 0 ? "#0F766E" : "#C92E09") : "#92400E" }}>{fmtR(dre.resultado)}</strong>
          </div>
          {equilibrio && (
            equilibrio.ok ? (
              <div style={{ borderTop: "1px solid #FDE68A", paddingTop: 8 }}>
                Para pagar {fmtR(totalMensal)} de custo fixo por mês, a loja precisa vender cerca de <strong>{fmtR(equilibrio.vendaMensal)} por mês</strong>,
                com a margem de contribuição deste período ({fmtPct(equilibrio.margem)} do valor vendido). A mensalidade e as despesas lançadas vêm por cima.
              </div>
            ) : (
              <div style={{ borderTop: "1px solid #FDE68A", paddingTop: 8 }}>
                {equilibrio.motivo === "incompleto"
                  ? "Quanto a loja precisa vender para pagar os custos fixos aparece aqui quando o custo dos produtos e a comissão dos apps estiverem cadastrados (veja a aba DRE Geral)."
                  : equilibrio.motivo === "margem-negativa"
                    ? "A margem de contribuição deste período é negativa: as vendas não estão pagando nem os custos que andam com elas. Revise preço, custo e comissão."
                    : equilibrio.motivo === "sem-venda" ? "Sem vendas no período para calcular a margem." : null}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
