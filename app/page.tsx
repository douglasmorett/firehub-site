"use client";
import { useState, useEffect } from "react";

const WA = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20testar%20o%20FireHub%20gr%C3%A1tis%20por%2015%20dias";
const TRIAL = "https://portalhakim.com.br/cadastro";

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
  ["FireCheck incluso 🏆", true, false, false],
  ["Leitura de notas por IA 🏆", true, false, false],
  ["Estoque automático", "soon", true, false],
  ["CMV automático", "soon", true, false],
  ["Integração iFood / Rappi", "soon", true, false],
];

const PRICING_FEATURES = [
  "Cardápio digital ilimitado", "Chatbot WhatsApp com IA", "Gestão completa de pedidos",
  "Disparos em massa", "Relatórios e analytics", "FireCheck (auditoria com IA)",
  "Leitura de notas fiscais por IA", "Controle de motoboys",
  "Pagamento online (cartão + Pix)", "Suporte humano via WhatsApp"
];

const FAQ = [
  { q: "Como funciona o teste grátis?", a: "15 dias completos sem cobrar nada. Sem cartão de crédito. Sem compromisso. Depois, planos a partir de R$ 99/mês sem taxa por pedido." },
  { q: "Precisa instalar algum aplicativo?", a: "Não! O FireHub funciona 100% no navegador. Celular, tablet ou computador — em qualquer lugar, a qualquer momento." },
  { q: "Como é o suporte?", a: "Humano, via WhatsApp, 7 dias por semana — manhã, tarde e noite. Você nunca fica sem resposta." },
  { q: "Posso imprimir comandas?", a: "Sim! Impressão de comandas de delivery, cozinha e mesas em uma ou mais impressoras térmicas." },
  { q: "Integra com iFood?", a: "Sim! Receba pedidos do iFood direto no painel, junto com cardápio digital e WhatsApp." },
  { q: "O que é o FireCheck?", a: "Módulo exclusivo de auditoria operacional: checklist com fotos, ponto eletrônico com geolocalização e controle financeiro inteligente." },
  { q: "Existe multa para cancelar?", a: "Absolutamente não. Você cancela quando quiser, sem burocracia, sem multa, sem surpresas." },
];

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const Check = () => <span style={{color:"#16A34A",fontSize:"1.1rem"}}>✅</span>;
  const Cross = () => <span style={{color:"#EF4444"}}>❌</span>;
  const Soon = () => <span style={{color:"#D97706",fontSize:".73rem",fontWeight:700,background:"#FEF3C7",padding:"2px 8px",borderRadius:6}}>EM BREVE</span>;

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
        <a href={TRIAL} className="btn-cta nav-mobile-cta">Testar Grátis</a>
        <div className="nav-links">
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#comparativo">Comparativo</a>
          <a href="#faq">FAQ</a>
          <a href={TRIAL} className="btn-cta">🔥 Testar Grátis</a>
        </div>
      </nav>

      {/* HERO */}
      <section>
        <div className="hero">
          <div>
            <div className="hero-tag"><span className="pulse" />15 dias grátis · Sem cartão de crédito</div>
            <h1>Simples, rápido e<br /><em>completo.</em> Tudo que o seu<br />restaurante precisa.</h1>
            <p className="hero-p">Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro e auditoria com IA — pare de perder vendas e comece a crescer.</p>
            <div className="hero-btns">
              <a href={TRIAL} className="btn-primary">🔥 Testar Grátis por 15 Dias</a>
              <a href={WA} target="_blank" rel="noopener" className="btn-outline">💬 Falar com Consultor</a>
            </div>
            <p className="hero-note">✓ Sem compromisso &nbsp;·&nbsp; ✓ Sem multa &nbsp;·&nbsp; ✓ Migração fácil</p>
            <div className="hero-badges">
              <div className="badge"><span>📋</span> Delivery</div>
              <div className="badge"><span>🍽️</span> Mesas</div>
              <div className="badge"><span>🏪</span> Balcão</div>
              <div className="badge"><span>🤖</span> IA</div>
              <div className="badge"><span>💬</span> WhatsApp</div>
            </div>
          </div>
          <div className="hero-visual">
            <img src="/firehub-mockup.png" alt="FireHub Dashboard" className="hero-img" />
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
            <h2>Tudo que seu negócio precisa numa <em>única solução</em></h2>
            <p>Do cardápio digital à auditoria com inteligência artificial — o FireHub centraliza toda a operação do seu restaurante.</p>
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

      {/* PLANOS */}
      <section className="sec" id="planos">
        <div className="w">
          <div className="sec-title">
            <h2>Um só FireHub, do <em>primeiro pedido ao primeiro milhão</em></h2>
            <p>Acesso a todas as funcionalidades por um preço que cabe no seu bolso. Sem taxa por pedido.</p>
          </div>
          <div className="pricing-card">
            <div className="pricing-header">
              <h3>Plano Completo</h3>
              <p>Todas as funcionalidades incluídas</p>
            </div>
            <div className="pricing-body">
              <div className="pricing-price">
                <div className="from">a partir de</div>
                <span className="amount">R$ 99</span>
                <span className="period">/mês</span>
              </div>
              <ul className="pricing-features">
                {PRICING_FEATURES.map((f, i) => (
                  <li key={i}><span className="ck">✓</span>{f}</li>
                ))}
              </ul>
              <div className="pricing-cta">
                <a href={TRIAL} className="btn-primary">🔥 Começar Teste Grátis de 15 Dias</a>
              </div>
              <p className="pricing-note">Sem cartão de crédito · Cancele quando quiser</p>
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
                    <td className="fh-col" style={{textAlign:"center"}}>{fh===true?<Check/>:fh===false?<Cross/>:<Soon/>}</td>
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
          <div className="sec-title"><h2>Perguntas <em>Frequentes</em></h2><p>Tire suas dúvidas sobre nossos planos e serviços</p></div>
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
