"use client";

import { useState, useEffect } from "react";
import { Check, Loader2, Info, BellRing } from "lucide-react";
import { BALCAO_CONFIG_PADRAO, type BalcaoConfig } from "@/lib/balcao-config";

/**
 * Minha Loja › Balcão & Pager.
 *
 * Duas chaves, e nada além disso: o pager é obrigatório no balcão? e na mesa?
 * A tela precisa responder sozinha o que acontece ao ligar cada uma — o
 * lojista não tem manual, e "obrigatório" sem dizer ONDE trava deixaria ele
 * descobrir na hora da fila.
 *
 * Grava a cada clique, sem botão Salvar: são dois interruptores, e um botão
 * Salvar só cria a chance de marcar a caixinha, sair da tela e o papel
 * continuar do mesmo jeito.
 */

type Chave = keyof BalcaoConfig;

const CHAVES: { chave: Chave; titulo: string; ligado: string; desligado: string; ajuda: string }[] = [
  {
    chave: "pagerObrigatorioBalcao",
    titulo: "Exigir pager no Balcão",
    ligado: "SIM — balcão não fecha sem pager",
    desligado: "NÃO — pager é opcional no balcão",
    ajuda: "Ligue se toda venda de balcão entrega um aparelhinho ao cliente. Com isto ligado, o pedido da aba Balcão não é registrado sem o número — nem pelo atendente com pressa.",
  },
  {
    chave: "pagerObrigatorioMesa",
    titulo: "Exigir pager na Mesa",
    ligado: "SIM — mesa não fecha sem pager",
    desligado: "NÃO — pager é opcional na mesa",
    ajuda: "Mesmo comportamento para o pedido lançado na aba Mesa da venda presencial.",
  },
];

export default function BalcaoConfigManager() {
  const [config, setConfig] = useState<BalcaoConfig>({ ...BALCAO_CONFIG_PADRAO });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<Chave | null>(null);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    fetch("/api/store-settings/balcao")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setConfig({ pagerObrigatorioBalcao: d.pagerObrigatorioBalcao === true, pagerObrigatorioMesa: d.pagerObrigatorioMesa === true }); })
      .catch(() => { /* fica no padrão: nada obrigatório */ })
      .finally(() => setCarregando(false));
  }, []);

  const alternar = async (chave: Chave) => {
    const novo: BalcaoConfig = { ...config, [chave]: !config[chave] };
    // A tela vira ANTES da resposta e volta atrás se o servidor recusar: são
    // dois interruptores, e esperar a rede em cada clique faz a chave parecer
    // travada.
    const anterior = config;
    setConfig(novo);
    setSalvando(chave);
    setErro("");
    setSalvo(false);
    try {
      const res = await fetch("/api/store-settings/balcao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novo),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        setConfig(anterior);
        setErro(e?.error || "Não consegui salvar. Tente de novo.");
      } else {
        setSalvo(true);
        setTimeout(() => setSalvo(false), 2500);
      }
    } catch {
      setConfig(anterior);
      setErro("Sem conexão com o servidor. A marcação não foi salva.");
    } finally {
      setSalvando(null);
    }
  };

  if (carregando) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2rem", color: "#64748B", fontSize: "0.9rem" }}>
        <Loader2 className="animate-spin" size={18} /> Carregando…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "#FFF7E6", borderRadius: 16, padding: "1rem 1.25rem", border: "1px solid #FDE68A", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <BellRing size={20} color="#B45309" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: "0.85rem", color: "#92400E", lineHeight: 1.55 }}>
          <b>O pager é o aparelhinho numerado</b> que a loja entrega a quem espera o pedido. O número digitado na venda aparece no card do painel e sai na comanda impressa, para o atendente saber quem chamar quando o pedido fica pronto.
        </div>
      </div>

      {CHAVES.map(({ chave, titulo, ligado, desligado, ajuda }) => {
        const marcado = config[chave];
        return (
          <div key={chave} style={{ background: "#FFFFFF", borderRadius: 18, padding: "1.25rem 1.5rem", border: `1px solid ${marcado ? "#FDE68A" : "#E2E8F0"}`, boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>{titulo}</h3>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5 }}>{ajuda}</p>
            </div>
            <button
              type="button"
              onClick={() => alternar(chave)}
              disabled={salvando !== null}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 16px", borderRadius: 30, border: "none",
                background: marcado ? "#B45309" : "#64748B", color: "#FFFFFF",
                fontWeight: 800, fontSize: "0.84rem",
                cursor: salvando !== null ? "wait" : "pointer",
                boxShadow: marcado ? "0 4px 12px rgba(180,83,9,0.25)" : "none",
                transition: "all 0.2s ease", whiteSpace: "nowrap",
              }}
            >
              {salvando === chave
                ? <Loader2 className="animate-spin" size={18} />
                : marcado ? <><Check size={18} /> {ligado}</> : <>{desligado}</>}
            </button>
          </div>
        );
      })}

      <div style={{ background: "#F8FAFC", borderRadius: 16, padding: "1rem 1.25rem", border: "1px solid #E2E8F0", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Info size={18} color="#64748B" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.55 }}>
          Desligado, o campo do pager continua existindo na venda presencial e é opcional — que é como está hoje. A regra vale no lançamento do PDV (<b>Venda Presencial</b>), abas Balcão e Mesa. A mesa aberta pelo garçom no app de Mesas não pede pager.
        </div>
      </div>

      {erro && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B71C1C", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.85rem", fontWeight: 700 }}>
          ❌ {erro}
        </div>
      )}
      {salvo && !erro && (
        <div style={{ background: "#F0FDFA", border: "1px solid #99F6E4", color: "#0F766E", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.85rem", fontWeight: 700 }}>
          ✓ Salvo. Vale no próximo pedido lançado.
        </div>
      )}
    </div>
  );
}
