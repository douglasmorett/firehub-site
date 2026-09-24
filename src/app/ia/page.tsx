import type { Metadata } from "next";
import Kit from "./Kit";
import { LINK_FIREHUB, LINK_WHATS, PASSOS } from "./passos";

export const metadata: Metadata = {
  title: "Kit grátis: a IA indica o seu restaurante — Douglas Morett",
  description:
    "Teste em 1 toque se o ChatGPT, o Gemini e o Google indicam o seu restaurante, e saia com os textos prontos para o Google, o iFood e o Instagram. Grátis.",
  openGraph: {
    title: "Kit grátis: a IA indica o seu restaurante",
    description: "O passo a passo que colocou uma esfirraria em 1º no ChatGPT, com os textos prontos com o nome da sua loja.",
    url: "https://firehubfood.com.br/ia",
    siteName: "FireHub",
    locale: "pt_BR",
    type: "article",
  },
};

/**
 * /ia — o kit grátis do "comenta IA" (Comanda de Conteúdo, Dias 3, 10 e 30).
 *
 * Quem chega aqui veio do direct do ManyChat, no celular, depois de ver um
 * Reel. O kit entrega de verdade (a pessoa consegue fazer tudo sozinha) e, nos
 * passos que dão trabalho, mostra quem faz por ela: o cardápio do FireHubFood
 * e a ajuda do Douglas. Não vende no topo: quem vende é o passo.
 *
 * A palavra é "IA" e não "ChatGPT" (decisão do dono em 24/09/2026): o teste
 * do Reel é no ChatGPT, mas os passos valem para qualquer IA.
 *
 * A página se descreve em JSON-LD (HowTo): é o próprio conselho do kit
 * aplicado a ela mesma.
 */
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "Como fazer a IA indicar o seu restaurante",
  description: "6 passos para ChatGPT, Gemini e a IA do Google indicarem o seu restaurante.",
  author: { "@type": "Person", name: "Douglas Morett" },
  step: PASSOS.map((p, i) => ({ "@type": "HowToStep", position: i + 1, name: p.titulo, text: p.porque })),
}).replace(/</g, "\\u003c");

const LARANJA = "#FF5722";

