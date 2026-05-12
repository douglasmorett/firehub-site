"use client";
import { useState, useEffect } from "react";

const FEATURES = [
  { icon: "📋", title: "Cardápio Digital", desc: "Delivery, mesa e balcão num só lugar. Sem app — direto no celular do cliente." },
  { icon: "🤖", title: "Chatbot WhatsApp", desc: "IA atende seus clientes 24h automaticamente. Zero pedido perdido." },
  { icon: "📊", title: "Gestão Completa", desc: "Caixa, estoque, financeiro e relatórios em tempo real na palma da mão." },
  { icon: "🛵", title: "Controle de Entregas", desc: "Rastreie entregadores, otimize rotas e acompanhe o status em tempo real." },
  { icon: "🔥", title: "Auditoria com IA", desc: "Checklist com foto, ponto com geolocalização e ranking de equipe." },
  { icon: "💬", title: "Disparo em Massa", desc: "Envie promoções para toda sua base de clientes via WhatsApp." },
];

const STEPS = [
  { num: "01", title: "Cadastre-se grátis", desc: "Menos de 2 minutos. Seu cardápio já fica no ar na hora." },
  { num: "02", title: "Personalize tudo", desc: "Logo, banner, produtos, preços, taxas de entrega e pagamentos." },
  { num: "03", title: "Receba pedidos", desc: "Pelo cardápio digital, WhatsApp, mesas ou balcão — centralizado." },
  { num: "04", title: "Gerencie e cresça", desc: "Relatórios e IA para você tomar decisões e vender mais." },
];

const FAQ = [
  { q: "Como funciona o teste grátis?", a: "15 dias completos sem cobrar nada. Sem cartão de crédito. Depois, planos a partir de R$ 99/mês sem taxa por pedido." },
  { q: "Precisa instalar algum aplicativo?", a: "Não! O FireHub funciona 100% no navegador. Celular, tablet ou computador, em qualquer lugar." },
  { q: "Como é o suporte?", a: "Humano, via WhatsApp, 7 dias por semana — manhã, tarde e noite. Você nunca fica sem resposta." },
  { q: "Posso imprimir comandas e boletos?", a: "Sim! Impressão de comandas de delivery, cozinha e mesas em uma ou mais impressoras." },
  { q: "Integra com iFood?", a: "Sim! Receba pedidos do iFood direto no painel, junto com cardápio digital e WhatsApp." },
  { q: "O que é o FireCheck?", a: "Módulo de auditoria operacional: checklist com fotos, ponto eletrônico e controle financeiro inteligente." },
];

const COMPARE = [
  ["Cardápio digital sem taxa", true, true, false],
  ["Delivery, Mesas e Balcão", true, true, false],
  ["Chatbot WhatsApp com IA", true, true, false],
  ["Auditoria operacional com IA 🏆", true, false, false],
  ["Controle financeiro completo 🏆", true, false, false],
  ["FireCheck incluso 🏆", true, false, false],
  ["Leitura de notas por IA 🏆", true, false, false],
  ["Estoque automático", "soon", true, false],
  ["CMV automático", "soon", true, false],
  ["Integração iFood / Rappi", "soon", true, false],
];

