"use client";
import { useState } from "react";

const SEGMENTS = ["Pizzaria","Hamburgueria","Restaurante","Lanchonete","Confeitaria","Açaiteria","Sushi","Marmitaria","Pastelaria","Outro"];
const REVENUES = ["Não sei","Não tem faturamento","Menos de R$1.000","R$1.001 à R$5.000","R$5.001 à R$10.000","R$10.001 à R$20.000","R$20.001 à R$50.000","Acima de R$50.000"];

const FEATURES = [
  { icon: "📋", title: "Cardápio Digital", desc: "Delivery, mesa e balcão num só lugar. Sem app, direto no navegador." },
  { icon: "🤖", title: "Chatbot WhatsApp", desc: "Atendimento automático com IA. Receba pedidos 24h sem perder vendas." },
  { icon: "📊", title: "Gestão Completa", desc: "Controle de caixa, estoque, financeiro e relatórios em tempo real." },
  { icon: "🛵", title: "Gestão de Entregas", desc: "Rastreamento de entregadores, rotas otimizadas e status em tempo real." },
  { icon: "🔥", title: "Módulos FireCheck", desc: "Auditoria por IA, ponto com geolocalização, ranking de equipe e mais." },
  { icon: "💬", title: "Disparo WhatsApp", desc: "Envie promoções em massa para sua base de clientes e aumente vendas." },
];

const STEPS = [
  { num: "01", title: "Cadastre seu restaurante", desc: "Em menos de 5 minutos seu cardápio digital está pronto para receber pedidos." },
  { num: "02", title: "Personalize tudo", desc: "Logo, banner, categorias, produtos, taxas de entrega, formas de pagamento." },
  { num: "03", title: "Receba pedidos", desc: "Pelo cardápio digital, WhatsApp, mesas ou balcão — tudo centralizado." },
  { num: "04", title: "Gerencie e cresça", desc: "Relatórios, IA e ferramentas de marketing para escalar seu negócio." },
];

const PLANS = [
  { name: "Delivery", icon: "🛵", popular: false, desc: "Esse plano é ideal para empresas que buscam trabalhar com delivery e querem automatizar seu atendimento com cardápios digitais e autoatendimento, além de aumentar suas vendas com ferramentas de automação e marketing muito completas." },
  { name: "Premium", icon: "🔥", popular: true, desc: "Esse plano foi feito para empresas que buscam automatizar tanto seu atendimento presencial quanto de delivery, tudo isso usando cardápios digitais, ChatBots e ferramentas de gestão que centralizam toda sua operação em único lugar." },
  { name: "Mesas", icon: "🍽️", popular: false, desc: "Esse plano foi feito para empresas que trabalham com um ambiente presencial e buscam automatizar seu atendimento de mesas e comandas, tudo isso através de cardápios digitais e módulos de gestão, para você controlar o que acontece no seu salão." },
];

const FAQ = [
  { q: "Quanto custa o FireHub?", a: "Os planos variam de acordo com a operação. Agende uma demonstração gratuita e receba uma proposta personalizada." },
  { q: "Precisa instalar aplicativo?", a: "Não! O FireHub funciona 100% no navegador, tanto para você quanto para seus clientes. Celular, tablet ou computador." },
  { q: "Como funciona o suporte?", a: "Nosso suporte funciona 7 dias por semana, de manhã, tarde e noite. Atendimento humanizado via WhatsApp." },
  { q: "Posso imprimir comandas?", a: "Sim! Imprima comandas de delivery, cozinha e mesas em uma ou mais impressoras, pelo celular ou computador." },
  { q: "Integra com iFood?", a: "Sim! Receba pedidos do iFood direto no seu painel FireHub, junto com os pedidos do cardápio digital e WhatsApp." },
  { q: "O que são os módulos FireCheck?", a: "São ferramentas de auditoria por IA: checklist com fotos obrigatórias, ponto com geolocalização, financeiro inteligente e ranking de equipe." },
];

