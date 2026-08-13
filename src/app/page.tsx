"use client";
import { useState, useEffect } from "react";

const WA = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20testar%20o%20FireHub%20gr%C3%A1tis%20por%2015%20dias";
const TRIAL = "/cadastro";
const LOGIN = "https://firehubfood.com.br/login";

const SOLUTIONS = [
  {
    icon: "⚡", title: "Venda no automático", desc: "Automatize cada venda com inteligência artificial",
    items: [
      { t: "Cardápio Digital Inteligente", d: "Delivery, mesa e balcão sem app" },
      { t: "Chatbot WhatsApp com IA", d: "Atendimento 24h sem perder pedido" },
      { t: "Gestão de Pedidos", d: "Tudo centralizado em tempo real" },
      { t: "Pagamento Online", d: "Cartão de crédito e Pix integrados" },
    ]
  },
  {
    icon: "❤️", title: "Fidelize e multiplique", desc: "Transforme clientes ocasionais em fãs da sua marca",
    items: [
      { t: "Disparos em Massa", d: "WhatsApp marketing automatizado" },
      { t: "Recuperação de Clientes", d: "Reconquiste inativos com IA" },
      { t: "Programa de Fidelidade", d: "Cashback e benefícios exclusivos" },
      { t: "Cupons Estratégicos", d: "Aumente conversão com descontos" },
    ]
  },
  {
    icon: "📊", title: "Analise cada detalhe", desc: "Dados em tempo real para decisões inteligentes",
    items: [
      { t: "Relatórios Completos", d: "Vendas, produtos e financeiro" },
      { t: "Auditoria com IA", d: "Checklist, fotos e ranking de equipe" },
      { t: "Leitura de Notas por IA", d: "Tire foto e a IA extrai os dados" },
      { t: "Controle de Entregas", d: "Motoboys e rotas em tempo real" },
    ]
  }
];

const STEPS = [
  { n: "01", t: "Cadastre-se grátis", d: "Menos de 2 min. Cardápio no ar na hora." },
  { n: "02", t: "Personalize tudo", d: "Logo, banner, produtos, preços e pagamentos." },
  { n: "03", t: "Receba pedidos", d: "Cardápio, WhatsApp, mesas ou balcão." },
  { n: "04", t: "Gerencie e cresça", d: "Relatórios e IA para vender mais." },
];

const COMPARE = [
  ["Cardápio digital sem taxa", true, true, false],
  ["Delivery, Mesas e Balcão", true, true, false],
  ["Chatbot WhatsApp com IA", true, true, false],
  ["Auditoria operacional com IA 🏆", true, false, false],
  ["Controle financeiro completo 🏆", true, false, false],
  ["Checklist auditado por IA 🏆", true, false, false],
  ["Leitura de notas por IA 🏆", true, false, false],
  ["Estoque automático 🏆", true, false, false],
  ["CMV automático 🏆", true, false, false],
  ["Integração iFood / 99Food", true, true, false],
];

// Preço = 1% do faturamento, mín R$50, máx R$400
const calcPrice = (rev: number) => rev === 0 ? 0 : Math.max(50, Math.min(400, rev * 0.01));

