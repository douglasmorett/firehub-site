"use client";
/**
 * Configurações do Financeiro: a COMISSÃO DE CADA APP (que o DRE usa na linha
 * "Comissão e taxas dos apps") e a conta de repasse guardada.
 *
 * O formulário de repasse que morava aqui não gravava nada: os campos não
 * tinham estado e o botão "Salvar Conta de Repasse" só mostrava um alert de
 * sucesso (auditoria de 11/10/2026). A chave fica em Minha Loja, que grava de
 * verdade; aqui ela só aparece, com o aviso de que o repasse automático ainda
 * não existe.
 */
import { useState } from "react";
import { Building2, Percent } from "lucide-react";
import AjudaModulo from "@/components/AjudaModulo";
import { CANAIS_COM_COMISSAO, COMISSAO_DE_REFERENCIA, type ComissoesDosApps, type ResultadoDoDRE } from "@/lib/financeiro/dre";
import { fmtNum, fmtR } from "./ui";

export default function AbaConfiguracoes({
  comissoes, onComissoes, dre, repasseConfig,
}: {
  comissoes: ComissoesDosApps;
  onComissoes: (c: ComissoesDosApps) => void;
  dre: ResultadoDoDRE | null;
  repasseConfig: any;
}) {
  const [texto, setTexto] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const { chave } of CANAIS_COM_COMISSAO) {
      const v = comissoes[chave];
      t[chave] = typeof v === "number" ? String(v).replace(".", ",") : "";
    }
    return t;
  });
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const vendasNoPeriodo = new Map((dre?.comissoes || []).map((c) => [c.canal as string, c]));

  async function salvar() {
    setSalvando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/store/financeiro/comissao-dos-apps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comissoes: texto }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setAviso({ ok: false, texto: j?.error || "Não foi possível salvar. Tente de novo." }); return; }
      onComissoes(j?.comissoes || {});
      setAviso({ ok: true, texto: "Percentuais salvos. O DRE já usa os novos valores." });
    } catch {
      setAviso({ ok: false, texto: "Sem conexão. Tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <AjudaModulo
        icone="⚙️"
        titulo="Configurações do financeiro"
        oQueE="Aqui você informa quanto cada app (iFood, 99Food…) cobra da loja em comissão e taxas, para o DRE descontar do resultado."
        paraQueServe="Sem esse percentual, o DRE não sabe quanto o app fica de cada venda — e mostra o resultado como incompleto em vez de inventar um número."
        passos={[
          { titulo: "Pegue o extrato do app", texto: "no repasse do iFood ou do 99, some comissão + taxa de pagamento online + outras taxas e divida pelo valor dos itens." },
          { titulo: "Digite o percentual", texto: "por exemplo 26,2 para 23% de comissão + 3,2% de pagamento online." },
          { titulo: "Salve", texto: "o DRE aplica o percentual sobre o valor dos itens de cada pedido daquele app." },
        ]}
      />

      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.5rem" }}>
          <Percent size={20} color="#C92E09" />
          <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, color: "#0F172A" }}>Comissão e taxas dos apps</h4>
        </div>
        <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "0 0 1rem", lineHeight: 1.6 }}>
          Percentual total que cada app desconta do seu repasse (comissão + pagamento online + outras taxas), sobre o valor dos itens.
          Deixe em branco o app que você não usa. Referência: o plano Entrega do iFood fica em torno de {COMISSAO_DE_REFERENCIA}% (23% + 3,2%) —
          confira no seu contrato, cada loja negocia o seu.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {CANAIS_COM_COMISSAO.map(({ chave, nome }) => {
            const doPeriodo = vendasNoPeriodo.get(chave);
            return (
              <div key={chave} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <label htmlFor={`comissao-${chave}`} style={{ flex: "1 1 160px", fontWeight: 700, fontSize: "0.88rem", color: "#334155" }}>
                  {nome}
                  {doPeriodo && (
                    <span style={{ display: "block", fontWeight: 500, fontSize: "0.74rem", color: doPeriodo.pct === null ? "#B45309" : "#64748B" }}>
                      {fmtNum(doPeriodo.pedidos)} pedidos no período · itens de {fmtR(doPeriodo.base)}{doPeriodo.pct === null ? " · sem percentual" : ""}
                    </span>
                  )}
                </label>
                <div style={{ position: "relative", width: 130 }}>
                  <input
                    id={`comissao-${chave}`}
                    inputMode="decimal"
                    placeholder="—"
                    value={texto[chave] ?? ""}
                    onChange={(e) => setTexto((t) => ({ ...t, [chave]: e.target.value.replace(/[^\d,.]/g, "") }))}
                    style={{ width: "100%", padding: "9px 30px 9px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box", fontFamily: "inherit" }}
                  />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748B", fontWeight: 700 }}>%</span>
                </div>
              </div>
            );
          })}
        </div>
        {aviso && (
          <div role={aviso.ok ? "status" : "alert"} style={{
            marginTop: 12, padding: "9px 12px", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700,
            background: aviso.ok ? "#F0FDFA" : "#FEF2F2", color: aviso.ok ? "#0F766E" : "#B71C1C", border: `1px solid ${aviso.ok ? "#99F6E4" : "#FECACA"}`,
          }}>
            {aviso.texto}
          </div>
        )}
        <button onClick={salvar} disabled={salvando} style={{
          marginTop: 14, padding: "11px 18px", borderRadius: 10, border: "none", background: salvando ? "#94A3B8" : "#C92E09",
          color: "#fff", fontWeight: 800, cursor: salvando ? "wait" : "pointer", fontFamily: "inherit",
        }}>
          {salvando ? "Salvando…" : "Salvar percentuais"}
        </button>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.5rem" }}>
          <Building2 size={20} color="#0F766E" />
          <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, color: "#0F172A" }}>Conta de repasse</h4>
        </div>
        <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 10px", lineHeight: 1.6 }}>
          O repasse automático <strong>ainda não está ativo</strong>. Hoje o Pix e o cartão pagos pelo site caem direto na sua conta Asaas, e
          o dinheiro dos apps chega pelo repasse de cada app — o FireHub não guarda dinheiro da loja.
        </p>
        <div style={{ fontSize: "0.84rem", color: "#334155", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 12px" }}>
          {repasseConfig?.chavePix
            ? <>Chave Pix guardada: <strong>{repasseConfig.chavePix}</strong>{repasseConfig.titular ? <> · titular {repasseConfig.titular}</> : null}</>
            : "Nenhuma chave Pix guardada."}
        </div>
        <a href="/store/minha-loja" style={{ display: "inline-block", marginTop: 10, fontSize: "0.82rem", fontWeight: 700, color: "#0F766E" }}>
          Alterar a chave em Minha Loja →
        </a>
      </div>
    </div>
  );
}
