"use client";

/**
 * A apresentação do Disparo oficial (lib/disparo-oficial): o que é, como
 * funciona e por que é melhor que o disparador pelo QR Code. Desde 13/10/2026
 * é a ÚNICA forma de disparo que o FireHub oferece (Douglas: "agora a única
 * opção que a gente oferece para o nosso cliente é com a API oficial").
 *
 * Aparece na aba Disparos do Chatbot IA, na aba de disparo de Marketing e no
 * topo de /store/disparo-oficial para quem ainda não conectou. Lê sozinha se a
 * loja está liberada e o preço do disparo.
 *
 * "Sem banimento" é a promessa da vitrine e vale do jeito que está escrito no
 * FAQ: a Meta não bane quem usa o canal oficial; ela limita o envio quando
 * muitos clientes denunciam — por isso todo envio leva o botão "Parar".
 */
import { useEffect, useState } from "react";

const WHATSAPP_DO_FIREHUB = "5522981118514";

const reais = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Estado = { liberada: boolean; preco: number; conectado: boolean } | null;

/**
 * No lugar dos interruptores antigos da recuperação de 7, 15 e 30 dias (que
 * mandavam pelo QR Code): o que mudou e onde configurar agora.
 */
export function ChamadaDaRecuperacaoOficial() {
  return (
    <div style={{ ...estilos.cartao, background: "linear-gradient(135deg,#F0FDFA,#ECFEFF)", borderColor: "#99F6E4" }}>
      <div style={{ fontWeight: 900, color: "#0F766E", fontSize: "1.02rem", marginBottom: 6 }}>🔁 A recuperação automática agora é pela API oficial</div>
      <p style={{ ...estilos.p, margin: "0 0 10px" }}>
        A mensagem para quem sumiu há 7, 15 e 30 dias continua automática — só que agora sai pelo canal oficial do WhatsApp, sem risco para o número
        da loja, com o botão “Quero pedir” e relatório de quem recebeu, leu e respondeu. Ela saía pelo QR Code e foi pausada para proteger o seu
        número.
      </p>
      <ul style={{ margin: "0 0 12px", paddingLeft: 18, color: "#334155", fontSize: "0.84rem", lineHeight: 1.7 }}>
        <li>Todo dia, a partir das 10h, quem completou o marco recebe a mensagem aprovada daquele marco.</li>
        <li>Cada cliente recebe cada marco uma vez só; quem voltou a pedir ou tocou em “Parar” sai sozinho.</li>
        <li>Usa o crédito dos disparos: só desconta a mensagem entregue.</li>
      </ul>
      <a href="/store/disparo-oficial#recuperacao" style={estilos.cta}>
        Configurar a recuperação automática →
      </a>
    </div>
  );
}

