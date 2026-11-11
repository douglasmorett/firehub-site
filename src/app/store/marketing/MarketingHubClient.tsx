"use client";

import { useState, useEffect } from "react";
import {
  Send,
  Users,
  ShieldCheck,
  Zap,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Gift,
  Search,
  MessageSquare,
  Flame,
  RefreshCw,
} from "lucide-react";

import ApresentacaoDisparoOficial, { ChamadaDaRecuperacaoOficial } from "@/components/ApresentacaoDisparoOficial";
import { FRASE_DO_ACEITE, type AceiteDoRiscoQr } from "@/lib/disparo-em-massa";

/** Os marcos da recuperação pelo QR, com as chaves que a rota grava (api/cron/recuperacao-clientes). */
const MARCOS_QR = [
  { dias: 7, ligado: "autoRecuperation7d", msg: "msg7d", cupom: "coupon7d", titulo: "🔥 Cliente 7 dias sem pedir", ajuda: "" },
  { dias: 15, ligado: "autoRecuperation15d", msg: "msg15d", cupom: "coupon15d", titulo: "🎁 Cliente 15 dias sem pedir", ajuda: "" },
  { dias: 30, ligado: "autoRecuperation30d", msg: "msg30d", cupom: "coupon30d", titulo: "✨ Cliente 30 dias sem pedir", ajuda: "" },
  {
    dias: null,
    ligado: "autoRecuperacaoConversa",
    msg: "msgConversa",
    cupom: "couponConversa",
    titulo: "💬 Conversou com o robô e nunca comprou",
    ajuda: "Vai 3 dias depois da última mensagem da pessoa, só para quem não tem nenhum pedido na loja. Dica: use um cupom de primeiro pedido.",
  },
] as const;

type CupomDaLoja = { code: string; type: string; discount: number; active: boolean; validade: string | null; primeiroPedido: boolean };

const descreverCupom = (c: CupomDaLoja) =>
  `${c.code} — ${c.type === "free_shipping" ? "frete grátis" : c.type === "fixed" ? `R$ ${c.discount} de desconto` : `${c.discount}% de desconto`}` +
  (c.validade ? ` · vale até ${c.validade.split("-").reverse().join("/")}` : "") +
  (c.active ? "" : " · DESLIGADO");