const FAQ = [
  { q: "Como funciona o teste grátis?", a: "15 dias completos sem cobrar nada. Sem cartão de crédito. Sem compromisso. Você tem acesso a todas as funcionalidades durante o período de teste." },
  { q: "E se eu não usar a plataforma?", a: "Se você não processar nenhuma venda pelo FireHub no mês, você não paga nada. Nosso modelo é justo: você só paga quando vende." },
  { q: "Como funciona a cobrança?", a: "Cobramos apenas 1% do seu faturamento no canal próprio (cardápio digital + WhatsApp). Mínimo de R$ 50 e máximo de R$ 400 por mês. Sem taxa por pedido, sem surpresas." },
  { q: "Precisa instalar algum aplicativo?", a: "Não! O FireHub funciona 100% no navegador. Celular, tablet ou computador — em qualquer lugar, a qualquer momento." },
  { q: "Como é o suporte?", a: "Humano, via WhatsApp, 7 dias por semana — manhã, tarde e noite. Você nunca fica sem resposta." },
  { q: "Integra com iFood?", a: "Sim! Receba pedidos do iFood direto no painel, junto com cardápio digital e WhatsApp." },
  { q: "Existe multa para cancelar?", a: "Absolutamente não. Você cancela quando quiser, sem burocracia, sem multa, sem surpresas." },
];

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [sliderValue, setSliderValue] = useState(3000);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const calculatedPrice = calcPrice(sliderValue);

  const Check = () => <span style={{color:"#16A34A",fontSize:"1.1rem"}}>✅</span>;
  const Cross = () => <span style={{color:"#EF4444"}}>❌</span>;

  const formatCurrency = (v: number) => v >= 1000 ? `R$ ${(v/1000).toFixed(v%1000===0?0:1)}k` : `R$ ${v}`;

  return (
    <div>
      {/* NAV */}
      <nav className={`nav ${scrolled ? "scrolled" : ""}`}>
        <a href="/" className="nav-logo">
          <img src="/firehub-flame.png" alt="FireHub" />
          <div>
            <div className="nav-logo-text"><span className="fire">FIRE</span><span className="hub">HUB</span></div>
            <div className="nav-sub">Sistema para restaurantes</div>
          </div>
        </a>
        <a href={LOGIN} className="btn-cta nav-mobile-cta">Acessar</a>
        <div className="nav-links">
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#comparativo">Comparativo</a>
          <a href="#faq">FAQ</a>
          <a href="/indique-ganhe" style={{
            color: "#EF4444", 
            fontWeight: 700, 
            border: "2px solid #EF4444", 
            padding: "8px 16px", 
            borderRadius: "50px", 
            background: "rgba(239, 68, 68, 0.08)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s"
          }}>🤝 Indique e Ganhe</a>
          <a href={LOGIN} className="btn-cta">🔑 Acessar</a>
        </div>
      </nav>

      {/* HERO — sem imagem, texto centralizado */}
      <section>
        <div className="hero" style={{gridTemplateColumns:"1fr",textAlign:"center",maxWidth:800}}>
          <div>
            <div className="hero-tag" style={{margin:"0 auto 22px"}}><span className="pulse" />15 dias grátis · Sem cartão de crédito</div>
            <h1>Simples, rápido e<br /><em>completo.</em> Tudo que o seu<br />restaurante precisa.</h1>
            <p className="hero-p" style={{maxWidth:560,margin:"0 auto 32px"}}>Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro e auditoria com IA — pare de perder vendas e comece a crescer.</p>
            <div className="hero-btns" style={{justifyContent:"center"}}>
              <a href={TRIAL} className="btn-primary btn-pulse" style={{padding:"18px 48px",fontSize:"1.15rem"}}>🔥 Testar Grátis por 15 Dias</a>
            </div>
            <p className="hero-note" style={{marginTop:16}}>✓ Sem compromisso &nbsp;·&nbsp; ✓ Sem multa &nbsp;·&nbsp; ✓ Migração fácil</p>
            <div className="hero-badges" style={{justifyContent:"center",marginTop:24}}>
              <div className="badge"><span>📋</span> Delivery</div>
              <div className="badge"><span>🍽️</span> Mesas</div>
              <div className="badge"><span>🏪</span> Balcão</div>
              <div className="badge"><span>🤖</span> IA</div>
              <div className="badge"><span>💬</span> WhatsApp</div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <div className="w">
        <div className="stats">
          <div className="stat"><h3>500+</h3><p>Restaurantes ativos</p></div>
          <div className="stat"><h3>2M+</h3><p>Pedidos processados</p></div>
          <div className="stat"><h3>99.9%</h3><p>Uptime garantido</p></div>
          <div className="stat"><h3>24/7</h3><p>Suporte disponível</p></div>
        </div>
      </div>

      {/* FUNCIONALIDADES */}
      <section className="sec" id="funcionalidades">
        <div className="w">
          <div className="sec-title">
            <h2>Todas as funcionalidades <em>incluídas</em></h2>
            <p>Tenha acesso a todas as funcionalidades do nosso sistema independente do seu faturamento.</p>
          </div>
          <div className="solutions">
            {SOLUTIONS.map((sol, i) => (
              <div key={i} className="sol-card">
                <div className="sol-icon">{sol.icon}</div>
                <h3>{sol.title}</h3>
                <p>{sol.desc}</p>
                {sol.items.map((item, j) => (
                  <div key={j} className="sol-item">
                    <div className="sol-check">✓</div>
                    <div><h4>{item.t}</h4><span>{item.d}</span></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SEÇÃO INOVAÇÃO EXCLUSIVA: AUTO-ETA IFOOD & SITE */}
      <section className="sec" style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#FFF", padding: "5rem 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -100, right: -100, width: 400, height: 400, background: "radial-gradient(circle, rgba(232,54,12,0.25) 0%, rgba(0,0,0,0) 70%)", borderRadius: "50%", pointerEvents: "none" }} />
        <div className="w">
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "3rem", alignItems: "center" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(232,54,12,0.2)", border: "1px solid rgba(232,54,12,0.5)", color: "#FF5722", fontSize: "0.82rem", fontWeight: 900, padding: "6px 16px", borderRadius: 20, marginBottom: 16 }}>
                ⚡ INOVAÇÃO EXCLUSIVA FIREHUB
              </div>
              <h2 style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1.15, color: "#FFF", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
                Automação Inteligente do Tempo de Entrega no <span style={{ color: "#EA1D2C" }}>iFood</span> & Site
              </h2>
              <p style={{ fontSize: "1.05rem", color: "#94A3B8", lineHeight: 1.6, margin: "0 0 24px" }}>
                Chega de ter que parar o atendimento para ficar ajustando o iFood manualmente no meio da correria. O FireHub é a <strong style={{ color: "#FFF" }}>primeira tecnologia do Brasil</strong> que lê a carga real do seu KDS e a quantidade de motoboys na casa para atualizar os prazos no iFood e no seu site próprio 100% no automático!
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: 28 }}>
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>🤖 100% Silencioso</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Atualiza os prazos nos bastidores sem fechar a tela do caixa</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>🛡️ Trava de Estouro</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Pausa a loja por 40 min se estourar a capacidade da cozinha</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>🛵 Cálculo por Motoboy</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Ajusta os prazos conforme a quantidade de motoboys ativos</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>⭐ Zero Avaliações 1 Estrela</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Elimine reclamações de atrasos e cancelamentos de pedidos</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem" }}>
                  🔥 Testar Tecnologia Exclusiva Grátis
                </a>
                <span style={{ fontSize: "0.85rem", color: "#94A3B8" }}>
                  Incluída sem custo adicional em todos os planos FireHub!
                </span>
              </div>
            </div>

            <div style={{ borderRadius: 24, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 20px 40px rgba(0,0,0,0.5)", background: "#000" }}>
              <img
                src="/images/ifood_eta_banner.jpg"
                alt="FireHub Auto-ETA iFood Automation"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO CHATBOT HUMANIZADO */}
      <section className="sec" style={{ background: "linear-gradient(135deg, #F8FAFC 0%, #E2E8F0 100%)", padding: "5rem 0", position: "relative", overflow: "hidden" }}>
        <div className="w">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "4rem", alignItems: "center" }} className="responsive-grid">
            <style>{`
              @media (min-width: 900px) {
                .responsive-grid { grid-template-columns: 0.9fr 1.1fr !important; }
                .responsive-grid > div:first-child { order: 2; }
                .responsive-grid > div:last-child { order: 1; }
              }
            `}</style>
            <div style={{ borderRadius: 24, overflow: "hidden", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 20px 40px rgba(0,0,0,0.1)", background: "#FFF" }}>
              <img
                src="/images/chatbot_ui.jpg"
                alt="FireHub Chatbot Humanizado"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
            
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(37,211,102,0.15)", border: "1px solid rgba(37,211,102,0.4)", color: "#16A34A", fontSize: "0.82rem", fontWeight: 900, padding: "6px 16px", borderRadius: 20, marginBottom: 16 }}>
                💬 CHATBOT WHATSAPP HUMANIZADO
              </div>
              <h2 style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1.15, color: "#0F172A", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
                Chega de robôs que irritam o seu cliente
              </h2>
              <p style={{ fontSize: "1.05rem", color: "#475569", lineHeight: 1.6, margin: "0 0 24px" }}>
                O robô de atendimento do FireHub é diferente de tudo o que você já viu. Ele <strong style={{ color: "#0F172A" }}>escuta áudios</strong> e entende naturalmente o que o cliente quer, montando o pedido direto na conversa sem forçar seu cliente a sair do WhatsApp para abrir links confusos.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: 28 }} className="features-grid">
                <style>{`
                  @media (max-width: 600px) {
                    .features-grid { grid-template-columns: 1fr !important; }
                  }
                `}</style>
                <div style={{ background: "#FFF", border: "1px solid rgba(0,0,0,0.05)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>🎙️ Entende Áudios</div>
                  <div style={{ fontSize: "0.82rem", color: "#64748B" }}>Compreende perfeitamente pedidos e instruções enviadas por voz</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(0,0,0,0.05)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>🛍️ Monta Pedidos</div>
                  <div style={{ fontSize: "0.82rem", color: "#64748B" }}>Adiciona itens ao carrinho sem que o cliente abra links do cardápio</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(0,0,0,0.05)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>❤️ Atendimento Empático</div>
                  <div style={{ fontSize: "0.82rem", color: "#64748B" }}>Uma conversa natural, como se fosse o seu melhor atendente humano</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(0,0,0,0.05)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>🚀 Aumenta Vendas</div>
                  <div style={{ fontSize: "0.82rem", color: "#64748B" }}>Zera desistências de quem odeia lidar com sistemas e sites complexos</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO INTEGRAÇÕES */}
      <section className="sec" style={{ background: "#FFFFFF", padding: "4rem 0", borderTop: "1px solid rgba(0,0,0,0.05)" }}>
        <div className="w">
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#0F172A", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
              Integramos com os maiores marketplaces do Brasil
            </h2>
          </div>

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "4rem", flexWrap: "wrap", marginBottom: "3rem", padding: "0 1rem" }}>
            {/* iFood */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src="/images/logos/ifood.png" alt="iFood" style={{ height: "45px", objectFit: "contain" }} />
            </div>
            {/* 99Food */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.9 }}>
              <img src="/images/logos/99.svg" alt="99" style={{ height: "35px", objectFit: "contain" }} />
            </div>
            {/* Jotajá */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src="/images/logos/jotaja.png" alt="Jotajá" style={{ height: "40px", objectFit: "contain" }} />
            </div>
            {/* Facebook */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src="/images/logos/facebook.png" alt="Facebook" style={{ height: "40px", objectFit: "contain" }} />
            </div>
          </div>

          <div style={{ textAlign: "center", background: "#F8FAFC", padding: "20px", borderRadius: "12px", border: "1px solid #E2E8F0", maxWidth: 650, margin: "0 auto" }}>
            <p style={{ margin: 0, fontSize: "1.05rem", color: "#334155" }}>
              <strong>Precisa integrar com algum marketplace que não temos?</strong> <br />
              <a href={WA} target="_blank" rel="noopener noreferrer" style={{ color: "#EF4444", fontWeight: 700, textDecoration: "none", display: "inline-block", marginTop: "8px" }}>
                Fale com nossa equipe aí no nosso WhatsApp!
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* SEÇÃO ROTEIRIZADOR */}
      <section className="sec" style={{ background: "#020617", color: "#FFF", padding: "5rem 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: -100, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(0,0,0,0) 70%)", borderRadius: "50%", pointerEvents: "none" }} />
        <div className="w">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "4rem", alignItems: "center" }} className="responsive-grid-2">
            <style>{`
              @media (min-width: 900px) {
                .responsive-grid-2 { grid-template-columns: 1.1fr 0.9fr !important; }
              }
            `}</style>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.5)", color: "#60A5FA", fontSize: "0.82rem", fontWeight: 900, padding: "6px 16px", borderRadius: 20, marginBottom: 16 }}>
                🗺️ LOGÍSTICA INTELIGENTE
              </div>
              <h2 style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1.15, color: "#FFF", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
                Roteirizador que coloca o seu restaurante em <span style={{ color: "#3B82F6" }}>outro nível</span>
              </h2>
              <p style={{ fontSize: "1.05rem", color: "#94A3B8", lineHeight: 1.6, margin: "0 0 24px" }}>
                Não jogue dinheiro fora com entregas desorganizadas. Nosso sistema de roteirização inteligente permite acompanhar os motoboys e criar rotas perfeitas, garantindo que os pedidos saiam juntos e cheguem na temperatura ideal.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: 28 }} className="features-grid">
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>🗺️ Rotas Otimizadas</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Agrupa pedidos próximos automaticamente para um único motoboy</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>🛵 Controle Total</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Saiba exatamente quem está disponível na loja e quem está na rua</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>⏱️ Previsão Exata</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Reduza atrasos em horários de pico despachando no momento certo</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>💰 Economia de Taxas</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Aproveite melhor sua equipe e evite idas e vindas desnecessárias</div>
                </div>
              </div>
            </div>

            <div style={{ borderRadius: 24, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 20px 40px rgba(0,0,0,0.8)", background: "#000" }}>
              <img
                src="/images/roteirizador_ui.jpg"
                alt="FireHub Roteirizador"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO MÓDULO DE VALIDADE & ETIQUETAS (FIRECHECK) */}
      <section className="sec" style={{ background: "linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)", color: "#431407", padding: "5.5rem 0", position: "relative", overflow: "hidden", borderTop: "1px solid rgba(234,88,12,0.15)" }}>
        <div style={{ position: "absolute", top: -100, right: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(234,88,12,0.15) 0%, rgba(0,0,0,0) 70%)", borderRadius: "50%", pointerEvents: "none" }} />
        <div className="w">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "4rem", alignItems: "center" }} className="responsive-grid-validade">
            <style>{`
              @media (min-width: 900px) {
                .responsive-grid-validade { grid-template-columns: 0.95fr 1.05fr !important; }
              }
            `}</style>

            <div style={{ order: 1 }}>
              <div style={{ borderRadius: 24, overflow: "hidden", border: "1.5px solid rgba(234,88,12,0.25)", boxShadow: "0 25px 50px rgba(234,88,12,0.12)", background: "#FFF" }}>
                <img
                  src="/images/etiquetas_validade_ui.jpg"
                  alt="FireHub Módulo de Validade e Impressão de Etiquetas de Cozinha"
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              </div>
            </div>

            <div style={{ order: 2 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(234,88,12,0.15)", border: "1px solid rgba(234,88,12,0.4)", color: "#C2410C", fontSize: "0.82rem", fontWeight: 900, padding: "6px 16px", borderRadius: 20, marginBottom: 16 }}>
                🏷️ MÓDULO DE VALIDADE & ETIQUETAS INCLUSO
              </div>
              <h2 style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1.15, color: "#431407", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
                Chega de ficar pagando caro por módulo para ter sua <span style={{ color: "#EA580C" }}>impressora de etiquetas e validade</span>
              </h2>
              <p style={{ fontSize: "1.05rem", color: "#7C2D12", lineHeight: 1.6, margin: "0 0 24px" }}>
                Cliente do <strong>FireCheck / FireHub</strong> tem essa funcionalidade por nossa conta, <strong>sem pagar nada a mais por isso!</strong> Cadastre insumos internos da sua cozinha, imprima etiquetas com QR Code, lote e data de manipulação de acordo com a ANVISA e garanta 0% de desperdício sem gastar com licenças abusivas de outros sistemas.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: 28 }} className="validade-features-grid">
                <div style={{ background: "#FFF", border: "1px solid rgba(234,88,12,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(234,88,12,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#431407", margin: "0 0 4px" }}>🏷️ Impressão em 1 Clique</div>
                  <div style={{ fontSize: "0.82rem", color: "#7C2D12" }}>Etiquetas prontas para insumos fracionados, molhos, carnes e massas</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(234,88,12,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(234,88,12,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#431407", margin: "0 0 4px" }}>🛡️ Conformidade ANVISA</div>
                  <div style={{ fontSize: "0.82rem", color: "#7C2D12" }}>Zero risco de autuações da Vigilância Sanitária no seu estabelecimento</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(234,88,12,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(234,88,12,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#431407", margin: "0 0 4px" }}>💰 100% Grátis e Incluso</div>
                  <div style={{ fontSize: "0.82rem", color: "#7C2D12" }}>Sem cobrar mensalidade extra por módulo de etiquetas de validade</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(234,88,12,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(234,88,12,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#431407", margin: "0 0 4px" }}>♻️ Redução de Desperdício</div>
                  <div style={{ fontSize: "0.82rem", color: "#7C2D12" }}>Alerta visual de validade de insumos para evitar descarte de estoque</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO ENGENHARIA DE CARDÁPIO E MÓDULO FISCAL */}
      <section className="sec" style={{ background: "#090D16", color: "#FFF", padding: "5.5rem 0", position: "relative", overflow: "hidden", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ position: "absolute", top: -100, right: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(0,0,0,0) 70%)", borderRadius: "50%", pointerEvents: "none" }} />
        <div className="w">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "4rem", alignItems: "center" }} className="responsive-grid-fiscal">
            <style>{`
              @media (min-width: 900px) {
                .responsive-grid-fiscal { grid-template-columns: 0.95fr 1.05fr !important; }
              }
            `}</style>

            <div style={{ order: 1 }}>
              <div style={{ borderRadius: 24, overflow: "hidden", border: "1px solid rgba(16,185,129,0.3)", boxShadow: "0 25px 50px rgba(0,0,0,0.9), 0 0 30px rgba(16,185,129,0.15)", background: "#000" }}>
                <img
                  src="/images/engenharia_fiscal_ui.jpg"
                  alt="FireHub Engenharia Fiscal e Imposto Reduzido"
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              </div>
            </div>

            <div style={{ order: 2 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#34D399", fontSize: "0.82rem", fontWeight: 900, padding: "6px 16px", borderRadius: 20, marginBottom: 16 }}>
                🧾 ENGENHARIA DE CARDÁPIO & FISCAL INTELIGENTE
              </div>
              <h2 style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1.15, color: "#FFF", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
                A mesma estratégia dos <span style={{ color: "#10B981" }}>gigantes do Fast Food</span> para pagar menos imposto
              </h2>
              <p style={{ fontSize: "1.05rem", color: "#94A3B8", lineHeight: 1.6, margin: "0 0 24px" }}>
                Reduza seus impostos <strong>100% dentro da lei, sem sonegar nada</strong>. Nossa tecnologia exclusiva de engenharia fiscal de cardápio permite que você configure o valor exato de cada item dentro dos seus combos para sair detalhado na nota fiscal, maximizando a isenção de PIS e COFINS Monofásico.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: 28 }} className="fiscal-features-grid">
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>🍔 Decomposição de Combos</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Defina o preço individual de bebidas e acompanhamentos isentos na nota fiscal</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>⚖️ 100% Legal e Auditado</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Aproveite brechas fiscais legítimas utilizadas pelas maiores redes do mundo</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>📉 Redução de PIS / COFINS</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Economize até 35% nos impostos sobre vendas de bebidas e sobremesas</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#FFF", margin: "0 0 4px" }}>⚡ Emissão de NFe Automática</div>
                  <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Emitida direto no fechamento do pedido sem intervenção manual</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO FINANCEIRO INTELIGENTE COM IA */}
      <section className="sec" style={{ background: "linear-gradient(135deg, #FDF2F8 0%, #FCE7F3 100%)", color: "#831843", padding: "5.5rem 0", position: "relative", overflow: "hidden", borderTop: "1px solid rgba(236,72,153,0.15)" }}>
        <div style={{ position: "absolute", bottom: -100, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(236,72,153,0.15) 0%, rgba(0,0,0,0) 70%)", borderRadius: "50%", pointerEvents: "none" }} />
        <div className="w">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "4rem", alignItems: "center" }} className="responsive-grid-finance-ai">
            <style>{`
              @media (min-width: 900px) {
                .responsive-grid-finance-ai { grid-template-columns: 1.05fr 0.95fr !important; }
              }
            `}</style>

            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(236,72,153,0.15)", border: "1px solid rgba(236,72,153,0.4)", color: "#DB2777", fontSize: "0.82rem", fontWeight: 900, padding: "6px 16px", borderRadius: 20, marginBottom: 16 }}>
                📸 CONTROLE FINANCEIRO & LEITURA COM IA
              </div>
              <h2 style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1.15, color: "#831843", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
                Tire foto de um boleto e a <span style={{ color: "#DB2777" }}>IA lança tudo sozinha</span>
              </h2>
              <p style={{ fontSize: "1.05rem", color: "#9F1239", lineHeight: 1.6, margin: "0 0 24px" }}>
                Diga adeus à digitação manual de notas fiscais e boletos de fornecedores. Com a nossa tecnologia de inteligência artificial baseada no Gemini, basta apontar a câmera do celular para a conta ou boleto: o sistema lê o fornecedor, valor, código de barras e data de vencimento e cadastra tudo no seu Contas a Pagar em segundos.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: 28 }} className="finance-ai-features-grid">
                <div style={{ background: "#FFF", border: "1px solid rgba(236,72,153,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(236,72,153,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#831843", margin: "0 0 4px" }}>📷 Leitura Instantânea</div>
                  <div style={{ fontSize: "0.82rem", color: "#9F1239" }}>Foto da conta extrai nome do recebedor, valor e vencimento em milissegundos</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(236,72,153,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(236,72,153,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#831843", margin: "0 0 4px" }}>📊 Contas a Pagar & Compras</div>
                  <div style={{ fontSize: "0.82rem", color: "#9F1239" }}>Organização automatizada do fluxo de caixa e notas fiscais de entrada</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(236,72,153,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(236,72,153,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#831843", margin: "0 0 4px" }}>⚡ Código de Barras Automático</div>
                  <div style={{ fontSize: "0.82rem", color: "#9F1239" }}>Copia a linha digitável direto pro app do seu banco sem erro de digitação</div>
                </div>
                <div style={{ background: "#FFF", border: "1px solid rgba(236,72,153,0.15)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 12px rgba(236,72,153,0.05)" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#831843", margin: "0 0 4px" }}>🔔 Alerta de Vencimentos</div>
                  <div style={{ fontSize: "0.82rem", color: "#9F1239" }}>Nunca mais pague juros por atraso em contas de fornecedores</div>
                </div>
              </div>
            </div>

            <div>
              <div style={{ borderRadius: 24, overflow: "hidden", border: "1.5px solid rgba(236,72,153,0.25)", boxShadow: "0 25px 50px rgba(236,72,153,0.12)", background: "#FFF" }}>
                <img
                  src="/images/financeiro_ia_ui.jpg"
                  alt="FireHub Leitura de Boletos e Contas com IA"
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section className="sec sec-alt" id="como-funciona">
        <div className="w">
          <div className="sec-title">
            <h2>Comece a vender em <em>4 passos simples</em></h2>
            <p>Seu restaurante online em minutos, sem burocracia.</p>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={i} className="step">
                <div className="step-num">{s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLANOS — Slider de faturamento */}
      <section className="sec" id="planos">
        <div className="w">
          <div className="sec-title">
            <h2>Juntos com você do <em>primeiro pedido até sua rede de lojas!</em></h2>
            <p>Nós existimos para mudar a realidade do seu delivery, e por isso você pode ter acesso a todas as funcionalidades por um preço que se adapta à realidade do seu negócio.</p>
          </div>
          <div className="pricing-card" style={{maxWidth:560}}>
            <div className="pricing-header" style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)"}}>
              <h3>Plano Único</h3>
              <p>Todas as funcionalidades incluídas</p>
            </div>
            <div className="pricing-body">
              {/* Slider */}
              <div style={{marginBottom:28}}>
                <p style={{textAlign:"center",fontWeight:600,fontSize:".88rem",color:"#374151",marginBottom:12}}>Selecione seu faturamento mensal atual:</p>
                <div style={{textAlign:"center",marginBottom:16}}>
                  <span style={{display:"inline-block",padding:"8px 24px",background:"#FEF2F2",border:"2px solid #EF4444",borderRadius:12,color:"#EF4444",fontWeight:800,fontSize:"1.3rem"}}>
                    R$ {sliderValue.toLocaleString("pt-BR")}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={40000}
                  step={500}
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  style={{width:"100%",accentColor:"#EF4444",cursor:"pointer"}}
                />
                <div style={{display:"flex",justifyContent:"space-between",fontSize:".72rem",color:"#9CA3AF",marginTop:4}}>
                  <span>R$ 0</span><span>R$ 5k</span><span>R$ 10k</span><span>R$ 20k</span><span>R$ 30k</span><span>R$ 40k</span>
                </div>
              </div>

              {/* Preço calculado */}
              <div className="pricing-price">
                <span className="amount" style={{color:"#EF4444"}}>R$ {calculatedPrice.toFixed(2).replace(".",",")}</span>
                <span className="period">/mês</span>
              </div>

              {/* Percentual info */}
              <div style={{display:"flex",justifyContent:"center",gap:24,marginBottom:20}}>
                <div style={{textAlign:"center"}}>
                  <p style={{fontSize:"1.5rem",fontWeight:900,color:"#EF4444"}}>1%</p>
                  <p style={{fontSize:".72rem",color:"#9CA3AF"}}>do faturamento</p>
                </div>
                <div style={{width:1,background:"#E5E7EB"}} />
                <div style={{textAlign:"center"}}>
                  <p style={{fontSize:"1.5rem",fontWeight:900,color:"#374151"}}>R$ 50</p>
                  <p style={{fontSize:".72rem",color:"#9CA3AF"}}>mínimo/mês</p>
                </div>
                <div style={{width:1,background:"#E5E7EB"}} />
                <div style={{textAlign:"center"}}>
                  <p style={{fontSize:"1.5rem",fontWeight:900,color:"#374151"}}>R$ 400</p>
                  <p style={{fontSize:".72rem",color:"#9CA3AF"}}>máximo/mês</p>
                </div>
              </div>

              {/* Faixa info */}
              <div style={{background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:14,padding:"16px 20px",marginBottom:24}}>
                <p style={{fontWeight:700,fontSize:".9rem",marginBottom:4}}>{sliderValue === 0 ? "Faturou R$ 0? Não paga nada." : `Faturamento de R$ ${sliderValue.toLocaleString("pt-BR")} × 1% = R$ ${(sliderValue * 0.01).toFixed(2).replace(".",",")}`}</p>
                <p style={{fontSize:".82rem",color:"#6B7280",lineHeight:1.5}}>{sliderValue === 0 ? "Se você não processar vendas pelo FireHub no mês, não cobramos nada. Você só paga quando vende." : calculatedPrice <= 50 ? "Valor mínimo de R$ 50,00 para ter acesso a todas as funcionalidades." : calculatedPrice >= 400 ? "Valor máximo de R$ 400,00 por mês. Acima de R$ 40k de faturamento, você não paga mais." : "Simples e justo: quanto mais você cresce, nós crescemos junto."}</p>
              </div>


              <div className="pricing-cta">
                <a href={TRIAL} className="btn-primary" style={{width:"100%",justifyContent:"center",padding:16}}>🔥 Testar Grátis Agora</a>
              </div>
              <p className="pricing-note">Sem cartão de crédito · Cancele quando quiser · Sem multa</p>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARATIVO */}
      <section className="sec sec-alt" id="comparativo">
        <div className="w">
          <div className="sec-title">
            <h2>Por que escolher o <em>FireHub</em>?</h2>
            <p>Compare e veja por que somos a melhor opção para o seu restaurante.</p>
          </div>
          <div className="compare-wrap">
            <table className="ct">
              <thead>
                <tr>
                  <th style={{textAlign:"left",color:"#6B7280"}}>Funcionalidade</th>
                  <th className="fh-head" style={{textAlign:"center"}}>🔥 FireHub</th>
                  <th style={{textAlign:"center",color:"#6B7280"}}>Concorrentes</th>
                  <th style={{textAlign:"center",color:"#6B7280"}}>Sem sistema</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([feat, fh, conc, sem], i) => (
                  <tr key={i}>
                    <td style={{color:(feat as string).includes("🏆")?"#B45309":"#374151",fontWeight:(feat as string).includes("🏆")?600:400}}>{feat as string}</td>
                    <td className="fh-col" style={{textAlign:"center"}}>{fh===true?<Check/>:<Cross/>}</td>
                    <td style={{textAlign:"center"}}>{conc===true?<Check/>:<Cross/>}</td>
                    <td style={{textAlign:"center"}}>{sem===true?<Check/>:<Cross/>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{textAlign:"center",color:"#9CA3AF",fontSize:".8rem",marginTop:12}}>🏆 Funcionalidades exclusivas que nenhum concorrente oferece</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec" id="faq">
        <div className="w">
          <div className="sec-title"><h2>Perguntas <em>Frequentes</em></h2><p>Tire suas dúvidas sobre o FireHub</p></div>
          <div className="faq-list">
            {FAQ.map((f, i) => (
              <div key={i} className={`faq-item ${openFaq===i?"open":""}`}>
                <div className="faq-q" onClick={() => setOpenFaq(openFaq===i?null:i)}>
                  {f.q}
                  <span className="faq-icon">+</span>
                </div>
                {openFaq===i && <div className="faq-a">{f.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="cta-final">
        <div className="w">
          <div className="cta-content">
            <h2>Pronto para vender mais?</h2>
            <p>Comece agora com 15 dias grátis. Sem cartão, sem compromisso, sem multa.</p>
            <div className="cta-buttons">
              <a href={TRIAL} className="btn-white">🔥 Começar Teste Grátis</a>
              <a href={WA} target="_blank" rel="noopener" className="btn-ghost">💬 Falar no WhatsApp</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="w">
          <div className="footer-grid">
            <div className="footer-brand">
              <div className="logo-text"><span className="fire">FIRE</span><span className="hub">HUB</span></div>
              <p>Simples, rápido e completo. Tudo que o seu restaurante precisa em um só lugar.</p>
            </div>
            <div className="footer-col">
              <h4>Links</h4>
              <a href="#funcionalidades">Funcionalidades</a>
              <a href="#como-funciona">Como funciona</a>
              <a href="#planos">Planos</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="footer-col">
              <h4>Contato</h4>
              <a href={WA} target="_blank" rel="noopener">📱 WhatsApp</a>
              <a href="mailto:contato@firehubfood.com.br">✉️ contato@firehubfood.com.br</a>
            </div>
          </div>
          <div className="footer-bottom">
            <p>© {new Date().getFullYear()} FireHub Food Technology. Todos os direitos reservados.</p>
            <div className="footer-social">
              <a href="https://instagram.com/firehubfood" target="_blank" rel="noopener">📸</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
