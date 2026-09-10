import type { Metadata } from "next";
import DemoAoVivo from "./DemoAoVivo";
import NoiteDaCozinha from "./NoiteDaCozinha";
import CalculadoraDePerda from "./CalculadoraDePerda";
import { SeletorDePlano, BarraFixa } from "./Assinar";
import VoceSabia from "./VoceSabia";
import GatilhoDoHero from "./GatilhoDoHero";
import RastreioDeClique from "./RastreioDeClique";
import { CHECKOUT_PADRAO, PLANOS } from "./planos";

export const metadata: Metadata = {
  title: "FireHub Prazos — o prazo do iFood muda sozinho quando a cozinha enche",
  description:
    "Extensão para o Chrome que olha a fila do seu painel de pedidos e escreve o prazo certo no iFood e o tempo de preparo no 99Food. R$ 29,90 por mês, 7 dias de garantia.",
  openGraph: {
    title: "O prazo do seu iFood muda sozinho quando a cozinha enche",
    description: "A extensão olha a fila da sua cozinha e escreve o prazo certo no iFood e no 99Food. Você deixa o portal aberto e ela faz o resto.",
    url: "https://firehubfood.com.br/prazos",
    siteName: "FireHub",
    locale: "pt_BR",
    type: "website",
    images: [{ url: "https://firehubfood.com.br/prazos-og.jpg", width: 1200, height: 630, alt: "A extensão lendo a fila da cozinha e escrevendo o prazo no iFood e no 99Food" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "O prazo do seu iFood muda sozinho quando a cozinha enche",
    description: "A extensão olha a fila da sua cozinha e escreve o prazo certo no iFood e no 99Food.",
    images: ["https://firehubfood.com.br/prazos-og.jpg"],
  },
};

/**
 * /prazos — a página de venda do FireHub Prazos.
 *
 * Refeita em 09/09/2026 depois do dono ler a versão anterior: "muita escrita,
 * pouca imagem, pouco intuitivo — as pessoas têm preguiça de ler". Ele estava
 * certo: a página tinha 2.771 palavras visíveis contra as 250–725 da própria
 * regra que eu segui. A pesquisa boa virou parágrafo, e parágrafo não vende
 * para quem lê no celular entre um pedido e outro.
 *
 * Regras desta versão:
 *   - cada dobra tem UMA imagem que conta a história sozinha (a demonstração
 *     ao vivo, o gráfico da noite, a foto real do produto, os ícones);
 *   - texto só do tamanho da legenda dessa imagem; o que precisa de leitura
 *     longa (a conta da loja, as outras citações) fica dobrado em <details>;
 *   - números só medidos ou publicados pela plataforma, com link;
 *   - preço: R$ 29,90 = menos de R$ 1 por dia (29,90 ÷ 30 = 0,9967; nunca
 *     arredondar para "R$ 1,00", cruzar para baixo de um real é o argumento);
 *   - garantia de 7 dias, igual ao cadastro da Cakto, decisão do dono;
 *   - um só botão, repetido, sempre com o mesmo texto.
 *
 * Acrescentado em 09/09/2026, a pedido do dono ("quero gatilhos: você sabia
 * que…"): a seção "Você sabia?" logo depois do hero e o pré-título do hero,
 * os dois em ./gatilhos.ts. Cada gatilho é frase literal do iFood ou de
 * pesquisa com amostra — o "até 67% de aumento nas vendas" que ele sugeriu
 * não existe em fonte nenhuma e ficou de fora. O pré-título casa com o
 * anúncio via ?g=posicao|atraso|cliente (message match). E a página
 * descreve a si mesma em JSON-LD (FAQ + oferta) para buscador e para os
 * assistentes de IA que hoje respondem "quanto custa" sem abrir o site.
 *
 * Nada de biblioteca de animação nem fonte externa: abre em menos de 2 s no
 * 4G, que é o item de maior efeito medido depois do texto.
 */

const FAQ: [string, string][] = [
  ["Funciona com o meu sistema?", "Se os pedidos aparecem em colunas numa página do Chrome, funciona. Saipos, Cardápio Web, Consumer, o que for. Você marca as colunas com um clique e pronto. Não precisa integração, não precisa mexer no seu sistema, não precisa autorização de ninguém."],
  ["Preciso deixar o computador ligado?", "Sim. Ela roda no Chrome do computador da loja, com o painel e os portais abertos. Se a aba do painel fechar, ela segura o último prazo e avisa na tela, em vez de zerar e prometer 28 minutos na hora errada."],
  ["Ela pode bagunçar minha loja?", "Ela só escreve o prazo de entrega. Não aceita, não recusa, não cancela e não pausa. E você desliga o robô num clique, quando quiser."],
  ["Extensão de Chrome é seguro? O que ela lê?", "Ela roda em três lugares: no seu painel de pedidos, no Portal do Parceiro e no 99Food Admin. Ela lê o número de pedidos da coluna que você marcou. Não lê senha, não lê suas outras abas e não vê nada de banco."],
  ["E se eu tiver várias lojas?", "Você marca na extensão quais lojas mudam de prazo. As que não marcar ficam como estão. Cada loja a mais custa R$ 9,90 e vale para as duas plataformas: mais uma no iFood e mais uma no 99Food. Todas precisam estar no mesmo login do iFood."],
  ["O prazo do 99 é o mesmo do iFood?", "Não, e é de propósito. No 99 o cliente vê o tempo de preparo somado ao tempo de entrega da faixa que você cadastrou, então a extensão mexe só no preparo. Você configura essa regra separada."],
  ["E se o iFood mudar a tela e ela parar?", "Acontece, e quem corre é a gente: a atualização é nossa, não sua. Enquanto isso ela segura o último prazo e avisa na tela, em vez de sumir com o prazo. Se ficar sem funcionar, você cancela na Cakto e, dentro dos 7 dias, o dinheiro volta inteiro."],
  ["Dá para pagar no Pix?", "Sim: Pix Automático ou cartão, pela Cakto. No Pix a renovação também é automática, sem você lembrar todo mês."],
  ["Consigo cancelar fácil?", "Sim, direto na Cakto, sem falar com ninguém. Não tem fidelidade nem multa. E se cancelar dentro de 7 dias, o dinheiro volta inteiro."],
  ["E se eu deixar de pagar?", "Ela para de ajustar na hora e explica na tela por quê. Pagou de novo, volta sozinha."],
];

/**
 * Dados estruturados: a FAQ e a oferta, do jeito que buscador e assistente
 * de IA leem. Só repete o que a página já mostra — nada de nota, avaliação
 * ou número de clientes que a gente não tem. O `<` vira `<` por causa
 * do XSS descrito no guia do Next (docs/01-app/02-guides/json-ld.md).
 */
const JSON_LD = JSON.stringify([
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FireHub Prazos",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Google Chrome",
    description: "Extensão para o Chrome que lê a fila do painel de pedidos e escreve o prazo de entrega no iFood e o tempo de preparo no 99Food, sozinha, o dia inteiro.",
    url: "https://firehubfood.com.br/prazos",
    image: "https://firehubfood.com.br/prazos-og.jpg",
    author: { "@type": "Organization", name: "FireHub", url: "https://firehubfood.com.br" },
    offers: PLANOS.map((p) => ({
      "@type": "Offer",
      name: p.lojas === 1 ? "1 loja" : `${p.lojas} lojas`,
      price: (p.centavos / 100).toFixed(2),
      priceCurrency: "BRL",
      url: p.url,
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: (p.centavos / 100).toFixed(2),
        priceCurrency: "BRL",
        billingIncrement: 1,
        unitCode: "MON",
      },
    })),
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map(([q, r]) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: r },
    })),
  },
]).replace(/</g, "\\u003c");

