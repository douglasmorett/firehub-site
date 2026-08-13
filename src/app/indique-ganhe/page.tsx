"use client";
import { useState, useEffect } from "react";

const TRIAL = "/cadastro";
const LOGIN = "https://firehubfood.com.br/login";

export default function IndiqueEGanhePage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>
      {/* NAV */}
      <nav className={`nav ${scrolled ? "scrolled" : ""}`}>
        <a href="/" className="nav-logo">
          <img src="/firehub-flame.png" alt="FireHub" style={{height: 32}} />
          <div style={{marginLeft: 12}}>
            <div className="nav-logo-text" style={{fontSize: "1.2rem", fontWeight: 900}}><span className="fire" style={{color:"#EF4444"}}>FIRE</span><span className="hub" style={{color:"#0F172A"}}>HUB</span></div>
            <div className="nav-sub" style={{fontSize: "0.75rem", color: "#64748B"}}>Programa de Parceiros</div>
          </div>
        </a>
        <div className="nav-links" style={{display: "flex", gap: 24, alignItems: "center"}}>
          <a href="#como-funciona" style={{color:"#334155", textDecoration:"none", fontWeight: 600}}>Como funciona</a>
          <a href="#comissao" style={{color:"#334155", textDecoration:"none", fontWeight: 600}}>Comissões</a>
          <a href="#isencao" style={{color:"#334155", textDecoration:"none", fontWeight: 600}}>Mensalidade Grátis</a>
          <a href={LOGIN} className="btn-primary" style={{padding: "10px 24px", borderRadius: 8, background: "#EF4444", color: "#FFF", textDecoration: "none", fontWeight: 700}}>Acessar Painel</a>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#FFF", padding: "10rem 2rem 6rem", textAlign: "center" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "inline-block", background: "rgba(239,68,68,0.2)", color: "#F87171", padding: "6px 16px", borderRadius: 20, fontWeight: 700, marginBottom: 24, border: "1px solid rgba(239,68,68,0.3)", fontSize: "0.85rem" }}>
            🚀 PROGRAMA "INDIQUE E GANHE"
          </div>
          <h1 style={{ fontSize: "3.5rem", fontWeight: 900, lineHeight: 1.15, marginBottom: 24, letterSpacing: "-1px" }}>
            Zere sua mensalidade e ganhe <span style={{ color: "#EF4444" }}>renda extra vitalícia.</span>
          </h1>
          <p style={{ fontSize: "1.15rem", color: "#94A3B8", lineHeight: 1.6, marginBottom: 40, maxWidth: 650, margin: "0 auto 40px" }}>
            Indique o FireHub para outros restaurantes e ganhe comissão recorrente todos os meses. Bateu 10 indicações ativas? Sua mensalidade sai de graça para sempre.
          </p>
          <a href={LOGIN} className="btn-primary" style={{ padding: "18px 48px", fontSize: "1.15rem", display: "inline-block", background: "#EF4444", color: "#FFF", borderRadius: 12, textDecoration: "none", fontWeight: 800, boxShadow: "0 10px 25px rgba(239,68,68,0.4)" }}>
            🤝 Quero ser um Parceiro
          </a>
        </div>
      </section>

      {/* COMISSÕES (3 Níveis) */}
      <section id="comissao" className="sec" style={{ background: "#F8FAFC", padding: "6rem 2rem" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "2.5rem", fontWeight: 900, color: "#0F172A", marginBottom: 16, letterSpacing: "-0.5px" }}>Comissões em 3 Níveis</h2>
          <p style={{ fontSize: "1.1rem", color: "#475569", marginBottom: 48, maxWidth: 600, margin: "0 auto 48px" }}>
            Você ganha não apenas pelas suas indicações diretas, mas também pelas indicações das suas indicações.
          </p>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
            <div style={{ background: "#FFF", padding: 40, borderRadius: 24, border: "1px solid #E2E8F0", boxShadow: "0 10px 25px rgba(0,0,0,0.03)" }}>
              <div style={{ fontSize: "4rem", fontWeight: 900, color: "#EF4444", marginBottom: 8, lineHeight: 1 }}>20%</div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0F172A", marginBottom: 16 }}>Nível 1 (Indicação Direta)</h3>
              <p style={{ color: "#64748B", fontSize: "0.95rem", lineHeight: 1.6 }}>Toda loja que assinar pelo seu link te rende 20% do valor da mensalidade dela todos os meses.</p>
            </div>
            <div style={{ background: "#FFF", padding: 40, borderRadius: 24, border: "1px solid #E2E8F0", boxShadow: "0 10px 25px rgba(0,0,0,0.03)" }}>
              <div style={{ fontSize: "4rem", fontWeight: 900, color: "#F59E0B", marginBottom: 8, lineHeight: 1 }}>3%</div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0F172A", marginBottom: 16 }}>Nível 2 (Segunda Geração)</h3>
              <p style={{ color: "#64748B", fontSize: "0.95rem", lineHeight: 1.6 }}>Se o restaurante que você indicou indicar outro, você ganha 3% sobre essa nova assinatura.</p>
            </div>
            <div style={{ background: "#FFF", padding: 40, borderRadius: 24, border: "1px solid #E2E8F0", boxShadow: "0 10px 25px rgba(0,0,0,0.03)" }}>
              <div style={{ fontSize: "4rem", fontWeight: 900, color: "#10B981", marginBottom: 8, lineHeight: 1 }}>1%</div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0F172A", marginBottom: 16 }}>Nível 3 (Terceira Geração)</h3>
              <p style={{ color: "#64748B", fontSize: "0.95rem", lineHeight: 1.6 }}>Uma renda passiva infinita pingando de lojas que você nem conhece diretamente.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ISENÇÃO */}
      <section id="isencao" className="sec" style={{ padding: "6rem 2rem", background: "#FFF" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4rem", alignItems: "center" }} className="responsive-grid">
           <style>{`
            @media (max-width: 900px) {
              .responsive-grid { grid-template-columns: 1fr !important; }
            }
          `}</style>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(16,185,129,0.15)", color: "#059669", padding: "6px 16px", borderRadius: 20, fontWeight: 800, marginBottom: 16, fontSize: "0.85rem" }}>
              🏆 META DE OURO
            </div>
            <h2 style={{ fontSize: "2.4rem", fontWeight: 900, color: "#0F172A", marginBottom: 20, lineHeight: 1.15, letterSpacing: "-0.5px" }}>
              Bateu 10 indicados ativos? Você não paga mais nada.
            </h2>
            <p style={{ fontSize: "1.1rem", color: "#475569", marginBottom: 24, lineHeight: 1.6 }}>
              Além de receber as comissões em dinheiro direto na sua conta Asaas, se você mantiver 10 ou mais clientes ativos no seu Nível 1, <strong>a sua própria mensalidade do FireHub sai de graça!</strong>
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              <li style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                <span style={{ color: "#10B981", fontSize: "1.2rem", fontWeight: 900 }}>✓</span>
                <span style={{ color: "#334155", fontSize: "1.05rem" }}>A verificação é feita mês a mês automaticamente pelo sistema.</span>
              </li>
              <li style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                <span style={{ color: "#10B981", fontSize: "1.2rem", fontWeight: 900 }}>✓</span>
                <span style={{ color: "#334155", fontSize: "1.05rem" }}>As comissões continuam caindo no seu bolso além da isenção.</span>
              </li>
            </ul>
          </div>
          <div style={{ background: "linear-gradient(135deg, #020617 0%, #0F172A 100%)", padding: 48, borderRadius: 32, color: "#FFF", textAlign: "center", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 25px 50px rgba(0,0,0,0.15)" }}>
            <div style={{ fontSize: "5rem", marginBottom: 16 }}>🎯</div>
            <h3 style={{ fontSize: "2.2rem", fontWeight: 900, marginBottom: 8 }}>10 Clientes</h3>
            <p style={{ color: "#94A3B8", fontSize: "1.1rem", fontWeight: 500 }}>Mensalidade FireHub 100% Isenta</p>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="sec" style={{ background: "#090D16", color: "#FFF", padding: "7rem 2rem" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={{ fontSize: "2.5rem", fontWeight: 900, textAlign: "center", marginBottom: 56, letterSpacing: "-0.5px" }}>Como começar?</h2>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", padding: 40, borderRadius: 24, display: "flex", alignItems: "center", gap: 32 }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "2px solid #EF4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", fontWeight: 900, flexShrink: 0 }}>1</div>
              <div>
                <h3 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 8 }}>Crie uma conta gratuita no Asaas</h3>
                <p style={{ color: "#94A3B8", lineHeight: 1.5 }}>O dinheiro das comissões cai diretamente em uma conta Asaas para você. Não passa por nós! É split automático na fonte.</p>
              </div>
            </div>
            
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", padding: 40, borderRadius: 24, display: "flex", alignItems: "center", gap: 32 }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "2px solid #EF4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", fontWeight: 900, flexShrink: 0 }}>2</div>
              <div>
                <h3 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 8 }}>Conecte no seu painel FireHub</h3>
                <p style={{ color: "#94A3B8", lineHeight: 1.5 }}>Acesse seu Dashboard de Lojista, clique em "Indique e Ganhe" e cole o seu Wallet ID do Asaas.</p>
              </div>
            </div>
            
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", padding: 40, borderRadius: 24, display: "flex", alignItems: "center", gap: 32 }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "2px solid #EF4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", fontWeight: 900, flexShrink: 0 }}>3</div>
              <div>
                <h3 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 8 }}>Compartilhe seu link exclusivo</h3>
                <p style={{ color: "#94A3B8", lineHeight: 1.5 }}>Pronto! O sistema vai gerar seu link. Mande para os colegas de profissão e ganhe dinheiro enquanto dorme.</p>
              </div>
            </div>
          </div>
          
          <div style={{ textAlign: "center", marginTop: 56 }}>
            <a href={LOGIN} className="btn-primary" style={{ padding: "18px 48px", fontSize: "1.15rem", display: "inline-block", background: "#EF4444", color: "#FFF", borderRadius: 12, textDecoration: "none", fontWeight: 800, boxShadow: "0 10px 25px rgba(239,68,68,0.3)" }}>
              Acessar meu Painel agora
            </a>
          </div>
        </div>
      </section>
      
    </div>
  );
}