const WA = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20testar%20o%20FireHub%20gr%C3%A1tis%20por%2015%20dias";
const TRIAL = "https://portalhakim.com.br/login";

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#fff", color: "#111827" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        html { scroll-behavior: smooth; }

        /* NAV */
        .nav { position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 40px;display:flex;justify-content:space-between;align-items:center;transition:all .35s; }
        .nav.s { background:#fff;box-shadow:0 1px 20px rgba(0,0,0,.08); }
        .nav-logo { display:flex;align-items:center;gap:10px; }
        .nav-logo-text { font-size:1.45rem;font-weight:900;letter-spacing:-.5px;line-height:1; }
        .nav-logo-text span:first-child { color:#EF4444; }
        .nav-logo-text span:last-child { color:#374151; }
        .nav-sub { font-size:.48rem;color:#9CA3AF;letter-spacing:1.5px;text-transform:uppercase;margin-top:1px; }
        .nav-links { display:flex;gap:28px;align-items:center; }
        .nav-links a { color:#6B7280;text-decoration:none;font-size:.88rem;font-weight:500;transition:color .2s; }
        .nav-links a:hover { color:#EF4444; }
        .nav-btn { background:#EF4444 !important;color:#fff !important;padding:10px 24px;border-radius:10px;font-weight:700 !important;font-size:.88rem;box-shadow:0 4px 14px rgba(239,68,68,.25);transition:all .3s !important; }
        .nav-mob-cta { display:none; }
        .nav-btn:hover { background:#DC2626 !important;transform:translateY(-1px);box-shadow:0 6px 20px rgba(239,68,68,.35) !important; }

        /* HERO */
        .hero { padding:140px 40px 100px;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center; }
        .hero-tag { display:inline-flex;align-items:center;gap:8px;padding:7px 16px;background:#FEF2F2;border-radius:50px;color:#EF4444;font-size:.78rem;font-weight:700;margin-bottom:24px;border:1px solid #FEE2E2; }
        .hero-tag .dot { width:7px;height:7px;border-radius:50%;background:#EF4444;animation:blink 1.8s infinite; }
        @keyframes blink { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)} }
        .hero h1 { font-size:clamp(2.2rem,4vw,3.4rem);font-weight:900;line-height:1.1;letter-spacing:-1.2px;margin-bottom:20px;color:#111827; }
        .hero h1 em { font-style:normal;color:#EF4444; }
        .hero-sub { font-size:1.1rem;color:#6B7280;line-height:1.7;margin-bottom:36px;max-width:500px; }
        .hero-ctas { display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px; }
        .btn-main { display:inline-flex;align-items:center;gap:8px;padding:15px 32px;background:#EF4444;color:#fff;border-radius:12px;font-weight:800;font-size:1rem;text-decoration:none;transition:all .3s;box-shadow:0 6px 24px rgba(239,68,68,.28);border:none;cursor:pointer;font-family:inherit; }
        .btn-main:hover { background:#DC2626;transform:translateY(-2px);box-shadow:0 10px 32px rgba(239,68,68,.38); }
        .btn-sec { display:inline-flex;align-items:center;gap:8px;padding:15px 32px;background:#fff;color:#374151;border-radius:12px;font-weight:700;font-size:1rem;text-decoration:none;transition:all .3s;border:1.5px solid #E5E7EB;cursor:pointer;font-family:inherit; }
        .btn-sec:hover { border-color:#EF4444;color:#EF4444;transform:translateY(-1px); }
        .hero-note { font-size:.8rem;color:#9CA3AF; }
        .hero-img { width:100%;border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.12);border:1px solid #F3F4F6; }
        .hero-badges { display:flex;flex-wrap:wrap;gap:10px;margin-top:28px; }
        .badge { display:flex;align-items:center;gap:7px;padding:8px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;font-size:.82rem;color:#6B7280;font-weight:500; }

        /* CONTAINER */
        .w { max-width:1200px;margin:0 auto;padding:0 40px; }
        .sec { padding:100px 0; }
        .sec-alt { background:#F9FAFB; }

        /* STATS */
        .stats { display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#E5E7EB;border-radius:16px;overflow:hidden;margin:60px 0; }
        .stat { background:#fff;padding:36px 24px;text-align:center; }
        .stat h3 { font-size:2.4rem;font-weight:900;color:#EF4444;margin-bottom:4px; }
        .stat p { font-size:.85rem;color:#9CA3AF; }

        /* TITLE */
        .t { text-align:center;margin-bottom:64px; }
        .t h2 { font-size:clamp(1.8rem,3vw,2.4rem);font-weight:800;letter-spacing:-.5px;margin-bottom:14px; }
        .t p { color:#6B7280;font-size:1.05rem;max-width:580px;margin:0 auto;line-height:1.6; }

        /* FEATURES */
        .fg { display:grid;grid-template-columns:repeat(3,1fr);gap:22px; }
        .fc { background:#fff;border:1px solid #E5E7EB;border-radius:18px;padding:32px;transition:all .35s;position:relative;overflow:hidden; }
        .fc::after { content:'';position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#EF4444,#F97316);transform:scaleX(0);transition:transform .35s;transform-origin:left; }
        .fc:hover { box-shadow:0 16px 48px rgba(0,0,0,.08);transform:translateY(-4px);border-color:#FECACA; }
        .fc:hover::after { transform:scaleX(1); }
        .fc-icon { font-size:2rem;margin-bottom:18px; }
        .fc h3 { font-size:1.05rem;font-weight:700;margin-bottom:10px;color:#111827; }
        .fc p { font-size:.87rem;color:#6B7280;line-height:1.6; }

        /* STEPS */
        .sg { display:grid;grid-template-columns:repeat(4,1fr);gap:40px;position:relative; }
        .sg::before { content:'';position:absolute;top:28px;left:14%;right:14%;height:2px;background:linear-gradient(90deg,#EF4444,#F97316,#EF4444);opacity:.2; }
        .st { text-align:center; }
        .st-n { width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;font-size:1rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;box-shadow:0 8px 20px rgba(239,68,68,.25); }
        .st h3 { font-size:1rem;font-weight:700;margin-bottom:8px; }
        .st p { font-size:.82rem;color:#6B7280;line-height:1.6; }

        /* COMPARE */
        .ct { width:100%;border-collapse:collapse;font-size:.9rem; }
        .ct th { padding:16px 20px;font-weight:600;background:#F9FAFB;border-bottom:2px solid #E5E7EB; }
        .ct td { padding:14px 20px;border-bottom:1px solid #F3F4F6; }
        .ct .fhc { background:#FFF5F5; }
        .ct .fhh { background:#FEF2F2;color:#EF4444;font-weight:800; }
        .ct tr:hover td { background:#FAFAFA; }
        .ct tr:hover .fhc { background:#FFF0F0; }

        /* FAQ */
        .fq { max-width:700px;margin:0 auto; }
        .fq-i { border:1.5px solid #E5E7EB;border-radius:14px;margin-bottom:10px;overflow:hidden;transition:all .3s; }
        .fq-i.o { border-color:#FECACA;box-shadow:0 4px 20px rgba(239,68,68,.06); }
        .fq-q { padding:18px 22px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:.95rem;color:#111827;transition:color .2s; }
        .fq-i.o .fq-q { color:#EF4444; }
        .fq-a { padding:0 22px 18px;font-size:.87rem;color:#6B7280;line-height:1.7; }
        .fq-arr { width:24px;height:24px;border-radius:50%;background:#F3F4F6;display:flex;align-items:center;justify-content:center;font-size:.8rem;transition:all .3s;flex-shrink:0; }
        .fq-i.o .fq-arr { background:#FEE2E2;color:#EF4444;transform:rotate(45deg); }

        /* CTA FINAL */
        .cta-sec { background:linear-gradient(135deg,#EF4444 0%,#DC2626 50%,#B91C1C 100%);padding:100px 0; }
        .cta-box { text-align:center;color:#fff; }
        .cta-box h2 { font-size:clamp(1.8rem,3vw,2.6rem);font-weight:900;margin-bottom:14px;letter-spacing:-.5px; }
        .cta-box p { color:rgba(255,255,255,.8);margin-bottom:36px;font-size:1.05rem; }
        .btn-white { display:inline-flex;align-items:center;gap:8px;padding:16px 40px;background:#fff;color:#EF4444;border-radius:12px;font-weight:800;font-size:1.05rem;text-decoration:none;transition:all .3s;border:none;cursor:pointer;font-family:inherit;box-shadow:0 8px 30px rgba(0,0,0,.15); }
        .btn-white:hover { transform:translateY(-3px);box-shadow:0 14px 40px rgba(0,0,0,.2); }
        .btn-white-ghost { display:inline-flex;align-items:center;gap:8px;padding:16px 40px;background:rgba(255,255,255,.1);color:#fff;border-radius:12px;font-weight:700;font-size:1.05rem;text-decoration:none;transition:all .3s;border:1.5px solid rgba(255,255,255,.25); }
        .btn-white-ghost:hover { background:rgba(255,255,255,.18);transform:translateY(-2px); }

        /* FOOTER */
        .foot { background:#111827;padding:48px 40px;text-align:center; }
        .foot-logo { font-size:1.3rem;font-weight:900;margin-bottom:10px; }
        .foot-logo span:first-child { color:#EF4444; }
        .foot-logo span:last-child { color:#6B7280; }
        .foot p { color:#4B5563;font-size:.82rem; }

        /* RESPONSIVE - TABLET */
        @media(max-width:960px) {
          .nav { padding:14px 20px; }
          .nav-links { display:none; }
          .nav-mob-cta { display:inline-flex !important;padding:8px 16px;font-size:.8rem; }
          .hero { grid-template-columns:1fr;gap:36px;padding:110px 20px 72px;text-align:center; }
          .hero-sub { max-width:100%; }
          .hero-ctas { justify-content:center; }
          .hero-badges { justify-content:center; }
          .fg { grid-template-columns:1fr 1fr; }
          .sg { grid-template-columns:1fr 1fr;gap:28px; }
          .sg::before { display:none; }
          .stats { grid-template-columns:1fr 1fr;gap:1px; }
          .w { padding:0 20px; }
          .sec { padding:72px 0; }
          .cta-sec { padding:72px 0; }
          .t { margin-bottom:44px; }
          .foot { padding:40px 20px; }
        }
        /* RESPONSIVE - MOBILE */
        @media(max-width:600px) {
          .nav { padding:12px 16px; }
          .hero { padding:100px 16px 60px;gap:28px; }
          .hero h1 { font-size:2rem;letter-spacing:-.5px; }
          .hero-sub { font-size:.95rem; }
          .hero-ctas { flex-direction:column;align-items:stretch;gap:12px; }
          .btn-main, .btn-sec { width:100%;justify-content:center;padding:14px 20px;font-size:.95rem; }
          .hero-badges { gap:8px; }
          .badge { font-size:.76rem;padding:6px 12px; }
          .fg { grid-template-columns:1fr;gap:14px; }
          .fc { padding:24px 20px; }
          .sg { grid-template-columns:1fr;gap:24px; }
          .stats { grid-template-columns:1fr 1fr;gap:1px; }
          .stat { padding:24px 16px; }
          .stat h3 { font-size:1.9rem; }
          .sec { padding:56px 0; }
          .w { padding:0 16px; }
          .t { margin-bottom:36px; }
          .t h2 { font-size:1.6rem; }
          .t p { font-size:.9rem; }
          .fq-q { font-size:.88rem;padding:16px 18px; }
          .fq-a { padding:0 18px 16px;font-size:.84rem; }
          .cta-sec { padding:60px 0; }
          .cta-box h2 { font-size:1.7rem; }
          .cta-box p { font-size:.9rem;margin-bottom:28px; }
          .cta-btns { flex-direction:column;align-items:stretch;gap:12px; }
          .btn-white, .btn-white-ghost { width:100%;justify-content:center;padding:15px 20px;font-size:.95rem; }
          .foot { padding:32px 16px; }
          .foot-logo { font-size:1.1rem; }
          .foot p { font-size:.76rem; }
          .ct th, .ct td { padding:11px 12px;font-size:.78rem; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav className={`nav ${scrolled ? "s" : ""}`}>
        <div className="nav-logo">
          <img src="/firehub-flame.png" alt="FireHub" style={{ height: 38, width: 38, objectFit: "contain" }} />
          <div>
            <div className="nav-logo-text">
              <span>FIRE</span><span>HUB</span>
            </div>
            <div className="nav-sub">Sistema para restaurantes</div>
          </div>
        </div>
        {/* Botão visível só no mobile via CSS */}
        <a href={TRIAL} className="nav-btn nav-mob-cta">Testar Grátis</a>
        <div className="nav-links">
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#comparativo">Comparativo</a>
          <a href="#faq">FAQ</a>
          <a href={TRIAL} className="nav-btn">Testar Grátis →</a>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section>
        <div className="hero">
          <div>
            <div className="hero-tag">
              <span className="dot" />
              15 dias grátis · Sem cartão de crédito
            </div>
            <h1>
              Simples, rápido e<br />
              <em>completo.</em> Tudo que o seu<br />
              restaurante precisa em<br />
              um só lugar.
            </h1>
            <p className="hero-sub">
              Cardápio digital, gestão de pedidos, chatbot WhatsApp,
              controle financeiro e auditoria com IA — pare de perder
              vendas e comece a crescer.
            </p>
            <div className="hero-ctas">
              <a href={TRIAL} className="btn-main">🔥 Testar Grátis por 15 Dias</a>
              <a href={WA} target="_blank" rel="noopener" className="btn-sec">💬 Falar com consultor</a>
            </div>
            <p className="hero-note">✓ Sem compromisso &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
            <div className="hero-badges">
              <div className="badge"><span>📋</span> Delivery</div>
              <div className="badge"><span>🍽️</span> Mesas</div>
              <div className="badge"><span>🏪</span> Balcão</div>
              <div className="badge"><span>🤖</span> IA</div>
              <div className="badge"><span>💬</span> WhatsApp</div>
            </div>
          </div>
          <div>
            <img src="/firehub-mockup.png" alt="FireHub Dashboard" className="hero-img" />
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <div className="w">
        <div className="stats">
          <div className="stat"><h3>500+</h3><p>Restaurantes ativos</p></div>
          <div className="stat"><h3>2M+</h3><p>Pedidos processados</p></div>
          <div className="stat"><h3>99.9%</h3><p>Uptime garantido</p></div>
          <div className="stat"><h3>24/7</h3><p>Suporte disponível</p></div>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <section className="sec" id="funcionalidades">
        <div className="w">
          <div className="t">
            <h2>Tudo que seu negócio precisa numa <span style={{ color: "#EF4444" }}>única solução</span></h2>
            <p>Do cardápio digital à auditoria com inteligência artificial — o FireHub centraliza toda a operação do seu restaurante.</p>
          </div>
          <div className="fg">
            {FEATURES.map((f, i) => (
              <div key={i} className="fc">
                <div className="fc-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMO FUNCIONA ── */}
      <section className="sec sec-alt" id="como-funciona">
        <div className="w">
          <div className="t">
            <h2>Comece a vender em <span style={{ color: "#EF4444" }}>4 passos simples</span></h2>
            <p>Seu restaurante online em minutos, sem burocracia.</p>
          </div>
          <div className="sg">
            {STEPS.map((s, i) => (
              <div key={i} className="st">
                <div className="st-n">{s.num}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARATIVO ── */}
      <section className="sec" id="comparativo">
        <div className="w">
          <div className="t">
            <h2>Por que escolher o <span style={{ color: "#EF4444" }}>FireHub</span>?</h2>
            <p>Compare e veja por que somos a melhor opção para o seu restaurante.</p>
          </div>
          <div style={{ overflowX: "auto", borderRadius: 16, border: "1px solid #E5E7EB", boxShadow: "0 4px 24px rgba(0,0,0,.05)" }}>
            <table className="ct" style={{ minWidth: 580 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", color: "#6B7280" }}>Funcionalidade</th>
                  <th className="fhh" style={{ textAlign: "center" }}>🔥 FireHub</th>
                  <th style={{ textAlign: "center", color: "#6B7280", fontWeight: 600 }}>Concorrentes</th>
                  <th style={{ textAlign: "center", color: "#6B7280", fontWeight: 600 }}>Sem sistema</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([feat, fh, conc, sem], i) => (
                  <tr key={i}>
                    <td style={{ color: (feat as string).includes("🏆") ? "#D97706" : "#374151", fontWeight: (feat as string).includes("🏆") ? 600 : 400 }}>{feat as string}</td>
                    <td className="fhc" style={{ textAlign: "center" }}>
                      {fh === true ? <span style={{ color: "#16A34A", fontSize: "1.1rem" }}>✅</span> : fh === false ? <span style={{ color: "#EF4444" }}>❌</span> : <span style={{ color: "#D97706", fontSize: ".75rem", fontWeight: 700, background: "#FEF3C7", padding: "2px 8px", borderRadius: 6 }}>EM BREVE</span>}
                    </td>
                    <td style={{ textAlign: "center" }}>{conc === true ? <span style={{ color: "#16A34A", fontSize: "1.1rem" }}>✅</span> : <span style={{ color: "#EF4444" }}>❌</span>}</td>
                    <td style={{ textAlign: "center" }}>{sem === true ? <span style={{ color: "#16A34A", fontSize: "1.1rem" }}>✅</span> : <span style={{ color: "#EF4444" }}>❌</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign: "center", color: "#9CA3AF", fontSize: ".82rem", marginTop: 14 }}>
            🏆 Funcionalidades exclusivas que nenhum concorrente oferece
          </p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="sec sec-alt" id="faq">
        <div className="w">
          <div className="t"><h2>Perguntas frequentes</h2></div>
          <div className="fq">
            {FAQ.map((f, i) => (
              <div key={i} className={`fq-i ${openFaq === i ? "o" : ""}`}>
                <div className="fq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {f.q}
                  <span className="fq-arr">+</span>
                </div>
                {openFaq === i && <div className="fq-a">{f.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="cta-sec">
        <div className="w">
          <div className="cta-box">
            <h2>Pronto para vender mais?</h2>
            <p>Comece agora com 15 dias grátis. Sem cartão, sem compromisso.</p>
            <div className="cta-btns" style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <a href={TRIAL} className="btn-white">🔥 Começar Teste Grátis</a>
              <a href={WA} target="_blank" rel="noopener" className="btn-white-ghost">💬 Falar no WhatsApp</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="foot">
        <div className="foot-logo">
          <span>FIRE</span><span>HUB</span>
        </div>
        <p style={{ color: "#6B7280", marginBottom: 8, fontSize: ".9rem" }}>Simples, rápido e completo. Tudo que o seu restaurante precisa em um só lugar.</p>
        <p>© {new Date().getFullYear()} FireHub Food Technology. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}
