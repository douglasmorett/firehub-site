import type { Metadata } from "next";
import DemoAoVivo from "./DemoAoVivo";
import CalculadoraDePerda from "./CalculadoraDePerda";
import { SeletorDePlano, BarraFixa } from "./Assinar";
import { CHECKOUT_PADRAO } from "./planos";

export const metadata: Metadata = {
  title: "FireHub Prazos — o prazo do iFood muda sozinho quando a cozinha enche",
  description:
    "Extensão para o Chrome que olha a fila do seu painel de pedidos e escreve o prazo certo no iFood e o tempo de preparo no 99Food. R$ 29,90 por mês, 7 dias de garantia.",
  openGraph: {
    title: "O prazo do seu iFood muda sozinho quando a cozinha enche",
    description: "A extensão olha a fila da sua cozinha e escreve o prazo certo no iFood e no 99Food. Sem abrir o portal.",
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
 * Desenho guiado pelo que tem evidência, não por gosto:
 *   - texto em linguagem de cozinha, não de software (o fator com maior
 *     efeito medido em conversão de landing: leitura simples converte muito
 *     mais que texto profissional);
 *   - preço no topo, porque em R$ 29,90 o preço é o argumento, não a objeção. O
 *     alvo declarado pelo dono (09/09/2026) é uma mensalidade que o lojista
 *     esquece que paga: R$ 1,00 por dia, menos que um pedido perdido;
 *   - um só botão, repetido, sempre com o mesmo texto;
 *   - a demonstração do produto acima da dobra, não descrição dele;
 *   - a objeção "o iFood já faz isso" respondida de frente, com o que a
 *     documentação do próprio iFood diz;
 *   - garantia em bloco visual próprio, não em nota de rodapé. São 7 dias por
 *     decisão do dono (08/09/2026), alinhados com o que está cadastrado na
 *     Cakto — a pesquisa sugeria 30, mas o argumento dele venceu: um fim de
 *     semana já basta para o lojista ver o produto trabalhando, e prazo curto
 *     é mais fácil de honrar sem discussão;
 *   - números só quando medidos de verdade, com período declarado.
 *
 * Nada de biblioteca de animação nem fonte externa: a página tem que abrir
 * em menos de 2 s no 4G, que é o item de maior efeito medido depois do texto.
 */

const LARANJA = "#FF5722";
// O laranja da marca sobre branco da contraste 3,16 — abaixo do minimo de
// leitura. Este e o mesmo laranja escurecido, so para texto de link.
const LARANJA_LINK = "#C2410C";
const CHECKOUT = CHECKOUT_PADRAO;
const ZIP = "https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip";
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
  const secao: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: "3.2rem 1.25rem" };
  const h2: React.CSSProperties = { fontSize: "clamp(1.4rem, 3.2vw, 1.9rem)", fontWeight: 900, margin: "0 0 10px", lineHeight: 1.2 };
  const p: React.CSSProperties = { color: "#475569", lineHeight: 1.65, fontSize: "1.02rem", margin: "0 0 14px", maxWidth: 720 };
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.2rem 1.35rem", boxShadow: "0 6px 20px rgba(15,23,42,.05)" };

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", color: "#0F172A", background: "#F8FAFC" }}>
      {/* ─────────── HERO ─────────── */}
      <section style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, paddingTop: "2.2rem", paddingBottom: "2.6rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${LARANJA}, #F44336)`, display: "grid", placeItems: "center", fontSize: "1.1rem" }}>🔥</div>
            <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>FireHub Prazos</div>
          </div>

          <h1 style={{ fontSize: "clamp(1.9rem, 5vw, 3.1rem)", lineHeight: 1.08, fontWeight: 900, margin: "0 0 16px", maxWidth: 860 }}>
            O prazo do seu iFood sobe sozinho<br style={{ display: "none" }} /> quando a cozinha enche.
            <span style={{ color: "#FF7A59" }}> E desce quando esvazia.</span>
          </h1>

          <p style={{ fontSize: "1.12rem", color: "#CBD5E1", maxWidth: 700, lineHeight: 1.6, margin: "0 0 22px" }}>
            A extensão olha a fila de pedidos no painel que você já usa e escreve o prazo certo no iFood
            e o tempo de preparo no 99Food. Você não abre o portal, não digita nada e não troca de sistema.
          </p>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <Botao>Assinar por R$ 29,90/mês</Botao>
            <div style={{ color: "#CBD5E1", fontSize: ".95rem" }}>
              <b style={{ color: "#fff" }}>R$ 29,90 por mês.</b> Dá R$ 1,00 por dia.
            </div>
          </div>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginBottom: 30 }}>
            Leva 2 minutos e o acesso chega no seu e-mail na hora · 7 dias de garantia · sem fidelidade ·
            funciona com o sistema de pedidos que você já tem
          </div>

          <DemoAoVivo />
        </div>
      </section>

      {/* ─────────── O PROBLEMA, COM NÚMERO NOSSO ─────────── */}
      <section style={secao}>
        <h2 style={h2}>Prazo fixo não serve para 3 pedidos e para 43</h2>
        <p style={p}>
          Com a cozinha vazia, 30 minutos é folga: o cliente recebe antes e acha ótimo. No pico, os mesmos
          30 minutos viram promessa quebrada. O pedido atrasa, o cliente reclama, a nota cai.
        </p>
        <p style={p}>
          E ninguém tem tempo de abrir o portal do iFood no meio do rush para mudar o prazo. Muito menos
          loja por loja.
        </p>

        <div style={{ ...card, marginTop: 18, background: "#0F172A", color: "#fff", border: "1px solid #334155" }}>
          <div style={{ fontSize: ".72rem", fontWeight: 800, color: "#FF7A59", letterSpacing: ".4px", marginBottom: 12 }}>
            MEDIDO NA NOSSA PRÓPRIA LOJA, NOS ÚLTIMOS 30 DIAS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
            {[
              { n: "9", u: "pedidos por hora", d: "na média do mês" },
              { n: "43", u: "pedidos na pior hora", d: "quase 5x a média" },
              { n: "41%", u: "das horas com 10 ou mais", d: "141 de 346 horas" },
            ].map((x) => (
              <div key={x.u}>
                <div style={{ fontSize: "2.1rem", fontWeight: 900, lineHeight: 1 }}>{x.n}</div>
                <div style={{ fontWeight: 700, fontSize: ".92rem", marginTop: 2 }}>{x.u}</div>
                <div style={{ color: "#94A3B8", fontSize: ".8rem" }}>{x.d}</div>
              </div>
            ))}
          </div>
          <div style={{ color: "#CBD5E1", fontSize: ".92rem", marginTop: 16, lineHeight: 1.55 }}>
            É a mesma cozinha, no mesmo mês. Qualquer prazo fixo que você escolher vai estar errado na
            metade do tempo.
          </div>
        </div>

        <h3 style={{ fontSize: "1.15rem", fontWeight: 900, margin: "34px 0 10px" }}>
          A mesma sexta-feira, duas vezes
        </h3>
        <p style={{ ...p, marginBottom: 6 }}>
          Um exemplo de uma noite, com 3 motoboys na casa: mesma cozinha, mesmos pedidos, muda só quem
          escreve o prazo. Os minutos em laranja são os mesmos da demonstração lá em cima — a tabela
          que a extensão usa de verdade.
        </p>
        {/* Grade, não <table>: no celular a coluna que vende (a laranja) ficava
            fora da tela atrás de uma rolagem lateral, e é justamente ela que
            o lojista precisa ver. Aqui cada hora vira um cartão empilhado. */}
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {[
            ["19h", "3 pedidos na cozinha", "sai em 22 min — você prometeu de menos e espantou quem tinha pressa", "28 min", "#15803D", "#DCFCE7"],
            ["20h", "8 pedidos na cozinha", "sai em 41 min — atrasou 11, e o cliente já pode cancelar", "58 min", "#B45309", "#FEF3C7"],
            ["21h", "14 pedidos na cozinha", "sai em 63 min — atrasou 33, e a nota vai junto", "78 min", "#B91C1C", "#FEE2E2"],
            ["22h", "6 pedidos na cozinha", "sai em 34 min — no limite", "38 min", "#B45309", "#FEF3C7"],
            ["23h", "3 pedidos na cozinha", "sai em 24 min — de novo prometendo demais", "28 min", "#15803D", "#DCFCE7"],
          ].map(([hora, fila, fixo, novo, cor, fundo]) => (
            <div key={hora} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 13, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                <span style={{ fontWeight: 900, fontSize: "1.05rem" }}>{hora}</span>
                <span style={{ color: "#64748B", fontSize: ".92rem" }}>{fila}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "9px 11px" }}>
                  <div style={{ fontSize: ".7rem", fontWeight: 800, color: "#64748B", letterSpacing: ".3px", marginBottom: 3 }}>PRAZO FIXO DE 30 MIN</div>
                  <div style={{ color: "#475569", lineHeight: 1.5, fontSize: ".93rem" }}>{fixo}</div>
                </div>
                <div style={{ background: fundo, border: `1px solid ${cor}33`, borderRadius: 10, padding: "9px 11px" }}>
                  <div style={{ fontSize: ".7rem", fontWeight: 800, color: cor, letterSpacing: ".3px", marginBottom: 3 }}>🔥 COM A EXTENSÃO</div>
                  <div style={{ fontWeight: 900, color: cor, fontSize: "1.15rem", lineHeight: 1.3 }}>{novo}</div>
                  <div style={{ color: "#475569", fontSize: ".85rem" }}>é o que a fila aguenta</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ ...p, marginTop: 12, marginBottom: 0 }}>
          Repare nas pontas: prazo fixo erra dos <b>dois</b> lados. Promete demais no pico e promete de menos
          com a cozinha vazia — e aí quem estava com fome escolhe a loja do lado, que disse 25 minutos.
        </p>

        <CalculadoraDePerda />
      </section>


      {/* ─────────── A PROVOCAÇÃO (verdadeira, sem número inventado) ─────────── */}
      <section style={{ background: "#0F172A", color: "#fff" }}>
        <div style={secao}>
          <h2 style={{ ...h2, color: "#fff" }}>Quem muda o prazo na sua loja hoje?</h2>
          <p style={{ color: "#CBD5E1", lineHeight: 1.7, fontSize: "1.05rem", maxWidth: 720, margin: "0 0 16px" }}>
            Se a resposta é "eu, quando lembro", você já sabe onde dói. E se a resposta é "ninguém, porque
            deixei alto e travei", dói de outro jeito.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, margin: "22px 0" }}>
            {[
              ["😐", "Prazo travado no alto", "Você põe 50 minutos e esquece, para o funcionário não errar. Aí o cliente que ia pedir às 15h da terça vê 50 minutos e pede na loja do lado."],
              ["😤", "Prazo travado no baixo", "Você põe 30 para parecer rápido. Sábado 20h a cozinha lota, o pedido sai atrasado e vira nota baixa."],
              ["🙂", "Prazo que acompanha a cozinha", "Baixo quando está vazio, alto quando está cheio. É o único que está certo nas duas horas."],
            ].map(([e, t2, d]) => (
              <div key={t2} style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 14, padding: "1rem 1.15rem" }}>
                <div style={{ fontSize: "1.5rem" }}>{e}</div>
                <div style={{ fontWeight: 900, margin: "6px 0 6px" }}>{t2}</div>
                <div style={{ color: "#CBD5E1", fontSize: ".95rem", lineHeight: 1.55 }}>{d}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "#1E293B", border: "1px solid #334155", borderLeft: "4px solid #FF5722", borderRadius: 12, padding: "1rem 1.2rem", maxWidth: 760 }}>
            <div style={{ color: "#CBD5E1", lineHeight: 1.65 }}>
              E não é só o cliente que repara. O próprio iFood lista{" "}
              <b style={{ color: "#fff" }}>"tempo de preparo e pontualidade na entrega"</b> entre as coisas que
              contam para a sua loja aparecer no aplicativo, junto com cancelamento e nota.{" "}
              <a href="https://blog-parceiros.ifood.com.br/aparecer-no-ifood/" target="_blank" rel="noopener" style={{ color: "#FF7A59", fontWeight: 700 }}>
                Está escrito no blog de parceiros deles
              </a>.
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── A REGRA É DELAS, NÃO NOSSA ───────────
          Todas as frases entre aspas aqui foram conferidas na página oficial
          no dia 08/09/2026, uma por uma. Nada de citação de segunda mão: se um
          dia sair do ar ou mudar, esta seção muda junto. */}
      <section style={secao}>
        <h2 style={h2}>A gente não inventou esse problema. Quem escreveu foi o iFood e o 99</h2>
        <p style={p}>
          Não precisa acreditar na nossa palavra. Está tudo publicado por elas, e dá para conferir agora,
          nos links de cada frase.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 16, marginTop: 20 }}>
          <div style={{ ...card, borderLeft: `4px solid ${LARANJA}` }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>O relógio do atraso, no iFood</div>
            <blockquote style={{ margin: "0 0 10px", color: "#0F172A", lineHeight: 1.6, fontStyle: "italic" }}>
              "Se o pedido for em restaurante e o atraso ultrapassar 10 minutos do prazo estimado durante a
              preparação, é considerado atrasado."
            </blockquote>
            <div style={{ color: "#475569", lineHeight: 1.6, fontSize: ".95rem" }}>
              A partir daí o cliente tem, no próprio aplicativo, o caminho para cancelar e pedir o dinheiro
              de volta. E repare contra o que o relógio corre: <b>o prazo que a sua loja publicou</b>.
            </div>
            <a href="https://institucional.ifood.com.br/ajuda/problemas-com-o-pedido-ifood/" target="_blank" rel="noopener" style={{ color: LARANJA_LINK, fontWeight: 700, fontSize: ".9rem", display: "inline-block", marginTop: 10 }}>
              Página de ajuda do iFood ↗
            </a>
          </div>

          <div style={{ ...card, borderLeft: `4px solid ${LARANJA}` }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Errar para cima também custa</div>
            <blockquote style={{ margin: "0 0 10px", color: "#0F172A", lineHeight: 1.6, fontStyle: "italic" }}>
              "Caso muitos entregadores fiquem esperando pelos pedidos, é um sinal de que seu tempo de preparo
              não está equilibrado" — e "a loja pode ser fechada no iFood em caso de muitos entregadores
              esperando".
            </blockquote>
            <div style={{ color: "#475569", lineHeight: 1.6, fontSize: ".95rem" }}>
              Ou seja: prazo travado no alto não é o lado seguro. É o outro jeito de errar.
            </div>
            <a href="https://blog-parceiros.ifood.com.br/tempo-de-preparo/" target="_blank" rel="noopener" style={{ color: LARANJA_LINK, fontWeight: 700, fontSize: ".9rem", display: "inline-block", marginTop: 10 }}>
              Blog de parceiros do iFood ↗
            </a>
          </div>

          <div style={{ ...card, borderLeft: `4px solid ${LARANJA}` }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>No 99Food, os dois lados na mesma página</div>
            <blockquote style={{ margin: "0 0 10px", color: "#0F172A", lineHeight: 1.6, fontStyle: "italic" }}>
              "Tempo menor que o real: pode causar atrasos, avaliações negativas ou cancelamentos."
              <br />
              "Tempo maior que o real: pode afastar clientes, reduzir pedidos e impactar seus ganhos".
            </blockquote>
            <div style={{ color: "#475569", lineHeight: 1.6, fontSize: ".95rem" }}>
              E a mesma página diz para que serve esse número: <i>"Ele será usado para calcular o prazo de
              entrega exibido aos seus clientes."</i>
            </div>
            <a href="https://99app.com/99food/restaurantes/guias/como-configurar-o-tempo-de-preparo/" target="_blank" rel="noopener" style={{ color: LARANJA_LINK, fontWeight: 700, fontSize: ".9rem", display: "inline-block", marginTop: 10 }}>
              Guia oficial do 99Food ↗
            </a>
          </div>

          <div style={{ ...card, borderLeft: `4px solid ${LARANJA}` }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Quanto de folga você tem</div>
            <div style={{ color: "#475569", lineHeight: 1.7, fontSize: ".95rem" }}>
              Para o <b>Selo Super Restaurante</b>, o iFood pede nota <b>≥ 4,7</b>, taxa de cancelamento
              <b> ≤ 0,90%</b> e reclamações <b>≤ 1%</b>.
              <div style={{ marginTop: 10, color: "#0F172A", fontWeight: 700 }}>
                Com teto de 0,90%, um único cancelamento consome a folga que 111 pedidos bons construíram.
              </div>
            </div>
            <a href="https://institucional.ifood.com.br/restaurantes/selo-super-do-ifood/" target="_blank" rel="noopener" style={{ color: LARANJA_LINK, fontWeight: 700, fontSize: ".9rem", display: "inline-block", marginTop: 10 }}>
              Critérios do Selo Super ↗
            </a>
          </div>
        </div>

        <div style={{ ...card, marginTop: 18, background: "#0F172A", color: "#fff", border: "1px solid #334155" }}>
          <div style={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
            As duas plataformas mandam você acertar o prazo, e as duas te punem quando ele está errado — para
            cima ou para baixo. <b style={{ color: "#FF7A59" }}>Nenhuma das duas te dá uma mão para fazer isso
            às 20h de sexta.</b> É essa mão.
          </div>
        </div>
      </section>

      {/* ─────────── COMO FUNCIONA ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Como funciona</h2>
          <p style={p}>Três passos, uma vez só. Depois disso ela trabalha sozinha.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16, marginTop: 22 }}>
            {[
              ["1", "Você marca a coluna", "No seu painel de pedidos, clica na coluna que tem pedido na cozinha. Pode marcar mais de uma, tipo \"Em preparo\" e \"Pronto\"."],
              ["2", "Ela conta sozinha", "A cada mudança na sua tela, ela soma os pedidos e vê quantos motoboys você tem na casa."],
              ["3", "Ela escreve o prazo", "No iFood e no 99Food, em todas as lojas que você marcar. E confere lendo de volta se entrou certo."],
            ].map(([n, t, d]) => (
              <div key={t} style={card}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: LARANJA, color: "#fff", display: "grid", placeItems: "center", fontWeight: 900, marginBottom: 10 }}>{n}</div>
                <div style={{ fontWeight: 900, fontSize: "1.05rem", marginBottom: 6 }}>{t}</div>
                <div style={{ color: "#475569", lineHeight: 1.55, fontSize: ".95rem" }}>{d}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <Botao>Assinar por R$ 29,90/mês</Botao>
            <a href="/prazos/demo" style={{ color: "#475569", fontSize: ".95rem", textDecoration: "underline" }}>
              Quer ver antes? Temos um painel de teste para você marcar uma coluna.
            </a>
          </div>
        </div>
      </section>

      {/* ─────────── A OBJEÇÃO PRINCIPAL ─────────── */}
      <section style={secao}>
        <h2 style={h2}>"Mas o iFood já não faz isso sozinho?"</h2>
        <p style={p}>
          Faz uma parte, e é bom saber a diferença antes de assinar qualquer coisa. O que o iFood oferece
          está na documentação dele:
        </p>

        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden", fontSize: ".95rem" }}>
            <thead>
              <tr style={{ background: "#F1F5F9", textAlign: "left" }}>
                <th style={{ padding: "12px 14px", fontWeight: 800 }}>Jeito</th>
                <th style={{ padding: "12px 14px", fontWeight: 800 }}>O que decide o prazo</th>
                <th style={{ padding: "12px 14px", fontWeight: 800 }}>Quem precisa agir</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Na mão, no portal", "Você olha a cozinha e digita", "Você, toda hora"],
                ["Pré-configuração do iFood", "O horário que você programou", "Você programa; fora do horário volta ao padrão sozinho"],
                ["Tempo de preparo por IA do iFood", "A média histórica da sua loja. Só no plano Entrega: no plano Básico não tem", "Ninguém, mas também não olha a fila de hoje"],
                ["Extensão que negocia o atraso", "O pedido que já está atrasado, um por um", "Ninguém — mas o estrago já aconteceu"],
                ["FireHub Prazos", "A fila que está na sua tela agora", "Ninguém"],
              ].map(([a, b, c], i, arr) => (
                <tr key={a} style={{ borderTop: "1px solid #E2E8F0", background: i === arr.length - 1 ? "#FFF7ED" : "#fff", fontWeight: i === arr.length - 1 ? 700 : 400 }}>
                  <td style={{ padding: "12px 14px" }}>{i === arr.length - 1 ? "🔥 " : ""}{a}</td>
                  <td style={{ padding: "12px 14px", color: i === arr.length - 1 ? "#0F172A" : "#475569" }}>{b}</td>
                  <td style={{ padding: "12px 14px", color: i === arr.length - 1 ? "#0F172A" : "#475569" }}>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ ...p, marginTop: 16 }}>
          Agenda não sabe que hoje faltou gente na chapa, que a promoção pegou, ou que entraram 14 pedidos
          em seis minutos. A fila na sua tela sabe.
        </p>
        <p style={{ ...p, marginBottom: 0 }}>
          E existe um caminho a mais, que é pedir mais tempo depois que o pedido já atrasou. Serve, mas é
          remédio: o cliente já viu "seu pedido vai atrasar". <b>Escrever o prazo certo antes é não precisar
          do remédio.</b>
        </p>
      </section>

      {/* ─────────── 99FOOD ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>No 99Food também, e lá é ainda mais direto</h2>
          <p style={p}>
            No 99 o cliente não vê "prazo": ele vê o <b>tempo de preparo somado ao tempo de entrega</b> da
            faixa de distância que você cadastrou. Mexer na tabela de faixas é um parto. Mexer no tempo de
            preparo muda o que o cliente enxerga na hora — e é exatamente aí que a extensão escreve.
          </p>
          <p style={p}>
            Quem diz isso é o próprio 99: o tempo de preparo <i>"será usado para calcular o prazo de entrega
            exibido aos seus clientes"</i>. Tempo menor que o real gera atraso e cancelamento; maior, afasta
            cliente. É o mesmo aperto do iFood, com outro nome.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14, marginTop: 18 }}>
            <div style={{ ...card, padding: "1rem 1.15rem" }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Você escolhe a regra do 99</div>
              <div style={{ color: "#475569", lineHeight: 1.6, fontSize: ".95rem" }}>
                Ou ela segue o iFood descontando os minutos da entrega, ou você escreve suas próprias faixas —
                tantos pedidos na cozinha, tantos minutos de preparo. Configuração separada, porque a conta lá
                é outra.
              </div>
            </div>
            <div style={{ ...card, padding: "1rem 1.15rem" }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>O teto que a gente não esconde</div>
              <div style={{ color: "#475569", lineHeight: 1.6, fontSize: ".95rem" }}>
                A sua conta no 99 tem um tempo de preparo máximo — no geral, 30 minutos. Se a fila pedir mais
                que isso, a extensão grava o máximo permitido e <b>avisa na tela</b> que segurou ali. Ela não
                finge que deu certo.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── PROVA ─────────── */}
      <section style={secao}>
        <h2 style={h2}>Quem fez isso também toca loja</h2>
        <p style={p}>
          O FireHub é o sistema das nossas lojas antes de ser vendido para as suas. Essa mesma regra de
          prazo roda na nossa operação desde agosto de 2026, todo dia, no nosso próprio dinheiro.
        </p>
        <p style={p}>
          Ela não é uma ideia bonita de software. É o que a gente fazia na mão, no meio do rush, até
          cansar de fazer na mão.
        </p>
        <div style={{ ...card, marginTop: 6, borderLeft: `4px solid ${LARANJA}` }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>O que ela nunca faz</div>
          <div style={{ color: "#475569", lineHeight: 1.6 }}>
            Não aceita pedido por você. Não recusa. Não cancela. Não pausa a sua loja. Ela escreve o prazo,
            e só. Quando a cozinha estoura, ela avisa em vermelho e deixa a decisão de pausar com você.
          </div>
        </div>
      </section>

      {/* ─────────── PREÇO ─────────── */}
      <section id="assinar" style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={secao}>
          <h2 style={{ ...h2, textAlign: "center", color: "#fff" }}>R$ 29,90 por mês. R$ 1,00 por dia.</h2>
          <p style={{ color: "#CBD5E1", textAlign: "center", maxWidth: 640, margin: "0 auto 26px", lineHeight: 1.65 }}>
            Com ticket de R$ 55, <b style={{ color: "#fff" }}>um único pedido perdido por atraso custa R$ 46,64</b>{" "}
            do que o iFood ia te repassar — <b style={{ color: "#fff" }}>uma mensalidade e meia</b>. Um pedido
            no mês inteiro já paga a extensão com folga.
            <br />
            <span style={{ fontSize: ".95rem" }}>
              Cada loja a mais sai por R$ 9,90, e vale para as duas plataformas: mais uma no iFood e mais uma no 99Food.
            </span>
          </p>
          <SeletorDePlano />
        </div>
      </section>

      {/* ─────────── GARANTIA ─────────── */}
      <section style={secao}>
        <div style={{ ...card, borderColor: "#BBF7D0", background: "#F0FDF4", display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ fontSize: "2.4rem", lineHeight: 1 }}>🛡️</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, marginBottom: 8 }}>7 dias de garantia, sem perguntar por quê</div>
            <p style={{ color: "#166534", lineHeight: 1.6, margin: "0 0 10px" }}>
              Assine e use no seu movimento. Se não fizer o que promete, você pede o dinheiro de volta e recebe tudo. Não precisa justificar.
            </p>
            <p style={{ color: "#166534", lineHeight: 1.6, margin: 0, fontSize: ".95rem" }}>
              Um fim de semana já basta para ver: é no sábado cheio que o prazo fixo quebra e a extensão mostra a diferença.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── REQUISITOS E PARA QUEM NÃO SERVE ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Antes de assinar, veja se serve para você</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 18 }}>
            <div style={{ ...card, borderColor: "#BBF7D0" }}>
              <div style={{ fontWeight: 900, marginBottom: 10, color: "#15803D" }}>✅ Serve se você</div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#334155", lineHeight: 1.8 }}>
                <li>Vê seus pedidos em colunas, numa aba do Chrome</li>
                <li>Entrega com motoboy próprio no iFood</li>
                <li>Deixa um computador ligado durante o serviço</li>
                <li>Tem uma loja ou várias, no mesmo login</li>
              </ul>
            </div>
            <div style={{ ...card, borderColor: "#FECACA" }}>
              <div style={{ fontWeight: 900, marginBottom: 10, color: "#B91C1C" }}>❌ Não serve se você</div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#334155", lineHeight: 1.8 }}>
                <li>Só usa a entrega do próprio iFood, sem motoboy seu</li>
                <li>Anota pedido só no papel ou no WhatsApp</li>
                <li>Não deixa computador ligado na loja</li>
                <li>Tem lojas em logins separados do iFood</li>
                <li>
                  Precisa passar de 30 minutos de preparo no 99Food
                  <span style={{ color: "#64748B", fontSize: ".88rem" }}> (é teto da plataforma, não nosso — no iFood não existe esse limite)</span>
                </li>
              </ul>
            </div>
          </div>
          <p style={{ ...p, marginTop: 18, marginBottom: 0 }}>
            Preferimos perder a venda a ter você pedindo o dinheiro de volta na semana seguinte.
          </p>
        </div>
      </section>

      {/* ─────────── INSTALAÇÃO ─────────── */}
      <section id="instalar" style={secao}>
        <h2 style={h2}>A instalação leva 3 minutos</h2>
        <p style={p}>
          Você pode assinar agora pelo celular. O link e a senha chegam no seu e-mail, e você instala
          depois, no computador da loja.
        </p>
        <div style={{ ...card, marginTop: 8 }}>
          <ol style={{ margin: 0, paddingLeft: "1.2rem", color: "#334155", lineHeight: 1.9 }}>
            <li>Baixe a extensão pelo link que chega no e-mail e descompacte numa pasta.</li>
            <li>No Chrome do computador da loja, instale a pasta e fixe o ícone 🔥 na barra.</li>
            <li>Entre com o e-mail e a senha do e-mail. Troque a senha ali mesmo, se quiser.</li>
            <li>Abra seu painel de pedidos e clique nas colunas que contam pedido na cozinha.</li>
            <li>Abra o iFood e o 99Food, marque as lojas, e ligue o robô.</li>
          </ol>
          <div style={{ color: "#64748B", fontSize: ".88rem", marginTop: 12 }}>
            Travou em algum passo? Chama a gente e a gente instala junto com você, por chamada de vídeo.
          </div>
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>Perguntas que todo mundo faz</h2>
          {[
            ["Funciona com o meu sistema?", "Se os pedidos aparecem em colunas numa página do Chrome, funciona. Saipos, Cardápio Web, Consumer, o que for. Você marca as colunas com um clique e pronto. Não precisa integração, não precisa mexer no seu sistema, não precisa autorização de ninguém."],
            ["Preciso deixar o computador ligado?", "Sim. Ela roda no Chrome do computador da loja, com o painel e os portais abertos. Se a aba do painel fechar, ela segura o último prazo e avisa na tela, em vez de zerar e prometer 28 minutos na hora errada."],
            ["Ela pode bagunçar minha loja?", "Ela só escreve o prazo de entrega. Não aceita, não recusa, não cancela e não pausa. E você desliga o robô num clique, quando quiser."],
            ["Extensão de Chrome é seguro? O que ela lê?", "Ela roda em três lugares: no seu painel de pedidos, no Portal do Parceiro e no 99Food Admin. Ela lê o número de pedidos da coluna que você marcou. Não lê senha, não lê suas outras abas e não vê nada de banco."],
            ["E se eu tiver várias lojas?", "Você marca na extensão quais lojas mudam de prazo. As que não marcar ficam como estão. Todas precisam estar no mesmo login do iFood, porque é dentro dele que ela troca de loja."],
            ["O prazo do 99 é o mesmo do iFood?", "Não, e é de propósito. No 99 o cliente vê o tempo de preparo somado ao tempo de entrega da faixa que você cadastrou, então a extensão mexe só no preparo. Você configura essa regra separada: seguir o iFood descontando os minutos da entrega, ou escrever suas próprias faixas."],
            ["Consigo cancelar fácil?", "Sim, direto na Cakto, sem falar com ninguém. Não tem fidelidade nem multa. E se cancelar dentro de 7 dias, o dinheiro volta inteiro."],
            ["E se eu deixar de pagar?", "Ela para de ajustar na hora e explica na tela por quê. Pagou de novo, volta sozinha. Sem ligação, sem cobrança chata."],
          ].map(([q, r]) => (
            <details key={q as string} style={{ borderBottom: "1px solid #E2E8F0", padding: "14px 0" }}>
              <summary style={{ fontWeight: 800, cursor: "pointer", fontSize: "1.03rem" }}>{q}</summary>
              <div style={{ color: "#475569", lineHeight: 1.65, marginTop: 8, maxWidth: 760 }}>{r}</div>
            </details>
          ))}
        </div>
      </section>

      {/* ─────────── DÚVIDA ─────────── */}
      <section style={{ background: "#fff" }}>
        <div style={{ ...secao, paddingTop: 0, textAlign: "center" }}>
          <div style={{ color: "#475569", fontSize: "1rem" }}>
            Ficou com dúvida se funciona no seu caso?{" "}
            <a href={WA} target="_blank" rel="noopener" style={{ color: "#15803D", fontWeight: 800 }}>
              Chama no WhatsApp
            </a>{" "}
            que a gente responde. Prefere ver funcionando primeiro?{" "}
            <a href="/prazos/demo" style={{ color: LARANJA_LINK, fontWeight: 800 }}>Abra o painel de teste</a>.
          </div>
        </div>
      </section>

      {/* ─────────── CTA FINAL ─────────── */}
      <section style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, textAlign: "center" }}>
          <h2 style={{ ...h2, color: "#fff" }}>Hoje à noite o prazo já pode estar certo</h2>
          <p style={{ color: "#CBD5E1", maxWidth: 560, margin: "0 auto 24px", lineHeight: 1.6 }}>
            R$ 29,90 por mês, 7 dias de garantia e sem fidelidade. O acesso chega no seu e-mail em
            segundos.
          </p>
          <Botao style={{ fontSize: "1.15rem", padding: "18px 36px" }}>Assinar por R$ 29,90/mês</Botao>
          <div style={{ color: "#94A3B8", fontSize: ".82rem", marginTop: 16 }}>
            Pagamento pela Cakto · cartão ou Pix · 7 dias de garantia
            <br />
            A Cakto soma R$ 0,99 de taxa de serviço no checkout: o total dessa cobrança fica R$ 30,89.
          </div>
        </div>
      </section>

      <footer style={{ textAlign: "center", color: "#64748B", fontSize: ".82rem", padding: "2.2rem 1rem", lineHeight: 1.8 }}>
        FireHub Prazos é um produto FireHub · <a href="https://firehubfood.com.br" style={{ color: "#64748B" }}>firehubfood.com.br</a> · contato@firehubfood.com.br
        <br />
        <a href={ZIP} style={{ color: "#64748B" }}>Baixar a extensão</a> · <a href="/privacidade-prazos" style={{ color: "#64748B" }}>Política de privacidade</a>
        <br />
        <span style={{ fontSize: ".76rem" }}>
          Produto independente. Não somos iFood nem 99Food, e não temos vínculo com essas empresas.
        </span>
      </footer>

      <BarraFixa />
    </main>
  );
}