export default function FireHubLanding() {
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", revenue: "", segment: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    // TODO: integrate with API/WhatsApp
    await new Promise(r => setTimeout(r, 1500));
    setSent(true);
    setSending(false);
  };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#fff", color: "#1a1a2e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .fh-hero { background: linear-gradient(135deg, #B91C1C 0%, #DC2626 40%, #EF4444 100%); min-height: 100vh; display: flex; align-items: center; position: relative; overflow: hidden; }
        .fh-hero::before { content: ''; position: absolute; top: -50%; right: -20%; width: 70%; height: 200%; background: radial-gradient(ellipse, rgba(255,255,255,0.08) 0%, transparent 70%); }
        .fh-container { max-width: 1200px; margin: 0 auto; padding: 0 24px; width: 100%; }
        .fh-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; background: rgba(185,28,28,0.95); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(255,255,255,0.1); }
        .fh-logo { display: flex; align-items: center; gap: 10px; }
        .fh-logo-text { font-size: 1.5rem; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
        .fh-logo-text span { color: #FCA5A5; }
        .fh-logo-sub { font-size: 0.55rem; color: rgba(255,255,255,0.7); text-transform: uppercase; letter-spacing: 2px; display: block; margin-top: -2px; }
        .fh-nav-links { display: flex; gap: 24px; align-items: center; }
        .fh-nav-links a { color: rgba(255,255,255,0.85); text-decoration: none; font-size: 0.85rem; font-weight: 500; transition: color 0.2s; }
        .fh-nav-links a:hover { color: #fff; }
        .fh-nav-btn { background: #fff !important; color: #DC2626 !important; padding: 8px 20px; border-radius: 8px; font-weight: 700 !important; font-size: 0.85rem; }
        .fh-hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; padding-top: 100px; }
        .fh-hero-tag { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 3px; color: #FCA5A5; font-weight: 600; margin-bottom: 16px; }
        .fh-hero h1 { font-size: 3rem; font-weight: 900; color: #fff; line-height: 1.1; margin-bottom: 20px; }
        .fh-hero h1 em { font-style: normal; color: #FEE2E2; }
        .fh-hero p { color: rgba(255,255,255,0.85); font-size: 1.1rem; line-height: 1.6; margin-bottom: 30px; }
        .fh-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
        .fh-badge { background: rgba(255,255,255,0.15); color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.2); }
        .fh-form-card { background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 25px 60px rgba(0,0,0,0.3); }
        .fh-form-card h3 { font-size: 1.2rem; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
        .fh-form-card p { font-size: 0.8rem; color: #64748B; margin-bottom: 20px; }
        .fh-input { width: 100%; padding: 12px 14px; border: 1.5px solid #E2E8F0; border-radius: 8px; font-size: 0.9rem; outline: none; transition: border 0.2s; margin-bottom: 12px; font-family: inherit; }
        .fh-input:focus { border-color: #DC2626; }
        .fh-select { width: 100%; padding: 12px 14px; border: 1.5px solid #E2E8F0; border-radius: 8px; font-size: 0.9rem; outline: none; background: #fff; margin-bottom: 12px; font-family: inherit; appearance: auto; }
        .fh-submit { width: 100%; padding: 14px; background: #DC2626; color: #fff; border: none; border-radius: 10px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.3s; font-family: inherit; text-transform: uppercase; letter-spacing: 1px; }
        .fh-submit:hover { background: #B91C1C; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(220,38,38,0.4); }
        .fh-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .fh-section { padding: 80px 0; }
        .fh-section-alt { background: #FFF5F5; }
        .fh-section-red { background: linear-gradient(135deg, #B91C1C, #DC2626); color: #fff; }
        .fh-section-title { text-align: center; margin-bottom: 60px; }
        .fh-section-title h2 { font-size: 2.2rem; font-weight: 800; margin-bottom: 12px; }
        .fh-section-title p { color: #64748B; font-size: 1rem; max-width: 600px; margin: 0 auto; }
        .fh-features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
        .fh-feature-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 28px; transition: all 0.3s; }
        .fh-feature-card:hover { border-color: #DC2626; box-shadow: 0 12px 40px rgba(220,38,38,0.1); transform: translateY(-4px); }
        .fh-feature-icon { font-size: 2rem; margin-bottom: 14px; }
        .fh-feature-card h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 8px; }
        .fh-feature-card p { font-size: 0.85rem; color: #64748B; line-height: 1.5; }
        .fh-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
        .fh-step { text-align: center; position: relative; }
        .fh-step-num { font-size: 3rem; font-weight: 900; color: #FEE2E2; margin-bottom: 12px; }
        .fh-step h3 { font-size: 1rem; font-weight: 700; margin-bottom: 8px; }
        .fh-step p { font-size: 0.8rem; color: #64748B; line-height: 1.5; }
        .fh-plans-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; align-items: center; }
        .fh-plan { background: #FEE2E2; border: none; border-radius: 20px; padding: 36px 28px; position: relative; transition: all 0.3s; color: #1a1a2e; }
        .fh-plan.popular { background: linear-gradient(135deg, #7F1D1D, #991B1B); color: #fff; transform: scale(1.07); box-shadow: 0 20px 50px rgba(127,29,29,0.3); z-index: 2; }
        .fh-plan-badge { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: rgba(255,255,255,0.2); color: #fff; padding: 6px 20px; border-radius: 20px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; border: 1px solid rgba(255,255,255,0.3); backdrop-filter: blur(4px); }
        .fh-plan-icon { font-size: 2rem; display: inline-block; margin-right: 10px; vertical-align: middle; background: rgba(220,38,38,0.15); padding: 8px; border-radius: 10px; }
        .fh-plan.popular .fh-plan-icon { background: rgba(255,255,255,0.15); }
        .fh-plan h3 { font-size: 1.6rem; font-weight: 800; margin-bottom: 16px; display: inline-block; vertical-align: middle; }
        .fh-plan p { font-size: 0.9rem; color: #64748B; margin-bottom: 28px; line-height: 1.6; }
        .fh-plan.popular p { color: rgba(255,255,255,0.8); }
        .fh-plan-btn { display: inline-block; text-align: center; padding: 12px 28px; border-radius: 25px; font-weight: 700; font-size: 0.85rem; text-decoration: none; transition: all 0.3s; background: #DC2626; color: #fff; border: none; cursor: pointer; font-family: inherit; box-shadow: 0 4px 15px rgba(220,38,38,0.3); }
        .fh-plan.popular .fh-plan-btn { background: #EF4444; }
        .fh-plan-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(220,38,38,0.4); }
        .fh-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; text-align: center; padding: 60px 0; }
        .fh-stat h3 { font-size: 2.5rem; font-weight: 900; color: #fff; }
        .fh-stat p { font-size: 0.85rem; color: rgba(255,255,255,0.8); }
        .fh-faq { max-width: 700px; margin: 0 auto; }
        .fh-faq-item { border: 1px solid #E2E8F0; border-radius: 10px; margin-bottom: 10px; overflow: hidden; transition: border 0.2s; }
        .fh-faq-item.open { border-color: #DC2626; }
        .fh-faq-q { padding: 16px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 0.95rem; }
        .fh-faq-a { padding: 0 20px 16px; font-size: 0.85rem; color: #64748B; line-height: 1.6; }
        .fh-cta-box { text-align: center; }
        .fh-cta-box h2 { font-size: 2rem; font-weight: 800; color: #fff; margin-bottom: 12px; }
        .fh-cta-box p { color: rgba(255,255,255,0.85); margin-bottom: 30px; font-size: 1rem; }
        .fh-cta-btn { display: inline-block; background: #fff; color: #DC2626; padding: 16px 40px; border-radius: 12px; font-weight: 800; font-size: 1.1rem; text-decoration: none; transition: all 0.3s; border: none; cursor: pointer; font-family: inherit; }
        .fh-cta-btn:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(0,0,0,0.2); }
        .fh-footer { background: #0F172A; color: rgba(255,255,255,0.6); padding: 40px 0; text-align: center; font-size: 0.8rem; }
        .fh-mockup-img { width: 100%; max-width: 500px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
        @media(max-width: 900px) {
          .fh-hero-grid { grid-template-columns: 1fr; gap: 30px; padding-top: 80px; }
          .fh-hero h1 { font-size: 2rem; }
          .fh-features-grid, .fh-plans-grid { grid-template-columns: 1fr; }
          .fh-steps { grid-template-columns: 1fr 1fr; }
          .fh-stats { grid-template-columns: 1fr 1fr; }
          .fh-plan.popular { transform: none; }
          .fh-nav-links { display: none; }
          .fh-hero-grid > div:last-child { order: -1; }
        }
      `}</style>

      {/* NAV */}
      <nav className="fh-nav">
        <div className="fh-logo">
          <img src="/firehub-flame.png" alt="" style={{ height: "36px", width: "36px", objectFit: "contain", borderRadius: "8px" }} />
          <div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1 }}>
              <span style={{ color: "#FF4500" }}>FIRE</span><span style={{ color: "#C0C0C0" }}>HUB</span>
            </div>
            <div style={{ fontSize: "0.45rem", color: "rgba(255,255,255,0.6)", letterSpacing: "1.5px", textTransform: "uppercase" as const, marginTop: "1px" }}>Sistema Centralizado de Pedidos & Estoque</div>
          </div>
        </div>
        <div className="fh-nav-links">
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#faq">FAQ</a>
          <a href="https://hakim-portal.vercel.app/login" className="fh-nav-btn">Área do Cliente</a>
        </div>
      </nav>

      {/* HERO */}
      <section className="fh-hero">
        <div className="fh-container">
          <div className="fh-hero-grid">
            <div>
              <div className="fh-hero-tag">Sistema para Delivery e Restaurante</div>
              <h1>O sistema de <em>pedidos</em> com tudo que o seu restaurante precisa</h1>
              <p>
                Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro 
                e auditoria com IA — tudo num só lugar. Pare de perder vendas e comece a crescer.
              </p>
              <div className="fh-badges">
                <span className="fh-badge">📋 Delivery</span>
                <span className="fh-badge">🍽️ Mesas</span>
                <span className="fh-badge">🏪 Balcão</span>
                <span className="fh-badge">🤖 IA</span>
                <span className="fh-badge">💬 WhatsApp</span>
              </div>
              <img src="/firehub-mockup.png" alt="FireHub Sistema" style={{ marginTop: "20px", width: "100%", maxWidth: "600px", borderRadius: "16px" }} />
            </div>

            {/* FORM */}
            <div>
              <div className="fh-form-card" id="demo">
                <h3>🔥 Agende uma demonstração gratuita</h3>
                <p>Preencha e um consultor entrará em contato em até 24h</p>
                {sent ? (
                  <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "12px" }}>✅</div>
                    <h3 style={{ color: "#16A34A", marginBottom: "8px" }}>Solicitação enviada!</h3>
                    <p style={{ color: "#64748B" }}>Entraremos em contato em breve pelo WhatsApp.</p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
                    <input className="fh-input" placeholder="Nome" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                    <input className="fh-input" placeholder="Empresa / Restaurante" value={form.company} onChange={e => setForm({...form, company: e.target.value})} />
                    <input className="fh-input" placeholder="E-mail" type="email" required value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
                    <input className="fh-input" placeholder="WhatsApp" required value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
                    <select className="fh-select" value={form.revenue} onChange={e => setForm({...form, revenue: e.target.value})}>
                      <option value="">Faturamento mensal</option>
                      {REVENUES.map(r => <option key={r}>{r}</option>)}
                    </select>
                    <select className="fh-select" value={form.segment} onChange={e => setForm({...form, segment: e.target.value})}>
                      <option value="">Qual o seu segmento?</option>
                      {SEGMENTS.map(s => <option key={s}>{s}</option>)}
                    </select>
                    <button className="fh-submit" type="submit" disabled={sending}>
                      {sending ? "Enviando..." : "🔥 SOLICITAR DEMONSTRAÇÃO"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="fh-section-red">
        <div className="fh-container">
          <div className="fh-stats">
            <div className="fh-stat"><h3>500+</h3><p>restaurantes ativos</p></div>
            <div className="fh-stat"><h3>2M+</h3><p>pedidos processados</p></div>
            <div className="fh-stat"><h3>99.9%</h3><p>uptime garantido</p></div>
            <div className="fh-stat"><h3>24/7</h3><p>suporte disponível</p></div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="fh-section" id="funcionalidades">
        <div className="fh-container">
          <div className="fh-section-title">
            <h2>Tudo que seu negócio precisa numa única solução</h2>
            <p>Do cardápio digital à auditoria com inteligência artificial, o FireHub centraliza toda a operação do seu restaurante.</p>
          </div>
          <div className="fh-features-grid">
            {FEATURES.map((f, i) => (
              <div key={i} className="fh-feature-card">
                <div className="fh-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section className="fh-section fh-section-alt" id="como-funciona">
        <div className="fh-container">
          <div className="fh-section-title">
            <h2>Como funciona?</h2>
            <p>Em 4 passos simples você coloca seu restaurante para vender online.</p>
          </div>
          <div className="fh-steps">
            {STEPS.map((s, i) => (
              <div key={i} className="fh-step">
                <div className="fh-step-num">{s.num}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TABELA COMPARATIVA */}
      <section className="fh-section" style={{ background: "#0f172a" }}>
        <div className="fh-container">
          <div className="fh-section-title">
            <h2 style={{ color: "#fff" }}>Por que escolher o <span style={{ color: "#EF4444" }}>FireHub</span>?</h2>
            <p style={{ color: "#94a3b8" }}>Compare e veja por que somos a melhor opção para o seu restaurante</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem", minWidth: "600px" }}>
              <thead>
                <tr>
                  <th style={{ padding: "14px 20px", textAlign: "left", color: "#94a3b8", fontWeight: 600, borderBottom: "1px solid #1e293b" }}>Funcionalidade</th>
                  <th style={{ padding: "14px 20px", textAlign: "center", background: "rgba(239,68,68,0.15)", color: "#EF4444", fontWeight: 700, borderBottom: "1px solid #1e293b", borderRadius: "8px 8px 0 0" }}>🔥 FireHub</th>
                  <th style={{ padding: "14px 20px", textAlign: "center", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #1e293b" }}>Saipos</th>
                  <th style={{ padding: "14px 20px", textAlign: "center", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #1e293b" }}>Sem sistema</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Cardápio digital sem taxa adicional", "✅", "✅", "❌"],
                  ["Pedidos: Delivery, Balcão e Mesas", "✅", "✅", "❌"],
                  ["IA integrada ao WhatsApp", "✅", "✅", "❌"],
                  ["Auditoria operacional com IA 🏆", "✅", "❌", "❌"],
                  ["Controle financeiro pessoal + empresarial 🏆", "✅", "❌", "❌"],
                  ["Módulo FireCheck de auditoria incluso 🏆", "✅", "❌", "❌"],
                  ["Notas de compras lidas por IA", "✅", "❌", "❌"],
                  ["Controle de estoque automático", "Em breve", "✅", "❌"],
                  ["CMV automático", "Em breve", "✅", "❌"],
                  ["Integração iFood / Rappi", "Em breve", "✅", "❌"],
                  ["App para garçom", "Em breve", "✅", "❌"],
                  ["Roteirização de entregas", "Em breve", "✅", "❌"],
                ].map(([feat, fh, saipos, sem], i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ padding: "13px 20px", color: feat.includes("🏆") ? "#fbbf24" : "#e2e8f0", fontWeight: feat.includes("🏆") ? 600 : 400 }}>{feat}</td>
                    <td style={{ padding: "13px 20px", textAlign: "center", background: "rgba(239,68,68,0.05)", fontSize: "1.1rem" }}>
                      {fh === "✅" ? <span style={{ color: "#22c55e" }}>✅</span> : fh === "❌" ? <span style={{ color: "#ef4444" }}>❌</span> : <span style={{ color: "#f59e0b", fontSize: "0.8rem", fontWeight: 600 }}>EM BREVE</span>}
                    </td>
                    <td style={{ padding: "13px 20px", textAlign: "center", fontSize: "1.1rem" }}>
                      {saipos === "✅" ? <span style={{ color: "#22c55e" }}>✅</span> : <span style={{ color: "#ef4444" }}>❌</span>}
                    </td>
                    <td style={{ padding: "13px 20px", textAlign: "center", fontSize: "1.1rem" }}>
                      {sem === "✅" ? <span style={{ color: "#22c55e" }}>✅</span> : <span style={{ color: "#ef4444" }}>❌</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign: "center", color: "#64748b", fontSize: "0.85rem", marginTop: "16px" }}>
            🏆 Funcionalidades exclusivas do FireHub que nenhum concorrente oferece
          </p>
        </div>
      </section>

      {/* PLANS */}
      <section className="fh-section" id="planos">
        <div className="fh-container">
          <div className="fh-section-title">
            <h2>Planos personalizados para cada operação</h2>
            <p>Escolha o plano ideal e agende uma demonstração gratuita.</p>
          </div>
          <div className="fh-plans-grid">
            {PLANS.map((p, i) => (
              <div key={i} className={`fh-plan ${p.popular ? "popular" : ""}`}>
                {p.popular && <div className="fh-plan-badge">+ Popular</div>}
                <div style={{ marginBottom: "16px" }}>
                  <span className="fh-plan-icon">{p.icon}</span>
                  <h3>{p.name}</h3>
                </div>
                <p>{p.desc}</p>
                <a href="https://wa.me/5522981118514?text=Ol%C3%A1!%20Tenho%20interesse%20no%20FireHub%20-%20Plano%20" className="fh-plan-btn">Fale com um consultor</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="fh-section fh-section-alt" id="faq">
        <div className="fh-container">
          <div className="fh-section-title">
            <h2>Perguntas frequentes</h2>
          </div>
          <div className="fh-faq">
            {FAQ.map((f, i) => (
              <div key={i} className={`fh-faq-item ${openFaq === i ? "open" : ""}`}>
                <div className="fh-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {f.q}
                  <span>{openFaq === i ? "−" : "+"}</span>
                </div>
                {openFaq === i && <div className="fh-faq-a">{f.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="fh-section fh-section-red">
        <div className="fh-container">
          <div className="fh-cta-box">
            <h2>Pronto para vender mais?</h2>
            <p>Agende uma demonstração gratuita e descubra como o FireHub pode transformar seu restaurante.</p>
            <a href="https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20agendar%20uma%20demonstra%C3%A7%C3%A3o%20do%20FireHub" className="fh-cta-btn">🔥 AGENDAR DEMONSTRAÇÃO GRATUITA</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="fh-footer">
        <div className="fh-container">
          <p style={{ marginBottom: "8px", fontSize: "1.1rem" }}><span style={{ color: "#EF4444", fontWeight: 800 }}>FIRE</span><span style={{ color: "#aaa", fontWeight: 800 }}>HUB</span> <span style={{ fontSize: "0.7rem" }}>— Sistema Centralizado de Pedidos & Estoque</span></p>
          <p>© {new Date().getFullYear()} FireHub. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