export default function KitIA() {
  const secao: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: "2.2rem 1.1rem" };
  const botao: React.CSSProperties = {
    display: "block", textAlign: "center", fontWeight: 900, padding: "15px 22px", borderRadius: 12,
    textDecoration: "none", fontSize: "1.02rem",
  };

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", color: "#0F172A", background: "#F8FAFC", minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <style>{`
        /* A extensão interna da casa desenha uma pílula em toda página do
           domínio; aqui ela só atrapalha (mesmo motivo da /prazos). */
        #firehub-corner-pill, #firehub-ifood-tab-alert, #fhprazos-pill { display: none !important; }
        /* No PDF o navegador não imprime o fundo escuro: sem isto, o texto
           branco do topo sumiria no papel branco. */
        @media print {
          main { background: #fff !important; }
          .topo-ia { background: #fff !important; }
          .topo-ia * { color: #0F172A !important; }
          .saida-ia { display: none !important; }
        }
      `}</style>

      {/* ─────────── TOPO: a história do Reel e o que tem no kit ─────────── */}
      <section className="topo-ia" style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, paddingTop: "2rem", paddingBottom: "2.2rem" }}>
          <div style={{ color: "#FF7A59", fontWeight: 800, fontSize: ".82rem", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>
            Kit grátis · Douglas Morett
          </div>
          <h1 style={{ fontSize: "clamp(1.9rem, 7vw, 2.8rem)", lineHeight: 1.06, fontWeight: 900, margin: "0 0 14px" }}>
            Faça a IA <span style={{ color: "#FF7A59" }}>indicar o seu restaurante</span>
          </h1>
          <p style={{ fontSize: "1.06rem", color: "#CBD5E1", lineHeight: 1.55, margin: "0 0 18px" }}>
            Perguntei ao ChatGPT onde comer esfirra em Rio das Ostras. A minha loja veio em 1º. E não foi pela nota: foi
            porque a IA tinha informação concreta sobre o meu cardápio. Aqui está como fazer o mesmo com a sua, no ChatGPT, no
            Gemini ou no Google.
          </p>
          <div style={{ display: "grid", gap: 8, marginBottom: 22 }}>
            {[
              ["🔎", "Teste em 1 toque", "para ver se a sua loja aparece"],
              ["📋", "Textos prontos", "com o nome da sua loja, para colar"],
              ["🗓️", "Plano de 7 dias", "só com o que falta fazer"],
            ].map(([icone, titulo, resto]) => (
              <div key={titulo} style={{ display: "flex", gap: 10, alignItems: "center", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "10px 12px" }}>
                <span style={{ fontSize: "1.3rem" }} aria-hidden="true">{icone}</span>
                <span style={{ lineHeight: 1.35 }}><b style={{ color: "#fff" }}>{titulo}</b> <span style={{ color: "#CBD5E1" }}>{resto}</span></span>
              </div>
            ))}
          </div>
          <a
            href="#sua-loja"
            style={{ display: "inline-block", background: `linear-gradient(135deg, ${LARANJA} 0%, #E64A19 100%)`, color: "#fff", fontWeight: 900, padding: "14px 26px", borderRadius: 12, textDecoration: "none", boxShadow: "0 10px 28px rgba(255,87,34,.35)" }}
          >
            Começar agora ↓
          </a>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 10 }}>Grátis · leva 2 minutos para começar · nenhum passo custa dinheiro</div>
        </div>
      </section>

      <Kit />

      {/* ─────────── A SAÍDA: fazer sozinho ou fazer junto ─────────── */}
      <section className="saida-ia" style={{ background: "#0F172A", color: "#fff" }}>
        <div style={secao}>
          <h2 style={{ fontSize: "clamp(1.4rem, 4.5vw, 1.8rem)", fontWeight: 900, margin: "0 0 10px" }}>
            Dá para fazer sozinho. <span style={{ color: "#FF7A59" }}>Ou eu faço junto com você.</span>
          </h2>
          <p style={{ color: "#CBD5E1", lineHeight: 1.55, margin: "0 0 20px" }}>
            Eu sou dono de esfirraria e criei o FireHub, o sistema que roda na minha loja. O cardápio dele já é uma
            página que a IA lê, e eu acompanho de perto quem quer crescer no iFood, no 99 e no site próprio.
          </p>
          {/* A frase da oferta, nas palavras do dono (24/09/2026): vai em toda
              comunicação da consultoria, sem explicar o "como". */}
          <p style={{ color: "#fff", fontWeight: 900, fontSize: "1.15rem", lineHeight: 1.4, margin: "0 0 20px", borderLeft: `4px solid ${LARANJA}`, paddingLeft: 12 }}>
            Vamos trazer tecnologia para seu negócio e aumentar seus resultados.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            <a href={LINK_FIREHUB} style={{ ...botao, background: `linear-gradient(135deg, ${LARANJA} 0%, #E64A19 100%)`, color: "#fff", boxShadow: "0 10px 28px rgba(255,87,34,.35)" }}>
              Testar o FireHubFood grátis por 15 dias
            </a>
            <a href={LINK_WHATS} target="_blank" rel="noopener noreferrer" style={{ ...botao, background: "transparent", color: "#fff", border: "2px solid #475569" }}>
              Quero ajuda na minha loja
            </a>
          </div>
          <p style={{ color: "#94A3B8", fontSize: ".9rem", margin: "20px 0 0", textAlign: "center" }}>
            Toda semana tem IA na prática no{" "}
            <a href="https://www.instagram.com/douglasmorett/" target="_blank" rel="noopener noreferrer" style={{ color: "#FF7A59", fontWeight: 800 }}>@douglasmorett</a>
          </p>
        </div>
      </section>
    </main>
  );
}
