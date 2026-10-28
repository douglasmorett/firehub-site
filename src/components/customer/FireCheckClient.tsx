"use client";

import { useState } from "react";
import { 
  Flame, ShieldCheck, CheckCircle2, 
  ExternalLink, Bot, MessageSquare, Smartphone, Camera, 
  MapPin, ArrowRight, Award, Lock, Monitor
} from "lucide-react";
import ConexaoDoFirecheck from "@/components/cmv/ConexaoDoFirecheck";
import ModulosNoBoleto from "@/components/firecheck/ModulosNoBoleto";

export default function FireCheckClient({ user }: { user: { id: string; storeName?: string | null; email: string } }) {
  // A conexão e os módulos se recarregam juntos quando um dos dois muda a ligação.
  const [versao, setVersao] = useState(0);
  const [activeTab, setActiveTab] = useState<"presentation" | "app">("presentation");
  const [iframeLoaded, setIframeLoaded] = useState(false);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 3rem" }}>
      
      {/* SELETOR DE ABA: APRESENTAÇÃO VS APP INTEGRADO */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFF4EF", border: "1px solid #FFF4EF", color: "#E8590C", fontSize: "0.75rem", fontWeight: 800, padding: "4px 12px", borderRadius: 20, marginBottom: 6 }}>
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
            <Monitor size={16} color={activeTab === "app" ? "#1C1917" : "#64748B"} /> Abrir FireCheck Direct
          </button>
        </div>
      </div>

      <ConexaoDoFirecheck key={`c${versao}`} onMudou={() => setVersao((v) => v + 1)} />

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
                <button
                  onClick={() => setActiveTab("app")}
                  style={{ background: "#FF4D00", color: "#FFF", padding: "12px 28px", borderRadius: "12px", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10, border: "none", boxShadow: "0 10px 20px rgba(255,77,0,0.35)", transition: "transform 0.15s ease" }}
                >
                  Acessar FireCheck (Entrar) <ExternalLink size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* AS 4 PILARES DO FIRECHECK */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem", marginBottom: "3rem" }}>
            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FFF4EF", color: "#E8590C", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Camera size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Checklists com Foto Real</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Fotos obrigatoriamente tiradas na hora da auditoria. Sistema impede envio de imagens da galeria ou repetidas.
              </p>
            </div>

            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FAF6F2", color: "#1C1917", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Smartphone size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Ponto com Facial & GPS</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Registros de entrada e saída validados por inteligência artificial e limitação de raio de geolocalização.
              </p>
            </div>

            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#F0FDFA", color: "#0F766E", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <MessageSquare size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Bill IA no WhatsApp</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Crie listas, consulte pendências e receba alertas imediatos de falta ou atraso diretamente no WhatsApp.
              </p>
            </div>

            <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FAF6F2", color: "#44403C", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Award size={22} />
              </div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>Scoreboard & Métricas</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5, margin: 0 }}>
                Compare a qualidade operacional e cumprimento de processos de cada turno, filial e funcionário.
              </p>
            </div>
          </div>

          {/* LIGAR NO BOLETO DO FIREHUB (no lugar do checkout da Cakto) */}
          <ModulosNoBoleto key={`m${versao}`} onConectou={() => setVersao((v) => v + 1)} />
        </>
      ) : (
        /* ABA APP INTEGRADO / IFRAME DO FIRECHECK */
        <div style={{ background: "#FFF", borderRadius: "20px", border: "1px solid #E2E8F0", padding: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600 }}>
              🌐 Conectado ao <strong>FireCheck Web</strong> ({user.email})
            </div>
            <a
              href="https://www.firecheckapp.com.br/login"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#1C1917", fontWeight: 700, fontSize: "0.82rem", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
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
              src="https://www.firecheckapp.com.br/login"
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
