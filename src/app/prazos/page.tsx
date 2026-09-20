import type { Metadata } from "next";
import DemoAoVivo from "./DemoAoVivo";
import NoiteDaCozinha from "./NoiteDaCozinha";
import CalculadoraDePerda from "./CalculadoraDePerda";
import { SeletorDePlano } from "./Assinar";
import VoceSabia from "./VoceSabia";
import GatilhoDoHero from "./GatilhoDoHero";
import RastreioDeClique from "./RastreioDeClique";
import QuemJaUsa from "./QuemJaUsa";
import { CHECKOUT_PADRAO, PLANOS } from "./planos";
import { CHEFS } from "./chefs";
import { SeloDeGarantia } from "./SeloDeGarantia";
import { TEXTO_CTA, PRECO_SOB_BOTAO } from "./textos";

export const metadata: Metadata = {
  title: "FireHub Prazos — o prazo do iFood muda sozinho quando a cozinha enche",
  description:
    "Extensão para o Chrome que olha a fila do seu painel de pedidos e escreve o prazo certo no iFood e o tempo de preparo no 99Food. R$ 29,90 por mês, 30 dias de garantia.",
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
 *   - garantia de 30 dias (era 7, o mínimo do CDC art. 49, que comunica
 *     "fiz o mínimo"): o produto prova valor no PICO, e 7 dias pegam um fim
 *     de semana só. Trocado em 19/09/2026, decisão do dono — a oferta na
 *     Cakto tem que dizer o mesmo;
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
  ["Tenho mais de uma marca saindo da mesma cozinha. Como fica?", "Esse é o caso da faixa com desconto. Como é uma fila só, a extensão escreve o prazo nas duas (ou cinco) ao mesmo tempo: a primeira loja custa R$ 29,90 e cada uma a mais custa R$ 9,90 — um terço. Vale para as duas plataformas: mais uma no iFood e mais uma no 99Food. Só precisam estar no mesmo login do Portal do Parceiro. E você marca na extensão quais mudam de prazo; as que não marcar ficam como estão."],
  ["E se minhas lojas ficam em endereços diferentes?", "Aí é uma assinatura para cada uma, e não a faixa de 2, 3 ou 5. O motivo é simples: a extensão roda no Chrome do computador da loja e lê a fila DAQUELE painel. A cozinha do centro pode estar com 14 pedidos enquanto a da praia está vazia — uma não pode escrever o prazo da outra. Se você tem rede, chama no WhatsApp que a gente fecha as lojas juntas e organiza o acesso de todas."],
  ["O prazo do 99 é o mesmo do iFood?", "Não, e é de propósito. No 99 o cliente vê o tempo de preparo somado ao tempo de entrega da faixa que você cadastrou, então a extensão mexe só no preparo. Você configura essa regra separada."],
  ["E se o iFood mudar a tela e ela parar?", "Acontece, e quem corre é a gente: a atualização é nossa, não sua. Enquanto isso ela segura o último prazo e avisa na tela, em vez de sumir com o prazo. Se ficar sem funcionar, você cancela na Cakto e, dentro dos 30 dias, o dinheiro volta inteiro."],
  ["Dá para pagar no Pix?", "Sim: Pix Automático ou cartão, pela Cakto. No Pix a renovação também é automática, sem você lembrar todo mês."],
  ["Consigo cancelar fácil?", "Sim, direto na Cakto, sem falar com ninguém. Não tem fidelidade nem multa. E se cancelar dentro de 30 dias, o dinheiro volta inteiro."],
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
      // O nome da oferta diz a regra, porque o assistente de IA que lê isto
      // responde "quanto custa para 5 lojas?" sem abrir a página — e a
      // resposta certa depende de as lojas dividirem ou não a mesma cozinha.
      name: p.lojas === 1 ? "1 loja" : `${p.lojas} lojas no mesmo endereço (mesma cozinha, mesmo login do iFood)`,
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
/** Alcance somado de quem indica, em milhares. */
const ALCANCE_MIL = CHEFS.reduce((t, c) => t + (c.seguidoresMil ?? 0), 0);
const CHECKOUT = CHECKOUT_PADRAO;
const WA = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Tenho%20uma%20d%C3%BAvida%20sobre%20o%20FireHub%20Prazos.";

function Botao({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <a
      href={CHECKOUT}
      className="cta-pulsa"
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
      {/* Nada do FireHub (o sistema) em cima da venda do Prazos.
          A extensão INTERNA da casa injeta uma pílula no canto
          ("FireHub: 28 min · 2 ped.") em toda página do domínio — o
          manifesto dela já foi restringido a /store/*, mas isto aqui vale
          para quem ainda não recarregou a extensão, e para qualquer outra
          que injete algo parecido amanhã. É CSS: a página não tem como
          desinstalar extensão, mas tem como esconder o que ela desenha. */}
      <style>{`
        #firehub-corner-pill, #firehub-ifood-tab-alert, #fhprazos-pill { display: none !important; }

        /* A pulsação do botão de ação: ela existe para o olho achar o botão
           depois de rolar meia tela de texto, não para chamar atenção o
           tempo todo. Por isso é lenta, discreta (3% de escala) e some
           quando o ponteiro chega. CSS puro — a página não carrega
           biblioteca de animação por causa do tempo de abertura no 4G. */
        @keyframes cta-pulsa {
          0%, 100% { transform: scale(1); box-shadow: 0 10px 28px rgba(255,87,34,.35); }
          50% { transform: scale(1.03); box-shadow: 0 14px 34px rgba(255,87,34,.55); }
        }
        .cta-pulsa { animation: cta-pulsa 2.4s ease-in-out infinite; will-change: transform; }
        .cta-pulsa:hover, .cta-pulsa:focus-visible { animation-play-state: paused; transform: scale(1.03); }
        /* Quem pediu menos movimento no sistema não recebe pulsação nenhuma. */
        @media (prefers-reduced-motion: reduce) {
          .cta-pulsa { animation: none; }
        }
      `}</style>
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

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            <Botao>{TEXTO_CTA}</Botao>
            {/* O preço sai do botão e vira a âncora ao lado dele: o número
                que ele compara não é com concorrente, é com o pedido que
                ele perde numa noite. */}
            <div style={{ color: "#fff", fontWeight: 800, fontSize: "1.05rem", lineHeight: 1.35 }}>
              R$ 29,90 por mês.
              <br />
              <span style={{ color: "#FF7A59" }}>Menos de R$ 1 por dia.</span>
            </div>
          </div>
          {/* Quem chega de anúncio quase nunca compra no primeiro clique, e a
              alternativa a "comprar agora" não pode ser "fechar a aba" — tem
              que ser a demonstração, que é o melhor vendedor desta página.
              Ela roda logo abaixo, então aqui vai só a seta: mandar para
              /prazos/demo seria pior, porque aquela página só faz sentido
              com a extensão JÁ instalada. */}
          <div style={{ color: "#FF7A59", fontWeight: 800, fontSize: ".95rem", marginBottom: 10 }}>
            ↓ Veja aqui embaixo, ao vivo: a fila enche, o prazo sobe sozinho.
          </div>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginBottom: 10 }}>
            Leva 2 minutos · Pix ou cartão · 30 dias de garantia · sem fidelidade
          </div>
          {/* A objeção de "extensão do Chrome" nasce no primeiro segundo, e
              até aqui só era respondida lá embaixo na FAQ — depois do ponto
              em que essa pessoa já tinha saído. */}
          {/* #64748B sobre o azul do hero dá 3,2 de contraste — abaixo do
              mínimo para texto pequeno. Mesmo cinza das outras linhas. */}
          <div style={{ color: "#94A3B8", fontSize: ".82rem", marginBottom: 18 }}>
            Não lê senha · não aceita nem cancela pedido · você desliga num clique
          </div>

          {/* Quem indica, com a cara, no primeiro segundo da página: a seção
              inteira fica depois de três dobras, e a maioria decide antes de
              chegar lá. O selo leva para ela. */}
          {CHEFS.length > 0 && (
            <a href="#quem-indica" style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(255,87,34,.12)", border: "1px solid rgba(255,122,89,.45)", borderRadius: 999, padding: "7px 16px 7px 7px", marginBottom: 28, textDecoration: "none" }}>
              <span style={{ display: "flex" }}>
                {CHEFS.map((c, i) =>
                  c.foto ? (
                    <img
                      key={c.arroba}
                      src={c.foto}
                      width={34}
                      height={34}
                      alt=""
                      style={{ width: 34, height: 34, borderRadius: 999, objectFit: "cover", border: "2px solid #0F172A", marginLeft: i === 0 ? 0 : -10 }}
                    />
                  ) : null,
                )}
              </span>
              <span style={{ color: "#FFD9CF", fontSize: ".92rem", lineHeight: 1.35 }}>
                Indicado por{" "}
                <b style={{ color: "#fff" }}>
                  {CHEFS.map((c) => "@" + c.arroba).join(" e ")}
                </b>
                {/* Com dois chefs, repetir só o número do primeiro daria a
                    entender que 145 mil é o total. Aqui vai a soma, e ela é
                    arredondada PARA BAIXO na casa das dezenas: número de
                    alcance a gente não infla. */}
                {ALCANCE_MIL > 0 ? ` · ${Math.floor(ALCANCE_MIL / 10) * 10} mil seguidores${CHEFS.length > 1 ? " somados" : ""}` : ""}
              </span>
            </a>
          )}

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

      {/* ─────────── "EU MUDO NA MÃO": a objeção que segura a venda ───────────
          Ninguém compra isto por não saber mudar o prazo — todo lojista sabe.
          A objeção real é "eu já faço isso". A página respondia a segurança,
          o preço e a instalação, e deixava essa de pé. Três cartões, porque
          o argumento é o mesmo em três horas diferentes da noite. */}
      <section style={{ background: "#F1F5F9", borderTop: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>“Mas eu mudo o prazo na mão”</h2>
          <p style={p}>
            Muda. Nas duas ou três vezes em que dá para parar. O problema é que a fila muda a cada pedido
            que entra e a cada um que sai — e o Portal do Parceiro não vem até você.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14, marginTop: 18 }}>
            {[
              ["🔥", "20h30, entraram 14 pedidos", "É exatamente a hora em que ninguém tem mão livre para abrir o Portal e digitar 58."],
              ["🥶", "22h10, a cozinha esvaziou", "O prazo alto continua lá, afastando cliente, porque baixar não parece urgente para ninguém."],
              // Era "Domingo, o gerente folga" — e o dono cortou: ninguém dá
              // folga de domingo para gerente de delivery. O argumento não
              // precisa do dia, precisa da ausência.
              ["🧯", "No dia de folga do gerente", "Na mão, o prazo certo depende de uma pessoa lembrar. A loja não pode depender de memória."],
            ].map(([e, t, d]) => (
              <div key={t} style={card}>
                <div style={{ fontSize: "1.8rem", lineHeight: 1, marginBottom: 8 }}>{e}</div>
                <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>{t}</div>
                <div style={{ color: "#64748B", fontSize: ".95rem", marginTop: 6, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>
          <p style={{ ...p, marginTop: 16, marginBottom: 0 }}>
            A extensão não lembra melhor que você. Ela só não tem mais nada para fazer: a cada mudança na
            tela, ela conta a fila e escreve o número. A noite inteira, todo dia que a loja abre.
          </p>
        </div>
      </section>

      {/* ─────────── COMO FUNCIONA: três ícones e a foto real ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Três passos, uma vez só</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 18 }}>
            {/* O número em laranja dá ordem de leitura ao que antes eram três
                cartões cinzas iguais — e diz de relance que são só três. */}
            {[
              ["👆", "Marca a coluna", "no seu painel, com um clique"],
              ["🔢", "Ela conta", "a cada mudança na tela"],
              ["✍️", "Ela escreve", "no iFood e no 99Food, nas lojas que você marcar"],
            ].map(([e, t, d], i) => (
              // Fundo levemente cinza porque a seção é branca: cartão branco
              // em fundo branco não existe.
              <div key={t} style={{ ...tile, background: "#F8FAFC", border: "1px solid #E2E8F0", borderTop: `4px solid ${LARANJA}`, position: "relative", paddingTop: "1.6rem" }}>
                <div style={{
                  position: "absolute", top: -16, left: "50%", transform: "translateX(-50%)",
                  width: 30, height: 30, borderRadius: 999, background: `linear-gradient(135deg, ${LARANJA}, #E64A19)`,
                  color: "#fff", fontWeight: 900, display: "grid", placeItems: "center", fontSize: ".95rem",
                  boxShadow: "0 6px 16px rgba(255,87,34,.35)",
                }}>
                  {i + 1}
                </div>
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
            <div>
              <Botao>{TEXTO_CTA}</Botao>
              <div style={{ color: "#64748B", fontSize: ".85rem", marginTop: 8 }}>{PRECO_SOB_BOTAO}</div>
            </div>
            {/* O texto antigo ("Quer testar antes?") mandava quem não tem a
                extensão para uma página que só funciona com ela instalada —
                e essa pessoa não voltava. O convite agora diz para quem é. */}
            <a href="/prazos/demo" style={{ color: LARANJA_LINK, fontWeight: 800, fontSize: ".98rem" }}>
              Já instalou? Teste a marcação no painel de demonstração →
            </a>
          </div>
        </div>
      </section>

      {/* ─────────── QUEM JÁ USA: prova de uso, antes do preço ─────────── */}
      <QuemJaUsa />

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
              "Suporte no WhatsApp com quem fez o produto",
            ].map((t) => (
              <li key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: "#34D399", fontWeight: 900, flexShrink: 0 }}>✓</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>

          <details style={{ ...detalhes, background: "#0B1220", border: "1px solid #334155", maxWidth: 720, margin: "18px auto 0" }}>
            {/* O rótulo antigo ("Quer fazer a conta da sua loja?") pedia
                trabalho sem prometer nada. Este promete o número que a
                calculadora entrega — que é o argumento de venda dela. */}
            <summary style={{ ...resumo, color: "#CBD5E1" }}>🧮 Quanto a sua loja perde por mês com prazo errado?</summary>
            <div style={{ color: "#0F172A" }}>
              <CalculadoraDePerda />
            </div>
          </details>
        </div>
      </section>

      {/* ─────────── O QUE ELA NUNCA FAZ ─────────── */}
      <section style={secao}>
        <h2 style={h2}>O que ela nunca faz</h2>
        {/* Quatro emojis 🚫 iguais viravam ruído visual. Cada limite ganhou
            o ícone do que ele protege, num cartão vermelho claro: isto aqui
            é alívio, não proibição — e alívio precisa ser visto. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 16 }}>
          {[
            ["🧾", "Não aceita pedido"],
            ["🗑️", "Não cancela"],
            ["⏸️", "Não pausa a loja"],
            ["🏷️", "Não mexe em preço"],
          ].map(([e, t]) => (
            <div key={t} style={{ ...tile, background: "#FEF2F2", border: "1px solid #FECACA", position: "relative", paddingTop: "1.5rem" }}>
              <div style={{ position: "absolute", top: 10, right: 12, color: "#DC2626", fontWeight: 900, fontSize: ".95rem" }}>✕</div>
              <div style={emoji}>{e}</div>
              <div style={{ fontWeight: 800, color: "#7F1D1D" }}>{t}</div>
            </div>
          ))}
        </div>
        <p style={{ ...p, marginTop: 16, marginBottom: 0 }}>
          Ela escreve o tempo, e só. Cozinha estourou? Ela avisa em vermelho. Pausar é decisão sua.
        </p>
      </section>

      {/* ─────────── GARANTIA ───────────
          Era um retângulo verde claro com um emoji de escudo, e o dono
          resumiu bem: "sem graça". Garantia é o argumento que tira o medo de
          pagar; ela merece o peso de um selo — verde forte, o 7 no tamanho
          de manchete e as três promessas separadas, para serem lidas de
          relance por quem está decidindo. */}
      <section style={secao}>
        <div className="bloco-garantia" style={{
          background: "linear-gradient(135deg, #047857 0%, #065F46 55%, #064E3B 100%)",
          borderRadius: 22, padding: "1.8rem 1.9rem", color: "#fff",
          display: "flex", gap: 26, alignItems: "center", flexWrap: "wrap",
          boxShadow: "0 22px 50px rgba(4,120,87,.28)",
        }}>
          {/* Medalha em SVG (./SeloDeGarantia): o círculo tracejado anterior
              parecia rascunho. No celular ela vai para o meio — encostada na
              esquerda, com o texto embaixo, ficava torta. */}
          <div className="selo-garantia">
            <SeloDeGarantia />
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: "clamp(1.4rem, 3vw, 1.8rem)", fontWeight: 900, lineHeight: 1.15, marginBottom: 8 }}>
              Use um mês inteiro. Não gostou, devolvemos tudo.
            </div>
            <div style={{ color: "#D1FAE5", lineHeight: 1.6, fontSize: "1.02rem", marginBottom: 14 }}>
              {/* Quatro fins de semana é o argumento: prazo de garantia só
                  vale se pegar o movimento em que o produto prova valor. */}
              Trinta dias é mês fechado — <b style={{ color: "#fff" }}>quatro sextas e quatro sábados</b>,
              que é quando a cozinha enche e o prazo importa. Não fez o que promete? Cancela na Cakto
              ou manda um zap: o dinheiro volta <b style={{ color: "#fff" }}>inteiro</b>.
            </div>
            <div className="pilulas-garantia" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Sem pergunta", "Sem formulário", "Sem fidelidade depois"].map((t) => (
                <span key={t} style={{
                  background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.32)",
                  borderRadius: 999, padding: "6px 14px", fontWeight: 800, fontSize: ".88rem",
                }}>
                  ✓ {t}
                </span>
              ))}
            </div>
          </div>
        </div>
        <style>{`
          .selo-garantia { flex-shrink: 0; }
          @media (max-width: 720px) {
            /* No celular a medalha vira o título do bloco: centralizada em
               cima do texto, que continua alinhado à esquerda para ler. */
            .bloco-garantia { justify-content: center; text-align: center; }
            .selo-garantia { width: 100%; display: flex; justify-content: center; }
            .bloco-garantia .pilulas-garantia { justify-content: center; }
          }
        `}</style>
      </section>

      {/* ─────────── SERVE / NÃO SERVE ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Serve para você?</h2>
          {/* Duas caixas brancas com borda pálida não diziam de longe qual
              era a boa e qual era a ruim — a cor faz esse trabalho antes da
              leitura. Faixa colorida no topo, fundo tingido, e o marcador de
              cada linha em vez de bolinha de lista. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 16 }}>
            {[
              {
                titulo: "Serve se você",
                marcador: "✓",
                faixa: "linear-gradient(135deg,#16A34A,#15803D)",
                fundo: "#F0FDF4",
                borda: "#BBF7D0",
                cor: "#166534",
                itens: [
                  <>Vê seus pedidos em colunas, numa aba do Chrome</>,
                  <>Entrega com motoboy próprio</>,
                  <>Deixa um computador ligado durante o serviço</>,
                  <>Tem uma loja — ou várias marcas saindo da mesma cozinha</>,
                ],
              },
              {
                titulo: "Não serve se você",
                marcador: "✕",
                faixa: "linear-gradient(135deg,#DC2626,#B91C1C)",
                fundo: "#FEF2F2",
                borda: "#FECACA",
                cor: "#991B1B",
                itens: [
                  <>Só usa a entrega do próprio iFood</>,
                  <>Anota pedido só no papel ou no WhatsApp</>,
                  <>Não deixa computador ligado na loja</>,
                  <>
                    Quer cobrir com uma assinatura só lojas de endereços diferentes, ou de logins separados do iFood{" "}
                    <span style={{ color: "#B45309", fontSize: ".88rem" }}>(cada cozinha tem a própria fila — é uma assinatura para cada)</span>
                  </>,
                  <>
                    Precisa de mais de 30 min de preparo no 99Food{" "}
                    <span style={{ color: "#B45309", fontSize: ".88rem" }}>(teto deles, não nosso)</span>
                  </>,
                ],
              },
            ].map((c) => (
              <div key={c.titulo} style={{ background: c.fundo, border: `1px solid ${c.borda}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 6px 20px rgba(15,23,42,.05)" }}>
                <div style={{ background: c.faixa, color: "#fff", fontWeight: 900, fontSize: "1.05rem", padding: "11px 18px", display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 999, background: "rgba(255,255,255,.22)", fontSize: ".85rem" }}>{c.marcador}</span>
                  {c.titulo}
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: "14px 18px", color: "#334155", lineHeight: 1.55, display: "grid", gap: 10 }}>
                  {c.itens.map((t, i) => (
                    <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ color: c.cor, fontWeight: 900, flexShrink: 0 }}>{c.marcador}</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p style={{ ...p, marginTop: 16, marginBottom: 0 }}>
            Preferimos perder a venda a ter você pedindo o dinheiro de volta no mês seguinte.
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
          {/* A urgência desta página é a real, não um contador regressivo:
              enquanto ele não instala, o prazo errado continua indo para o
              cliente todas as noites. Escassez inventada converte pior que
              nenhuma — e o público aqui já viu essa peça em infoproduto. */}
          <p style={{ color: "#FFD9CF", fontWeight: 800, maxWidth: 560, margin: "0 auto 14px", lineHeight: 1.55, fontSize: "1.05rem" }}>
            Toda noite que passa é uma noite prometendo 28 minutos com a cozinha cheia.
          </p>
          <p style={{ color: "#CBD5E1", maxWidth: 520, margin: "0 auto 22px", lineHeight: 1.6 }}>
            Instala em 2 minutos e o acesso chega no e-mail na hora. Sem fidelidade.
          </p>
          <Botao style={{ fontSize: "1.15rem", padding: "18px 36px" }}>{TEXTO_CTA}</Botao>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: "1rem", marginTop: 14 }}>
            R$ 29,90 por mês · menos de R$ 1 por dia
          </div>
          <div style={{ color: "#94A3B8", fontSize: ".82rem", marginTop: 10, lineHeight: 1.6 }}>
            Pagamento pela Cakto · cartão ou Pix
            <br />
            A Cakto soma R$ 0,99 de taxa de serviço no checkout: o total dessa cobrança fica R$ 30,89.
          </div>
          {/* Quem chegou até aqui e não clicou tem uma pergunta, não uma
              objeção de preço. A saída dele não pode ser o botão de voltar. */}
          <div style={{ color: "#CBD5E1", fontSize: ".95rem", marginTop: 18 }}>
            Ficou uma dúvida sobre a sua loja?{" "}
            <a href={WA} target="_blank" rel="noopener" style={{ color: "#4ADE80", fontWeight: 800 }}>
              Pergunta no WhatsApp
            </a>{" "}
            — responde quem fez o produto.
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

    </main>
  );
}
