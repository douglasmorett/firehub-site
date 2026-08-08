"use client";

import { useState } from "react";
import { 
  Flame, Zap, Building2, ShieldCheck, CheckCircle2, 
  ExternalLink, Bot, MessageSquare, Smartphone, Camera, 
  MapPin, Check, ArrowRight, Award, Lock, Monitor
} from "lucide-react";

export default function FireCheckClient({ user }: { user: { id: string; storeName?: string | null; email: string } }) {
  const [billingCycle, setBillingCycle] = useState<"anual" | "mensal">("anual");
  const [activeTab, setActiveTab] = useState<"presentation" | "app">("presentation");
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const PLANS = [
    {
      id: "checklists",
      name: "Só Checklists",
      icon: <Flame size={28} color="#FF4500" />,
      price: billingCycle === "anual" ? "R$ 97" : "R$ 149",
      cycle: "/mês",
      note: billingCycle === "anual" ? "Faturado R$ 1.164/ano (Economiza R$ 624)" : "Cobrado mensalmente",
      color: "#FF4500",
      highlight: false,
      features: [
        "Checklists ILIMITADOS",
        "Até 30 colaboradores cadastrados",
        "Auditoria visual por IA",
        "Alertas de irregularidade no WhatsApp",
        "Bloqueio de fotos falsas da galeria",
        "Relatórios exportáveis em PDF e Excel"
      ],
      caktoLink: billingCycle === "anual" ? "https://pay.cakto.com.br/e7c88df" : "https://pay.cakto.com.br/3eph5ko_856837",
    },
    {
      id: "combo",
      name: "Combo Tudo em 1",
      icon: <Zap size={28} color="#FF4D00" />,
      price: billingCycle === "anual" ? "R$ 167" : "R$ 197",
      cycle: "/mês",
      note: billingCycle === "anual" ? "12x R$ 167 (Economiza R$ 360/ano)" : "Economize R$ 101/mês vs 2 separados",
      color: "#FF4D00",
      highlight: true,
      badge: "🔥 MAIS VENDIDO • MELHOR CUSTO",
      features: [
        "🎁 BÔNUS: Até 50 colaboradores (+20 grátis!)",
        "TUDO do Módulo Checklist Ilimitado",
        "TUDO do Módulo Controle de Ponto IA",
        "Reconhecimento facial + Trava de GPS",
        "Alertas de atraso/saída no WhatsApp",
        "Assistente Bill IA 24h no WhatsApp",
        "Suporte VIP com gerente de conta"
      ],
      caktoLink: billingCycle === "anual" ? "https://pay.cakto.com.br/36m7kzq" : "https://pay.cakto.com.br/pavdwiz_869704",
    },
    {
      id: "ponto",
      name: "Só Ponto IA",
      icon: <Building2 size={28} color="#3B82F6" />,
      price: billingCycle === "anual" ? "R$ 97" : "R$ 149",
      cycle: "/mês",
      note: billingCycle === "anual" ? "Faturado R$ 1.164/ano (Economiza R$ 624)" : "Cobrado mensalmente",
      color: "#3B82F6",
      highlight: false,
      features: [
        "Reconhecimento Facial com IA",
        "Até 30 colaboradores cadastrados",
        "Trava de Geolocalização (GPS)",
        "Alerta de atraso automático no WhatsApp",
        "Relatório diário de espelho de ponto",
        "Folha de ponto pronta pro contador"
      ],
      caktoLink: billingCycle === "anual" ? "https://pay.cakto.com.br/o2xichf" : "https://pay.cakto.com.br/kfx3fri_869702",
    },
  ];

  const handleChoosePlan = (caktoLink: string) => {
    const checkoutUrl = `${caktoLink}?email=${encodeURIComponent(user.email)}`;
    window.open(checkoutUrl, "_blank");
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 3rem" }}>
      
      {/* SELETOR DE ABA: APRESENTAÇÃO VS APP INTEGRADO */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFF7ED", border: "1px solid #FFEDD5", color: "#EA580C", fontSize: "0.75rem", fontWeight: 800, padding: "4px 12px", borderRadius: 20, marginBottom: 6 }}>
            <Flame size={14} /> MÓDULO PARCEIRO INTEGRADO
          </div>
          <h1 style={{ fontWeight: 900, fontSize: "1.5rem", color: "#0F172A", margin: 0 }}>
            FireCheck — Checklist & Ponto Inteligente
          </h1>
        </div>

        <div style={{ display: "flex", background: "#F1F5F9", padding: "4px", borderRadius: "12px", gap: "4px" }}>
          <button
            onClick={() => setActiveTab("presentation")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "presentation" ? "#FFF" : "transparent",
              color: activeTab === "presentation" ? "#0F172A" : "#64748B",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
              boxShadow: activeTab === "presentation" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <ShieldCheck size={16} color={activeTab === "presentation" ? "#FF4D00" : "#64748B"} /> Conhecer & Assinar
          </button>
          <button
            onClick={() => setActiveTab("app")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "app" ? "#FFF" : "transparent",
              color: activeTab === "app" ? "#0F172A" : "#64748B",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
              boxShadow: activeTab === "app" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <Monitor size={16} color={activeTab === "app" ? "#3B82F6" : "#64748B"} /> Abrir FireCheck Direct
          </button>
        </div>
      </div>

      {activeTab === "presentation" ? (
        <>
          {/* HERO BANNER */}
          <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: "24px", padding: "2.5rem", color: "#FFF", marginBottom: "2.5rem", position: "relative", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ position: "absolute", top: -50, right: -50, width: 300, height: 300, background: "radial-gradient(circle, rgba(255,77,0,0.2) 0%, rgba(0,0,0,0) 70%)", borderRadius: "50%", pointerEvents: "none" }} />
            <div style={{ maxWidth: 680, position: "relative", zIndex: 2 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,77,0,0.2)", border: "1px solid rgba(255,77,0,0.4)", color: "#FF7A38", fontSize: "0.8rem", fontWeight: 800, padding: "5px 14px", borderRadius: 20, marginBottom: 14 }}>
                ✅ PADRONIZAÇÃO & GESTÃO OPERACIONAL
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 900, lineHeight: 1.2, margin: "0 0 12px", letterSpacing: "-0.5px" }}>
                Sua operação no padrão perfeito, <span style={{ color: "#FF4D00" }}>sempre</span>.
              </h2>
              <p style={{ fontSize: "0.98rem", color: "#94A3B8", lineHeight: 1.6, margin: "0 0 20px" }}>
                O <strong>FireCheck</strong> é a nossa solução parceira definitiva de checklists auditados com foto obrigatória em tempo real, controle de ponto por reconhecimento facial por IA e assistente inteligente no WhatsApp.
              </p>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <a
                  href="#planos-firecheck"
                  style={{ background: "#FF4D00", color: "#FFF", padding: "12px 24px", borderRadius: "12px", fontWeight: 800, fontSize: "0.9rem", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 10px 20px rgba(255,77,0,0.3)" }}
                >
                  Ver Pacotes & Assinar no Cakto <ArrowRight size={16} />
                </a>
                <button
                  onClick={() => setActiveTab("app")}
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "#FFF", padding: "12px 20px", borderRadius: "12px", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  Já tenho conta (Entrar) <ExternalLink size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* AS 4 PILARES DO FIRECHECK */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem", marginBottom: "3rem" }}>
            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FFF7ED", color: "#EA580C", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Camera size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Checklists com Foto Real</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Fotos obrigatoriamente tiradas na hora da auditoria. Sistema impede envio de imagens da galeria ou repetidas.
              </p>
            </div>

            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#EFF6FF", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Smartphone size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Ponto com Facial & GPS</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Registros de entrada e saída validados por inteligência artificial e limitação de raio de geolocalização.
              </p>
            </div>

            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#F0FDF4", color: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <MessageSquare size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Bill IA no WhatsApp</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Crie listas, consulte pendências e receba alertas imediatos de falta ou atraso diretamente no WhatsApp.
              </p>
            </div>

            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FAF5FF", color: "#9333EA", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Award size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Scoreboard & Métricas</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Compare a qualidade operacional e cumprimento de processos de cada turno, filial e funcionário.
              </p>
            </div>
          </div>

          {/* SEÇÃO DE PLANOS & ASSINATURA */}
          <div id="planos-firecheck" style={{ scrollMarginTop: 40, textAlign: "center", marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.75rem", fontWeight: 900, color: "#0F172A", margin: "0 0 8px" }}>
              Escolha o Plano Ideal para a sua Operação
            </h2>
            <p style={{ fontSize: "0.9rem", color: "#64748B", margin: "0 0 20px" }}>
              Contrate pelo gateway oficial Cakto/Cactus com ativação instantânea para sua equipe.
            </p>

            {/* SELETOR ANUAL / MENSAL */}
            <div style={{ display: "inline-flex", background: "#F1F5F9", padding: "4px", borderRadius: "12px", gap: "4px", marginBottom: "2rem" }}>
              <button
                onClick={() => setBillingCycle("anual")}
                style={{
                  padding: "8px 20px",
                  borderRadius: "8px",
                  border: "none",
                  background: billingCycle === "anual" ? "#FF4D00" : "transparent",
                  color: billingCycle === "anual" ? "#FFF" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6
                }}
              >
                ⚡ Plano Anual (Economize até R$ 624)
              </button>
              <button
                onClick={() => setBillingCycle("mensal")}
                style={{
                  padding: "8px 20px",
                  borderRadius: "8px",
                  border: "none",
                  background: billingCycle === "mensal" ? "#FFF" : "transparent",
                  color: billingCycle === "mensal" ? "#0F172A" : "#64748B",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: "pointer"
                }}
              >
                Mensal Sem Fidelidade
              </button>
            </div>
          </div>

          {/* CARDS DOS PLANOS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem", alignItems: "stretch" }}>
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                style={{
                  background: "#FFF",
                  borderRadius: "20px",
                  border: plan.highlight ? "2px solid #FF4D00" : "1px solid #E2E8F0",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: plan.highlight ? "0 20px 40px rgba(255,77,0,0.12)" : "0 4px 6px rgba(0,0,0,0.02)",
                  position: "relative"
                }}
              >
                {plan.badge && (
                  <div style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#FF4D00,#EA580C)", color: "#FFF", fontSize: "0.7rem", fontWeight: 900, padding: "4px 14px", borderRadius: 20, letterSpacing: 0.5, whiteSpace: "nowrap" }}>
                    {plan.badge}
                  </div>
                )}

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    {plan.icon}
                    <h3 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#0F172A", margin: 0 }}>{plan.name}</h3>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: "2.2rem", fontWeight: 900, color: "#0F172A" }}>{plan.price}</span>
                    <span style={{ fontSize: "0.85rem", color: "#64748B", fontWeight: 600 }}>{plan.cycle}</span>
                    <div style={{ fontSize: "0.76rem", color: "#16A34A", fontWeight: 700, marginTop: 2 }}>{plan.note}</div>
                  </div>

                  <hr style={{ border: "none", borderTop: "1px solid #F1F5F9", margin: "16px 0" }} />

                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    {plan.features.map((feat, idx) => (
                      <li key={idx} style={{ fontSize: "0.85rem", color: "#334155", display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.4 }}>
                        <Check size={16} color="#10B981" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => handleChoosePlan(plan.caktoLink)}
                  style={{
                    width: "100%",
                    padding: "14px",
                    borderRadius: "12px",
                    border: "none",
                    background: plan.highlight ? "#FF4D00" : "#0F172A",
                    color: "#FFF",
                    fontWeight: 800,
                    fontSize: "0.92rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: plan.highlight ? "0 8px 16px rgba(255,77,0,0.25)" : "none",
                    transition: "transform 0.15s ease"
                  }}
                >
                  Assinar Agora pelo Cakto <ExternalLink size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* ABA APP INTEGRADO / IFRAME DO FIRECHECK */
        <div style={{ background: "#FFF", borderRadius: "20px", border: "1px solid #E2E8F0", padding: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600 }}>
              🌐 Conectado ao <strong>FireCheck Web</strong> ({user.email})
            </div>
            <a
              href="https://firecheck-eight.vercel.app/login"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#3B82F6", fontWeight: 700, fontSize: "0.82rem", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              Abrir em Nova Aba <ExternalLink size={14} />
            </a>
          </div>

          <div style={{ position: "relative", width: "100%", height: "720px", borderRadius: "12px", overflow: "hidden", border: "1px solid #CBD5E1", background: "#0F172A" }}>
            {!iframeLoaded && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#FFF", gap: "12px" }}>
                <Flame size={40} className="animate-bounce" color="#FF4D00" />
                <div style={{ fontSize: "0.95rem", fontWeight: 700 }}>Carregando plataforma FireCheck...</div>
              </div>
            )}
            <iframe
              src="https://firecheck-eight.vercel.app/login"
              style={{ width: "100%", height: "100%", border: "none" }}
              onLoad={() => setIframeLoaded(true)}
              title="FireCheck App"
            />
          </div>
        </div>
      )}
    </div>
  );
}