export default function MarketingHubClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  const [activeTab, setActiveTab] = useState<"broadcast" | "automation" | "qr" | "database">("broadcast");

  // Envio pelo QR Code (não oficial): só depois do aceite do risco (lib/disparo-em-massa.ts).
  const [aceite, setAceite] = useState<AceiteDoRiscoQr | null>(null);
  const [entendo, setEntendo] = useState(false);
  const [salvandoAceite, setSalvandoAceite] = useState(false);
  const [cupons, setCupons] = useState<CupomDaLoja[]>([]);
  const [marcosNoOficial, setMarcosNoOficial] = useState<number[]>([]);

  // Dados de Clientes
  const [customers, setCustomers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  // Disparo em Massa Manual (Broadcast)
  // Começa vazio: o texto antigo de exemplo levava o link do FireHub, não o da loja.
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);

  // Recuperação automática pelo QR (7, 15, 30 dias e quem conversou e não comprou).
  // Começa desligada: é o que o servidor grava enquanto a loja não ligar.
  const [autoConfig, setAutoConfig] = useState<Record<string, any>>({
    autoRecuperation7d: false,
    autoRecuperation15d: false,
    autoRecuperation30d: false,
    autoRecuperacaoConversa: false,
    msg7d: "Oie, sentimos sua falta! 🍕 Que tal matar a fome hoje com R$ 10 de desconto? Use o cupom VOLTEI10!",
    msg15d: "Faz 15 dias que você não pede seu lanche favorito! 🚀 Ganhe 15% OFF hoje no nosso cardápio!",
    msg30d: "Saudade do nosso tempero especial? ❤️ Liberamos Frete Grátis exclusivo para você pedir hoje!",
    msgConversa: "",
    coupon7d: "",
    coupon15d: "",
    coupon30d: "",
    couponConversa: "",
  });

  // Toast State
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const showToast = (msg: string, color: string = "#0F766E") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 5000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/store/marketing").then((r) => r.json());
      if (res.success) {
        setCustomers(res.customers || []);
        if (res.marketingConfig) {
          setAutoConfig((prev) => ({ ...prev, ...res.marketingConfig }));
        }
        setAceite(res.aceiteRiscoQr || null);
        setCupons(Array.isArray(res.cupons) ? res.cupons : []);
        setMarcosNoOficial(Array.isArray(res.marcosNoOficial) ? res.marcosNoOficial : []);
        // Nenhum contato marcado de início: mandar para a base inteira é o que
        // mais arrisca o número pelo QR. A loja escolhe (ou "Marcar todos").
        setSelectedPhones([]);
      }
    } catch (e) {
      showToast("⚠️ Falha ao carregar base de marketing", "#C92E09");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Salvar Automações (7d, 15d, 30d)
  const handleSaveAutomation = async () => {
    try {
      setSaving(true);
      const res = await fetch("/api/store/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_config",
          ...autoConfig,
        }),
      });

      if (res.ok) {
        showToast("✅ Automações de Marketing salvas com sucesso!", "#0F766E");
      } else {
        showToast("⚠️ Erro ao salvar configurações", "#C92E09");
      }
    } catch {
      showToast("⚠️ Falha de conexão", "#C92E09");
    } finally {
      setSaving(false);
    }
  };

  // Aceitar (ou desfazer) o risco do envio pelo QR Code. Quem trava é o servidor.
  const handleAceite = async (aceitar: boolean) => {
    try {
      setSalvandoAceite(true);
      const res = await fetch("/api/store/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: aceitar ? "aceitar_risco_qr" : "desfazer_aceite_qr", entendo: aceitar ? entendo : undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setAceite(data.aceiteRiscoQr || null);
        setEntendo(false);
        showToast(data.message, aceitar ? "#B45309" : "#0F766E");
      } else {
        showToast(data.error || "⚠️ Não consegui gravar", "#C92E09");
      }
    } catch {
      showToast("⚠️ Falha de conexão", "#C92E09");
    } finally {
      setSalvandoAceite(false);
    }
  };

  // Disparar Campanha Anti-Ban
  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      showToast("⚠️ Digite o texto da promoção", "#C92E09");
      return;
    }
    if (selectedPhones.length === 0) {
      showToast("⚠️ Selecione pelo menos 1 contato da sua base", "#C92E09");
      return;
    }

    try {
      setSendingBroadcast(true);
      const res = await fetch("/api/store/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_broadcast",
          message: broadcastMessage,
          targetPhones: selectedPhones,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "#0F766E");
      } else {
        showToast(data.error || "⚠️ Falha ao iniciar disparo", "#C92E09");
      }
    } catch {
      showToast("⚠️ Erro de rede ao disparar campanha", "#C92E09");
    } finally {
      setSendingBroadcast(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone?.includes(searchTerm)
  );

  const toggleSelectPhone = (phone: string) => {
    if (selectedPhones.includes(phone)) {
      setSelectedPhones(selectedPhones.filter((p) => p !== phone));
    } else {
      setSelectedPhones([...selectedPhones, phone]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedPhones.length === filteredCustomers.length) {
      setSelectedPhones([]);
    } else {
      setSelectedPhones(filteredCustomers.map((c) => c.phone));
    }
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "sans-serif" }}>
      {/* TOAST */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            background: toast.color,
            color: "#fff",
            padding: "12px 20px",
            borderRadius: "12px",
            fontWeight: 700,
            fontSize: "0.88rem",
            boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
            zIndex: 10000,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <div
        style={{
          background: "linear-gradient(135deg, #1E1B4B, #312E81)",
          color: "#fff",
          borderRadius: "20px",
          padding: "2rem",
          marginBottom: "1.5rem",
          boxShadow: "0 10px 30px rgba(49, 46, 129, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, color: "#A5B4FC", marginBottom: "8px" }}>
              <ShieldCheck size={14} /> DISPARO OFICIAL RECOMENDADO
            </div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800 }}>Marketing &amp; Disparos no WhatsApp</h1>
            <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", opacity: 0.8 }}>
              Fidelize seus clientes com mensagens automáticas e campanhas. O caminho sem risco de banimento é o Disparo oficial.
            </p>
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ background: "rgba(255,255,255,0.1)", padding: "10px 16px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{customers.length}</div>
              <div style={{ fontSize: "0.7rem", opacity: 0.8 }}>Clientes na Base</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.1)", padding: "10px 16px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#5EEAD4" }}>OFICIAL</div>
              <div style={{ fontSize: "0.7rem", opacity: 0.8 }}>Caminho sem banimento</div>
            </div>
          </div>
        </div>
      </div>

      {/* NAVEGAÇÃO POR ABAS */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "1.5rem", borderBottom: "2px solid #E2E8F0", paddingBottom: "8px", flexWrap: "wrap" }}>
        {[
          { id: "broadcast", label: "📢 Disparos (API oficial)", icon: Send },
          { id: "automation", label: "🔁 Recuperação 7, 15 e 30 dias (API oficial)", icon: Clock },
          { id: "qr", label: "📱 Pelo QR Code (não oficial)", icon: AlertTriangle },
          { id: "database", label: "👥 Base de Clientes Cadastrados", icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: "10px 18px",
                borderRadius: "10px",
                border: "none",
                background: isActive ? "#312E81" : "transparent",
                color: isActive ? "#fff" : "#64748B",
                fontWeight: 800,
                fontSize: "0.85rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                transition: "all 0.2s",
              }}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ABA 1: DISPARO — desde 13/10/2026 só pela API oficial da Meta (lib/disparo-oficial). */}
      {activeTab === "broadcast" && <ApresentacaoDisparoOficial />}

      {/* ABA 2: RECUPERAÇÃO 7, 15 E 30 DIAS — desde 13/10/2026 pela API oficial (lib/disparo-oficial). */}
      {activeTab === "automation" && <ChamadaDaRecuperacaoOficial />}

      {/* ABA PELO QR CODE (NÃO OFICIAL) — religada em 11/11/2026 só com o aceite do
          risco (lib/disparo-em-massa.ts). A trava é do servidor; aqui é o aviso. */}
      {activeTab === "qr" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* O AVISO — grande enquanto não aceitou, uma faixa depois. */}
          <div style={{ background: "#FEF2F2", border: "3px solid #DC2626", borderRadius: "16px", padding: aceite ? "1rem 1.25rem" : "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#B91C1C", fontWeight: 900, fontSize: aceite ? "1rem" : "1.35rem" }}>
              <AlertTriangle size={aceite ? 20 : 30} /> O WhatsApp pode banir o número da sua loja
            </div>
            {!aceite && (
              <div style={{ color: "#7F1D1D", fontSize: "0.95rem", lineHeight: 1.6, marginTop: 10 }}>
                <p style={{ margin: "0 0 8px" }}>
                  Este envio sai pelo WhatsApp que você conectou com o <strong>QR Code</strong>. Esse caminho <strong>não é oficial</strong>:
                  o WhatsApp pode bloquear o número de vez, sem aviso e <strong>sem como recorrer</strong>. Você perde o número, as conversas e os
                  clientes que só falam com você por ali.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Já aconteceu com um número da nossa casa.</strong> Mandar devagar ajuda pouco: o que mais pesa é cliente que não pediu a
                  mensagem e denuncia.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Recomendamos o Disparo oficial da Meta</strong>: não tem risco de banimento.
                </p>
              </div>
            )}
            {aceite && (
              <div style={{ color: "#7F1D1D", fontSize: "0.86rem", lineHeight: 1.5, marginTop: 6 }}>
                Envio pelo QR Code liberado em {new Date(aceite.aceitoEm).toLocaleString("pt-BR")} por {aceite.nome || aceite.aceitoPor}. O risco de
                banimento continua: mande só para quem conhece a loja.
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14, alignItems: "center" }}>
              <a
                href="/store/disparo-oficial"
                style={{ padding: "10px 14px", borderRadius: 10, background: "#0F766E", color: "#fff", fontWeight: 800, fontSize: "0.88rem", textDecoration: "none" }}
              >
                📣 Usar o Disparo oficial (sem banimento) →
              </a>
              {aceite && (
                <button
                  onClick={() => handleAceite(false)}
                  disabled={salvandoAceite}
                  style={{ padding: "10px 14px", borderRadius: 10, border: "2px solid #B91C1C", background: "#fff", color: "#B91C1C", fontWeight: 800, fontSize: "0.88rem", cursor: "pointer" }}
                >
                  {salvandoAceite ? "Travando..." : "Desfazer o aceite e travar o QR Code"}
                </button>
              )}
            </div>

            {!aceite && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #FCA5A5" }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", color: "#7F1D1D", fontWeight: 800, fontSize: "0.95rem" }}>
                  <input
                    type="checkbox"
                    checked={entendo}
                    onChange={(e) => setEntendo(e.target.checked)}
                    style={{ width: 20, height: 20, accentColor: "#B91C1C", marginTop: 2, flexShrink: 0 }}
                  />
                  {FRASE_DO_ACEITE}
                </label>
                <button
                  onClick={() => handleAceite(true)}
                  disabled={!entendo || salvandoAceite}
                  style={{
                    marginTop: 12,
                    padding: "12px 18px",
                    borderRadius: 10,
                    border: "none",
                    background: entendo ? "#B91C1C" : "#E2E8F0",
                    color: entendo ? "#fff" : "#94A3B8",
                    fontWeight: 800,
                    fontSize: "0.9rem",
                    cursor: entendo ? "pointer" : "not-allowed",
                  }}
                >
                  {salvandoAceite ? "Liberando..." : "Liberar o envio pelo QR Code"}
                </button>
              </div>
            )}
          </div>

          {aceite && (
            <>
              {/* DISPARO AGORA */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem" }}>
                <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "16px", border: "1px solid #E2E8F0" }}>
                  <h3 style={{ margin: "0 0 4px 0", fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>Mandar uma promoção agora</h3>
                  <p style={{ margin: "0 0 12px 0", fontSize: "0.8rem", color: "#64748B", lineHeight: 1.5 }}>
                    As mensagens saem uma a cada 12 a 28 segundos, com descanso de 45 a 75 segundos a cada dez. Roda em segundo plano e leva alguns
                    minutos. Quem tocou em “Parar promoções” no Disparo oficial fica de fora.
                  </p>
                  <textarea
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="Escreva a promoção. Ex.: Hoje tem pizza grande com 20% de desconto! Peça pelo nosso site."
                    style={{ width: "100%", height: "120px", padding: "12px", borderRadius: "12px", border: "1.5px solid #CBD5E1", fontSize: "0.88rem", resize: "none", boxSizing: "border-box", outline: "none" }}
                  />
                  {selectedPhones.length > 150 && (
                    <div style={{ background: "#FEF2F2", padding: "12px", borderRadius: "12px", border: "1px solid #FECACA", color: "#B71C1C", fontSize: "0.88rem", marginTop: "10px" }}>
                      ⚠️ <strong>Risco alto:</strong> {selectedPhones.length} contatos marcados. Pelo QR Code, mande para no máximo 100 a 150 pessoas por dia.
                    </div>
                  )}
                  <button
                    onClick={handleSendBroadcast}
                    disabled={sendingBroadcast}
                    style={{ width: "100%", marginTop: "12px", padding: "14px", borderRadius: "12px", border: "none", background: "#0F766E", color: "#fff", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                  >
                    <Send size={18} />
                    {sendingBroadcast ? "Iniciando..." : `Mandar para ${selectedPhones.length} contato(s) pelo QR Code`}
                  </button>
                </div>

                <div style={{ background: "#fff", padding: "1.25rem", borderRadius: "16px", border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0F172A" }}>Para quem ({selectedPhones.length})</div>
                    <button onClick={toggleSelectAll} style={{ background: "#F1F5F9", border: "none", padding: "4px 8px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#334155" }}>
                      {selectedPhones.length === filteredCustomers.length && filteredCustomers.length > 0 ? "Desmarcar todos" : "Marcar todos"}
                    </button>
                  </div>
                  <div style={{ maxHeight: "350px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {filteredCustomers.map((c) => {
                      const isChecked = selectedPhones.includes(c.phone);
                      return (
                        <div
                          key={c.id}
                          onClick={() => toggleSelectPhone(c.phone)}
                          style={{ padding: "8px 10px", borderRadius: "8px", background: isChecked ? "#F0FDFA" : "#F8FAFC", border: `1px solid ${isChecked ? "#99F6E4" : "#E2E8F0"}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.78rem" }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</div>
                            <div style={{ color: "#64748B", fontSize: "0.72rem" }}>{c.phone}</div>
                          </div>
                          <input type="checkbox" checked={isChecked} readOnly style={{ accentColor: "#0F766E" }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* RECUPERAÇÃO AUTOMÁTICA PELO QR */}
              <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "16px", border: "1px solid #E2E8F0" }}>
                <h3 style={{ margin: "0 0 4px 0", fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>Recuperação automática pelo QR Code</h3>
                <p style={{ margin: "0 0 14px 0", fontSize: "0.8rem", color: "#64748B", lineHeight: 1.5 }}>
                  Todo dia, entre 10h e 20h, o robô manda a mensagem de cada marco ligado, com o cupom escolhido e o link da loja. No máximo 60
                  mensagens por dia, com 25 a 75 segundos entre uma e outra. Cada cliente recebe cada marco uma vez só; quem já recebeu uma
                  mensagem automática nos últimos 6 dias espera. Cupom desligado ou vencido: o marco não sai.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.25rem" }}>
                  {MARCOS_QR.map((m) => {
                    const ligado = autoConfig[m.ligado] === true;
                    const noOficial = m.dias !== null && marcosNoOficial.includes(m.dias);
                    return (
                      <div key={m.ligado} style={{ background: "#F8FAFC", padding: "1rem 1.25rem", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 800, color: "#1E293B" }}>{m.titulo}</div>
                          <button
                            onClick={() => setAutoConfig({ ...autoConfig, [m.ligado]: !ligado })}
                            style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: ligado ? "#0F766E" : "#CBD5E1", color: "#fff", fontWeight: 800, fontSize: "0.75rem", cursor: "pointer" }}
                          >
                            {ligado ? "LIGADO" : "DESLIGADO"}
                          </button>
                        </div>
                        {m.ajuda && <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "#64748B" }}>{m.ajuda}</p>}
                        {noOficial && (
                          <div style={{ background: "#ECFEFF", border: "1px solid #A5F3FC", borderRadius: 8, padding: "8px 10px", fontSize: "0.78rem", color: "#155E75", marginBottom: 8 }}>
                            Este marco está ligado no Disparo oficial. Pelo QR Code ele fica parado, para o cliente não receber duas vezes.
                          </div>
                        )}
                        <textarea
                          value={autoConfig[m.msg] || ""}
                          onChange={(e) => setAutoConfig({ ...autoConfig, [m.msg]: e.target.value })}
                          style={{ width: "100%", height: "64px", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", resize: "none", boxSizing: "border-box" }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>Cupom:</label>
                          <select
                            value={autoConfig[m.cupom] || ""}
                            onChange={(e) => setAutoConfig({ ...autoConfig, [m.cupom]: e.target.value })}
                            style={{ flex: 1, minWidth: 200, padding: "7px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.8rem" }}
                          >
                            <option value="">Sem cupom</option>
                            {cupons.map((c) => (
                              <option key={c.code} value={c.code}>{descreverCupom(c)}</option>
                            ))}
                            {autoConfig[m.cupom] && !cupons.some((c) => c.code === autoConfig[m.cupom]) && (
                              <option value={autoConfig[m.cupom]}>{autoConfig[m.cupom]} — não existe mais</option>
                            )}
                          </select>
                          <a href="/store/minha-loja" style={{ fontSize: "0.76rem", fontWeight: 800, color: "#312E81" }}>Criar cupom</a>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleSaveAutomation}
                  disabled={saving}
                  style={{ padding: "12px 24px", borderRadius: "10px", border: "none", background: "#312E81", color: "#fff", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer" }}
                >
                  {saving ? "Salvando..." : "✓ Salvar a recuperação pelo QR Code"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ABA 3: BASE DE CLIENTES CADASTRAIS */}
      {activeTab === "database" && (
        <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "16px", border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <h3 style={{ margin: "0 0 4px 0", fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>
                Banco de Dados de Clientes Interativos
              </h3>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>
                Clientes gravados automaticamente após interagirem com o robô ou realizarem pedidos no seu site.
              </p>
            </div>

            <div style={{ position: "relative", minWidth: "260px" }}>
              <input
                type="text"
                placeholder="Buscar por nome ou número..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px 8px 32px",
                  borderRadius: "8px",
                  border: "1px solid #CBD5E1",
                  fontSize: "0.82rem",
                  outline: "none",
                }}
              />
              <Search size={14} style={{ position: "absolute", left: "10px", top: "10px", color: "#94A3B8" }} />
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.84rem" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", color: "#475569" }}>
                  <th style={{ padding: "10px 14px" }}>Nome do Cliente</th>
                  <th style={{ padding: "10px 14px" }}>WhatsApp</th>
                  <th style={{ padding: "10px 14px" }}>Total de Pedidos</th>
                  <th style={{ padding: "10px 14px" }}>Última Interação</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "30px", textAlign: "center", color: "#94A3B8" }}>
                      Nenhum cliente registrado na base ainda.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#0F172A" }}>{c.name}</td>
                      <td style={{ padding: "10px 14px", color: "#1C1917", fontWeight: 700 }}>{c.phone}</td>
                      <td style={{ padding: "10px 14px" }}>{c.totalOrders || 0} pedido(s)</td>
                      <td style={{ padding: "10px 14px", color: "#64748B", fontSize: "0.78rem" }}>
                        {new Date(c.updatedAt).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
