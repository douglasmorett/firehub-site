"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { TrendingUp, Star, ChevronRight, ArrowLeft, Check, X, Zap, Target, BarChart2, MapPin, Clock, Shield } from "lucide-react";

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


type Step = "hero" | "method" | "invest" | "connect" | "commitment" | "dashboard";

interface Campaign {
  id: string; weeklyBudget: number; status: string;
  spent?: number; impressions?: number; clicks?: number; orders?: number;
}

export default function TrafegoPagoPage({ user }: { user: any }) {
  const [step, setStep] = useState<Step>("hero");
  const [investment, setInvestment] = useState(100);
  const [agreed, setAgreed] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [pixPaid, setPixPaid] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/meta-ads/campaign")
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.campaign) { setCampaign(d.campaign); setStep("dashboard"); }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // Auto scroll social proof
  useEffect(() => {
    if (step !== "hero") return;
    const el = scrollRef.current;
    if (!el) return;
    let pos = 0;
    const interval = setInterval(() => {
      pos += 1;
      if (pos >= el.scrollWidth / 2) pos = 0;
      el.scrollLeft = pos;
    }, 20);
    return () => clearInterval(interval);
  }, [step]);

  // Live counter tick — simula crescimento constante nos totais
  useEffect(() => {
    if (step !== "hero") return;
    const interval = setInterval(() => setTick(t => t + 1), 1200);
    return () => clearInterval(interval);
  }, [step]);

  // Valores base + crescimento por tick
  const liveReceita = 2_847_392.18 + tick * 3.47;
  const liveInvestido = 412_580 + tick * 0.58;
  const livePedidos = 41_893 + tick;

  const handleConnectFacebook = () => {
    // Redireciona para OAuth do Facebook com permissões de ads_management
    const appId = "YOUR_META_APP_ID"; // será env var
    const redirectUri = encodeURIComponent(window.location.origin + "/api/meta-ads/callback");
    const scope = "ads_management,ads_read,pages_show_list,pages_read_engagement,business_management";
    window.location.href = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${investment}`;
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, border: "4px solid #E5E7EB", borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#6B7280" }}>Carregando...</p>
      </div>
    </div>
  );

  /* ─── HERO ─── */
  if (step === "hero") return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 4rem" }}>
      {/* Badge */}
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <span style={{ background: "#EF4444", color: "#fff", fontSize: "0.7rem", fontWeight: 800, padding: "4px 12px", borderRadius: 99, letterSpacing: 1 }}>TRÁFEGO PAGO + FIREHUB</span>
      </div>

      {/* Hero title */}
      <h1 style={{ textAlign: "center", fontSize: "clamp(1.6rem,4vw,2.5rem)", fontWeight: 900, lineHeight: 1.2, marginBottom: "1rem" }}>
        Anúncios que trazem pedidos<br />direto pro seu cardápio
      </h1>
      <p style={{ textAlign: "center", color: "#6B7280", fontSize: "1rem", marginBottom: "2rem", lineHeight: 1.6 }}>
        O FireHub cria, publica e otimiza seus anúncios no <strong>Facebook</strong> e<br />
        <strong>Instagram</strong> automaticamente. Você só recebe os pedidos.
      </p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.75rem", marginBottom: "2rem" }}>
        {[
          { label: "Custo médio por pedido", value: "R$ 7,33" },
          { label: "Visualizações/semana", value: "133 mil" },
          { label: "ROAS médio", value: "4,72x" },
          { label: "Pedidos gerados/semana", value: "37" },
        ].map(s => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#111" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <button onClick={() => setStep("method")}
          style={{ background: "#EF4444", color: "#fff", border: "none", padding: "16px 40px", borderRadius: 12, fontSize: "1.1rem", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
          Ativar para meu restaurante <ChevronRight size={20} />
        </button>
        <p style={{ color: "#9CA3AF", fontSize: "0.8rem", marginTop: 8 }}>Configuração em menos de 5 minutos</p>
      </div>

      {/* Social proof scroll */}
      <div ref={scrollRef} style={{ display: "flex", gap: "0.75rem", overflowX: "hidden", marginBottom: "2rem", userSelect: "none" }}>
        {[...SOCIAL_PROOF, ...SOCIAL_PROOF].map((r, i) => (
          <div key={i} style={{ flexShrink: 0, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "0.85rem 1rem", minWidth: 200 }}>
            <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
              {Array(r.stars).fill(0).map((_, j) => <Star key={j} size={12} fill="#F59E0B" color="#F59E0B" />)}
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 4 }}>{r.name}</div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
              Investiu <strong>R${r.invested}</strong> — Faturou{" "}
              <span style={{ color: "#16A34A", fontWeight: 800 }}>R${r.earned.toLocaleString("pt-BR")}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom totals — live counters */}
      <div style={{ display: "flex", justifyContent: "center", gap: "3rem", borderTop: "1px solid #E5E7EB", paddingTop: "1.5rem" }}>
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
    </div>
  );

  /* ─── METHOD ─── */
  if (step === "method") return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <button onClick={() => setStep("hero")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
        <span style={{ background: "#EF4444", color: "#fff", fontSize: "0.7rem", fontWeight: 800, padding: "4px 12px", borderRadius: 99 }}>TRÁFEGO PAGO + FIREHUB</span>
      </div>
      <h2 style={{ textAlign: "center", fontSize: "1.8rem", fontWeight: 900, marginBottom: "0.5rem" }}>Como deseja configurar?</h2>
      <p style={{ textAlign: "center", color: "#6B7280", marginBottom: "2rem" }}>Escolha a modalidade que funciona melhor pra você.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
        {[
          { title: "Configuração Acompanhada", desc: "Um especialista FireHub configura com você via WhatsApp", href: `https://wa.me/5511999999999?text=Quero+ativar+o+Tráfego+Pago` },
          { title: "Configurar Sozinho", desc: "Configure no seu ritmo, passo a passo em menos de 5 minutos", action: () => setStep("invest") },
        ].map((opt, i) => (
          <div key={i} onClick={() => opt.action ? opt.action() : window.open(opt.href, "_blank")}
            style={{ border: "1.5px solid #E5E7EB", borderRadius: 14, padding: "1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", transition: "border-color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#EF4444")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "#E5E7EB")}>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 4 }}>{opt.title}</div>
              <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>{opt.desc}</div>
            </div>
            <ChevronRight size={18} color="#9CA3AF" style={{ flexShrink: 0, marginLeft: 8 }} />
          </div>
        ))}
      </div>

      {/* Features grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem" }}>
        {FEATURES.map(f => (
          <div key={f.label} style={{ background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem", display: "flex", alignItems: "center", gap: 8 }}>
            <f.icon size={15} color="#EF4444" style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{f.label}</div>
              <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ─── INVEST ─── */
  if (step === "invest") return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <button onClick={() => setStep("method")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 900, marginBottom: "0.25rem" }}>Investimento semanal</h2>
      <p style={{ color: "#6B7280", marginBottom: "2.5rem" }}>Quanto você quer investir por semana no Facebook?</p>

      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "2rem", textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{ marginBottom: "0.25rem", color: "#6B7280", fontSize: "0.85rem" }}>Investimento semanal</div>
        <div style={{ fontSize: "3rem", fontWeight: 900, color: "#111", marginBottom: "1.5rem" }}>
          R$ <span>{investment}</span>
        </div>
        <input type="range" min={100} max={2000} step={50} value={investment} onChange={e => setInvestment(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#EF4444", height: 6, cursor: "pointer" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#9CA3AF", marginTop: 6 }}>
          <span>R$ 100</span><span>R$ 2.000</span>
        </div>
      </div>

      {/* ROI estimate */}
      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1rem", marginBottom: "1.5rem", textAlign: "center" }}>
        <div style={{ fontSize: "0.8rem", color: "#6B7280", marginBottom: 4 }}>Estimativa de retorno (ROAS médio 4,72x)</div>
        <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#16A34A" }}>
          ≈ R$ {(investment * 4.72).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} / semana
        </div>
        <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 4 }}>Baseado nos resultados dos nossos restaurantes</div>
        <div style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 8, lineHeight: 1.5, borderTop: "1px solid #BBF7D0", paddingTop: 8 }}>
          ⚠️ Essa métrica varia de acordo com a <strong>qualidade das suas fotos</strong>, <strong>preço</strong> e <strong>posicionamento na cidade</strong>. Avalie seus resultados mensalmente.
        </div>
      </div>

      <button onClick={() => setStep("commitment")}
        style={{ width: "100%", background: "#EF4444", color: "#fff", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        Confirmar R$ {investment}/semana <ChevronRight size={18} />
      </button>
    </div>
  );

  /* ─── COMMITMENT ─── */
  if (step === "commitment") return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <button onClick={() => setStep("invest")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🚀</div>
        <h2 style={{ fontSize: "1.6rem", fontWeight: 900, marginBottom: "0.5rem" }}>Quase lá!</h2>
        <p style={{ color: "#6B7280" }}>Leia com atenção antes de ativar.</p>
      </div>

      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <label style={{ display: "flex", gap: "0.75rem", cursor: "pointer" }}>
          <div onClick={() => setAgreed(!agreed)}
            style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${agreed ? "#EF4444" : "#D1D5DB"}`, background: agreed ? "#EF4444" : "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", marginTop: 2 }}>
            {agreed && <Check size={13} color="#fff" />}
          </div>
          <span style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
            Entendo que os primeiros dias são de aprendizado e vou usar por pelo menos <strong>30 dias</strong> para avaliar os resultados
          </span>
        </label>
      </div>

      <div style={{ background: "#FEF9C3", border: "1px solid #FDE68A", borderRadius: 12, padding: "0.85rem 1rem", fontSize: "0.82rem", color: "#92400E", marginBottom: "1.5rem" }}>
        💡 A IA precisa de alguns dias para otimizar seus anúncios. Os melhores resultados aparecem na 2ª e 3ª semana.
      </div>

      <button onClick={() => setStep("connect")} disabled={!agreed}
        style={{ width: "100%", background: agreed ? "#EF4444" : "#E5E7EB", color: agreed ? "#fff" : "#9CA3AF", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: agreed ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
        Conectar meu Facebook →
      </button>
    </div>
  );

  /* ─── CONNECT FACEBOOK ─── */
  if (step === "connect") return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <button onClick={() => setStep("commitment")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 900, marginBottom: "0.25rem" }}>Conectar Facebook</h2>
      <p style={{ color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>Conecte sua página do Facebook para que a IA crie os anúncios na <strong>sua conta</strong>.</p>

      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem" }}>
        {/* Steps visual */}
        <div style={{ marginBottom: "1.5rem" }}>
          {[
            { n: "1", title: "Conecte sua página", desc: "Clique no botão abaixo e faça login no Facebook" },
            { n: "2", title: "Autorize o FireHub", desc: "Permita que a IA gerencie seus anúncios" },
            { n: "3", title: "Defina o orçamento", desc: `R$ ${investment}/semana — cobrado pelo Meta direto na sua conta` },
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: i < 2 ? "1rem" : 0 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#EF4444", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 800, flexShrink: 0 }}>
                {s.n}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.title}</div>
                <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "0.6rem 0.85rem", marginBottom: "1rem", fontSize: "0.82rem", color: "#166534", fontWeight: 600 }}>
          ✅ O pagamento é feito direto pela sua conta do Meta — você tem controle total
        </div>

        <button onClick={handleConnectFacebook}
          style={{ width: "100%", background: "#1877F2", color: "#fff", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: "0.75rem" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          Conectar com Facebook
        </button>

        <div style={{ fontSize: "0.72rem", color: "#9CA3AF", textAlign: "center" }}>
          🔒 Seus dados são seguros. O FireHub nunca publica nada sem sua autorização.
        </div>
      </div>

      {/* FAQ */}
      <div style={{ marginTop: "1.5rem", background: "#F9FAFB", borderRadius: 12, padding: "1rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.75rem" }}>Perguntas frequentes</div>
        {[
          { q: "Quem paga os anúncios?", a: "Você. O valor é cobrado diretamente pela Meta na sua conta de anúncios. Quando o orçamento acaba, os anúncios param automaticamente." },
          { q: "Preciso ter uma página no Facebook?", a: "Sim, sua página do Facebook é onde os anúncios aparecem. Se não tiver, crie uma em 2 minutos." },
          { q: "Posso pausar a qualquer momento?", a: "Sim! Você pode pausar ou cancelar direto pelo painel, sem multas." },
        ].map((faq, i) => (
          <div key={i} style={{ marginBottom: i < 2 ? "0.75rem" : 0 }}>
            <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#374151" }}>{faq.q}</div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.5 }}>{faq.a}</div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ─── DASHBOARD ─── */
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 4rem" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#EF4444,#DC2626)", borderRadius: 16, padding: "1.5rem", color: "#fff", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Zap size={20} />
              <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1.2rem" }}>Tráfego Pago Ativo 🔥</h2>
            </div>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.85 }}>
              Anúncios rodando no Facebook & Instagram — R$ {campaign?.weeklyBudget ?? investment}/semana
            </p>
          </div>
          <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 14px", fontSize: "0.8rem", fontWeight: 700 }}>
            ✅ Ativo
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Gasto esta semana", value: `R$ ${campaign?.spent ?? 0}`, sub: `de R$ ${campaign?.weeklyBudget ?? investment}`, color: "#3B82F6" },
          { label: "Impressões", value: (campaign?.impressions ?? 0).toLocaleString("pt-BR"), sub: "visualizações totais", color: "#8B5CF6" },
          { label: "Cliques no cardápio", value: campaign?.clicks ?? 0, sub: "pessoas interessadas", color: "#F59E0B" },
          { label: "Pedidos gerados", value: campaign?.orders ?? 0, sub: "via tráfego pago", color: "#10B981" },
          { label: "ROI estimado", value: campaign?.orders ? `${((campaign.orders * 45) / (campaign.spent ?? 1)).toFixed(1)}x` : "—", sub: "retorno sobre investimento", color: "#EF4444" },
        ].map(k => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "1.1rem" }}>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{k.label}</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Info about sync */}
      <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: "1rem", fontSize: "0.85rem", color: "#92400E" }}>
        <strong>📊 Métricas atualizadas:</strong> As métricas de campanhas são sincronizadas diariamente com o Facebook. Para ver relatórios detalhados em tempo real, acesse o gerenciador de anúncios pelo botão abaixo.
        <br /><br />
        <button onClick={() => window.open("https://wa.me/5511999999999?text=Quero+ver+métricas+do+meu+tráfego+pago", "_blank")}
          style={{ background: "#EF4444", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 8, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
          💬 Falar com especialista
        </button>
      </div>
    </div>
  );
}
