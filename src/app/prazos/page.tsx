import type { Metadata } from "next";
import DemoAoVivo from "./DemoAoVivo";
import { SeletorDePlano, BarraFixa } from "./Assinar";
import { CHECKOUT_PADRAO } from "./planos";

export const metadata: Metadata = {
  title: "FireHub Prazos — o prazo do iFood muda sozinho quando a cozinha enche",
  description:
    "Extensão para o Chrome que olha a fila do seu painel de pedidos e escreve o prazo certo no iFood e o tempo de preparo no 99Food. R$ 49,90 por mês, 30 dias de garantia.",
  openGraph: {
    title: "O prazo do seu iFood muda sozinho quando a cozinha enche",
    description: "A extensão olha a fila da sua cozinha e escreve o prazo certo no iFood e no 99Food. Sem abrir o portal.",
    url: "https://firehubfood.com.br/prazos",
    siteName: "FireHub",
    locale: "pt_BR",
    type: "website",
  },
};

/**
 * /prazos — a página de venda do FireHub Prazos.
 *
 * Desenho guiado pelo que tem evidência, não por gosto:
 *   - texto em linguagem de cozinha, não de software (o fator com maior
 *     efeito medido em conversão de landing: leitura simples converte muito
 *     mais que texto profissional);
 *   - preço no topo, porque em R$ 49,90 o preço é o argumento, não a objeção;
 *   - um só botão, repetido, sempre com o mesmo texto;
 *   - a demonstração do produto acima da dobra, não descrição dele;
 *   - a objeção "o iFood já faz isso" respondida de frente, com o que a
 *     documentação do próprio iFood diz;
 *   - garantia de 30 dias em bloco próprio (7 dias é só o mínimo do CDC, e
 *     não contém um fim de semana cheio, que é quando o produto prova valor);
 *   - números só quando medidos de verdade, com período declarado.
 *
 * Nada de biblioteca de animação nem fonte externa: a página tem que abrir
 * em menos de 2 s no 4G, que é o item de maior efeito medido depois do texto.
 */

