"use client";
import { useState } from "react";
import { Gift, ToggleLeft, ToggleRight, Info, TrendingUp } from "lucide-react";

type LoyaltyConfig = {
  active: boolean;
  type: "cashback";
  rate: number;
  minOrderValue: number;
  maxRedeemPercent: number;
  expiresInDays: number;
};

const DEFAULT: LoyaltyConfig = {
  active: false, type: "cashback",
  rate: 2, minOrderValue: 20,
  maxRedeemPercent: 50, expiresInDays: 0,
};

export default function LoyaltyConfigForm({
  initialConfig, onSave,
}: {
  initialConfig?: Partial<LoyaltyConfig>;
  onSave: (config: LoyaltyConfig) => Promise<void>;
}) {
  const [config, setConfig] = useState<LoyaltyConfig>({ ...DEFAULT, ...initialConfig });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (key: keyof LoyaltyConfig, val: any) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    await onSave(config);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const exampleOrder = 80;
  const exampleCashback = config.active && exampleOrder >= config.minOrderValue
    ? (exampleOrder * config.rate) / 100 : 0;

  return (
    <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #E2E8F0", overflow: "hidden" }}>
      <div style={{
        padding: "1rem 1.25rem",
        background: config.active ? "linear-gradient(135deg,#7C3AED,#6D28D9)" : "linear-gradient(135deg,#0F172A,#1E293B)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Gift size={20} color="#fff" />
          <div>
            <p style={{ color: "#fff", fontWeight: 800, fontSize: "0.95rem", margin: 0 }}>Programa de Fidelidade</p>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.72rem", margin: 0 }}>Cashback automático para seus clientes</p>
          </div>
        </div>
        <button onClick={() => update("active", !config.active)}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
          {config.active ? <ToggleRight size={36} color="#A78BFA" /> : <ToggleLeft size={36} color="rgba(255,255,255,0.4)" />}
          <span style={{ color: config.active ? "#A78BFA" : "rgba(255,255,255,0.5)", fontSize: "0.78rem", fontWeight: 700 }}>
            {config.active ? "ATIVO" : "INATIVO"}
          </span>
        </button>
      </div>

      <div style={{ padding: "1.25rem" }}>
        <div style={{
          background: config.active ? "#F5F3FF" : "#F8FAFC",
          border: `1px solid ${config.active ? "#DDD6FE" : "#E2E8F0"}`,
          borderRadius: "12px", padding: "1rem", marginBottom: "1.25rem",
          display: "flex", alignItems: "center", gap: "12px",
        }}>
          <div style={{ width: 44, height: 44, borderRadius: "12px", background: config.active ? "#7C3AED" : "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <TrendingUp size={20} color="#fff" />
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: "0.85rem", color: config.active ? "#5B21B6" : "#94A3B8", margin: 0 }}>
              {config.active ? `Pedido de R$${exampleOrder} → cliente ganha R$${exampleCashback.toFixed(2)} de cashback` : "Ative para ver a simulação"}
            </p>
            <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "2px 0 0" }}>
              {config.active ? `${config.rate}% de volta · Pode usar até ${config.maxRedeemPercent}% do próximo pedido` : "Configure as regras abaixo"}
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          {[
            { key: "rate", label: "💸 Cashback (%)", help: "% do pedido devolvida como crédito", min: 0.5, max: 20, step: 0.5, suffix: "%" },
            { key: "minOrderValue", label: "🛒 Pedido mínimo (R$)", help: "Valor mínimo para acumular", min: 0, max: 500, step: 5, suffix: "" },
            { key: "maxRedeemPercent", label: "🎯 Limite de resgate (%)", help: "% máximo do pedido pago com cashback", min: 10, max: 100, step: 5, suffix: "%" },
            { key: "expiresInDays", label: "⏱️ Expiração (dias)", help: "0 = nunca expira", min: 0, max: 365, step: 30, suffix: "" },
          ].map(({ key, label, help, min, max, step, suffix }) => (
            <div key={key}>
              <label style={{ display: "block", fontWeight: 700, fontSize: "0.83rem", color: "#1E293B", marginBottom: "2px" }}>{label}</label>
              <p style={{ fontSize: "0.7rem", color: "#94A3B8", margin: "0 0 5px" }}>{help}</p>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input type="number" min={min} max={max} step={step}
                  value={(config as any)[key]}
                  onChange={e => update(key as keyof LoyaltyConfig, parseFloat(e.target.value) || 0)}
                  style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", fontFamily: "inherit", outline: "none" }}
                />
                {suffix && <span style={{ fontWeight: 700, color: "#7C3AED" }}>{suffix}</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "10px", padding: "0.75rem 1rem", display: "flex", gap: "8px", alignItems: "flex-start", margin: "1rem 0" }}>
          <Info size={16} color="#3B82F6" style={{ flexShrink: 0, marginTop: "2px" }} />
          <p style={{ fontSize: "0.75rem", color: "#1D4ED8", margin: 0, lineHeight: 1.5 }}>
            O cashback é acumulado automaticamente após cada pedido entregue. O cliente vê o saldo no checkout e decide se quer usar.
          </p>
        </div>

        <button onClick={handleSave} disabled={saving} style={{
          width: "100%", padding: "12px",
          background: saved ? "#16A34A" : "linear-gradient(135deg,#7C3AED,#6D28D9)",
          color: "#fff", border: "none", borderRadius: "10px",
          fontSize: "0.9rem", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
          fontFamily: "inherit", opacity: saving ? 0.7 : 1, transition: "all 0.3s",
        }}>
          {saved ? "✅ Salvo!" : saving ? "Salvando..." : "💾 Salvar configuração"}
        </button>
      </div>
    </div>
  );
}
