"use client";
import { useState, useEffect } from "react";

const FEATURES = [
  { icon: "📋", title: "Cardápio Digital", desc: "Delivery, mesa e balcão num só lugar. Sem app, direto no navegador do cliente." },
  { icon: "🤖", title: "Chatbot WhatsApp", desc: "Atendimento automático com IA. Receba pedidos 24h sem perder nenhuma venda." },
  { icon: "📊", title: "Gestão Completa", desc: "Controle de caixa, estoque, financeiro e relatórios em tempo real." },
  { icon: "🛵", title: "Gestão de Entregas", desc: "Rastreamento de entregadores, rotas otimizadas e status em tempo real." },
  { icon: "🔥", title: "Módulos FireCheck", desc: "Auditoria por IA, ponto com geolocalização, ranking de equipe e mais." },
  { icon: "💬", title: "Disparo WhatsApp", desc: "Envie promoções em massa para sua base de clientes e aumente vendas." },
];

const STEPS = [
  { num: "01", title: "Cadastre-se grátis", desc: "Em menos de 2 minutos seu restaurante está no ar, pronto para vender." },
  { num: "02", title: "Personalize tudo", desc: "Logo, banner, categorias, produtos, taxas de entrega e pagamentos." },
  { num: "03", title: "Receba pedidos", desc: "Cardápio digital, WhatsApp, mesas ou balcão — tudo centralizado." },
  { num: "04", title: "Cresça com IA", desc: "Relatórios inteligentes e ferramentas de marketing para escalar." },
];

const FAQ = [
  { q: "Quanto custa o FireHub?", a: "Comece com 15 dias grátis sem compromisso. Após o teste, planos a partir de R$ 99/mês — sem taxas por pedido." },
  { q: "Precisa instalar aplicativo?", a: "Não! O FireHub funciona 100% no navegador, tanto para você quanto para seus clientes. Celular, tablet ou computador." },
  { q: "Como funciona o suporte?", a: "Nosso suporte funciona 7 dias por semana, de manhã, tarde e noite. Atendimento humanizado via WhatsApp." },
  { q: "Posso imprimir comandas?", a: "Sim! Imprima comandas de delivery, cozinha e mesas em uma ou mais impressoras, pelo celular ou computador." },
  { q: "Integra com iFood?", a: "Sim! Receba pedidos do iFood direto no seu painel FireHub, junto com os pedidos do cardápio digital e WhatsApp." },
  { q: "O que são os módulos FireCheck?", a: "Ferramentas de auditoria por IA: checklist com fotos obrigatórias, ponto com geolocalização, financeiro inteligente e ranking de equipe." },
];

const COMPARE = [
  ["Cardápio digital sem taxa adicional", true, true, false],
  ["Pedidos: Delivery, Balcão e Mesas", true, true, false],
  ["IA integrada ao WhatsApp", true, true, false],
  ["Auditoria operacional com IA 🏆", true, false, false],
  ["Controle financeiro completo 🏆", true, false, false],
  ["Módulo FireCheck incluso 🏆", true, false, false],
  ["Notas de compras lidas por IA 🏆", true, false, false],
  ["Controle de estoque automático", "soon", true, false],
  ["CMV automático", "soon", true, false],
  ["Integração iFood / Rappi", "soon", true, false],
];

const TRIAL_URL = "https://portalhakim.com.br/login";
const WA_URL = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20testar%20o%20FireHub%20gr%C3%A1tis%20por%2015%20dias";