const LARANJA = "#FF5722";
const CHECKOUT = CHECKOUT_PADRAO;
const ZIP = "https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip";

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
            <Botao>Assinar por R$ 49,90/mês</Botao>
            <div style={{ color: "#CBD5E1", fontSize: ".95rem" }}>
              <b style={{ color: "#fff" }}>R$ 49,90 por mês.</b> Dá R$ 1,66 por dia.
            </div>
          </div>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginBottom: 30 }}>
            30 dias de garantia · sem fidelidade · funciona com o sistema de pedidos que você já tem
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
          <div style={{ marginTop: 24 }}>
            <Botao>Assinar por R$ 49,90/mês</Botao>
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
                ["FireHub Prazos", "A fila que está na sua tela agora", "Ninguém"],
              ].map(([a, b, c], i) => (
                <tr key={a} style={{ borderTop: "1px solid #E2E8F0", background: i === 3 ? "#FFF7ED" : "#fff", fontWeight: i === 3 ? 700 : 400 }}>
                  <td style={{ padding: "12px 14px" }}>{i === 3 ? "🔥 " : ""}{a}</td>
                  <td style={{ padding: "12px 14px", color: i === 3 ? "#0F172A" : "#475569" }}>{b}</td>
                  <td style={{ padding: "12px 14px", color: i === 3 ? "#0F172A" : "#475569" }}>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ ...p, marginTop: 16 }}>
          Agenda não sabe que hoje faltou gente na chapa, que a promoção pegou, ou que entraram 14 pedidos
          em seis minutos. A fila na sua tela sabe.
        </p>
      </section>

      {/* ─────────── 99FOOD ─────────── */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={h2}>No 99Food também</h2>
          <p style={p}>
            No 99 o cliente vê o tempo de preparo somado ao tempo de entrega da área. A extensão mexe no
            tempo de preparo, que é o que muda o que o cliente enxerga.
          </p>
          <p style={p}>
            A regra do 99 é separada da do iFood, porque a conta lá é outra. Você escolhe: seguir o iFood
            descontando os minutos da entrega, ou escrever as suas faixas.
          </p>
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
          <h2 style={{ ...h2, textAlign: "center", color: "#fff" }}>R$ 49,90 por mês</h2>
          <p style={{ color: "#CBD5E1", textAlign: "center", maxWidth: 620, margin: "0 auto 26px", lineHeight: 1.6 }}>
            Um pedido cancelado por atraso custa mais que a mensalidade inteira. Se você tem mais de uma
            loja, cada loja a mais sai por R$ 9,90.
          </p>
          <SeletorDePlano />
        </div>
      </section>

      {/* ─────────── GARANTIA ─────────── */}
      <section style={secao}>
        <div style={{ ...card, borderColor: "#BBF7D0", background: "#F0FDF4", display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ fontSize: "2.4rem", lineHeight: 1 }}>🛡️</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, marginBottom: 8 }}>30 dias de garantia, sem perguntar por quê</div>
            <p style={{ color: "#166534", lineHeight: 1.6, margin: "0 0 10px" }}>
              Assine, use por um mês inteiro. Se não fizer o que promete, você pede o dinheiro de volta e
              recebe tudo. Não precisa justificar.
            </p>
            <p style={{ color: "#166534", lineHeight: 1.6, margin: 0, fontSize: ".95rem" }}>
              São 30 dias e não 7 de propósito: o valor dela aparece no fim de semana cheio. Em um mês
              você passa por quatro.
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
            ["E se eu deixar de pagar?", "Ela para de ajustar na hora e explica na tela por quê. Pagou de novo, volta sozinha. Sem ligação, sem cobrança chata."],
            ["Consigo cancelar fácil?", "Sim, direto na Cakto, sem falar com ninguém. Não tem fidelidade nem multa."],
          ].map(([q, r]) => (
            <details key={q as string} style={{ borderBottom: "1px solid #E2E8F0", padding: "14px 0" }}>
              <summary style={{ fontWeight: 800, cursor: "pointer", fontSize: "1.03rem" }}>{q}</summary>
              <div style={{ color: "#475569", lineHeight: 1.65, marginTop: 8, maxWidth: 760 }}>{r}</div>
            </details>
          ))}
        </div>
      </section>

      {/* ─────────── CTA FINAL ─────────── */}
      <section style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, textAlign: "center" }}>
          <h2 style={{ ...h2, color: "#fff" }}>Hoje à noite o prazo já pode estar certo</h2>
          <p style={{ color: "#CBD5E1", maxWidth: 560, margin: "0 auto 24px", lineHeight: 1.6 }}>
            R$ 49,90 por mês, 30 dias de garantia e sem fidelidade. O acesso chega no seu e-mail em
            segundos.
          </p>
          <Botao style={{ fontSize: "1.15rem", padding: "18px 36px" }}>Assinar por R$ 49,90/mês</Botao>
          <div style={{ color: "#94A3B8", fontSize: ".82rem", marginTop: 16 }}>
            Pagamento pela Cakto · cartão ou Pix · 30 dias de garantia
          </div>
        </div>
      </section>

      <footer style={{ textAlign: "center", color: "#94A3B8", fontSize: ".82rem", padding: "2.2rem 1rem", lineHeight: 1.8 }}>
        FireHub Prazos é um produto FireHub · <a href="https://firehubfood.com.br" style={{ color: "#64748B" }}>firehubfood.com.br</a> · contato@firehubfood.com.br
        <br />
        <a href={ZIP} style={{ color: "#94A3B8" }}>Baixar a extensão</a> · <a href="/privacidade-extensao" style={{ color: "#94A3B8" }}>Política de privacidade</a>
        <br />
        <span style={{ fontSize: ".76rem" }}>
          Produto independente. Não somos iFood nem 99Food, e não temos vínculo com essas empresas.
        </span>
      </footer>

      <BarraFixa />
    </main>
  );
}
