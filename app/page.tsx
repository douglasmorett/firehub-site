"use client";
import { useState, useEffect } from "react";

const WA = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20testar%20o%20FireHub%20gr%C3%A1tis%20por%2015%20dias";
const TRIAL = "/cadastro";
const LOGIN = "https://hakim-portal-grupohakim.vercel.app/login";

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
  ["Integração iFood / Rappi", true, true, false],
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
                  max={30000}
                  step={500}
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  style={{width:"100%",accentColor:"#EF4444",cursor:"pointer"}}
                />
                <div style={{display:"flex",justifyContent:"space-between",fontSize:".72rem",color:"#9CA3AF",marginTop:4}}>
                  <span>R$ 0</span><span>R$ 5k</span><span>R$ 10k</span><span>R$ 20k</span><span>R$ 30k</span>
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
