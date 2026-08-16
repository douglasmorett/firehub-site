"use client";
import { useState } from "react";
import {
  Gift, Info, TrendingUp, Award, Users, Cake, Crown, Check, Sparkles, AlertCircle, HelpCircle
} from "lucide-react";

export type LoyaltyConfig = {
  active: boolean;
  // Program 1: Cashback
  cashbackActive: boolean;
  rate: number;
  minOrderValue: number;
  maxRedeemPercent: number;
  expiresInDays: number;
  // Program 2: Carimbos (Cartão Fidelidade)
  stampsActive: boolean;
  stampGoal: number; // Ex: 10 carimbos
  stampMinOrder: number; // Ex: R$ 30
  stampRewardType: "discount" | "product"; // "discount" | "product"
  stampRewardValue: number; // Ex: R$ 25 off
  // Program 3: Indique e Ganhe
  referralActive: boolean;
  friendDiscount: number; // Ex: R$ 10 off para o amigo
  referrerReward: number; // Ex: R$ 10 de volta para quem indicou
  referralMinOrder: number; // Ex: R$ 35
  // Program 4: Aniversariantes
  birthdayActive: boolean;
  birthdayRewardType: "coupon" | "double_cashback";
  birthdayDiscount: number; // Ex: R$ 20 off
  birthdayMinOrder: number; // Ex: R$ 40
  // Program 5: Níveis VIP
  vipActive: boolean;
  bronzeCashback: number; // Ex: 1%
  silverMinSpend: number; // Ex: R$ 150/mês
  silverCashback: number; // Ex: 2%
  goldMinSpend: number; // Ex: R$ 350/mês
  goldCashback: number; // Ex: 3%
};

const DEFAULT_LOYALTY: LoyaltyConfig = {
  active: true,
  cashbackActive: true,
  rate: 5,
  minOrderValue: 20,
  maxRedeemPercent: 50,
  expiresInDays: 30,

  stampsActive: false,
  stampGoal: 10,
  stampMinOrder: 30,
  stampRewardType: "discount",
  stampRewardValue: 25,

  referralActive: false,
  friendDiscount: 10,
  referrerReward: 10,
  referralMinOrder: 35,

  birthdayActive: false,
  birthdayRewardType: "coupon",
  birthdayDiscount: 15,
  birthdayMinOrder: 40,

  vipActive: false,
  bronzeCashback: 1,
  silverMinSpend: 150,
  silverCashback: 2,
  goldMinSpend: 350,
  goldCashback: 3,
};

const fmt = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

