"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  TrendingUp, Star, ChevronRight, ArrowLeft, Check, X, Zap, Target,
  BarChart2, MapPin, Clock, Shield, Pause, Play, DollarSign, RefreshCw,
  AlertTriangle, CheckCircle, Settings, ExternalLink, Upload, ImageIcon,
  Sparkles, Edit3, Eye, Bot, Wifi
} from "lucide-react";

/* ── Dados de social proof ── */
const SOCIAL_PROOF = [
  { name: "Burger Carioca", invested: 150, earned: 847, stars: 5 },
  { name: "Pizza do Bairro", invested: 200, earned: 1230, stars: 5 },
  { name: "Sushi Express", invested: 100, earned: 480, stars: 5 },
  { name: "Frango & Cia", invested: 150, earned: 720, stars: 5 },
  { name: "Lanches Top", invested: 100, earned: 394, stars: 5 },
  { name: "Açaí Premium", invested: 150, earned: 1435, stars: 5 },
  { name: "Churrasco RS", invested: 200, earned: 3222, stars: 5 },
  { name: "Tapioca Fit", invested: 100, earned: 560, stars: 4 },
  { name: "Esfiharia Top", invested: 250, earned: 1890, stars: 5 },
  { name: "Poke Natural", invested: 100, earned: 612, stars: 5 },
  { name: "Cantina Italiana", invested: 300, earned: 2415, stars: 5 },
  { name: "Dog & Burger", invested: 150, earned: 980, stars: 5 },
  { name: "Temaki House", invested: 200, earned: 1550, stars: 5 },
  { name: "Pastelaria Mineira", invested: 100, earned: 430, stars: 4 },
];

const FEATURES = [
  { icon: Zap, label: "100% automático", desc: "IA cria e otimiza os anúncios" },
  { icon: Target, label: "Só sua cidade", desc: "Raio de entrega exato" },
  { icon: BarChart2, label: "Painel em tempo real", desc: "ROI, pedidos e investimento" },
  { icon: MapPin, label: "Seus criativos", desc: "Fotos do seu cardápio" },
  { icon: Clock, label: "Otimização contínua", desc: "IA melhora toda semana" },
  { icon: Shield, label: "Sem surpresas", desc: "Você define o valor" },
];

type Step = "hero" | "terms" | "method" | "invest" | "commitment" | "connect" | "creative" | "dashboard";

interface Campaign {
  id: string; weeklyBudget: number; status: string;
  spend?: number; impressions?: number; clicks?: number;
  ordersGenerated?: number; revenue?: number; feeAccrued?: number;
  adCopy?: string; adImageUrl?: string; createdAt?: string;
}

interface ProductImage {
  name: string; imageUrl: string; price: number;
}