export default function ApresentacaoDisparoOficial({ compacta = false, aoComecar }: { compacta?: boolean; aoComecar?: () => void }) {
  const [estado, setEstado] = useState<Estado>(null);
  const [aberta, setAberta] = useState<number | null>(0);

  useEffect(() => {
    fetch("/api/store/disparo-oficial", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setEstado({ liberada: !!d?.liberada, preco: Number(d?.preco) || 0.46, conectado: d?.conexao?.status === "CONECTADO" }))
      .catch(() => setEstado({ liberada: false, preco: 0.46, conectado: false }));
  }, []);

  const preco = estado?.preco || 0.46;
  const linkAtivar = `https://wa.me/${WHATSAPP_DO_FIREHUB}?text=${encodeURIComponent("Oi! Quero ativar o Disparo oficial (API do WhatsApp) na minha loja.")}`;

  const botaoPrincipal = estado?.liberada ? (
    aoComecar ? (
      <button onClick={aoComecar} style={estilos.cta}>
        {estado.conectado ? "Abrir meus disparos →" : "Conectar meu WhatsApp →"}
      </button>
    ) : (
      <a href="/store/disparo-oficial" style={estilos.cta}>
        {estado.conectado ? "Abrir meus disparos →" : "Começar agora →"}
      </a>
    )
  ) : (
    <a href={linkAtivar} target="_blank" rel="noreferrer" style={estilos.cta}>
      Quero ativar na minha loja →
    </a>
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* ── HERÓI ─────────────────────────────────────────────────────── */}
      <section style={estilos.heroi}>
        <div style={estilos.brilho} aria-hidden />
        <div style={{ position: "relative", maxWidth: 720 }}>
          <span style={estilos.selo}>✅ API oficial do WhatsApp · Meta</span>
          <h2 style={estilos.titulo}>Disparos sem banimento, do número da sua loja</h2>
          <p style={estilos.subtitulo}>
            Mande promoção para todos os seus clientes pelo canal oficial da Meta. Seu número continua no celular, seu robô continua atendendo — e quem
            responde já cai na conversa para pedir.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 18 }}>
            {botaoPrincipal}
            <span style={estilos.preco}>
              {reais(preco)} <small style={{ fontWeight: 600, opacity: 0.8 }}>por mensagem entregue</small>
            </span>
          </div>
          {!estado?.liberada && estado && (
            <p style={{ margin: "12px 0 0", fontSize: "0.8rem", color: "#CCFBF1" }}>
              Estamos liberando loja por loja. Chame a gente no WhatsApp que ativamos a sua.
            </p>
          )}
        </div>
      </section>

      {/* ── ANTES × AGORA ─────────────────────────────────────────────── */}
      {!compacta && (
        <section style={estilos.cartao}>
          <h3 style={estilos.h3}>Por que trocamos o disparo pelo QR Code</h3>
          <p style={estilos.p}>
            Disparador pelo QR Code usa uma conexão não oficial. O WhatsApp trata isso como uso não autorizado e pode banir o número sem aviso e sem
            recurso — com todo o histórico de clientes junto. Nós mesmos já perdemos um número assim.
          </p>
          <div style={estilos.tabela}>
            <div style={{ ...estilos.colTabela, background: "#FEF2F2", borderColor: "#FECACA" }}>
              <div style={{ ...estilos.cabTabela, color: "#B91C1C" }}>🚫 Disparador pelo QR Code</div>
              {[
                "Risco de banimento do número",
                "Devagar: 50 por vez, com pausas",
                "Mensagem simples, sem botões",
                "Não sabe quem recebeu",
                "Cliente não tem como sair da lista",
              ].map((t) => (
                <div key={t} style={estilos.linhaTabela}>✗ {t}</div>
              ))}
            </div>
            <div style={{ ...estilos.colTabela, background: "#F0FDFA", borderColor: "#99F6E4" }}>
              <div style={{ ...estilos.cabTabela, color: "#0F766E" }}>✅ Disparo oficial FireHub</div>
              {[
                "Canal oficial da Meta: sem risco de banimento por app pirata",
                "Centenas de mensagens por minuto",
                "Botões “Quero pedir” e “Parar promoções”",
                "Relatório: entregue, lida e respondeu",
                "Só paga a mensagem que chegou",
              ].map((t) => (
                <div key={t} style={estilos.linhaTabela}>✓ {t}</div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── COMO FUNCIONA ─────────────────────────────────────────────── */}
      <section style={estilos.cartao}>
        <h3 style={estilos.h3}>Como funciona</h3>
        <div style={estilos.grade}>
          {[
            { n: "1", t: "Conecte seu WhatsApp", d: "Em poucos cliques, pelo Facebook. É o MESMO número da loja, que continua no WhatsApp Business do celular." },
            { n: "2", t: "Escreva a promoção", d: "Com o nome do cliente e o botão “Quero pedir”. A Meta aprova o texto — normalmente em minutos." },
            { n: "3", t: "Escolha quem recebe", d: "Todos os clientes, quem sumiu há 7, 15 ou 30 dias, quem pediu esta semana… Teste primeiro no seu celular." },
            { n: "4", t: "O robô fecha o pedido", d: "Quem toca em “Quero pedir” cai na conversa da loja e o seu robô atende na hora, como sempre." },
          ].map((p) => (
            <div key={p.n} style={estilos.passo}>
              <div style={estilos.numero}>{p.n}</div>
              <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>{p.t}</div>
              <div style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5 }}>{p.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BENEFÍCIOS ────────────────────────────────────────────────── */}
      <section style={estilos.cartao}>
        <h3 style={estilos.h3}>O que a sua loja ganha</h3>
        <div style={estilos.grade}>
          {[
            { i: "🛡️", t: "Número protegido", d: "Sem conexão pirata. O que derruba número hoje é disparador não oficial — aqui não tem." },
            { i: "📱", t: "Mesmo número, mesmo robô", d: "Nada de chip novo. O cliente reconhece a loja e responde onde sempre conversou." },
            { i: "🛒", t: "Botão “Quero pedir”", d: "Um toque e o cliente já está falando com o robô, que manda o cardápio e fecha o pedido." },
            { i: "💸", t: "Só paga o que chega", d: "Crédito pré-pago por Pix. Mensagem que não foi entregue volta para o seu saldo." },
            { i: "📊", t: "Relatório de verdade", d: "Quantos receberam, quantos leram e quantos responderam em cada campanha." },
            { i: "🙋", t: "Cliente feliz", d: "Quem não quer mais recebe o botão “Parar promoções” e sai da lista sozinho." },
            { i: "🔁", t: "Recuperação automática", d: "Quem sumiu há 7, 15 ou 30 dias recebe a sua promoção sozinho, todo dia — liga uma vez e esquece." },
            { i: "🧾", t: "Sem mensalidade a mais", d: "Crédito pré-pago: usou, pagou. Sem plano, sem fidelidade, sem taxa escondida." },
          ].map((b) => (
            <div key={b.t} style={estilos.beneficio}>
              <div style={{ fontSize: "1.6rem" }}>{b.i}</div>
              <div style={{ fontWeight: 800, color: "#0F172A", margin: "6px 0 4px" }}>{b.t}</div>
              <div style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5 }}>{b.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── QUANTO CUSTA ──────────────────────────────────────────────── */}
      <section style={{ ...estilos.cartao, background: "linear-gradient(135deg,#FFFBEB,#FEF3C7)", borderColor: "#FDE68A" }}>
        <h3 style={estilos.h3}>Quanto custa</h3>
        <p style={estilos.p}>
          <strong>{reais(preco)} por mensagem entregue</strong>, sem mensalidade a mais. Você coloca crédito por Pix (a partir de R$ 50) e vai usando.
        </p>
        <div style={estilos.conta}>
          <div>
            <div style={estilos.contaRotulo}>Promoção para 500 clientes</div>
            <div style={estilos.contaValor}>{reais(500 * preco)}</div>
          </div>
          <div style={{ fontSize: "1.4rem", color: "#B45309" }}>→</div>
          <div>
            <div style={estilos.contaRotulo}>Se só 3% pedirem um combo de R$ 50</div>
            <div style={{ ...estilos.contaValor, color: "#047857" }}>{reais(500 * 0.03 * 50)} em vendas</div>
          </div>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#92400E" }}>Exemplo ilustrativo; o resultado depende da oferta e da sua base.</p>
      </section>

      {/* ── PERGUNTAS ─────────────────────────────────────────────────── */}
      {!compacta && (
        <section style={estilos.cartao}>
          <h3 style={estilos.h3}>Perguntas frequentes</h3>
          {[
            {
              p: "É mesmo sem banimento?",
              r: "Sim no que derruba número hoje: o disparo sai pelo canal oficial da Meta, não por conexão pirata. A Meta só limita o envio de quem recebe muitas denúncias de spam — por isso toda mensagem leva o botão “Parar promoções” e mandamos só para quem já comprou na sua loja.",
            },
            { p: "Preciso de outro número ou chip?", r: "Não. É o número da sua loja, no WhatsApp Business do celular. O celular continua funcionando normalmente." },
            {
              p: "O meu robô continua respondendo?",
              r: "Sim. Depois de conectar, você lê o QR do robô uma vez (a Meta desconecta os aparelhos nessa hora) e ele volta a atender — inclusive quem tocou em “Quero pedir”.",
            },
            { p: "Quanto tempo a Meta leva para aprovar a mensagem?", r: "Normalmente minutos; às vezes algumas horas. Você vê o status na tela e recebe a mensagem aprovada pronta para disparar." },
            {
              p: "Para quantos clientes posso mandar por dia?",
              r: "Número novo começa com 250 clientes por dia. A Meta aumenta o limite sozinha (2 mil, 10 mil…) conforme as mensagens são bem recebidas.",
            },
            {
              p: "Muda alguma coisa no celular?",
              r: "Algumas funções do WhatsApp Business ficam desligadas no aparelho: lista de transmissão, grupos e ligações. E é preciso abrir o app pelo menos a cada 13 dias.",
            },
          ].map((f, i) => (
            <div key={f.p} style={{ borderTop: i ? "1px solid #F1F5F9" : "none" }}>
              <button onClick={() => setAberta(aberta === i ? null : i)} style={estilos.pergunta} aria-expanded={aberta === i}>
                <span>{f.p}</span>
                <span style={{ color: "#0F766E" }}>{aberta === i ? "−" : "+"}</span>
              </button>
              {aberta === i && <p style={{ ...estilos.p, margin: "0 0 12px" }}>{f.r}</p>}
            </div>
          ))}
          <div style={{ marginTop: 14 }}>{botaoPrincipal}</div>
        </section>
      )}
    </div>
  );
}

const estilos: Record<string, React.CSSProperties> = {
  heroi: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 20,
    padding: "28px 26px",
    background: "linear-gradient(135deg,#0F766E 0%,#115E59 55%,#134E4A 100%)",
    color: "#fff",
    boxShadow: "0 12px 30px -12px rgba(15,118,110,.55)",
  },
  brilho: {
    position: "absolute",
    right: -80,
    top: -80,
    width: 280,
    height: 280,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(94,234,212,.35), transparent 70%)",
  },
  selo: { display: "inline-block", fontSize: "0.74rem", fontWeight: 800, background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.25)", padding: "4px 10px", borderRadius: 999 },
  titulo: { margin: "12px 0 8px", fontSize: "clamp(1.4rem, 3.4vw, 2rem)", fontWeight: 900, lineHeight: 1.15 },
  subtitulo: { margin: 0, fontSize: "0.98rem", lineHeight: 1.55, color: "#E6FFFA" },
  cta: {
    display: "inline-block",
    padding: "12px 20px",
    borderRadius: 12,
    background: "#FBBF24",
    color: "#1C1917",
    fontWeight: 900,
    fontSize: "0.95rem",
    textDecoration: "none",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 6px 16px -6px rgba(251,191,36,.7)",
  },
  preco: { fontSize: "1.15rem", fontWeight: 900, background: "rgba(255,255,255,.12)", padding: "8px 14px", borderRadius: 12 },
  cartao: { background: "#fff", padding: "1.25rem 1.3rem", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" },
  h3: { margin: "0 0 10px", fontSize: "1.1rem", fontWeight: 900, color: "#0F172A" },
  p: { margin: "0 0 12px", fontSize: "0.88rem", color: "#475569", lineHeight: 1.6 },
  tabela: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 },
  colTabela: { border: "1px solid", borderRadius: 14, padding: 14 },
  cabTabela: { fontWeight: 900, marginBottom: 8, fontSize: "0.92rem" },
  linhaTabela: { fontSize: "0.85rem", color: "#334155", padding: "5px 0", lineHeight: 1.4 },
  grade: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 },
  passo: { background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14, padding: 14 },
  numero: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#0F766E",
    color: "#fff",
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  beneficio: { border: "1px solid #E2E8F0", borderRadius: 14, padding: 14 },
  conta: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, background: "rgba(255,255,255,.7)", borderRadius: 14, padding: "12px 14px" },
  contaRotulo: { fontSize: "0.78rem", color: "#92400E", fontWeight: 700 },
  contaValor: { fontSize: "1.35rem", fontWeight: 900, color: "#0F172A" },
  pergunta: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 0",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "0.92rem",
    color: "#0F172A",
    textAlign: "left",
  },
};