export default function LoyaltyConfigForm({
  initialConfig,
  onSave,
}: {
  initialConfig?: Partial<LoyaltyConfig>;
  onSave: (config: LoyaltyConfig) => Promise<void>;
}) {
  const [config, setConfig] = useState<LoyaltyConfig>({ ...DEFAULT_LOYALTY, ...initialConfig });
  const [activeTab, setActiveTab] = useState<"cashback" | "stamps" | "referral" | "birthday" | "vip">("cashback");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (key: keyof LoyaltyConfig, val: any) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    await onSave(config);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const exampleOrder = 80;
  const exampleCashback = config.cashbackActive && exampleOrder >= config.minOrderValue
    ? (exampleOrder * config.rate) / 100 : 0;

  return (
    <div style={{ background: "#fff", borderRadius: "20px", border: "1.5px solid #E2E8F0", overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
      {/* Banner Topo Limpo e Informativo (Sem botão redundante) */}
      <div
        style={{
          padding: "1.25rem 1.5rem",
          background: "linear-gradient(135deg, #6D28D9, #4C1D95)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Gift size={24} color="#fff" />
          </div>
          <div>
            <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "1.1rem", margin: 0 }}>
              🎁 Promoções & Fidelidade da Loja
            </h2>
            <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.78rem", margin: "2px 0 0" }}>
              Cada programa pode ser ativado individualmente e já passa a funcionar no seu cardápio.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.12)", padding: "6px 14px", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 700 }}>
          <Sparkles size={14} color="#FDE047" /> Controle por Módulo
        </div>
      </div>

      {/* Navegação por Sub-Programas (Abas) */}
      <div style={{ display: "flex", flexWrap: "wrap", background: "#F8FAFC", borderBottom: "1.5px solid #E2E8F0", padding: "6px 12px", gap: "6px" }}>
        {[
          { key: "cashback", label: "💸 Cashback Automático", badge: config.cashbackActive ? "Ativo" : null },
          { key: "stamps", label: "🎫 Cartão de Carimbos", badge: config.stampsActive ? "Ativo" : null },
          { key: "referral", label: "🎁 Indique e Ganhe", badge: config.referralActive ? "Ativo" : null },
          { key: "birthday", label: "🎂 Aniversariantes & Chatbot", badge: config.birthdayActive ? "Ativo" : null },
          { key: "vip", label: "👑 Níveis VIP", badge: config.vipActive ? "Ativo" : null },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              border: "none",
              background: activeTab === tab.key ? "#EDE9FE" : "transparent",
              fontSize: "0.85rem",
              fontWeight: activeTab === tab.key ? 800 : 600,
              color: activeTab === tab.key ? "#6D28D9" : "#64748B",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            {tab.label}
            {tab.badge && (
              <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 10, background: "#DCFCE7", color: "#15803D", fontWeight: 800 }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* CONTEÚDO DAS ABAS */}
      <div style={{ padding: "1.5rem" }}>
        {/* TAB 1: CASHBACK AUTOMÁTICO */}
        {activeTab === "cashback" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  💸 Cashback Automático
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Devolva uma porcentagem das compras do cliente como crédito em saldo para os próximos pedidos.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("cashbackActive", !config.cashbackActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.cashbackActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.cashbackActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                {config.cashbackActive ? "🟢 Cashback Habilitado" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Simulation Card */}
            <div
              style={{
                background: config.cashbackActive ? "#F5F3FF" : "#F8FAFC",
                border: `1.5px solid ${config.cashbackActive ? "#DDD6FE" : "#CBD5E1"}`,
                borderRadius: 14,
                padding: "14px 16px",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: config.cashbackActive ? "#7C3AED" : "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <TrendingUp size={22} color="#fff" />
              </div>
              <div>
                <strong style={{ fontSize: "0.9rem", color: config.cashbackActive ? "#5B21B6" : "#475569", display: "block" }}>
                  Simulador de Exemplo: Pedido de R$ {exampleOrder},00
                </strong>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>
                  {config.cashbackActive
                    ? `O cliente ganha ${fmt(exampleCashback)} de volta (${config.rate}% do pedido) para gastar em compras futuras.`
                    : "Ative o Cashback Automático para ver o cálculo."}
                </span>
              </div>
            </div>

            {/* Inputs Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Porcentagem de Cashback (%)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="0"
                    value={config.rate === 0 ? "" : config.rate}
                    onChange={e => update("rate", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                  />
                  <span style={{ fontWeight: 800, color: "#7C3AED" }}>%</span>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo para Acumular (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.minOrderValue === 0 ? "" : config.minOrderValue}
                  onChange={e => update("minOrderValue", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Limite de Resgate por Pedido (%)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    step="5"
                    placeholder="50"
                    value={config.maxRedeemPercent === 0 ? "" : config.maxRedeemPercent}
                    onChange={e => update("maxRedeemPercent", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                  />
                  <span style={{ fontWeight: 800, color: "#7C3AED" }}>%</span>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Expiração dos Créditos (dias)
                </label>
                <input
                  type="number"
                  placeholder="0 (nunca expira)"
                  value={config.expiresInDays === 0 ? "" : config.expiresInDays}
                  onChange={e => update("expiresInDays", e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CARTÃO FIDELIDADE (CARIMBOS) */}
        {activeTab === "stamps" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  🎫 Cartão Fidelidade por Carimbos (Digital)
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Substitua os cartões de papel por selos digitais marcados a cada pedido finalizado.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("stampsActive", !config.stampsActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.stampsActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.stampsActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.stampsActive ? "🟢 Carimbos Habilitados" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Cartela de Carimbos Visual */}
            <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "16px", marginBottom: 20 }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                Simulador da Cartela Digital do Cliente ({config.stampGoal} Carimbos):
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                {Array.from({ length: config.stampGoal || 10 }).map((_, idx) => (
                  <div
                    key={idx}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: idx < 4 ? "#7C3AED" : "#fff",
                      border: `2px ${idx < 4 ? "solid #7C3AED" : "dashed #CBD5E1"}`,
                      color: idx < 4 ? "#fff" : "#94A3B8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: "0.85rem",
                    }}
                  >
                    {idx < 4 ? <Award size={20} /> : idx + 1}
                  </div>
                ))}
                <div style={{ marginLeft: "auto", background: "#FEF3C7", border: "1.5px solid #FCD34D", padding: "8px 14px", borderRadius: 10, fontSize: "0.82rem", fontWeight: 800, color: "#92400E" }}>
                  🎁 Prêmio Final: {fmt(config.stampRewardValue)} OFF
                </div>
              </div>
            </div>

            {/* Inputs Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Meta de Carimbos para Completar
                </label>
                <select
                  value={config.stampGoal}
                  onChange={e => update("stampGoal", parseInt(e.target.value) || 10)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                >
                  <option value={5}>5 Carimbos</option>
                  <option value={8}>8 Carimbos</option>
                  <option value={10}>10 Carimbos</option>
                  <option value={12}>12 Carimbos</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo por Carimbo (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.stampMinOrder === 0 ? "" : config.stampMinOrder}
                  onChange={e => update("stampMinOrder", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Valor do Prêmio ao Completar (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.stampRewardValue === 0 ? "" : config.stampRewardValue}
                  onChange={e => update("stampRewardValue", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: INDIQUE E GANHE */}
        {activeTab === "referral" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  🎁 Indique e Ganhe (Recompensa por Indicação)
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Transforme seus clientes em divulgadores ativando cupons para quem indica e quem é indicado.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("referralActive", !config.referralActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.referralActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.referralActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.referralActive ? "🟢 Indicação Habilitada" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Flow Banner */}
            <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 14, padding: "14px 16px", marginBottom: 20, fontSize: "0.82rem", color: "#1E40AF" }}>
              <strong>Como Funciona o Fluxo de Indicação:</strong>
              <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
                <li>O cliente copia o link único no cardápio digital (ex: <code>loja.com.br?ref=CARLOS10</code>).</li>
                <li>O amigo indicado ganha <strong>{fmt(config.friendDiscount)} de desconto</strong> no 1º pedido.</li>
                <li>Assim que o amigo compra, o indicador recebe <strong>{fmt(config.referrerReward)} de recompensa</strong>!</li>
              </ol>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Desconto para o Amigo Indicado (R$)
                </label>
                <input
                  type="number"
                  step="2"
                  placeholder="0"
                  value={config.friendDiscount === 0 ? "" : config.friendDiscount}
                  onChange={e => update("friendDiscount", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Recompensa para quem Indicou (R$)
                </label>
                <input
                  type="number"
                  step="2"
                  placeholder="0"
                  value={config.referrerReward === 0 ? "" : config.referrerReward}
                  onChange={e => update("referrerReward", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo do Amigo (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.referralMinOrder === 0 ? "" : config.referralMinOrder}
                  onChange={e => update("referralMinOrder", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: ANIVERSARIANTES */}
        {activeTab === "birthday" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  🎂 Presente de Aniversário
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Fidelize clientes concedendo mimos e cupons no mês de aniversário.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("birthdayActive", !config.birthdayActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.birthdayActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.birthdayActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.birthdayActive ? "🟢 Presente Habilitado" : "⚪ Desabilitado"}
              </button>
            </div>

            <div style={{ background: "#FDF2F8", border: "1.5px solid #FBCFE8", borderRadius: 14, padding: "14px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "#DB2777", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Cake size={24} color="#fff" />
              </div>
              <div>
                <strong style={{ fontSize: "0.9rem", color: "#831843", display: "block" }}>
                  Disparo Automático via Chatbot & WhatsApp
                </strong>
                <span style={{ fontSize: "0.78rem", color: "#9D174D" }}>
                  No dia do aniversário do cliente cadastrado, o Chatbot IA envia automaticamente os parabéns com um cupom especial de presente!
                </span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Tipo de Recompensa
                </label>
                <select
                  value={config.birthdayRewardType}
                  onChange={e => update("birthdayRewardType", e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                >
                  <option value="coupon">Cupom de Desconto em R$</option>
                  <option value="double_cashback">Cashback em Dobro no Mês</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Valor do Cupom de Presente (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.birthdayDiscount === 0 ? "" : config.birthdayDiscount}
                  onChange={e => update("birthdayDiscount", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo para Usar (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.birthdayMinOrder === 0 ? "" : config.birthdayMinOrder}
                  onChange={e => update("birthdayMinOrder", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: NÍVEIS VIP (CLUBE DE MEMBROS) */}
        {activeTab === "vip" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  👑 Níveis de Clientes VIP (Clube de Membros por Gasto Mensal)
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Recompense clientes fiéis com medalhas e vantagens baseadas no quanto eles gastam no mês com você.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("vipActive", !config.vipActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.vipActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.vipActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.vipActive ? "🟢 Níveis VIP Habilitados" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Box Didático Explicativo de Como Funciona o Nível VIP */}
            <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: "14px", padding: "16px", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <HelpCircle size={20} color="#7C3AED" />
                <strong style={{ color: "#0F172A", fontSize: "0.92rem" }}>
                  Como funciona a medalha e o cálculo dos Níveis VIP?
                </strong>
              </div>
              <p style={{ fontSize: "0.82rem", color: "#475569", lineHeight: 1.5, margin: "0 0 10px 0" }}>
                O sistema calcula <strong>automaticamente todo dia a soma dos gastos que cada cliente realizou nos últimos 30 dias (último mês)</strong> com a sua loja:
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", fontSize: "0.78rem" }}>
                <div style={{ background: "#FFF7ED", border: "1px solid #FFEDD5", borderRadius: "10px", padding: "10px" }}>
                  <strong style={{ color: "#C2410C", display: "block", marginBottom: "3px" }}>🥉 Nível Bronze (Iniciante)</strong>
                  <span>Cliente que gastou até <strong>{fmt(config.silverMinSpend)}</strong> no mês. Recebe o cashback padrão da categoria.</span>
                </div>
                <div style={{ background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: "10px", padding: "10px" }}>
                  <strong style={{ color: "#475569", display: "block", marginBottom: "3px" }}>🥈 Nível Prata (Frequente)</strong>
                  <span>Cliente que somou entre <strong>{fmt(config.silverMinSpend)}</strong> e <strong>{fmt(config.goldMinSpend)}</strong> no mês. Ganha mais cashback!</span>
                </div>
                <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: "10px", padding: "10px" }}>
                  <strong style={{ color: "#92400E", display: "block", marginBottom: "3px" }}>🥇 Nível Ouro / VIP (Top Clientes)</strong>
                  <span>Cliente que superou <strong>{fmt(config.goldMinSpend)}</strong> no mês. Ganha a medalha de Ouro e o maior benefício!</span>
                </div>
              </div>
              <p style={{ fontSize: "0.74rem", color: "#64748B", margin: "10px 0 0 0" }}>
                💡 <em>Vantagem para a sua loja: Estimula o cliente a comprar toda semana para manter a medalha e não perder o cashback VIP!</em>
              </p>
            </div>

            {/* VIP Tiers Config Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {/* Bronze */}
              <div style={{ background: "#FFF7ED", border: "1.5px solid #FFEDD5", borderRadius: 12, padding: "14px" }}>
                <strong style={{ color: "#C2410C", fontSize: "0.9rem", display: "block" }}>🥉 Nível Bronze</strong>
                <span style={{ fontSize: "0.75rem", color: "#64748B", display: "block", marginBottom: 10 }}>
                  Gasto acumulado no mês até {fmt(config.silverMinSpend)}
                </span>
                <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Cashback Bronze (%)</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="0"
                  value={config.bronzeCashback === 0 ? "" : config.bronzeCashback}
                  onChange={e => update("bronzeCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}
                />
              </div>

              {/* Prata */}
              <div style={{ background: "#F1F5F9", border: "1.5px solid #CBD5E1", borderRadius: 12, padding: "14px" }}>
                <strong style={{ color: "#475569", fontSize: "0.9rem", display: "block" }}>🥈 Nível Prata</strong>
                <span style={{ fontSize: "0.75rem", color: "#64748B", display: "block", marginBottom: 6 }}>
                  De {fmt(config.silverMinSpend)} até {fmt(config.goldMinSpend)}/mês
                </span>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Gasto Mínimo Prata (R$)</label>
                  <input
                    type="number"
                    step="10"
                    placeholder="0"
                    value={config.silverMinSpend === 0 ? "" : config.silverMinSpend}
                    onChange={e => update("silverMinSpend", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 700, marginTop: 2 }}
                  />
                </div>
                <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Cashback Prata (%)</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="0"
                  value={config.silverCashback === 0 ? "" : config.silverCashback}
                  onChange={e => update("silverCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}
                />
              </div>

              {/* Ouro */}
              <div style={{ background: "#FEF3C7", border: "1.5px solid #FCD34D", borderRadius: 12, padding: "14px" }}>
                <strong style={{ color: "#92400E", fontSize: "0.9rem", display: "block" }}>🥇 Nível Ouro / VIP</strong>
                <span style={{ fontSize: "0.75rem", color: "#78350F", display: "block", marginBottom: 6 }}>
                  Gasto mensal acima de {fmt(config.goldMinSpend)}
                </span>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#78350F" }}>Gasto Mínimo VIP (R$)</label>
                  <input
                    type="number"
                    step="10"
                    placeholder="0"
                    value={config.goldMinSpend === 0 ? "" : config.goldMinSpend}
                    onChange={e => update("goldMinSpend", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 700, marginTop: 2 }}
                  />
                </div>
                <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#78350F" }}>Cashback VIP (%)</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="0"
                  value={config.goldCashback === 0 ? "" : config.goldCashback}
                  onChange={e => update("goldCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Action Button Footer */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            marginTop: 24,
            width: "100%",
            padding: "13px",
            background: saved ? "#16A34A" : "linear-gradient(135deg, #7C3AED, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontSize: "0.92rem",
            fontWeight: 800,
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            transition: "all 0.3s",
            boxShadow: "0 4px 14px rgba(109, 40, 217, 0.25)"
          }}
        >
          {saved ? "✅ Configurações de Fidelidade Salvas!" : saving ? "Salvando..." : "💾 Salvar Programa de Fidelidade"}
        </button>
      </div>
    </div>
  );
}