export default function TrafegoPagoPage({ user }: { user: any }) {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("hero");
  const [investment, setInvestment] = useState(100);
  const [agreed, setAgreed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsScrolled, setTermsScrolled] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [newBudget, setNewBudget] = useState(100);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [connected, setConnected] = useState(false);

  // Creative step state
  const [imageTab, setImageTab] = useState<"upload" | "menu" | "ai">("menu");
  const [selectedImage, setSelectedImage] = useState<string>("");
  const [uploadPreview, setUploadPreview] = useState<string>("");
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [gerandoImagem, setGerandoImagem] = useState(false);
  const [descricaoIA, setDescricaoIA] = useState("");
  const [cotaRestante, setCotaRestante] = useState<number | null>(null);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [adCopy, setAdCopy] = useState("");
  const [adDescription, setAdDescription] = useState("");
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carregar campanha existente + query params do OAuth
  useEffect(() => {
    const connectedParam = searchParams.get("connected");
    const error = searchParams.get("error");
    const budgetParam = searchParams.get("budget");

    if (error) {
      const msgs: Record<string, string> = {
        facebook_denied: "Você negou a autorização no Facebook. Tente novamente.",
        missing_params: "Parâmetros faltando no retorno do Facebook.",
        token_exchange_failed: "Erro ao conectar com o Facebook. Tente novamente.",
      };
      setNotification({ type: "error", message: msgs[error] || "Erro desconhecido." });
    }

    if (connectedParam === "true") {
      setConnected(true);
      setNotification({ type: "success", message: "✅ Facebook conectado! Agora configure seu primeiro anúncio." });
      if (budgetParam) setInvestment(Number(budgetParam) || 100);
      // Ir direto pro wizard de criativo
      setStep("creative");
    }

    // Buscar campanhas existentes
    fetch("/api/meta-ads/campaign")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.needsSetup) setNeedsSetup(true);
        if (d?.connected) setConnected(true);
        if (d?.campaigns?.length > 0) {
          setCampaigns(d.campaigns);
          if (connectedParam !== "true") setStep("dashboard");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live counter
  useEffect(() => {
    if (step !== "hero") return;
    const interval = setInterval(() => setTick(t => t + 1), 1200);
    return () => clearInterval(interval);
  }, [step]);

  // Dashboard auto-refresh a cada 60s
  useEffect(() => {
    if (step !== "dashboard") return;
    const interval = setInterval(async () => {
      try {
        const r = await fetch("/api/meta-ads/campaign");
        const d = await r.json();
        if (d?.campaigns) setCampaigns(d.campaigns);
      } catch { /* silencioso */ }
    }, 60_000);
    return () => clearInterval(interval);
  }, [step]);

  // Auto-gerar copy ao entrar no step creative (se ainda não tem)
  const hasAutoGenerated = useRef(false);
  useEffect(() => {
    if (step === "creative" && !adCopy && !generatingCopy && !hasAutoGenerated.current) {
      hasAutoGenerated.current = true;
      handleGenerateCopy();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveReceita = 2_847_392.18 + tick * 3.47;
  const liveInvestido = 412_580 + tick * 0.58;
  const livePedidos = 41_893 + tick;

  // A URL do OAuth é montada NO SERVIDOR (/api/meta-ads/auth).
  //
  // Antes era montada aqui, com o state em base64 contendo o franchiseeId — e o
  // callback confiava nesse valor. Trocando o id no state dava para desviar a
  // conexão de outro lojista e passar a gastar a verba da conta de anúncios
  // dele. Agora a loja vem da sessão e o state é assinado; o navegador não
  // decide mais nada.
  //
  // Isso também acaba com a divergência de redirect_uri (com e sem "www", que
  // a Meta exige idêntico) — a origem passou a sair de um lugar só.
  const handleConnectFacebook = () => {
    const qs = investment ? `?investment=${encodeURIComponent(String(investment))}` : "";
    window.location.href = `/api/meta-ads/auth${qs}`;
  };

  // Gerar copy com IA
  const handleGenerateCopy = async () => {
    setGeneratingCopy(true);
    try {
      const res = await fetch("/api/meta-ads/generate-creative", { method: "POST" });
      const data = await res.json();
      if (data.adCopy) setAdCopy(data.adCopy);
      if (data.adDescription) setAdDescription(data.adDescription);
      if (data.productImages?.length > 0) setProductImages(data.productImages);
    } catch {
      setAdCopy(`🍔 Peça agora em ${user.storeName || "nosso restaurante"}! Entrega rápida. Clique e aproveite!`);
      setAdDescription("Delivery rápido com cardápio completo. Peça pelo nosso site!");
    } finally {
      setGeneratingCopy(false);
    }
  };

  // Upload imagem
  // O arquivo vai para o servidor e volta como URL pública.
  //
  // Antes virava data URI (readAsDataURL) e era isso que ia como adImageUrl —
  // mas a Meta BAIXA a imagem para montar o criativo, e "data:image/..." não é
  // endereço que ela consiga buscar. O upload nunca funcionou de verdade.
  // O servidor também padroniza em 1080x1080, senão a Meta recusa foto pequena.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEnviandoImagem(true);
    try {
      const corpo = new FormData();
      corpo.append("imagem", file);
      const res = await fetch("/api/meta-ads/imagem", { method: "POST", body: corpo });
      const data = await res.json();
      if (!res.ok) {
        setNotification({ type: "error", message: data.error || "Não consegui enviar a imagem." });
        return;
      }
      setUploadPreview(data.url);
      setSelectedImage(data.url);
    } catch {
      setNotification({ type: "error", message: "Falha ao enviar a imagem. Tente de novo." });
    } finally {
      setEnviandoImagem(false);
    }
  };

  // Geração por IA — 10 por semana no pacote.
  // Busca a cota ao abrir a aba, para o número já aparecer certo em vez de
  // mostrar "10 incluídas" para quem já usou 7.
  useEffect(() => {
    if (imageTab !== "ai" || cotaRestante !== null) return;
    fetch("/api/meta-ads/gerar-imagem")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.restantes === "number") setCotaRestante(d.restantes); })
      .catch(() => {});
  }, [imageTab, cotaRestante]);

  const handleGerarImagemIA = async () => {
    const descricao = descricaoIA.trim();
    if (!descricao) {
      setNotification({ type: "error", message: "Descreva o que você quer na imagem." });
      return;
    }
    setGerandoImagem(true);
    try {
      const res = await fetch("/api/meta-ads/gerar-imagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotification({ type: "error", message: data.mensagem || "Não consegui gerar a imagem." });
        if (typeof data.restantes === "number") setCotaRestante(data.restantes);
        return;
      }
      setUploadPreview(data.url);
      setSelectedImage(data.url);
      setCotaRestante(data.restantes);
    } catch {
      setNotification({ type: "error", message: "Falha ao gerar a imagem. Tente de novo." });
    } finally {
      setGerandoImagem(false);
    }
  };

  // Criar campanha
  const handleCreateCampaign = async () => {
    if (!selectedImage && !uploadPreview) {
      setNotification({ type: "error", message: "Selecione uma imagem para o anúncio." });
      return;
    }
    if (!adCopy.trim()) {
      setNotification({ type: "error", message: "Escreva o texto do anúncio." });
      return;
    }
    setCreatingCampaign(true);
    try {
      const res = await fetch("/api/meta-ads/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weeklyBudget: investment,
          adCopy: adCopy.trim(),
          adImageUrl: selectedImage || uploadPreview,
        }),
      });
      const data = await res.json();
      if (res.ok && data.campaign) {
        setCampaigns(prev => [data.campaign, ...prev]);
        setStep("dashboard");
        setNotification({ type: "success", message: "🎉 Campanha criada! Seus anúncios já estão rodando no Facebook e Instagram." });
      } else {
        setNotification({ type: "error", message: data.error || "Erro ao criar campanha." });
      }
    } catch {
      setNotification({ type: "error", message: "Erro de conexão. Tente novamente." });
    } finally {
      setCreatingCampaign(false);
    }
  };

  // Ações do dashboard
  const handleAction = async (campaignId: string, action: string, extraData?: any) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/meta-ads/campaign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaignId, ...extraData }),
      });
      if (res.ok) {
        const r = await fetch("/api/meta-ads/campaign");
        const d = await r.json();
        if (d?.campaigns) setCampaigns(d.campaigns);
        const msgs: Record<string, string> = {
          pause: "⏸️ Campanha pausada.", resume: "▶️ Campanha retomada!",
          update_budget: "💰 Orçamento atualizado.",
        };
        setNotification({ type: "success", message: msgs[action] || "✅" });
        setEditingBudget(null);
      }
    } catch {
      setNotification({ type: "error", message: "Erro de conexão." });
    } finally {
      setActionLoading(false);
    }
  };

  // Notification
  const Banner = () => {
    if (!notification) return null;
    const cfg = {
      success: { bg: "#F0FDF4", border: "#BBF7D0", color: "#166534", Icon: CheckCircle },
      error: { bg: "#FEF2F2", border: "#FECACA", color: "#991B1B", Icon: AlertTriangle },
      info: { bg: "#EFF6FF", border: "#BFDBFE", color: "#1E40AF", Icon: Zap },
    }[notification.type];
    return (
      <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: 10 }}>
        <cfg.Icon size={18} color={cfg.color} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: "0.88rem", color: cfg.color, fontWeight: 600, flex: 1 }}>{notification.message}</span>
        <button onClick={() => setNotification(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><X size={16} color={cfg.color} /></button>
      </div>
    );
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, border: "4px solid #E5E7EB", borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#6B7280" }}>Carregando...</p>
      </div>
    </div>
  );

  /* ═══════ HERO ═══════ */
  if (step === "hero") return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <style>{`@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}.social-track{display:flex;gap:.75rem;width:max-content;animation:marquee 28s linear infinite}.social-track:hover{animation-play-state:paused}@keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse-glow{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}50%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}@media(max-width:640px){.hero-stats-grid{grid-template-columns:repeat(2,1fr)!important}.hero-live-row{flex-direction:column!important;gap:1rem!important}.hero-steps-grid{grid-template-columns:1fr!important}}`}</style>
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <span style={{ background: "#EF4444", color: "#fff", fontSize: "0.7rem", fontWeight: 800, padding: "4px 12px", borderRadius: 99, letterSpacing: 1 }}>TRÁFEGO PAGO + FIREHUB</span>
      </div>
      <h1 style={{ textAlign: "center", fontSize: "clamp(1.6rem,4vw,2.5rem)", fontWeight: 900, lineHeight: 1.2, marginBottom: "0.75rem", animation: "fadeInUp 0.6s ease" }}>
        Conecte, invista e a IA<br />cuida do resto
      </h1>
      <p style={{ textAlign: "center", color: "#6B7280", fontSize: "1rem", marginBottom: "2rem", lineHeight: 1.6 }}>
        Anúncios no <strong>Facebook</strong> e <strong>Instagram</strong> 100% automáticos.<br />
        Você não precisa entender nada de marketing. <strong>Só receba os pedidos.</strong>
      </p>

      {/* ── 3 Passos visuais ── */}
      <div className="hero-steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "1rem", marginBottom: "2rem" }}>
        {[
          { step: "1", emoji: "📱", title: "Conecte o Facebook", desc: "Login em 1 clique. Sem complicação.", color: "#1877F2" },
          { step: "2", emoji: "💰", title: "Escolha o investimento", desc: "A partir de R$100/semana. Você decide.", color: "#16A34A" },
          { step: "3", emoji: "🤖", title: "IA faz tudo por você", desc: "Cria, publica e otimiza os anúncios.", color: "#EF4444" },
        ].map((s, i) => (
          <div key={i} style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.25rem", textAlign: "center", position: "relative", animation: `fadeInUp ${0.4 + i * 0.15}s ease` }}>
            <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: s.color, color: "#fff", width: 24, height: 24, borderRadius: "50%", fontSize: "0.72rem", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.step}</div>
            <div style={{ fontSize: "2rem", marginBottom: 8, marginTop: 4 }}>{s.emoji}</div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.4 }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Métricas */}
      <div className="hero-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.75rem", marginBottom: "2rem" }}>
        {/* Antes havia aqui "ROAS médio 4,72x", "133 mil visualizações" e
            "37 pedidos/semana" — todos escritos no código, sem nenhum dado real
            por trás. Prometer resultado que não se pode sustentar é o caminho
            mais curto para o lojista pedir o dinheiro de volta. Trocado pelo
            que é verdade e verificável sobre o serviço. */}
        {[
          { label: "Onde aparece", value: "Facebook e Instagram" },
          { label: "Quem vê", value: "Só quem você entrega" },
          { label: "Gestão FireHub", value: "R$ 50/semana" },
          { label: "Fidelidade", value: "Sem contrato" },
        ].map(s => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#111" }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <button onClick={() => setStep("terms")} style={{ background: "#EF4444", color: "#fff", border: "none", padding: "16px 40px", borderRadius: 12, fontSize: "1.1rem", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, animation: "pulse-glow 2s infinite" }}>
          Ativar para meu restaurante <ChevronRight size={20} />
        </button>
        <p style={{ color: "#9CA3AF", fontSize: "0.8rem", marginTop: 8 }}>⚡ Configuração em menos de 5 minutos · Sem contrato</p>
      </div>
      {/* O carrossel de "depoimentos" mostrava 14 restaurantes que NÃO EXISTEM
          ("Burger Carioca investiu R$150 e faturou R$847"), com cinco estrelas
          e tudo. Isso é depoimento fabricado — some até haver resultado real de
          cliente real para mostrar, com autorização dele. */}
      {false && (
      <div style={{ overflow: "hidden", marginBottom: "2rem", userSelect: "none" }}>
        <div className="social-track">
          {[...SOCIAL_PROOF, ...SOCIAL_PROOF].map((r, i) => (
            <div key={i} style={{ flexShrink: 0, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "0.85rem 1rem", minWidth: 200 }}>
              <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>{Array(r.stars).fill(0).map((_, j) => <Star key={j} size={12} fill="#F59E0B" color="#F59E0B" />)}</div>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 4 }}>{r.name}</div>
              <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>Investiu <strong>R${r.invested}</strong> — Faturou <span style={{ color: "#16A34A", fontWeight: 800 }}>R${r.earned.toLocaleString("pt-BR")}</span></div>
            </div>
          ))}
        </div>
      </div>
      )}
      {false && (
      <div className="hero-live-row" style={{ display: "flex", justifyContent: "center", gap: "3rem", borderTop: "1px solid #E5E7EB", paddingTop: "1.5rem" }}>
        {[
          { label: "Receita Gerada", value: `R$ ${liveReceita.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: "Valor Investido", value: `R$ ${liveInvestido.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` },
          { label: "Pedidos Gerados", value: livePedidos.toLocaleString("pt-BR") },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#16A34A", fontVariantNumeric: "tabular-nums", transition: "all 0.3s ease" }}>{s.value}</div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
          </div>
        ))}
      </div>
      )}
      {/* Os contadores "ao vivo" acima (Receita Gerada / Valor Investido /
          Pedidos) eram uma fórmula: 2.847.392,18 + tick × 3,47. Nada vinha do
          banco. Ficam ocultos até existir número real para somar. */}
    </div>
  );

  /* ═══════ TERMS ═══════ */
  if (step === "terms") {
    const handleTermsScroll = (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) setTermsScrolled(true);
    };
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 1rem 4rem" }}>
        <Banner />
        <button onClick={() => setStep("hero")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📜</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 900, marginBottom: "0.25rem" }}>Termos do Tráfego Pago</h2>
          <p style={{ color: "#6B7280", fontSize: "0.88rem" }}>Leia com atenção antes de prosseguir. Role até o final para aceitar.</p>
        </div>

        <div onScroll={handleTermsScroll} style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", maxHeight: 400, overflowY: "auto", marginBottom: "1.5rem", fontSize: "0.88rem", lineHeight: 1.8, color: "#374151" }}>
          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>1. Taxa de Gestão</h3>
          <p>O módulo de Tráfego Pago cobra <strong>R$ 50,00/semana</strong> pelo <strong>serviço de gestão de campanhas</strong> (criação, otimização e monitoramento dos seus anúncios).</p>

          <div style={{ background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 10, padding: "0.85rem", margin: "0.75rem 0" }}>
            <strong style={{ color: "#991B1B" }}>🔴 IMPORTANTE:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: "1.2rem", color: "#991B1B" }}>
              <li><strong>Ativou a campanha = taxa é cobrada</strong>, independente do retorno em vendas</li>
              <li>O FireHub <strong>NÃO garante</strong> resultados específicos de vendas ou ROAS</li>
              <li>O retorno depende de fatores como: <strong>qualidade do produto, atendimento, preços, fotos do cardápio e mercado local</strong></li>
            </ul>
          </div>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", marginTop: "1.25rem" }}>2. Cobrança</h3>
          <ul style={{ paddingLeft: "1.2rem", margin: "0 0 0.75rem" }}>
            <li>A taxa de R$50/semana é acumulada e <strong>incluída na fatura do mês seguinte</strong></li>
            <li>Se pausar todas as campanhas, a taxa <strong>para imediatamente</strong></li>
            <li>Nenhuma campanha ativa no mês = R$0 de taxa</li>
          </ul>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>3. Investimento em Mídia</h3>
          <ul style={{ paddingLeft: "1.2rem", margin: "0 0 0.75rem" }}>
            <li>O valor investido em anúncios vai <strong>direto para a Meta (Facebook/Instagram)</strong> na sua conta</li>
            <li>O FireHub <strong>não retém</strong> nenhuma parte do investimento em mídia</li>
            <li>Você define o orçamento semanal e pode alterar a qualquer momento</li>
          </ul>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>4. Resultados e ROAS</h3>
          <p>O <strong>ROAS</strong> (Retorno sobre o Investimento em Anúncios) varia de acordo com:</p>
          <ul style={{ paddingLeft: "1.2rem", margin: "4px 0 0.75rem" }}>
            <li>Qualidade e apresentação do seu cardápio (fotos, descrições)</li>
            <li>Atendimento ao cliente e velocidade de entrega</li>
            <li>Preços competitivos para a sua região</li>
            <li>Demanda do mercado local e concorrência</li>
          </ul>
          <p>Os primeiros dias são de <strong>aprendizado do algoritmo</strong>. Recomendamos manter a campanha ativa por pelo menos <strong>30 dias</strong> antes de avaliar os resultados.</p>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", marginTop: "1.25rem" }}>5. Exemplos Práticos</h3>
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "0.85rem" }}>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "#92400E" }}>
              <li>Ativou campanha na segunda e pausou na quinta (4 dias) → <strong>R$50</strong></li>
              <li>Manteve campanha ativa por 3 semanas → <strong>R$150</strong></li>
              <li>Nenhuma campanha ativa no mês → <strong>R$0</strong></li>
            </ul>
          </div>
        </div>

        {!termsScrolled && (
          <div style={{ textAlign: "center", fontSize: "0.82rem", color: "#9CA3AF", marginBottom: "0.75rem" }}>↓ Role até o final para aceitar os termos</div>
        )}

        <label style={{ display: "flex", gap: "0.75rem", cursor: termsScrolled ? "pointer" : "not-allowed", opacity: termsScrolled ? 1 : 0.5, background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 12, padding: "1rem", marginBottom: "1rem" }}>
          <div onClick={() => termsScrolled && setTermsAccepted(!termsAccepted)} style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${termsAccepted ? "#EF4444" : "#D1D5DB"}`, background: termsAccepted ? "#EF4444" : "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", marginTop: 2 }}>
            {termsAccepted && <Check size={13} color="#fff" />}
          </div>
          <span style={{ fontSize: "0.88rem", lineHeight: 1.6 }}>Li e aceito os termos acima. Entendo que a <strong>taxa de R$50/semana é pelo serviço de gestão</strong>, não por resultados. O ROAS depende da qualidade do meu produto, atendimento e mercado local.</span>
        </label>

        <button onClick={() => setStep("method")} disabled={!termsAccepted}
          style={{ width: "100%", background: termsAccepted ? "#EF4444" : "#E5E7EB", color: termsAccepted ? "#fff" : "#9CA3AF", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: termsAccepted ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
          Aceito os termos — Continuar →
        </button>
      </div>
    );
  }

  /* ═══════ METHOD ═══════ */
  if (step === "method") return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <button onClick={() => setStep("terms")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <div style={{ textAlign: "center", marginBottom: "0.5rem" }}><span style={{ background: "#EF4444", color: "#fff", fontSize: "0.7rem", fontWeight: 800, padding: "4px 12px", borderRadius: 99 }}>TRÁFEGO PAGO + FIREHUB</span></div>
      <h2 style={{ textAlign: "center", fontSize: "1.8rem", fontWeight: 900, marginBottom: "0.5rem" }}>Como deseja configurar?</h2>
      <p style={{ textAlign: "center", color: "#6B7280", marginBottom: "2rem" }}>Escolha a modalidade que funciona melhor pra você.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
        {[
          { title: "Configuração Acompanhada", desc: "Um especialista FireHub configura com você via WhatsApp", href: "https://wa.me/5522998851680?text=Oi%20quero%20ajuda%20para%20configurar%20o%20trafego%20pago%20do%20firehub%20na%20minha%20loja" },
          { title: "Configurar Sozinho", desc: "Configure no seu ritmo, passo a passo em menos de 5 minutos", action: () => setStep("invest") },
        ].map((opt, i) => (
          <div key={i} onClick={() => opt.action ? opt.action() : window.open(opt.href, "_blank")}
            style={{ border: "1.5px solid #E5E7EB", borderRadius: 14, padding: "1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", transition: "border-color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#EF4444")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#E5E7EB")}>
            <div><div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 4 }}>{opt.title}</div><div style={{ fontSize: "0.82rem", color: "#6B7280" }}>{opt.desc}</div></div>
            <ChevronRight size={18} color="#9CA3AF" style={{ flexShrink: 0, marginLeft: 8 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem" }}>
        {FEATURES.map(f => (
          <div key={f.label} style={{ background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem", display: "flex", alignItems: "center", gap: 8 }}>
            <f.icon size={15} color="#EF4444" style={{ flexShrink: 0 }} />
            <div><div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{f.label}</div><div style={{ fontSize: "0.7rem", color: "#6B7280" }}>{f.desc}</div></div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ═══════ INVEST ═══════ */
  const BUDGET_PRESETS = [100, 150, 200, 300, 500, 1000];
  if (step === "invest") return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <button onClick={() => setStep("method")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 900, marginBottom: "0.25rem" }}>Investimento semanal</h2>
      <p style={{ color: "#6B7280", marginBottom: "2rem" }}>Quanto você quer investir por semana? A IA otimiza cada real.</p>
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "2rem", textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{ marginBottom: "0.25rem", color: "#6B7280", fontSize: "0.85rem" }}>Investimento semanal em anúncios</div>
        <div style={{ fontSize: "3rem", fontWeight: 900, color: "#111", marginBottom: "1rem" }}>R$ <span>{investment}</span></div>
        {/* Presets rápidos */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: "1.25rem" }}>
          {BUDGET_PRESETS.map(v => (
            <button key={v} onClick={() => setInvestment(v)}
              style={{
                padding: "6px 14px", borderRadius: 8, border: investment === v ? "2px solid #EF4444" : "1.5px solid #E5E7EB",
                background: investment === v ? "#FEF2F2" : "#fff", fontWeight: 700, fontSize: "0.82rem",
                cursor: "pointer", color: investment === v ? "#EF4444" : "#374151", transition: "all 0.15s",
                position: "relative",
              }}>
              R${v}
              {v === 150 && <span style={{ position: "absolute", top: -8, right: -4, background: "#16A34A", color: "#fff", fontSize: "0.55rem", fontWeight: 800, padding: "1px 5px", borderRadius: 6, whiteSpace: "nowrap" }}>⭐ Popular</span>}
            </button>
          ))}
        </div>
        <input type="range" min={100} max={2000} step={50} value={investment} onChange={e => setInvestment(Number(e.target.value))} style={{ width: "100%", accentColor: "#EF4444", height: 6, cursor: "pointer" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#9CA3AF", marginTop: 6 }}><span>R$ 100</span><span>R$ 2.000</span></div>
      </div>
      {/* Estimativas */}
      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1rem", marginBottom: "0.75rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", textAlign: "center" }}>
          {/* "Retorno estimado = investimento × 4,72" saiu daqui.
              Era promessa de resultado financeiro calculada sobre um ROAS
              inventado no código — quem investisse R$ 200 lia "≈ R$ 944". Sem
              nenhum dado por trás, isso é o tipo de número que volta como
              reclamação, e com razão.
              O alcance fica, porque é estimativa de ENTREGA (quantas pessoas o
              valor alcança), não de retorno — e é a conta que a própria Meta
              usa. Mesmo assim vai marcado como estimativa. */}
          <div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 2 }}>Alcance estimado</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#3B82F6" }}>≈ {(investment * 85).toLocaleString("pt-BR")}</div>
            <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>pessoas na sua região</div>
          </div>
          <div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 2 }}>Gestão FireHub</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#111" }}>R$ 50<span style={{ fontSize: "0.8rem", fontWeight: 600 }}>/semana</span></div>
            <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>cobrado só enquanto ativo</div>
          </div>
        </div>
        <div style={{ fontSize: "0.68rem", color: "#9CA3AF", marginTop: 8, lineHeight: 1.4, borderTop: "1px solid #BBF7D0", paddingTop: 8, textAlign: "center" }}>
          ⚠️ O alcance é uma estimativa e varia com concorrência e público. Não prometemos
          número de pedidos: o resultado depende das suas <strong>fotos</strong>, <strong>preços</strong> e
          <strong> mercado local</strong>. Você acompanha os números reais aqui no painel.
        </div>
      </div>
      <div style={{ background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 12, padding: "0.85rem 1rem", marginBottom: "1.5rem", fontSize: "0.82rem", color: "#991B1B", lineHeight: 1.6 }}>
        🔴 <strong>Taxa de gestão:</strong> R$ 50/semana pelo serviço de criação, otimização e monitoramento. <strong>Ativou = cobra</strong>, independente do retorno em vendas.
      </div>
      <button onClick={() => connected ? (handleGenerateCopy(), setStep("creative")) : setStep("connect")} style={{ width: "100%", background: "#EF4444", color: "#fff", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        Confirmar R$ {investment}/semana <ChevronRight size={18} />
      </button>
    </div>
  );
  /* ═══════ CONNECT ═══════ */
  if (step === "connect") return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <button onClick={() => setStep("invest")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 900, marginBottom: "0.25rem" }}>Conectar Facebook</h2>
      <p style={{ color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>Conecte sua página do Facebook para que a IA crie os anúncios na <strong>sua conta</strong>.</p>
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          {[
            { n: "1", title: "Conecte sua página", desc: "Faça login no Facebook" },
            { n: "2", title: "Autorize o FireHub", desc: "Permita que a IA gerencie seus anúncios" },
            { n: "3", title: "Configure seu anúncio", desc: "Escolha imagem, confirme o texto e publique" },
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: i < 2 ? "1rem" : 0 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#EF4444", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 800, flexShrink: 0 }}>{s.n}</div>
              <div><div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.title}</div><div style={{ fontSize: "0.78rem", color: "#6B7280" }}>{s.desc}</div></div>
            </div>
          ))}
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "0.6rem 0.85rem", marginBottom: "1rem", fontSize: "0.82rem", color: "#166534", fontWeight: 600 }}>
          ✅ O pagamento dos anúncios é feito direto pela sua conta do Meta
        </div>
        <button onClick={handleConnectFacebook} style={{ width: "100%", background: "#1877F2", color: "#fff", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: "0.75rem" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          Conectar com Facebook
        </button>
        <div style={{ fontSize: "0.72rem", color: "#9CA3AF", textAlign: "center" }}>🔒 Seus dados são seguros. O FireHub nunca publica nada sem sua autorização.</div>
      </div>
      <div style={{ marginTop: "1.5rem", background: "#F9FAFB", borderRadius: 12, padding: "1rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.75rem" }}>Perguntas frequentes</div>
        {[
          { q: "Quem paga os anúncios?", a: "Você. O valor é cobrado pela Meta na sua conta. O FireHub cobra R$50/semana de gestão." },
          { q: "Preciso ter uma página no Facebook?", a: "Sim. Se não tiver, crie uma em 2 minutos." },
          { q: "Posso pausar?", a: "Sim! Pause ou cancele direto pelo painel, sem multas." },
        ].map((faq, i) => (
          <div key={i} style={{ marginBottom: i < 2 ? "0.75rem" : 0 }}>
            <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#374151" }}>{faq.q}</div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.5 }}>{faq.a}</div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ═══════ CREATIVE (NOVO!) ═══════ */
  if (step === "creative") return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <button onClick={() => setStep("commitment")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <h2 style={{ fontSize: "1.6rem", fontWeight: 900, marginBottom: "0.25rem" }}>Configure seu anúncio</h2>
      <p style={{ color: "#6B7280", marginBottom: "2rem", fontSize: "0.9rem" }}>Escolha a imagem e confirme o texto. A IA já sugeriu um texto otimizado para você.</p>

      {/* ── Imagem ── */}
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
          <ImageIcon size={18} color="#EF4444" /> Imagem do anúncio
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: "1rem", background: "#F1F5F9", borderRadius: 10, padding: 4 }}>
          {([
            { key: "menu" as const, label: "Do cardápio", icon: "🍔" },
            { key: "upload" as const, label: "Upload", icon: "📸" },
            { key: "ai" as const, label: "Gerar com IA", icon: "🤖" },
          ]).map(t => (
            <button key={t.key} onClick={() => setImageTab(t.key)}
              style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", background: imageTab === t.key ? "#fff" : "transparent", fontWeight: imageTab === t.key ? 700 : 500, fontSize: "0.82rem", cursor: "pointer", boxShadow: imageTab === t.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.2s" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Menu */}
        {imageTab === "menu" && (
          <div>
            {productImages.length === 0 && !generatingCopy ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#6B7280" }}>
                <button onClick={handleGenerateCopy} style={{ background: "#EF4444", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
                  Carregar fotos do cardápio
                </button>
              </div>
            ) : generatingCopy ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#6B7280" }}>
                <div style={{ width: 32, height: 32, border: "3px solid #E5E7EB", borderTopColor: "#EF4444", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Carregando fotos...
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 8 }}>
                {productImages.map((p, i) => (
                  <div key={i} onClick={() => { setSelectedImage(p.imageUrl); setUploadPreview(""); }}
                    style={{ border: `2px solid ${selectedImage === p.imageUrl ? "#EF4444" : "#E5E7EB"}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "border-color 0.2s", position: "relative" }}>
                    <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: 100, objectFit: "cover" }} />
                    <div style={{ padding: "6px 8px", fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    {selectedImage === p.imageUrl && (
                      <div style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", background: "#EF4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={13} color="#fff" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Upload */}
        {imageTab === "upload" && (
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: "none" }} />
            {uploadPreview ? (
              <div style={{ textAlign: "center" }}>
                <img src={uploadPreview} alt="Preview" style={{ maxHeight: 200, borderRadius: 12, marginBottom: 12, border: "2px solid #EF4444" }} />
                <br />
                <button onClick={() => fileInputRef.current?.click()} style={{ background: "#F1F5F9", border: "none", padding: "8px 16px", borderRadius: 8, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" }}>Trocar imagem</button>
              </div>
            ) : (
              <div onClick={() => fileInputRef.current?.click()}
                style={{ border: "2px dashed #D1D5DB", borderRadius: 12, padding: "2.5rem", textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "#EF4444")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#D1D5DB")}>
                <Upload size={32} color="#9CA3AF" style={{ margin: "0 auto 8px" }} />
                <div style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>Clique para enviar uma imagem</div>
                <div style={{ fontSize: "0.78rem", color: "#9CA3AF" }}>JPG, PNG ou WEBP — máx 5MB</div>
              </div>
            )}
          </div>
        )}

        {/* Tab: IA — 10 gerações por semana incluídas no pacote */}
        {imageTab === "ai" && (
          <div style={{ padding: "1.25rem", background: "#F9FAFB", borderRadius: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Sparkles size={20} color="#8B5CF6" />
              <div style={{ fontWeight: 700 }}>Criar imagem com IA</div>
            </div>

            <div style={{ fontSize: "0.8rem", color: "#6B7280", marginBottom: 12, lineHeight: 1.5 }}>
              Descreva a cena que você quer. A IA cria uma foto de apresentação para o anúncio.
              <br />
              <strong style={{ color: "#B45309" }}>Importante:</strong> a imagem é ilustrativa. Para mostrar
              o prato exato que você entrega, prefira a foto do seu cardápio — anunciar um prato
              diferente do real gera reclamação do cliente.
            </div>

            <textarea
              value={descricaoIA}
              onChange={(e) => setDescricaoIA(e.target.value.slice(0, 300))}
              placeholder="Ex.: hambúrguer artesanal com fritas, sobre tábua de madeira"
              rows={2}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: "0.86rem", fontFamily: "inherit", resize: "vertical", marginBottom: 10 }}
            />

            <button
              onClick={handleGerarImagemIA}
              disabled={gerandoImagem || cotaRestante === 0}
              style={{ width: "100%", background: (gerandoImagem || cotaRestante === 0) ? "#E5E7EB" : "#8B5CF6", color: (gerandoImagem || cotaRestante === 0) ? "#9CA3AF" : "#fff", border: "none", padding: "12px", borderRadius: 10, fontWeight: 700, fontSize: "0.9rem", cursor: (gerandoImagem || cotaRestante === 0) ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {gerandoImagem ? "Criando imagem..." : cotaRestante === 0 ? "Cota da semana esgotada" : "✨ Gerar imagem"}
            </button>

            <div style={{ fontSize: "0.74rem", color: "#9CA3AF", marginTop: 8, textAlign: "center" }}>
              {cotaRestante === null
                ? "10 imagens por semana incluídas no seu plano"
                : `${cotaRestante} de 10 imagens restantes nesta semana`}
              {cotaRestante === 0 && " · a cota volta na segunda-feira"}
            </div>

            <div style={{ fontSize: "0.74rem", color: "#6B7280", marginTop: 10, textAlign: "center" }}>
              Fotos do cardápio e imagens que você envia <strong>não têm limite</strong>.
            </div>
          </div>
        )}
      </div>

      {/* ── Texto do anúncio ── */}
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
            <Edit3 size={18} color="#EF4444" /> Texto do anúncio
          </div>
          <button onClick={handleGenerateCopy} disabled={generatingCopy}
            style={{ background: "#F1F5F9", border: "none", padding: "6px 12px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: generatingCopy ? 0.5 : 1 }}>
            <Sparkles size={13} /> {generatingCopy ? "Gerando..." : "Gerar com IA"}
          </button>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.78rem", color: "#6B7280", fontWeight: 600, display: "block", marginBottom: 4 }}>Texto principal</label>
          <textarea value={adCopy} onChange={e => setAdCopy(e.target.value)} rows={3}
            placeholder="Ex: 🍔 Peça agora! Entrega rápida na sua região..."
            style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", fontSize: "0.9rem", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", color: "#6B7280", fontWeight: 600, display: "block", marginBottom: 4 }}>Descrição curta</label>
          <input value={adDescription} onChange={e => setAdDescription(e.target.value)}
            placeholder="Ex: Delivery rápido com cardápio completo..."
            style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
      </div>

      {/* ── Preview do anúncio ── */}
      {(selectedImage || uploadPreview) && adCopy && (
        <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
            <Eye size={18} color="#EF4444" /> Preview do anúncio
          </div>
          <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", maxWidth: 400, margin: "0 auto" }}>
            <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#EF4444", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "0.8rem" }}>
                {(user.storeName || "R")[0]}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{user.storeName || "Restaurante"}</div>
                <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>Patrocinado · 🌐</div>
              </div>
            </div>
            <div style={{ padding: "0 12px 8px", fontSize: "0.85rem", lineHeight: 1.5 }}>{adCopy}</div>
            <img src={selectedImage || uploadPreview} alt="Ad preview" style={{ width: "100%", height: 200, objectFit: "cover" }} />
            <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #E5E7EB" }}>
              <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>{adDescription || "Saiba mais"}</div>
              <button style={{ background: "#EF4444", color: "#fff", border: "none", padding: "6px 16px", borderRadius: 6, fontSize: "0.78rem", fontWeight: 700 }}>Pedir agora</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resumo + Publicar ── */}
      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1rem", marginBottom: "1rem", fontSize: "0.85rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>💰 Investimento semanal:</span><strong>R$ {investment}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>🔧 Taxa de gestão FireHub:</span><strong>R$ 50/semana</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #BBF7D0", paddingTop: 8, marginTop: 4 }}><span style={{ fontWeight: 700 }}>Total semanal:</span><strong style={{ color: "#16A34A" }}>R$ {investment + 50}</strong></div>
      </div>

      <button onClick={handleCreateCampaign} disabled={creatingCampaign || (!selectedImage && !uploadPreview) || !adCopy.trim()}
        style={{ width: "100%", background: ((!selectedImage && !uploadPreview) || !adCopy.trim()) ? "#E5E7EB" : "#EF4444", color: ((!selectedImage && !uploadPreview) || !adCopy.trim()) ? "#9CA3AF" : "#fff", border: "none", padding: "16px", borderRadius: 12, fontSize: "1.1rem", fontWeight: 800, cursor: ((!selectedImage && !uploadPreview) || !adCopy.trim()) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s" }}>
        {creatingCampaign ? (
          <><RefreshCw size={18} style={{ animation: "spin 1s linear infinite" }} /> Criando campanha...</>
        ) : (
          <>🚀 Publicar campanha</>
        )}
      </button>
    </div>
  );

  /* ═══════ DASHBOARD ═══════ */
  const activeCampaigns = campaigns.filter(c => c.status === "ACTIVE");
  const pausedCampaigns = campaigns.filter(c => c.status === "PAUSED");
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
  const totalOrders = campaigns.reduce((s, c) => s + (c.ordersGenerated ?? 0), 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.revenue ?? 0), 0);
  const roasNum = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const overallRoas = totalSpend > 0 ? roasNum.toFixed(1) : "—";
  const roasBarPct = Math.min(roasNum / 6 * 100, 100); // 6x = barra cheia

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:640px){.dash-kpis{grid-template-columns:repeat(2,1fr)!important}.dash-campaign-metrics{grid-template-columns:repeat(2,1fr)!important}.dash-info-grid{grid-template-columns:1fr!important}}`}</style>

      {/* Header */}
      <div style={{ background: activeCampaigns.length > 0 ? "linear-gradient(135deg,#EF4444,#DC2626)" : "linear-gradient(135deg,#F59E0B,#D97706)", borderRadius: 16, padding: "1.5rem", color: "#fff", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Zap size={20} />
              <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1.2rem" }}>Tráfego Pago {activeCampaigns.length > 0 ? "🔥" : "⏸️"}</h2>
              <span style={{ background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: 6, fontSize: "0.65rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                <Bot size={11} /> Gerenciado por IA
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.85 }}>
              {activeCampaigns.length} campanha(s) ativa(s) · {pausedCampaigns.length} pausada(s)
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8, fontSize: "0.72rem", opacity: 0.7 }}><Wifi size={10} /> Atualiza a cada 60s</span>
            </p>
          </div>
          <button onClick={() => { hasAutoGenerated.current = false; setAdCopy(""); setAdDescription(""); setSelectedImage(""); setUploadPreview(""); setProductImages([]); setStep("creative"); }}
            style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 10, padding: "8px 16px", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            + Nova campanha
          </button>
        </div>
      </div>

      {/* KPIs totais */}
      <div className="dash-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        {[
          { label: "Total investido", value: `R$ ${totalSpend.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "#3B82F6", icon: DollarSign },
          { label: "Pedidos gerados", value: totalOrders.toLocaleString("pt-BR"), color: "#10B981", icon: CheckCircle },
          { label: "Receita atribuída", value: `R$ ${totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "#8B5CF6", icon: TrendingUp },
          { label: "ROAS geral", value: `${overallRoas}x`, color: "#EF4444", icon: BarChart2 },
        ].map(k => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <k.icon size={14} color={k.color} />
              <span style={{ fontSize: "0.7rem", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{k.label}</span>
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 900, color: k.color, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ROAS visual bar */}
      {totalSpend > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#374151" }}>💰 Retorno sobre Investimento (ROAS)</span>
            <span style={{ fontSize: "0.82rem", fontWeight: 800, color: roasNum >= 2 ? "#16A34A" : roasNum >= 1 ? "#F59E0B" : "#EF4444" }}>
              {overallRoas}x {roasNum >= 3 ? "🔥" : roasNum >= 1 ? "📈" : "⏳"}
            </span>
          </div>
          <div style={{ background: "#F1F5F9", borderRadius: 8, height: 12, overflow: "hidden", position: "relative" }}>
            <div style={{
              width: `${roasBarPct}%`, height: "100%", borderRadius: 8,
              background: roasNum >= 2 ? "linear-gradient(90deg,#22C55E,#16A34A)" : roasNum >= 1 ? "linear-gradient(90deg,#F59E0B,#D97706)" : "linear-gradient(90deg,#EF4444,#DC2626)",
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#9CA3AF", marginTop: 4 }}>
            <span>0x</span>
            <span>Investiu R${totalSpend.toFixed(0)} → Faturou R${totalRevenue.toFixed(0)}</span>
            <span>6x+</span>
          </div>
        </div>
      )}

      {/* Lista de campanhas */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.75rem" }}>Suas campanhas</h3>
        {campaigns.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", background: "#F9FAFB", borderRadius: 14, color: "#6B7280" }}>
            <Target size={40} color="#D1D5DB" style={{ margin: "0 auto 12px" }} />
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Nenhuma campanha criada</div>
            <div style={{ fontSize: "0.85rem" }}>Crie sua primeira campanha de tráfego pago.</div>
          </div>
        ) : campaigns.map(c => {
          const isActive = c.status === "ACTIVE";
          const isPaused = c.status === "PAUSED";
          const spend = c.spend ?? 0;
          const orders = c.ordersGenerated ?? 0;
          const revenue = c.revenue ?? 0;
          const roas = spend > 0 ? (revenue / spend).toFixed(1) : "—";
          const cpo = orders > 0 ? `R$ ${(spend / orders).toFixed(2)}` : "—";

          return (
            <div key={c.id} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "1.25rem", marginBottom: "0.75rem" }}>
              {/* Header campanha */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {c.adImageUrl && <img src={c.adImageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 6 }}>
                      R$ {c.weeklyBudget}/semana
                      <span style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", padding: "1px 6px", borderRadius: 5, fontSize: "0.6rem", fontWeight: 700, color: "#0284C7", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Bot size={9} /> IA
                      </span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>Criada em {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : "—"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{
                    padding: "4px 10px", borderRadius: 99, fontSize: "0.72rem", fontWeight: 700,
                    background: isActive ? "#F0FDF4" : isPaused ? "#FEF9C3" : "#F1F5F9",
                    color: isActive ? "#166534" : isPaused ? "#92400E" : "#475569",
                    border: `1px solid ${isActive ? "#BBF7D0" : isPaused ? "#FDE68A" : "#E2E8F0"}`,
                  }}>
                    {isActive ? "✅ Ativo" : isPaused ? "⏸️ Pausado" : c.status}
                  </span>
                  {isActive && (
                    <button onClick={() => handleAction(c.id, "pause")} disabled={actionLoading}
                      style={{ background: "#FEF9C3", border: "1px solid #FDE68A", borderRadius: 8, padding: "4px 10px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#92400E", display: "flex", alignItems: "center", gap: 4 }}>
                      <Pause size={12} /> Pausar
                    </button>
                  )}
                  {isPaused && (
                    <button onClick={() => handleAction(c.id, "resume")} disabled={actionLoading}
                      style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "4px 10px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#166534", display: "flex", alignItems: "center", gap: 4 }}>
                      <Play size={12} /> Retomar
                    </button>
                  )}
                </div>
              </div>

              {/* Métricas */}
              <div className="dash-campaign-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "0.5rem" }}>
                {[
                  { label: "Investido", value: `R$ ${spend.toFixed(2)}`, color: "#3B82F6" },
                  { label: "Impressões", value: (c.impressions ?? 0).toLocaleString("pt-BR"), color: "#8B5CF6" },
                  { label: "Cliques", value: (c.clicks ?? 0).toLocaleString("pt-BR"), color: "#F59E0B" },
                  { label: "Pedidos", value: orders.toString(), color: "#10B981" },
                  { label: "ROAS", value: `${roas}x`, color: "#EF4444" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#F9FAFB", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.65rem", color: "#6B7280", textTransform: "uppercase", marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: "1rem", fontWeight: 800, color: m.color, fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Custo por pedido + Lucro estimado */}
              {orders > 0 && (
                <div style={{ marginTop: 8, display: "flex", gap: "1rem", fontSize: "0.78rem", color: "#6B7280" }}>
                  <span>📊 Custo/pedido: <strong style={{ color: "#111" }}>{cpo}</strong></span>
                  {revenue > spend && <span>💚 Lucro estimado: <strong style={{ color: "#16A34A" }}>R$ {(revenue - spend).toFixed(2)}</strong></span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info cards */}
      <div className="dash-info-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "1rem" }}>
          <div style={{ fontSize: "0.82rem", color: "#1E40AF", fontWeight: 700, marginBottom: 6 }}>💰 Taxa de gestão (serviço)</div>
          <div style={{ fontSize: "0.78rem", color: "#3B82F6" }}>
            R$ 50/semana pelo serviço. Ativou campanha = cobra, independente do resultado.
          </div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1rem" }}>
          <div style={{ fontSize: "0.82rem", color: "#166534", fontWeight: 700, marginBottom: 6 }}>🤖 Tudo automático</div>
          <div style={{ fontSize: "0.78rem", color: "#166534", lineHeight: 1.5 }}>
            A IA cria, otimiza e monitora seus anúncios 24h. Sem precisar fazer nada.
          </div>
        </div>
      </div>

      <div style={{ marginTop: "1rem", textAlign: "center" }}>
        <button onClick={() => window.open("https://wa.me/5522998851680?text=Oi%20quero%20ajuda%20para%20configurar%20o%20trafego%20pago%20do%20firehub%20na%20minha%20loja", "_blank")}
          style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 20px", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "#475569", display: "inline-flex", alignItems: "center", gap: 8 }}>
          💬 Falar com especialista <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}
