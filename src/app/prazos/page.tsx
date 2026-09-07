import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FireHub Prazos — prazo do iFood e tempo de preparo do 99Food no automático",
  description:
    "Extensão para o Chrome que lê a fila da cozinha no painel que você já usa e ajusta sozinha o prazo de entrega no iFood e o tempo de preparo no 99Food. R$ 49,90/mês.",
  openGraph: {
    title: "FireHub Prazos — prazo automático no iFood e 99Food",
    description: "Cozinha cheia, prazo sobe. Cozinha vazia, prazo desce. Sem ninguém mexer no portal.",
    url: "https://firehubfood.com.br/prazos",
    siteName: "FireHub",
    locale: "pt_BR",
    type: "website",
  },
};

/**
 * /prazos — a landing do FireHub Prazos, o low ticket de recorrência.
 *
 * Página estática, sem dependência do resto do painel: quem chega aqui não é
 * loja FireHub — é qualquer restaurante com iFood/99Food e um painel de
 * pedidos. O checkout é da Cakto; a conta nasce pelo webhook da compra.
 */
const CHECKOUT_URL = "https://pay.cakto.com.br/firehub-prazos";
const ZIP_URL = "https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip";
const LARANJA = "#FF5722";

export default function PrazosLanding() {
  const secao: React.CSSProperties = { maxWidth: 980, margin: "0 auto", padding: "3rem 1.25rem" };
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.25rem 1.4rem", boxShadow: "0 6px 20px rgba(15,23,42,.06)" };
  const botao: React.CSSProperties = { display: "inline-block", background: `linear-gradient(135deg, ${LARANJA} 0%, #E64A19 100%)`, color: "#fff", fontWeight: 900, padding: "14px 26px", borderRadius: 12, textDecoration: "none", fontSize: "1.05rem", boxShadow: "0 8px 24px rgba(255,87,34,.35)" };

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#0F172A", background: "#F8FAFC" }}>
      {/* HERO */}
      <section style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, padding: "3.5rem 1.25rem 3rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${LARANJA}, #F44336)`, display: "grid", placeItems: "center", fontSize: "1.3rem" }}>🔥</div>
            <div style={{ fontWeight: 900, fontSize: "1.2rem" }}>FireHub Prazos</div>
            <span style={{ marginLeft: 6, fontSize: ".7rem", fontWeight: 800, background: "#1E3A8A", color: "#BFDBFE", border: "1px solid #3B82F6", borderRadius: 999, padding: "3px 10px" }}>EXTENSÃO PARA O CHROME</span>
          </div>
          <h1 style={{ fontSize: "clamp(1.9rem, 4.5vw, 3rem)", lineHeight: 1.1, fontWeight: 900, margin: "0 0 14px", maxWidth: 820 }}>
            Cozinha cheia, prazo sobe. Cozinha vazia, prazo desce. <span style={{ color: "#FF7A59" }}>Sem ninguém mexer no portal.</span>
          </h1>
          <p style={{ fontSize: "1.1rem", color: "#CBD5E1", maxWidth: 720, lineHeight: 1.6, margin: "0 0 26px" }}>
            A extensão lê a fila da cozinha no painel de pedidos que você já usa (Saipos, Cardápio Web, Consumer, qualquer um) e ajusta
            sozinha o <b style={{ color: "#fff" }}>prazo de entrega no iFood</b> e o <b style={{ color: "#fff" }}>tempo de preparo no 99Food</b>, em todas as
            lojas que você marcar. Menos atraso, menos cancelamento, menos nota baixa.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <a href={CHECKOUT_URL} style={botao}>Assinar — R$ 49,90/mês</a>
            <a href="#como-funciona" style={{ color: "#CBD5E1", fontWeight: 700, textDecoration: "underline" }}>Ver como funciona</a>
          </div>
          <div style={{ color: "#94A3B8", fontSize: ".8rem", marginTop: 12 }}>1 loja incluída (iFood + 99Food) · lojas adicionais por R$ 9,90/mês cada · cancele quando quiser</div>
        </div>
      </section>

      {/* PROBLEMA */}
      <section style={secao}>
        <h2 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 8px" }}>O prazo fixo é o que atrasa o seu pedido</h2>
        <p style={{ color: "#475569", lineHeight: 1.6, maxWidth: 780, margin: "0 0 20px" }}>
          Com 2 pedidos na cozinha, 30 minutos é folga. Com 12, é promessa quebrada: o cliente recebe atrasado, o iFood
          cobra, a nota cai. E ninguém tem tempo de abrir o portal no meio do pico para mudar o prazo — muito menos loja por loja.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {[
            ["📋", "Lê o seu painel", "Você marca com um clique as colunas que contam pedido na cozinha (\"Em preparo\", \"Pronto\"…). A extensão passa a somar sozinha."],
            ["🛵", "Ajusta o iFood", "Pela quantidade de pedidos e de motoboys na casa, escreve o prazo de entrega no Portal do Parceiro — em cada loja marcada."],
            ["🟡", "Ajusta o 99Food", "No 99 o cliente vê preparo + entrega da área. A extensão mexe no tempo de preparo, com regra própria para o 99."],
          ].map(([icone, titulo, texto]) => (
            <div key={titulo as string} style={card}>
              <div style={{ fontSize: "1.6rem" }}>{icone}</div>
              <div style={{ fontWeight: 900, fontSize: "1.05rem", margin: "6px 0 4px" }}>{titulo}</div>
              <div style={{ color: "#475569", lineHeight: 1.55, fontSize: ".95rem" }}>{texto}</div>
            </div>
          ))}
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 16px" }}>Como funciona, na prática</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24, alignItems: "start" }}>
            <ol style={{ paddingLeft: "1.3rem", color: "#334155", lineHeight: 1.7, fontSize: "1rem", margin: 0 }}>
              <li><b>Instale a extensão</b> no Chrome do caixa (3 minutos, guia abaixo) e entre com o login que chega por e-mail.</li>
              <li><b>Marque as colunas</b> do seu painel de pedidos que contam pedido em produção. Serve para qualquer sistema com kanban na web.</li>
              <li><b>Marque as lojas</b> do iFood e do 99Food que devem mudar de prazo. Só as marcadas mudam — as outras ficam como estão.</li>
              <li><b>Ligue o robô.</b> A cada mudança na cozinha o prazo é recalculado e escrito nos portais, e a extensão confere lendo de volta.</li>
            </ol>
            <div style={{ ...card, background: "#0F172A", color: "#E2E8F0", border: "1px solid #334155" }}>
              <div style={{ fontWeight: 800, color: "#FF7A59", fontSize: ".78rem", letterSpacing: ".4px" }}>A REGRA (AUTOMÁTICA)</div>
              <div style={{ fontSize: ".95rem", lineHeight: 1.7, marginTop: 6 }}>
                Para cada motoboy na casa: até 1 pedido → <b>28 min</b> · até 2 → <b>38</b> · até 3 → <b>58</b> · até 4 → <b>78</b> · acima disso, avisa para pausar.
                <br />Prefere as suas faixas? Escreva "até 6 pedidos → 45 min" e a extensão obedece. O 99Food tem regra separada, em minutos de preparo.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* REQUISITOS */}
      <section style={secao}>
        <h2 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 8px" }}>O que você precisa ter</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {[
            ["Um painel de pedidos na web", "Qualquer sistema em que os pedidos apareçam em colunas (kanban) numa aba do Chrome. A aba fica aberta no PC do caixa."],
            ["Portal do Parceiro e/ou 99Food Admin abertos", "Logados na conta das suas lojas. Se você tem mais de uma loja, todas precisam estar no mesmo login — é dentro dele que a extensão troca de loja."],
            ["Entrega própria no iFood", "O prazo de entrega só existe para quem entrega com motoboy próprio. No 99Food o tempo de preparo vale para qualquer modo de entrega."],
          ].map(([titulo, texto]) => (
            <div key={titulo as string} style={card}>
              <div style={{ fontWeight: 900, fontSize: "1rem", marginBottom: 4 }}>✅ {titulo}</div>
              <div style={{ color: "#475569", lineHeight: 1.55, fontSize: ".95rem" }}>{texto}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PREÇO */}
      <section id="assinar" style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff" }}>
        <div style={{ ...secao, textAlign: "center" }}>
          <h2 style={{ fontSize: "1.8rem", fontWeight: 900, margin: "0 0 6px" }}>R$ 49,90 por mês</h2>
          <p style={{ color: "#CBD5E1", fontSize: "1.05rem", margin: "0 0 6px" }}>1 loja incluída (a mesma no iFood e no 99Food). Loja adicional: R$ 9,90/mês.</p>
          <p style={{ color: "#94A3B8", fontSize: ".9rem", margin: "0 0 22px" }}>Um pedido a menos cancelado por mês já paga. Sem fidelidade: cancela na Cakto quando quiser.</p>
          <a href={CHECKOUT_URL} style={botao}>Assinar agora</a>
          <div style={{ color: "#94A3B8", fontSize: ".8rem", marginTop: 14 }}>Pagamento seguro pela Cakto · o acesso chega no seu e-mail em segundos</div>
        </div>
      </section>

      {/* INSTALAR */}
      <section id="instalar" style={secao}>
        <h2 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 8px" }}>Guia de instalação (3 minutos)</h2>
        <div style={card}>
          <ol style={{ paddingLeft: "1.3rem", color: "#334155", lineHeight: 1.8, margin: 0 }}>
            <li>Baixe a extensão: <a href={ZIP_URL} style={{ color: LARANJA, fontWeight: 800 }}>FireHub-Prazos-Extensao.zip</a> e descompacte numa pasta (ex.: Documentos\FireHub Prazos).</li>
            <li>No Chrome, abra <code>chrome://extensions</code>, ligue o <b>Modo do desenvolvedor</b> (canto superior direito) e clique em <b>Carregar sem compactação</b>, escolhendo a pasta.</li>
            <li>Clique no ícone de quebra-cabeça e <b>fixe o 🔥 FireHub Prazos</b> na barra.</li>
            <li>Entre com o e-mail e a senha que chegaram por e-mail (troque a senha dentro da extensão, se quiser).</li>
            <li>Abra o painel de pedidos do seu sistema, clique em <b>Marcar coluna na aba atual</b> e clique nas colunas que contam pedido na cozinha.</li>
            <li>Abra o Portal do Parceiro e/ou o 99Food Admin, clique em <b>Atualizar lista</b> na extensão e marque as lojas que devem mudar de prazo.</li>
            <li>Ligue o robô. Pronto: a pílula 🔥 no canto do portal mostra o prazo em vigor, e o botão <b>Relatório</b> mostra quanto tempo o prazo ficou alto ou baixo.</li>
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0" }}>
        <div style={secao}>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 12px" }}>Perguntas frequentes</h2>
          {[
            ["Funciona com o meu sistema de pedidos?", "Se os pedidos aparecem em colunas numa página do Chrome, sim. Você marca as colunas com um clique; não precisa de integração nem de API."],
            ["Preciso deixar o computador ligado?", "Sim — a extensão roda no Chrome do caixa, com o painel e os portais abertos. Se a aba do painel fechar, ela segura o último prazo e avisa."],
            ["E se eu tiver várias lojas?", "Marque na extensão quais lojas mudam de prazo. Todas precisam estar no mesmo login do iFood (e do 99Food). Cada loja adicional custa R$ 9,90/mês."],
            ["O que acontece se eu deixar de pagar?", "A extensão para de ajustar no mesmo instante e mostra o motivo. Regularizou na Cakto, volta sozinha."],
            ["A extensão pausa a loja quando estoura?", "Não — ela põe o prazo máximo e avisa em vermelho na tela. Pausar a loja continua sendo decisão sua."],
          ].map(([p, r]) => (
            <details key={p as string} style={{ borderBottom: "1px solid #E2E8F0", padding: "12px 0" }}>
              <summary style={{ fontWeight: 800, cursor: "pointer", fontSize: "1rem" }}>{p}</summary>
              <div style={{ color: "#475569", lineHeight: 1.6, marginTop: 6 }}>{r}</div>
            </details>
          ))}
        </div>
      </section>

      <footer style={{ textAlign: "center", color: "#94A3B8", fontSize: ".8rem", padding: "2rem 1rem" }}>
        FireHub Prazos é um produto FireHub · <a href="https://firehubfood.com.br" style={{ color: "#94A3B8" }}>firehubfood.com.br</a> · contato@firehubfood.com.br
      </footer>
    </main>
  );
}