const LARANJA = "#FF5722";
// O laranja da marca sobre branco dá contraste 3,16 — abaixo do mínimo de
// leitura. Este é o mesmo laranja escurecido, só para texto de link.
const LARANJA_LINK = "#C2410C";
const CHECKOUT = CHECKOUT_PADRAO;
const WA = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Tenho%20uma%20d%C3%BAvida%20sobre%20o%20FireHub%20Prazos.";

function Botao({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <a
      href={CHECKOUT}
      style={{
        display: "inline-block",
        background: `linear-gradient(135deg, ${LARANJA} 0%, #E64A19 100%)`,
        color: "#fff", fontWeight: 900, padding: "16px 30px", borderRadius: 12,
        textDecoration: "none", fontSize: "1.05rem", boxShadow: "0 10px 28px rgba(255,87,34,.35)",
        ...style,
      }}
    >
      {children}
    </a>
  );
}

export default function PrazosLanding() {
  const secao: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: "3rem 1.25rem" };
  const h2: React.CSSProperties = { fontSize: "clamp(1.5rem, 3.4vw, 2rem)", fontWeight: 900, margin: "0 0 8px", lineHeight: 1.15 };
  const p: React.CSSProperties = { color: "#475569", lineHeight: 1.6, fontSize: "1.05rem", margin: "0 0 14px", maxWidth: 640 };
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.2rem 1.35rem", boxShadow: "0 6px 20px rgba(15,23,42,.05)" };
  const tile: React.CSSProperties = { ...card, textAlign: "center", padding: "1.3rem 1rem" };
  const emoji: React.CSSProperties = { fontSize: "2.2rem", lineHeight: 1, marginBottom: 10 };
  const detalhes: React.CSSProperties = { ...card, marginTop: 16, padding: "0.9rem 1.2rem" };
  const resumo: React.CSSProperties = { cursor: "pointer", fontWeight: 800, color: "#334155", fontSize: "1rem" };

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", color: "#0F172A", background: "#F8FAFC" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <RastreioDeClique />

      {/* ─────────── HERO: a demonstração é a imagem ─────────── */}
      <section style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, paddingTop: "2.2rem", paddingBottom: "2.6rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${LARANJA}, #F44336)`, display: "grid", placeItems: "center", fontSize: "1.1rem" }}>🔥</div>
            <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>FireHub Prazos</div>
          </div>

          <GatilhoDoHero />

          <h1 style={{ fontSize: "clamp(1.9rem, 5vw, 3.1rem)", lineHeight: 1.08, fontWeight: 900, margin: "0 0 14px", maxWidth: 860 }}>
            O prazo do seu iFood sobe sozinho quando a cozinha enche.
            <span style={{ color: "#FF7A59" }}> E desce quando esvazia.</span>
          </h1>

          <p style={{ fontSize: "1.12rem", color: "#CBD5E1", maxWidth: 680, lineHeight: 1.55, margin: "0 0 20px" }}>
            A extensão olha a fila do seu painel de pedidos e escreve o prazo certo no iFood e no 99Food.
            Feita para quem entrega com motoboy próprio. Você deixa o portal aberto e não mexe em mais nada.
          </p>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <Botao>Assinar por R$ 29,90/mês</Botao>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: "1.05rem" }}>Menos de R$ 1 por dia.</div>
          </div>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginBottom: 28 }}>
            Leva 2 minutos · Pix ou cartão · 7 dias de garantia · sem fidelidade
          </div>

          <DemoAoVivo />
        </div>
      </section>

      {/* ─────────── VOCÊ SABIA? os gatilhos, com a fonte na mão ─────────── */}
      <VoceSabia />

      {/* ─────────── O PROBLEMA: um gráfico, uma frase ─────────── */}
      <section style={secao}>
        <h2 style={h2}>Prazo fixo erra dos dois lados</h2>
        <p style={p}>
          Promete de menos no pico e de mais com a cozinha vazia. O prazo da extensão acompanha a fila,
          hora a hora.
        </p>
        <div style={{ ...card, padding: "1.2rem 1rem 1rem" }}>
          <NoiteDaCozinha />
        </div>
      </section>

      {/* ─────────── COMO FUNCIONA: três ícones e a foto real ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Três passos, uma vez só</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 18 }}>
            {[
              ["👆", "Marca a coluna", "no seu painel, com um clique"],
              ["🔢", "Ela conta", "a cada mudança na tela"],
              ["✍️", "Ela escreve", "no iFood e no 99Food, nas lojas que você marcar"],
            ].map(([e, t, d]) => (
              <div key={t} style={{ ...tile, background: "#F8FAFC" }}>
                <div style={emoji}>{e}</div>
                <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>{t}</div>
                <div style={{ color: "#64748B", fontSize: ".95rem", marginTop: 4, lineHeight: 1.45 }}>{d}</div>
              </div>
            ))}
          </div>

          {/* No desktop, a foto inteira: painel + popup lado a lado. No celular
              ela encolheria até o popup virar um borrão — e o popup É o produto
              (iFood 58 min · 99 preparo 43 min · Robô ligado). Então o celular
              recebe só o recorte do popup, em pé, no tamanho de ler. */}
          <figure style={{ margin: "22px 0 0", textAlign: "center" }}>
            <picture>
              <source media="(max-width: 700px)" srcSet="/prazos-popup.webp" width={320} height={590} />
              <img
                src="/prazos-produto.webp"
                width={1080}
                height={680}
                loading="lazy"
                alt="A extensão FireHub Prazos aberta: a coluna Em preparo marcada, 8 pedidos contados, iFood em 58 minutos e 99Food em 43 de preparo, robô ligado nas lojas marcadas"
                style={{ maxWidth: "100%", height: "auto", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 18px 45px rgba(15,23,42,.12)", display: "inline-block" }}
              />
            </picture>
            <figcaption style={{ color: "#64748B", fontSize: ".9rem", marginTop: 10 }}>
              A extensão de verdade, trabalhando.
            </figcaption>
          </figure>

          <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <Botao>Assinar por R$ 29,90/mês</Botao>
            <a href="/prazos/demo" style={{ color: LARANJA_LINK, fontWeight: 800, fontSize: ".98rem" }}>
              Quer testar antes? Abra o painel de demonstração →
            </a>
          </div>
        </div>
      </section>

      {/* ─────────── PREÇO ─────────── */}
      <section id="assinar" style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={secao}>
          <h2 style={{ ...h2, textAlign: "center", color: "#fff" }}>
            R$ 29,90 por mês.
            <br />
            <span style={{ color: "#FF7A59" }}>Menos de R$ 1 por dia.</span>
          </h2>
          <p style={{ color: "#CBD5E1", textAlign: "center", maxWidth: 560, margin: "0 auto 24px", lineHeight: 1.6 }}>
            Um pedido perdido por atraso custa <b style={{ color: "#fff" }}>R$ 46,64</b> com ticket de R$ 55 —
            uma mensalidade e meia.
          </p>
          <SeletorDePlano />

          {/* O que vem no preço. Cinco itens, todos verdadeiros hoje — nada de
              "bônus no valor de R$ X". A pilha de valor em low ticket é curta. */}
          <ul style={{ listStyle: "none", padding: 0, maxWidth: 720, margin: "22px auto 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "8px 24px", color: "#CBD5E1", lineHeight: 1.5, fontSize: ".98rem" }}>
            {[
              "iFood e 99Food, nas lojas que você marcar",
              "Ajuste a cada mudança na fila, o dia inteiro",
              "Relatório do dono: quanto tempo o prazo ficou alto, baixo e em estouro",
              "Atualizações incluídas — quando o iFood muda a tela, quem corre é a gente",
              "Suporte no WhatsApp com quem fez o produto e também toca loja",
            ].map((t) => (
              <li key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: "#34D399", fontWeight: 900, flexShrink: 0 }}>✓</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>

          <details style={{ ...detalhes, background: "#0B1220", border: "1px solid #334155", maxWidth: 720, margin: "18px auto 0" }}>
            <summary style={{ ...resumo, color: "#CBD5E1" }}>🧮 Quer fazer a conta da sua loja?</summary>
            <div style={{ color: "#0F172A" }}>
              <CalculadoraDePerda />
            </div>
          </details>
        </div>
      </section>

      {/* ─────────── O QUE ELA NUNCA FAZ ─────────── */}
      <section style={secao}>
        <h2 style={h2}>O que ela nunca faz</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16 }}>
          {[
            ["🚫", "Não aceita pedido"],
            ["🚫", "Não cancela"],
            ["🚫", "Não pausa a loja"],
            ["🚫", "Não mexe em preço"],
          ].map(([e, t]) => (
            <div key={t} style={tile}>
              <div style={emoji}>{e}</div>
              <div style={{ fontWeight: 800 }}>{t}</div>
            </div>
          ))}
        </div>
        <p style={{ ...p, marginTop: 16, marginBottom: 0 }}>
          Ela escreve o tempo, e só. Cozinha estourou? Ela avisa em vermelho. Pausar é decisão sua.
        </p>
      </section>

      {/* ─────────── GARANTIA ─────────── */}
      <section style={secao}>
        <div style={{ ...card, borderColor: "#BBF7D0", background: "#F0FDF4", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: "2.6rem", lineHeight: 1 }}>🛡️</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, marginBottom: 6 }}>7 dias de garantia, incondicional</div>
            <div style={{ color: "#166534", lineHeight: 1.55 }}>
              Use no seu movimento de verdade. Não fez o que promete? Cancela na Cakto ou manda um zap, e o
              dinheiro volta inteiro — sem pergunta, sem formulário. Depois disso, sem fidelidade: para quando quiser.
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── SERVE / NÃO SERVE ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Serve para você?</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
            <div style={{ ...card, borderColor: "#BBF7D0" }}>
              <div style={{ fontWeight: 900, marginBottom: 10, color: "#15803D", fontSize: "1.05rem" }}>✅ Serve se você</div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#334155", lineHeight: 1.8 }}>
                <li>Vê seus pedidos em colunas, numa aba do Chrome</li>
                <li>Entrega com motoboy próprio</li>
                <li>Deixa um computador ligado durante o serviço</li>
                <li>Tem uma loja ou várias, no mesmo login</li>
              </ul>
            </div>
            <div style={{ ...card, borderColor: "#FECACA" }}>
              <div style={{ fontWeight: 900, marginBottom: 10, color: "#B91C1C", fontSize: "1.05rem" }}>❌ Não serve se você</div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#334155", lineHeight: 1.8 }}>
                <li>Só usa a entrega do próprio iFood</li>
                <li>Anota pedido só no papel ou no WhatsApp</li>
                <li>Não deixa computador ligado na loja</li>
                <li>Tem lojas em logins separados do iFood</li>
                <li>Precisa de mais de 30 min de preparo no 99Food <span style={{ color: "#64748B", fontSize: ".88rem" }}>(teto deles, não nosso)</span></li>
              </ul>
            </div>
          </div>
          <p style={{ ...p, marginTop: 16, marginBottom: 0 }}>
            Preferimos perder a venda a ter você pedindo o dinheiro de volta na semana seguinte.
          </p>
        </div>
      </section>

      {/* ─────────── INSTALAÇÃO: dois botões, como no e-mail ─────────── */}
      <section id="instalar" style={secao}>
        <h2 style={h2}>Instalar não dá trabalho</h2>
        <p style={p}>Você assina agora, até pelo celular. No computador da loja, são dois cliques que chegam no e-mail:</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <div style={{ ...tile, borderLeft: `5px solid ${LARANJA}`, textAlign: "left" }}>
            <div style={{ fontWeight: 900, fontSize: "1.15rem" }}>1. Instalar no Chrome</div>
            <div style={{ color: "#64748B", marginTop: 4 }}>um clique, pela loja do Google</div>
          </div>
          <div style={{ ...tile, borderLeft: "5px solid #0F172A", textAlign: "left" }}>
            <div style={{ fontWeight: 900, fontSize: "1.15rem" }}>2. Ativar minha conta</div>
            <div style={{ color: "#64748B", marginTop: 4 }}>a extensão entra sozinha, sem senha</div>
          </div>
        </div>
        <p style={{ ...p, marginTop: 16, marginBottom: 0 }}>
          Depois, marque a coluna do seu painel. É o único passo que depende de você — só você sabe qual
          coluna é.
        </p>
      </section>

      {/* ─────────── FAQ (fechado) ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Perguntas que todo mundo faz</h2>
          {FAQ.map(([q, r]) => (
            <details key={q} style={{ borderBottom: "1px solid #E2E8F0", padding: "14px 0" }}>
              <summary style={{ fontWeight: 800, cursor: "pointer", fontSize: "1.03rem" }}>{q}</summary>
              <div style={{ color: "#475569", lineHeight: 1.65, marginTop: 8, maxWidth: 760 }}>{r}</div>
            </details>
          ))}
          <div style={{ color: "#475569", marginTop: 22, textAlign: "center" }}>
            Dúvida se funciona no seu caso?{" "}
            <a href={WA} target="_blank" rel="noopener" style={{ color: "#15803D", fontWeight: 800 }}>Chama no WhatsApp</a>.
          </div>
        </div>
      </section>

      {/* ─────────── CTA FINAL ─────────── */}
      <section style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, textAlign: "center" }}>
          <h2 style={{ ...h2, color: "#fff" }}>Hoje à noite o prazo já pode estar certo</h2>
          <p style={{ color: "#CBD5E1", maxWidth: 520, margin: "0 auto 22px", lineHeight: 1.6 }}>
            R$ 29,90 por mês, 7 dias de garantia, sem fidelidade. O acesso chega no e-mail na hora.
          </p>
          <Botao style={{ fontSize: "1.15rem", padding: "18px 36px" }}>Assinar por R$ 29,90/mês</Botao>
          <div style={{ color: "#94A3B8", fontSize: ".82rem", marginTop: 16, lineHeight: 1.6 }}>
            Pagamento pela Cakto · cartão ou Pix
            <br />
            A Cakto soma R$ 0,99 de taxa de serviço no checkout: o total dessa cobrança fica R$ 30,89.
          </div>
        </div>
      </section>

      <footer style={{ textAlign: "center", color: "#64748B", fontSize: ".82rem", padding: "2.2rem 1rem", lineHeight: 1.8 }}>
        FireHub Prazos é um produto FireHub · <a href="https://firehubfood.com.br" style={{ color: "#64748B" }}>firehubfood.com.br</a> · contato@firehubfood.com.br
        <br />
        <a href="/prazos/instalar" style={{ color: "#64748B" }}>Instalar a extensão</a> · <a href="/privacidade-prazos" style={{ color: "#64748B" }}>Política de privacidade</a>
        <br />
        <span style={{ fontSize: ".76rem" }}>
          Produto independente. Não somos iFood nem 99Food, e não temos vínculo com essas empresas.
        </span>
      </footer>

      <BarraFixa />
    </main>
  );
}