export default function FireHubLanding() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#09090b", color: "#fafafa" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; scroll-behavior: smooth; }
        ::selection { background: rgba(239,68,68,0.4); }

        /* ── NAV ── */
        .fn { position:fixed;top:0;left:0;right:0;z-index:100;padding:14px 32px;display:flex;justify-content:space-between;align-items:center;transition:all .4s; }
        .fn.scrolled { background:rgba(9,9,11,.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.06);box-shadow:0 4px 30px rgba(0,0,0,.3); }
        .fn-links { display:flex;gap:28px;align-items:center; }
        .fn-links a { color:rgba(255,255,255,.7);text-decoration:none;font-size:.85rem;font-weight:500;transition:color .2s;position:relative; }
        .fn-links a:hover { color:#fff; }
        .fn-cta { background:linear-gradient(135deg,#ef4444,#dc2626)!important;color:#fff!important;padding:9px 22px;border-radius:10px;font-weight:700!important;font-size:.85rem;box-shadow:0 4px 20px rgba(239,68,68,.3);transition:all .3s!important; }
        .fn-cta:hover { transform:translateY(-2px);box-shadow:0 8px 30px rgba(239,68,68,.5)!important; }

        /* ── HERO ── */
        .hero { min-height:100vh;display:flex;align-items:center;position:relative;overflow:hidden;padding-top:80px; }
        .hero::before { content:'';position:absolute;top:-30%;left:50%;transform:translateX(-50%);width:140%;height:80%;background:radial-gradient(ellipse at center,rgba(239,68,68,.12) 0%,transparent 70%);pointer-events:none; }
        .hero::after { content:'';position:absolute;bottom:0;left:0;right:0;height:200px;background:linear-gradient(to top,#09090b,transparent);pointer-events:none; }
        .hero-inner { max-width:1200px;margin:0 auto;padding:0 24px;width:100%;text-align:center;position:relative;z-index:2; }
        .hero-tag { display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:50px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:#f87171;font-size:.8rem;font-weight:600;margin-bottom:28px;letter-spacing:.5px; }
        .hero-tag .dot { width:6px;height:6px;border-radius:50%;background:#ef4444;animation:pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
        .hero h1 { font-size:clamp(2.4rem,5.5vw,4.2rem);font-weight:900;line-height:1.08;margin-bottom:24px;letter-spacing:-1.5px; }
        .hero h1 .grad { background:linear-gradient(135deg,#ef4444,#f97316,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text; }
        .hero-sub { font-size:clamp(1rem,2vw,1.25rem);color:rgba(255,255,255,.55);max-width:620px;margin:0 auto 40px;line-height:1.7;font-weight:400; }
        .hero-btns { display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:16px; }
        .btn-fire { display:inline-flex;align-items:center;gap:10px;padding:16px 36px;border-radius:14px;font-weight:800;font-size:1.05rem;text-decoration:none;transition:all .3s;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;cursor:pointer;font-family:inherit;box-shadow:0 8px 30px rgba(239,68,68,.35);letter-spacing:.3px; }
        .btn-fire:hover { transform:translateY(-3px);box-shadow:0 14px 40px rgba(239,68,68,.5); }
        .btn-ghost { display:inline-flex;align-items:center;gap:10px;padding:16px 36px;border-radius:14px;font-weight:700;font-size:1.05rem;text-decoration:none;transition:all .3s;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.1);cursor:pointer;font-family:inherit; }
        .btn-ghost:hover { background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);transform:translateY(-2px); }
        .hero-note { color:rgba(255,255,255,.35);font-size:.8rem;margin-top:8px; }
        .hero-badges { display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-top:48px; }
        .hb { display:flex;align-items:center;gap:8px;padding:10px 20px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);font-size:.82rem;color:rgba(255,255,255,.6);font-weight:500; }
        .hb span { font-size:1.1rem; }

        /* ── CONTAINER ── */
        .ctn { max-width:1200px;margin:0 auto;padding:0 24px;width:100%; }
        .sec { padding:100px 0; }

        /* ── STATS ── */
        .stats { display:grid;grid-template-columns:repeat(4,1fr);gap:24px;text-align:center;padding:60px 0;border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06); }
        .stat h3 { font-size:2.8rem;font-weight:900;background:linear-gradient(135deg,#ef4444,#f97316);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text; }
        .stat p { font-size:.85rem;color:rgba(255,255,255,.5);margin-top:4px; }

        /* ── SECTION TITLE ── */
        .stitle { text-align:center;margin-bottom:64px; }
        .stitle h2 { font-size:clamp(1.8rem,3.5vw,2.6rem);font-weight:800;margin-bottom:16px;letter-spacing:-0.5px; }
        .stitle p { color:rgba(255,255,255,.45);font-size:1.05rem;max-width:600px;margin:0 auto; }

        /* ── FEATURES ── */
        .fgrid { display:grid;grid-template-columns:repeat(3,1fr);gap:20px; }
        .fcard { background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:32px;transition:all .4s;position:relative;overflow:hidden; }
        .fcard::before { content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#ef4444,transparent);opacity:0;transition:opacity .4s; }
        .fcard:hover { border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.04);transform:translateY(-4px); }
        .fcard:hover::before { opacity:1; }
        .fcard-icon { font-size:2.2rem;margin-bottom:18px;display:block; }
        .fcard h3 { font-size:1.1rem;font-weight:700;margin-bottom:10px; }
        .fcard p { font-size:.88rem;color:rgba(255,255,255,.45);line-height:1.6; }

        /* ── STEPS ── */
        .steps { display:grid;grid-template-columns:repeat(4,1fr);gap:32px; }
        .step { text-align:center;position:relative; }
        .step-num { font-size:4rem;font-weight:900;background:linear-gradient(135deg,rgba(239,68,68,.25),rgba(239,68,68,.05));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1; }
        .step h3 { font-size:1rem;font-weight:700;margin:12px 0 8px; }
        .step p { font-size:.82rem;color:rgba(255,255,255,.4);line-height:1.6; }

        /* ── COMPARE ── */
        .compare-sec { background:rgba(255,255,255,.02);border-top:1px solid rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.05); }
        .ctable { width:100%;border-collapse:collapse;font-size:.92rem; }
        .ctable th { padding:16px 20px;font-weight:600;border-bottom:1px solid rgba(255,255,255,.08); }
        .ctable td { padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.04); }
        .ctable .fh-col { background:rgba(239,68,68,.06); }
        .ctable .fh-head { background:rgba(239,68,68,.12);color:#f87171;font-weight:800;border-radius:12px 12px 0 0; }

        /* ── FAQ ── */
        .faq { max-width:720px;margin:0 auto; }
        .faq-item { border:1px solid rgba(255,255,255,.06);border-radius:14px;margin-bottom:10px;overflow:hidden;transition:all .3s; }
        .faq-item.open { border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.03); }
        .faq-q { padding:18px 22px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:.95rem;transition:color .2s; }
        .faq-q:hover { color:#f87171; }
        .faq-a { padding:0 22px 18px;font-size:.88rem;color:rgba(255,255,255,.5);line-height:1.7; }
        .faq-arrow { transition:transform .3s;font-size:1.2rem;color:rgba(255,255,255,.3); }
        .faq-item.open .faq-arrow { transform:rotate(45deg);color:#ef4444; }

        /* ── CTA ── */
        .cta-sec { background:linear-gradient(135deg,rgba(239,68,68,.12),rgba(249,115,22,.08));border-top:1px solid rgba(239,68,68,.15); }
        .cta-box { text-align:center; }
        .cta-box h2 { font-size:clamp(1.8rem,3.5vw,2.5rem);font-weight:800;margin-bottom:16px; }
        .cta-box p { color:rgba(255,255,255,.5);margin-bottom:36px;font-size:1.05rem; }

        /* ── FOOTER ── */
        .foot { background:#050505;padding:40px 0;text-align:center;border-top:1px solid rgba(255,255,255,.05); }
        .foot p { color:rgba(255,255,255,.3);font-size:.8rem; }

        /* ── MOBILE ── */
        @media(max-width:900px) {
          .fn-links { display:none; }
          .hero h1 { font-size:2.2rem; }
          .fgrid { grid-template-columns:1fr; }
          .steps { grid-template-columns:1fr 1fr; }
          .stats { grid-template-columns:1fr 1fr; }
          .hero-badges { flex-direction:column;align-items:center; }
          .hero-btns { flex-direction:column;align-items:center; }
          .btn-fire,.btn-ghost { width:100%;max-width:340px;justify-content:center; }
        }
        @media(max-width:600px) {
          .steps { grid-template-columns:1fr; }
          .stats { grid-template-columns:1fr 1fr; }
        }
      `}</style>

      {/* ═══════ NAV ═══════ */}
      <nav className={`fn ${scrolled ? "scrolled" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/firehub-flame.png" alt="" style={{ height: 34, width: 34, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, letterSpacing: -0.5, lineHeight: 1 }}>
              <span style={{ color: "#ef4444" }}>FIRE</span><span style={{ color: "#a1a1aa" }}>HUB</span>
            </div>
            <div style={{ fontSize: ".5rem", color: "rgba(255,255,255,.4)", letterSpacing: 1.5, textTransform: "uppercase" as const, marginTop: 1 }}>
              Sistema para Restaurantes
            </div>
          </div>
        </div>
        <div className="fn-links">
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#comparativo">Comparativo</a>
          <a href="#faq">FAQ</a>
          <a href={TRIAL_URL} className="fn-cta">Testar Grátis</a>
        </div>
      </nav>

      {/* ═══════ HERO ═══════ */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-tag">
            <span className="dot" />
            15 dias grátis · Sem cartão de crédito
          </div>
          <h1>
            <span className="grad">Simples, rápido e completo.</span><br />
            Tudo que o seu restaurante<br />precisa em um só lugar.
          </h1>
          <p className="hero-sub">
            Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro
            e auditoria com IA — pare de perder vendas e comece a crescer.
          </p>
          <div className="hero-btns">
            <a href={TRIAL_URL} className="btn-fire">
              🔥 Testar Grátis por 15 Dias
            </a>
            <a href={WA_URL} className="btn-ghost" target="_blank" rel="noopener">
              💬 Falar com Consultor
            </a>
          </div>
          <p className="hero-note">Sem compromisso. Sem cartão. Cancele quando quiser.</p>
          <div className="hero-badges">
            <div className="hb"><span>📋</span> Delivery</div>
            <div className="hb"><span>🍽️</span> Mesas</div>
            <div className="hb"><span>🏪</span> Balcão</div>
            <div className="hb"><span>🤖</span> IA</div>
            <div className="hb"><span>💬</span> WhatsApp</div>
          </div>
        </div>
      </section>

      {/* ═══════ STATS ═══════ */}
      <section className="sec">
        <div className="ctn">
          <div className="stats">
            <div className="stat"><h3>500+</h3><p>restaurantes ativos</p></div>
            <div className="stat"><h3>2M+</h3><p>pedidos processados</p></div>
            <div className="stat"><h3>99.9%</h3><p>uptime garantido</p></div>
            <div className="stat"><h3>24/7</h3><p>suporte disponível</p></div>
          </div>
        </div>
      </section>

      {/* ═══════ FEATURES ═══════ */}
      <section className="sec" id="funcionalidades">
        <div className="ctn">
          <div className="stitle">
            <h2>Tudo que você precisa numa <span style={{ color: "#ef4444" }}>única solução</span></h2>
            <p>Do cardápio digital à auditoria com inteligência artificial, o FireHub centraliza toda a operação do seu restaurante.</p>
          </div>
          <div className="fgrid">
            {FEATURES.map((f, i) => (
              <div key={i} className="fcard">
                <span className="fcard-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ COMO FUNCIONA ═══════ */}
      <section className="sec" id="como-funciona" style={{ background: "rgba(255,255,255,.02)" }}>
        <div className="ctn">
          <div className="stitle">
            <h2>Comece a vender em <span style={{ color: "#ef4444" }}>4 passos</span></h2>
            <p>Seu restaurante online em minutos, sem burocracia.</p>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={i} className="step">
                <div className="step-num">{s.num}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ COMPARATIVO ═══════ */}
      <section className="sec compare-sec" id="comparativo">
        <div className="ctn">
          <div className="stitle">
            <h2>Por que escolher o <span style={{ color: "#ef4444" }}>FireHub</span>?</h2>
            <p>Compare e descubra por que somos a melhor opção para o seu restaurante.</p>
          </div>
          <div style={{ overflowX: "auto", borderRadius: 16, border: "1px solid rgba(255,255,255,.06)" }}>
            <table className="ctable" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", color: "rgba(255,255,255,.4)" }}>Funcionalidade</th>
                  <th className="fh-head" style={{ textAlign: "center" }}>🔥 FireHub</th>
                  <th style={{ textAlign: "center", color: "rgba(255,255,255,.4)" }}>Concorrentes</th>
                  <th style={{ textAlign: "center", color: "rgba(255,255,255,.4)" }}>Sem sistema</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([feat, fh, conc, sem], i) => (
                  <tr key={i}>
                    <td style={{ color: (feat as string).includes("🏆") ? "#fbbf24" : "rgba(255,255,255,.7)", fontWeight: (feat as string).includes("🏆") ? 600 : 400 }}>{feat as string}</td>
                    <td className="fh-col" style={{ textAlign: "center", fontSize: "1.1rem" }}>
                      {fh === true ? "✅" : fh === false ? "❌" : <span style={{ color: "#f59e0b", fontSize: ".75rem", fontWeight: 700 }}>EM BREVE</span>}
                    </td>
                    <td style={{ textAlign: "center", fontSize: "1.1rem" }}>{conc === true ? "✅" : "❌"}</td>
                    <td style={{ textAlign: "center", fontSize: "1.1rem" }}>{sem === true ? "✅" : "❌"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign: "center", color: "rgba(255,255,255,.3)", fontSize: ".82rem", marginTop: 16 }}>
            🏆 Funcionalidades exclusivas que nenhum concorrente oferece
          </p>
        </div>
      </section>

      {/* ═══════ FAQ ═══════ */}
      <section className="sec" id="faq">
        <div className="ctn">
          <div className="stitle">
            <h2>Perguntas frequentes</h2>
          </div>
          <div className="faq">
            {FAQ.map((f, i) => (
              <div key={i} className={`faq-item ${openFaq === i ? "open" : ""}`}>
                <div className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {f.q}
                  <span className="faq-arrow">+</span>
                </div>
                {openFaq === i && <div className="faq-a">{f.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ CTA FINAL ═══════ */}
      <section className="sec cta-sec">
        <div className="ctn">
          <div className="cta-box">
            <h2>Pronto para <span style={{ color: "#ef4444" }}>vender mais</span>?</h2>
            <p>Comece agora mesmo com 15 dias grátis. Sem cartão, sem compromisso.</p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <a href={TRIAL_URL} className="btn-fire" style={{ fontSize: "1.1rem", padding: "18px 44px" }}>
                🔥 Começar Teste Grátis
              </a>
              <a href={WA_URL} className="btn-ghost" target="_blank" rel="noopener" style={{ fontSize: "1.1rem", padding: "18px 44px" }}>
                💬 Falar no WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="foot">
        <div className="ctn">
          <p style={{ marginBottom: 8, fontSize: "1.1rem" }}>
            <span style={{ color: "#ef4444", fontWeight: 900 }}>FIRE</span>
            <span style={{ color: "#71717a", fontWeight: 900 }}>HUB</span>
            <span style={{ fontSize: ".7rem", marginLeft: 8, color: "rgba(255,255,255,.25)" }}>Simples, rápido e completo.</span>
          </p>
          <p>© {new Date().getFullYear()} FireHub Food Technology. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
