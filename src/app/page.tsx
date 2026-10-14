"use client";
import { Fragment, useState, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import "./landing.css";

const WA = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20testar%20o%20FireHub%20gr%C3%A1tis%20por%2015%20dias";
const TRIAL = "/cadastro";
const LOGIN = "https://firehubfood.com.br/login";

const SOLUTIONS = [
  {
    icon: "⚡", title: "Venda no automático", desc: "Automatize cada venda com inteligência artificial",
    items: [
      { t: "Cardápio Digital Inteligente", d: "Delivery, mesa e balcão sem app" },
      { t: "Chatbot WhatsApp com IA", d: "Atendimento 24h sem perder pedido" },
      { t: "Alerta Automático de Bebidas", d: "Zero esquecimento de refrigerantes na expedição" },
      { t: "Gestão de Pedidos", d: "Tudo centralizado em tempo real" },
      { t: "Pagamento Online", d: "Cartão de crédito e Pix integrados" },
    ]
  },
  {
    icon: "❤️", title: "Fidelize e multiplique", desc: "Transforme clientes ocasionais em fãs da sua marca",
    items: [
      // Era "Disparos em Massa": o disparo pelo WhatsApp da loja está desligado
      // desde 02/09/2026 (lib/disparo-em-massa.ts). No lugar, o tráfego pago.
      { t: "Tráfego Pago sem Gestor", d: "Anúncios no Instagram e Facebook pelo painel (módulo à parte)" },
      { t: "Disparos pela API Oficial", d: "Promoção no WhatsApp sem risco de banimento (por mensagem)" },
      { t: "Recuperação de Clientes", d: "Quem sumiu há 7, 15 e 30 dias recebe sua oferta sozinho (pelos Disparos)" },
      { t: "Programa de Fidelidade", d: "Cashback e benefícios exclusivos" },
      { t: "Cupons Estratégicos", d: "Aumente conversão com descontos" },
    ]
  },
  {
    icon: "📊", title: "Analise cada detalhe", desc: "Dados em tempo real para decisões inteligentes",
    items: [
      { t: "Relatórios Completos", d: "Vendas, produtos e financeiro" },
      // Era "Auditoria com IA": checklist e auditoria são do FireCheck, outro
      // produto, e não entram em material do FireHub.
      { t: "Modo Contingência", d: "Internet caiu? A loja segue no computador do caixa" },
      { t: "Leitura de Notas por IA", d: "Tire foto e a IA extrai os dados" },
      { t: "Controle de Entregas", d: "Motoboys e rotas em tempo real" },
    ]
  }
];

const STEPS = [
  { n: "01", t: "Cadastre-se grátis", d: "Menos de 2 min. Link do cardápio na hora — e a gente copia seu cardápio grátis." },
  { n: "02", t: "Personalize tudo", d: "Logo, banner, produtos, preços e pagamentos." },
  { n: "03", t: "Receba pedidos", d: "Cardápio, WhatsApp, mesas ou balcão." },
  { n: "04", t: "Gerencie e cresça", d: "Relatórios e IA para vender mais." },
];

const COMPARE = [
  ["Cardápio digital sem taxa", true, true, false],
  ["Delivery, Mesas e Balcão", true, true, false],
  ["Chatbot WhatsApp com IA", true, true, false],
  ["Alerta de bebida na comanda (zero esquecimento) 🏆", true, false, false],
  ["Controle financeiro completo", true, true, false],
  ["Leitura de boletos e notas por IA", true, false, false],
  ["Estoque automático", true, true, false],
  ["CMV automático", true, true, false],
  ["Integração iFood / 99Food", true, true, false],
];

// Preço = 2% do faturamento, mín R$100, máx R$400 (teto em R$ 20 mil)
const calcPrice = (rev: number) => rev === 0 ? 0 : Math.max(100, Math.min(400, rev * 0.02));

const FAQ = [
  { q: "Como funciona o teste grátis?", a: "15 dias completos sem cobrar nada. Sem cartão de crédito. Sem compromisso. Você tem acesso a todas as funcionalidades do plano durante o teste (Tráfego Pago e Disparos são cobrados à parte, só se você usar)." },
  // A regra do mínimo está em lib/billing.ts: conta como uso o robô ou a IA
  // respondendo, caixa aberto, contas a pagar, nota de compra, totem e tráfego
  // pago. Integração ligada sem pedido NÃO conta.
  { q: "E se eu não usar a plataforma?", a: "Se você não vender nada e não usar nenhuma funcionalidade no mês, você não paga nada. Se você usar a plataforma ativamente (robô atendendo, caixa aberto, contas a pagar) sem faturar, aplica-se apenas a mensalidade mínima." },
  { q: "Como funciona a cobrança?", a: "Cobramos apenas 2% do valor dos pedidos que passam pelo FireHub — cardápio digital, WhatsApp, mesa, balcão, totem, iFood, 99Food, Jotajá, Brendi e Wabiz entram na mesma conta (valor cheio do pedido, como está nos Termos de Uso). Mínimo de R$ 100 e máximo de R$ 400 por mês — a partir de R$ 20 mil de faturamento você não paga mais nada a mais. Sem taxa por pedido, sem surpresas." },
  { q: "Precisa instalar algum aplicativo?", a: "Não! O FireHub funciona no navegador. Celular, tablet ou computador — em qualquer lugar, a qualquer momento. Para imprimir as comandas, você instala o Assistente de Impressão no computador da loja." },
  { q: "Como é o suporte?", a: "Pelo WhatsApp e pelo chat do painel, 7 dias por semana, com a nossa equipe." },
  { q: "Integra com iFood?", a: "Sim! Receba pedidos do iFood direto no painel, junto com cardápio digital e WhatsApp." },
  { q: "Preciso de um gestor de tráfego para anunciar?", a: "Não. No módulo de Tráfego Pago você escolhe quanto quer investir por semana, a IA escreve o texto e cria a imagem, e o FireHub publica o anúncio no Facebook e no Instagram para quem está na sua área de entrega. O módulo custa R$ 50 por semana de campanha ativa, e a verba do anúncio você paga direto à Meta." },
  // Fatos em lib/disparo-oficial/regras.ts e components/ApresentacaoDisparoOficial.tsx.
  { q: "Dá para disparar promoção sem perder o meu WhatsApp?", a: "Sim. O disparo sai pela API oficial da Meta, do mesmo número da loja: o WhatsApp Business continua no seu celular e o robô continua atendendo. Nada de disparador pelo QR Code, que é o que faz número ser banido. Custa R$ 0,46 por mensagem entregue, com crédito por Pix a partir de R$ 50 — mensagem que não chega volta para o saldo." },
  { q: "E se a internet da loja cair?", a: "Com o Modo Contingência ativado, o computador do caixa assume em uns 15 segundos: você continua lançando pedido, abrindo mesa e imprimindo. Quando a conexão volta, tudo sobe sozinho para o sistema, sem duplicar. Está incluído no plano, sem custo a mais." },
  { q: "Existe multa para cancelar?", a: "Absolutamente não. Você cancela quando quiser, sem burocracia, sem multa, sem surpresas." },
];

// ── Pedidos do quadro do topo. Exemplo ilustrativo: nenhum é de loja real. ──
const PEDIDOS_DEMO = [
  { ic: "🛵", cor: "#FEE2E2", canal: "iFood", item: "2x Pizza grande calabresa", valor: "R$ 89,80", st: "novo" },
  { ic: "💬", cor: "#DCFCE7", canal: "WhatsApp · robô", item: "X-tudo + Coca lata", valor: "R$ 38,90", st: "novo" },
  { ic: "🍽️", cor: "#FEF3C7", canal: "Mesa 4", item: "3 itens · conta aberta", valor: "R$ 112,00", st: "prep" },
  { ic: "🏪", cor: "#E0E7FF", canal: "Balcão", item: "Esfiha de carne x6", valor: "R$ 33,00", st: "saiu" },
  { ic: "🟡", cor: "#FEF9C3", canal: "99Food", item: "Combo smash + batata", valor: "R$ 44,90", st: "prep" },
  { ic: "📱", cor: "#FCE7F3", canal: "Cardápio digital", item: "Açaí 500 ml com granola", valor: "R$ 24,00", st: "novo" },
  { ic: "💬", cor: "#DCFCE7", canal: "WhatsApp · robô", item: "Marmita de frango", valor: "R$ 21,90", st: "prep" },
];
const STATUS: Record<string, string> = { novo: "Novo", prep: "Na cozinha", saiu: "Saiu" };

// Texto do anúncio de exemplo (a IA do módulo escreve um parecido).
const TEXTO_ANUNCIO = "Fome bateu? 🍔 Smash duplo com cheddar e batata saindo agora! Entregamos no seu bairro. Toque em Pedir agora e peça pelo cardápio.";

// ── Hooks de animação ──────────────────────────────────────────────────────

/** Liga as animações de entrada (classe lp-js) e revela [data-revela] ao rolar. */
function useRevelar() {
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.add("lp-js");
    const alvos = document.querySelectorAll<HTMLElement>("[data-revela]");
    if (!("IntersectionObserver" in window)) {
      alvos.forEach((a) => a.classList.add("lp-visivel"));
      return;
    }
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("lp-visivel"); obs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    // O que já está acima da dobra (link com #âncora, voltar da página) aparece
    // na hora: nada pode ficar escondido atrás de quem já passou.
    alvos.forEach((a) => {
      const r = a.getBoundingClientRect();
      if (r.bottom < 0) a.classList.add("lp-visivel");
      else if (r.top < window.innerHeight) requestAnimationFrame(() => requestAnimationFrame(() => a.classList.add("lp-visivel")));
      else obs.observe(a);
    });
    // Rede de segurança: rolagem muito rápida (dedo no celular, atalho de
    // teclado) pode pular o aviso do observador. A cada rolagem, o que já
    // entrou na tela ou ficou para trás aparece — o preço nunca fica escondido.
    let quadro = 0;
    const conferir = () => {
      quadro = 0;
      document.querySelectorAll<HTMLElement>("[data-revela]:not(.lp-visivel)").forEach((a) => {
        if (a.getBoundingClientRect().top < window.innerHeight * 0.92) { a.classList.add("lp-visivel"); obs.unobserve(a); }
      });
    };
    const aoRolar = () => { if (!quadro) quadro = requestAnimationFrame(conferir); };
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => { obs.disconnect(); window.removeEventListener("scroll", aoRolar); cancelAnimationFrame(quadro); raiz.classList.remove("lp-js"); };
  }, []);
}

/** true uma vez, quando o elemento entra na tela. */
function useNaTela<T extends HTMLElement>(limiar = 0.35) {
  const ref = useRef<T>(null);
  const [visto, setVisto] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisto(true); obs.disconnect(); } }, { threshold: limiar });
    obs.observe(el);
    return () => obs.disconnect();
  }, [limiar]);
  return [ref, visto] as const;
}

const semMovimento = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Peças ──────────────────────────────────────────────────────────────────

/** Título do hero: cada palavra sobe em sequência. */
function TituloAnimado({ linhas }: { linhas: { texto: string; em?: boolean }[][] }) {
  let i = 0;
  const palavra = (texto: string, em?: boolean) => (
    <span key={i} className="lp-palavra" style={{ "--i": i++ } as CSSProperties}>
      {em ? <em className="lp-em-brilho">{texto}</em> : texto}
    </span>
  );
  return (
    <h1 className="lp-titulo-anim">
      {linhas.map((linha, l) => (
        <Fragment key={l}>
          {linha.flatMap((parte) => parte.texto.split(" ").filter(Boolean).map((p) => [palavra(p, parte.em), " "]))}
          {l < linhas.length - 1 && <br />}
        </Fragment>
      ))}
    </h1>
  );
}

/** Quadro do hero: pedidos de vários canais chegando num lugar só. */
function QuadroDePedidos() {
  const [linhas, setLinhas] = useState(() => PEDIDOS_DEMO.slice(0, 5).map((p, k) => ({ ...p, id: k, nova: false })));
  const prox = useRef(5);
  useEffect(() => {
    if (semMovimento()) return;
    const t = setInterval(() => {
      const p = PEDIDOS_DEMO[prox.current % PEDIDOS_DEMO.length];
      const id = prox.current++;
      setLinhas((ls) => [{ ...p, id, nova: true }, ...ls].slice(0, 6));
    }, 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div data-revela="zoom" style={{ "--atraso": "650ms" } as CSSProperties}>
      <div className="lp-quadro" aria-label="Exemplo do painel recebendo pedidos de vários canais">
        <div className="lp-quadro-topo">
          <span>📋 Pedidos de hoje — todos os canais</span>
          <span className="lp-ao-vivo">chegando agora</span>
        </div>
        <ul className="lp-linhas">
          {linhas.map((p) => (
            <li key={p.id} className={`lp-linha ${p.nova ? "entra" : ""}`}>
              <span className="lp-canal" style={{ background: p.cor }}>{p.ic}</span>
              <span><b>{p.canal}</b><small>{p.item}</small></span>
              <span className="lp-valor">{p.valor}</span>
              <span className={`lp-st ${p.st}`}>{STATUS[p.st]}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="lp-rotulo">Exemplo ilustrativo — pedidos fictícios.</p>
    </div>
  );
}

/** Número que sobe de 0 até o valor quando aparece na tela. */
function NumeroQueSobe({ valor }: { valor: string }) {
  const [ref, visto] = useNaTela<HTMLDivElement>(0.5);
  const m = valor.match(/^([\d.]+)(.*)$/);
  const alvo = m ? parseFloat(m[1]) : NaN;
  const casas = m && m[1].includes(".") ? m[1].split(".")[1].length : 0;
  const [atual, setAtual] = useState(0);
  useEffect(() => {
    if (!visto || isNaN(alvo)) return;
    if (semMovimento()) { setAtual(alvo); return; }
    const inicio = performance.now(), dur = 1400;
    let raf = 0;
    const passo = (t: number) => {
      const x = Math.min(1, (t - inicio) / dur);
      setAtual(alvo * (1 - Math.pow(1 - x, 3)));
      if (x < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [visto, alvo]);
  if (!m || valor.includes("/")) return <div ref={ref} className="stat-num">{valor}</div>;
  return <div ref={ref} className="stat-num">{visto ? atual.toFixed(casas) : (0).toFixed(casas)}{m[2]}</div>;
}

type Tema = {
  fundo: string; brilho: string; brilhoPos: CSSProperties;
  seloFundo: string; seloBorda: string; seloCor: string;
  titulo: string; texto: string;
  cardFundo: string; cardBorda: string; cardSombra?: string; cardTitulo: string; cardTexto: string;
  nota: string;
};

/** Seção de destaque com texto, quatro cartões e um visual ao lado. */
function Destaque({ id, tema, selo, novo, titulo, texto, cards, acao, visual, inverter, className, borda }: {
  id?: string; tema: Tema; selo: string; novo?: boolean; titulo: ReactNode; texto: ReactNode;
  cards: { t: string; d: string }[]; acao?: ReactNode; visual: ReactNode; inverter?: boolean; className?: string; borda?: string;
}) {
  return (
    <section id={id} className={`lp-destaque ${className ?? ""}`} style={{ background: tema.fundo, borderTop: borda }}>
      <div className="lp-brilho" style={{ ...tema.brilhoPos, background: `radial-gradient(circle, ${tema.brilho} 0%, rgba(0,0,0,0) 70%)` }} />
      <div className="w">
        <div className={`lp-split ${inverter ? "inv" : ""}`}>
          <div>
            <div data-revela className="lp-selo" style={{ background: tema.seloFundo, border: `1px solid ${tema.seloBorda}`, color: tema.seloCor }}>
              {novo && <span className="novo">NOVO</span>}{selo}
            </div>
            <h2 data-revela className="lp-h2" style={{ color: tema.titulo, "--atraso": "80ms" } as CSSProperties}>{titulo}</h2>
            <p data-revela className="lp-p" style={{ color: tema.texto, "--atraso": "160ms" } as CSSProperties}>{texto}</p>
            <div className="lp-mini">
              {cards.map((c, k) => (
                <div key={k} data-revela className="lp-mini-card" style={{ background: tema.cardFundo, border: `1px solid ${tema.cardBorda}`, boxShadow: tema.cardSombra, "--atraso": `${200 + k * 90}ms` } as CSSProperties}>
                  <div className="t" style={{ color: tema.cardTitulo }}>{c.t}</div>
                  <div className="d" style={{ color: tema.cardTexto }}>{c.d}</div>
                </div>
              ))}
            </div>
            {acao && <div data-revela className="lp-acao" style={{ "--atraso": "520ms" } as CSSProperties}>{acao}</div>}
          </div>
          <div className="lp-visual" data-revela={inverter ? "esq" : "dir"} style={{ "--atraso": "150ms" } as CSSProperties}>{visual}</div>
        </div>
      </div>
    </section>
  );
}

/** `real`: print de verdade do painel (dados de cliente trocados por exemplo). */
function Moldura({ src, alt, borda, sombra, fundo, real, children }: { src: string; alt: string; borda: string; sombra: string; fundo: string; real?: boolean; children?: ReactNode }) {
  return (
    <div className={`lp-moldura ${real ? "lp-tela-real" : ""}`} style={{ border: borda, boxShadow: sombra, background: fundo }}>
      {real && <span className="lp-selo-real">✓ Tela real do FireHub</span>}
      <img src={src} alt={alt} loading="lazy" decoding="async" />
      {children}
    </div>
  );
}

/** Celular com o anúncio sendo escrito pela IA, dentro do raio de entrega. */
function AnuncioDemo() {
  const [ref, visto] = useNaTela<HTMLDivElement>(0.3);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!visto) return;
    if (semMovimento()) { setN(TEXTO_ANUNCIO.length); return; }
    let k = 0, t: ReturnType<typeof setTimeout>;
    const escreve = () => {
      k++;
      setN(k);
      if (k < TEXTO_ANUNCIO.length) t = setTimeout(escreve, 34);
      else t = setTimeout(() => { k = 0; escreve(); }, 4200);
    };
    t = setTimeout(escreve, 400);
    return () => clearTimeout(t);
  }, [visto]);
  const pronto = n >= TEXTO_ANUNCIO.length;
  return (
    <div ref={ref} className="lp-cel-cena" aria-label="Exemplo de anúncio criado pelo módulo de Tráfego Pago">
      <div className="lp-raio" />
      <span className="lp-pino" style={{ top: "6%", left: "8%" }}>📍 Só quem você entrega</span>
      <span className="lp-pino" style={{ bottom: "8%", right: "4%", animationDelay: "1.2s" }}>🎯 Raio de 1 a 50 km</span>
      <div className="lp-cel">
        <div className="lp-cel-tela">
          <div className="lp-cel-barra"><span>20:14</span><span>▮▮▮ 5G</span></div>
          <div className="lp-an-topo">
            <div className="lp-an-av"><i>🍔</i></div>
            <div><b>Hamburgueria do Bairro</b><small>Patrocinado</small></div>
          </div>
          <div className="lp-an-img">
            <div className="lanche">🍔</div>
            {!pronto && <div className="gerando" />}
            <span className="tag">{pronto ? "✨ Imagem criada pela IA" : "✨ IA criando a imagem…"}</span>
          </div>
          <div className="lp-an-cta"><span style={{ background: "none", color: "#111", padding: 0 }}>Peça pelo cardápio</span><span>Pedir agora</span></div>
          <div className="lp-an-txt"><b>hamburgueriadobairro</b> {TEXTO_ANUNCIO.slice(0, n)}{!pronto && <span className="lp-cursor" />}</div>
        </div>
      </div>
      <div className="lp-ia-chip">✍️ IA escreveu o texto</div>
      <div className="lp-ia-chip b">📣 Facebook + Instagram</div>
      <p className="lp-rotulo" style={{ position: "absolute", bottom: -18, left: 0, right: 0 }}>Exemplo ilustrativo de anúncio.</p>
    </div>
  );
}

// Disparo oficial: a promoção chega com os botões do template de verdade
// (lib/disparo-oficial) e o relatório sobe. Números do relatório = exemplo.
const RELATORIO_DEMO = [
  { rotulo: "Entregues", valor: 487, cor: "#5EEAD4" },
  { rotulo: "Lidas", valor: 352, cor: "#A7F3D0" },
  { rotulo: "Responderam", valor: 41, cor: "#FDE68A" },
];
function DisparoDemo() {
  const [ref, visto] = useNaTela<HTMLDivElement>(0.35);
  // 0 nada, 1 promoção chegou, 2 cliente tocou em "Quero pedir", 3 robô respondeu
  const [fase, setFase] = useState(0);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!visto) return;
    if (semMovimento()) { setFase(3); setT(1); return; }
    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;
    const ciclo = () => {
      setFase(0); setT(0);
      timers.push(setTimeout(() => {
        setFase(1);
        const inicio = performance.now();
        const passo = (agora: number) => {
          const x = Math.min(1, (agora - inicio) / 2200);
          setT(1 - Math.pow(1 - x, 3));
          if (x < 1) raf = requestAnimationFrame(passo);
        };
        raf = requestAnimationFrame(passo);
      }, 500));
      timers.push(setTimeout(() => setFase(2), 2600));
      timers.push(setTimeout(() => setFase(3), 3500));
      timers.push(setTimeout(ciclo, 9000));
    };
    ciclo();
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); };
  }, [visto]);
  return (
    <div ref={ref} className="lp-disp-cena" aria-label="Exemplo de promoção enviada pela API oficial do WhatsApp">
      <div className="lp-zap">
        <div className="lp-zap-topo">
          <span className="lp-zap-av">🍕</span>
          <span><b>Pizzaria do Bairro</b><small>conta comercial</small></span>
        </div>
        <div className="lp-zap-chat">
          <div className={`lp-zap-msg ${fase >= 1 ? "on" : ""}`}>
            <p>Oi, Ana! 🍕 Hoje tem <b>pizza grande com borda grátis</b> até as 23h. Bateu a fome?</p>
            <span className="hora">19:02</span>
            <div className="lp-zap-botoes">
              <span className={fase >= 2 ? "tocado" : ""}>🛒 Quero pedir</span>
              <span>🚫 Parar promoções</span>
            </div>
          </div>
          <div className={`lp-zap-msg robo ${fase >= 3 ? "on" : ""}`}>
            <p>Oba! 😄 Aqui está o cardápio. Me diz o sabor que eu já anoto o seu pedido.</p>
            <span className="hora">19:03 · robô da loja</span>
          </div>
        </div>
      </div>
      <div className="lp-disp-rel">
        <div className="lp-disp-rel-tit">📊 Relatório da campanha · 500 clientes</div>
        {RELATORIO_DEMO.map((r) => (
          <div key={r.rotulo} className="lp-disp-linha">
            <span>{r.rotulo}</span>
            <div className="barra"><i style={{ width: `${(r.valor / 500) * 100 * t}%`, background: r.cor }} /></div>
            <b>{Math.round(r.valor * t)}</b>
          </div>
        ))}
      </div>
      <p className="lp-rotulo" style={{ color: "#5EEAD4", opacity: 0.75 }}>Exemplo ilustrativo — cliente e números fictícios.</p>
    </div>
  );
}

// Cena da contingência. Textos das faixas = os da tela de verdade
// (components/contingencia/TrocaDeContingencia.tsx).
const EVENTOS_QUEDA = [
  { h: "20:41", t: "Mesa 6 aberta pelo garçom" },
  { h: "20:42", t: "Pedido #0412 do balcão impresso" },
  { h: "20:44", t: "Conta da mesa 2 fechada no caixa" },
];
function ContingenciaDemo() {
  const [ref, visto] = useNaTela<HTMLDivElement>(0.4);
  const [fase, setFase] = useState<"normal" | "caiu" | "voltou">("normal");
  const [mostrados, setMostrados] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rodando = fase !== "normal";

  const rodar = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const agenda = (ms: number, f: () => void) => timers.current.push(setTimeout(f, ms));
    setFase("caiu"); setMostrados(0);
    EVENTOS_QUEDA.forEach((_, k) => agenda(1100 + k * 1100, () => setMostrados(k + 1)));
    agenda(5200, () => setFase("voltou"));
    agenda(8600, () => setFase("normal"));
  };
  useEffect(() => {
    if (!visto) return;
    const t = setTimeout(rodar, 700);
    return () => { clearTimeout(t); timers.current.forEach(clearTimeout); };
  }, [visto]);

  const faixa = fase === "caiu"
    ? "🛡️ Sem conexão com o FireHub — trabalhando no computador da loja. Tudo será enviado quando voltar."
    : fase === "voltou"
      ? "✅ Conexão voltou — tudo foi enviado. Voltando ao FireHub…"
      : "🟢 Com internet: tudo como hoje. O computador do caixa guarda uma cópia da loja.";

  return (
    <div ref={ref} className="lp-cena" data-fase={fase} aria-live="polite">
      <div className="lp-cena-faixa">{faixa}</div>
      <div className="lp-trilho">
        <div className="lp-no nuvem"><div className="ic">☁️</div>FireHub<br />na internet</div>
        <div className="lp-fio nuvem" />
        <div className="lp-no pc"><div className="ic">🖥️</div>Computador<br />do caixa</div>
        <div className="lp-fio" />
        <div className="lp-no"><div className="ic">🖨️</div>Impressora,<br />TV e garçom</div>
      </div>
      <div className="lp-eventos">
        {EVENTOS_QUEDA.map((e, k) => (
          <div key={k} className={`lp-evento ${k < mostrados ? "on" : ""}`}>
            <i>{e.h}</i>{e.t}<span className="ok">{fase === "voltou" ? "✓ enviado" : "✓ na loja"}</span>
          </div>
        ))}
      </div>
      <div className="lp-cena-pe">
        <button type="button" onClick={rodar} disabled={rodando}>⚡ Derrubar a internet</button>
        <small>Simulação ilustrativa.</small>
      </div>
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [barra, setBarra] = useState(false);
  const [sliderValue, setSliderValue] = useState(3000);
  const progresso = useRef<HTMLDivElement>(null);

  useRevelar();

  useEffect(() => {
    const fn = () => {
      const y = window.scrollY;
      setScrolled(y > 30);
      setBarra(y > 520);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progresso.current) progresso.current.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    };
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const calculatedPrice = calcPrice(sliderValue);

  const Check = () => <span style={{color:"#16A34A",fontSize:"1.1rem"}}>✅</span>;
  const Cross = () => <span style={{color:"#EF4444"}}>❌</span>;

  return (
    <main>
      <div className="lp-progresso" ref={progresso} />

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
          <a href="#trafego-pago">Tráfego Pago</a>
          <a href="#contingencia">Contingência</a>
          <a href="#disparos">Disparos</a>
          <a href="#planos">Planos</a>
          <a href="#faq">FAQ</a>
          {/* Era "🤝 Indique e Ganhe", aberto a qualquer lojista. O programa de
              indicação self-service saiu: embaixador agora é cadastrado à mão
              pela equipe, e esta porta serve para demonstrar interesse. */}
          <a href="/seja-embaixador" style={{
            color: "#EF4444",
            fontWeight: 700,
            border: "2px solid #EF4444",
            padding: "8px 16px",
            borderRadius: "50px",
            background: "rgba(239, 68, 68, 0.08)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s"
          }}>⭐ Embaixadores</a>
          <a href={LOGIN} style={{ fontWeight: 600 }}>🔑 Acessar</a>
          <a href={TRIAL} className="btn-cta">🔥 Testar Grátis</a>
        </div>
      </nav>

      {/* HERO — texto centralizado, com o quadro de pedidos chegando embaixo */}
      <section className="lp-hero">
        <div className="lp-bolha b1" /><div className="lp-bolha b2" /><div className="lp-bolha b3" />
        <div className="lp-ficha" style={{ top: 170, left: "max(24px, calc(50% - 600px))" }}><span className="ic" style={{ background: "#FEE2E2" }}>🛵</span><span>iFood<small>pedido novo</small></span></div>
        <div className="lp-ficha" style={{ top: 330, left: "max(24px, calc(50% - 640px))", animationDelay: "1.5s" }}><span className="ic" style={{ background: "#DCFCE7" }}>💬</span><span>WhatsApp<small>robô anotou</small></span></div>
        <div className="lp-ficha" style={{ top: 190, right: "max(24px, calc(50% - 600px))", animationDelay: ".8s" }}><span className="ic" style={{ background: "#FEF3C7" }}>🍽️</span><span>Mesa 7<small>conta aberta</small></span></div>
        <div className="lp-ficha" style={{ top: 350, right: "max(24px, calc(50% - 630px))", animationDelay: "2.2s" }}><span className="ic" style={{ background: "#E0E7FF" }}>🖨️</span><span>Comanda<small>impressa</small></span></div>
        <div className="hero" style={{gridTemplateColumns:"1fr",textAlign:"center",maxWidth:800}}>
          <div>
            <div className="hero-tag" data-revela style={{margin:"0 auto 22px"}}><span className="pulse" />15 dias grátis · Sem cartão de crédito</div>
            <TituloAnimado linhas={[
              [{ texto: "Simples, rápido e" }],
              [{ texto: "completo.", em: true }, { texto: "Tudo que o seu" }],
              [{ texto: "restaurante precisa." }],
            ]} />
            <p className="hero-p" data-revela style={{maxWidth:560,margin:"0 auto 32px","--atraso":"420ms"} as CSSProperties}>Cardápio digital, gestão de pedidos, chatbot WhatsApp, controle financeiro e tráfego pago — pare de perder vendas e comece a crescer.</p>
            <div className="hero-btns" data-revela style={{justifyContent:"center","--atraso":"520ms"} as CSSProperties}>
              <a href={TRIAL} className="btn-primary btn-pulse" style={{padding:"18px 48px",fontSize:"1.15rem"}}>🔥 Testar Grátis por 15 Dias</a>
            </div>
            <p className="hero-note" data-revela style={{marginTop:16,"--atraso":"580ms"} as CSSProperties}>✓ Sem compromisso &nbsp;·&nbsp; ✓ Sem multa para cancelar &nbsp;·&nbsp; ✓ Migração fácil</p>
            <div className="hero-badges" data-revela style={{justifyContent:"center",marginTop:24,"--atraso":"640ms"} as CSSProperties}>
              <div className="badge"><span>📋</span> Delivery</div>
              <div className="badge"><span>🍽️</span> Mesas</div>
              <div className="badge"><span>🏪</span> Balcão</div>
              <div className="badge"><span>🤖</span> IA</div>
              <div className="badge"><span>💬</span> WhatsApp</div>
            </div>
            <QuadroDePedidos />
          </div>
        </div>
      </section>

      {/* STATS */}
      <div className="w">
        <div className="stats" data-revela>
          <div className="stat"><NumeroQueSobe valor="500+" /><p>Restaurantes ativos</p></div>
          <div className="stat"><NumeroQueSobe valor="2M+" /><p>Pedidos processados</p></div>
          <div className="stat"><NumeroQueSobe valor="99.9%" /><p>Uptime garantido</p></div>
          <div className="stat"><NumeroQueSobe valor="24/7" /><p>Suporte disponível</p></div>
        </div>
      </div>

      {/* FUNCIONALIDADES */}
      <section className="sec" id="funcionalidades">
        <div className="w">
          <div className="sec-title" data-revela>
            <h2>Todas as funcionalidades <em>incluídas</em></h2>
            <p>Tenha acesso a todas as funcionalidades do nosso sistema independente do seu faturamento.</p>
          </div>
          <div className="solutions">
            {SOLUTIONS.map((sol, i) => (
              <div key={i} className="sol-card" data-revela style={{ "--atraso": `${i * 120}ms` } as CSSProperties}>
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

      {/* NOVO: TRÁFEGO PAGO — fatos em components/customer/TrafegoPagoClient.tsx
          (termos: R$ 50/semana de campanha ativa, verba direto à Meta; a IA
          escreve o texto e gera a imagem, o Facebook decide a entrega). */}
      <Destaque
        id="trafego-pago"
        className="lp-trafego"
        tema={{
          fundo: "linear-gradient(160deg,#FFFFFF 0%,#FFF5F7 45%,#FFF7ED 100%)", brilho: "rgba(225,48,108,0.14)", brilhoPos: { top: -160, right: -160 },
          seloFundo: "rgba(225,48,108,0.10)", seloBorda: "rgba(225,48,108,0.35)", seloCor: "#BE185D",
          titulo: "#0F172A", texto: "#475569",
          cardFundo: "#FFF", cardBorda: "rgba(225,48,108,0.12)", cardSombra: "0 4px 14px rgba(225,48,108,0.06)", cardTitulo: "#0F172A", cardTexto: "#64748B",
          nota: "#64748B",
        }}
        novo
        selo="📣 TRÁFEGO PAGO SEM GESTOR"
        titulo={<>Faça anúncios no <span className="lp-ig">Instagram e Facebook</span> sem precisar de gestor</>}
        texto={<>Você escolhe quanto quer investir por semana. A <strong style={{ color: "#0F172A" }}>IA escreve o texto e cria a imagem</strong>, e o FireHub publica o anúncio só para quem está na sua área de entrega. Quem clica cai direto no seu cardápio e faz o pedido.</>}
        cards={[
          { t: "🎯 Só Quem Você Entrega", d: "Raio no mapa a partir da sua loja, já preenchido com a sua área de entrega" },
          { t: "✍️ IA Monta o Anúncio", d: "Texto e imagem prontos em minutos — ou use a foto do seu cardápio" },
          { t: "📊 Painel em Tempo Real", d: "Investido, cliques, pedidos e custo por pedido de cada campanha" },
          { t: "⏸️ Pause Quando Quiser", d: "Pausa, retoma e muda o orçamento pelo painel, sem contrato" },
        ]}
        acao={<>
          <div className="lp-preco-modulo" style={{ width: "100%", marginBottom: 6 }}>
            <strong>R$ 50<small>/semana</small></strong>
            <span><b style={{ color: "#374151" }}>Módulo à parte</b>, cobrado só nas semanas com campanha ativa. A verba do anúncio você paga direto à Meta — o FireHub não fica com nada dela.</span>
          </div>
          <a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem", background: "linear-gradient(135deg,#E1306C,#C13584)", boxShadow: "0 6px 24px rgba(225,48,108,.3)" }}>🔥 Quero Anunciar sem Gestor</a>
          <span className="nota" style={{ color: "#64748B" }}>A gente conecta o seu Facebook junto com você</span>
        </>}
        visual={<AnuncioDemo />}
      />

      {/* SEÇÃO INOVAÇÃO EXCLUSIVA: AUTO-ETA IFOOD — a extensão escreve SÓ no
          iFood e não pausa a loja (store/extensao-ifood/page.tsx). */}
      <Destaque
        tema={{
          fundo: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", brilho: "rgba(232,54,12,0.25)", brilhoPos: { top: -100, right: -100 },
          seloFundo: "rgba(232,54,12,0.2)", seloBorda: "rgba(232,54,12,0.5)", seloCor: "#FF5722",
          titulo: "#FFF", texto: "#94A3B8",
          cardFundo: "rgba(255,255,255,0.05)", cardBorda: "rgba(255,255,255,0.1)", cardTitulo: "#FFF", cardTexto: "#94A3B8",
          nota: "#94A3B8",
        }}
        selo="⚡ INOVAÇÃO EXCLUSIVA FIREHUB"
        titulo={<>Automação Inteligente do Tempo de Entrega no <span style={{ color: "#EA1D2C" }}>iFood</span></>}
        texto={<>Chega de ter que parar o atendimento para ficar ajustando o iFood manualmente no meio da correria. O FireHub é a <strong style={{ color: "#FFF" }}>primeira tecnologia do Brasil</strong> que lê a fila real da sua cozinha e os motoboys que você informa para atualizar os prazos no iFood 100% no automático!</>}
        cards={[
          { t: "🤖 100% Silencioso", d: "Atualiza os prazos nos bastidores sem fechar a tela do caixa" },
          { t: "🛡️ Alerta de Estouro", d: "Avisa na hora quando a cozinha passa do limite de pedidos" },
          { t: "🛵 Cálculo por Motoboy", d: "Ajusta os prazos conforme os motoboys que estão na casa" },
          { t: "⭐ Menos Avaliações 1 Estrela", d: "Menos reclamação de atraso e menos pedido cancelado" },
        ]}
        acao={<>
          <a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem" }}>🔥 Testar Tecnologia Exclusiva Grátis</a>
          <span className="nota" style={{ color: "#94A3B8" }}>Incluída sem custo adicional em todos os planos FireHub!</span>
        </>}
        visual={<Moldura real src="/images/tela-prazo-ifood.webp" alt="Tela do FireHub: o prazo do iFood muda sozinho conforme a fila da cozinha e os motoboys na casa" borda="1px solid rgba(255,255,255,0.15)" sombra="0 20px 40px rgba(0,0,0,0.5)" fundo="#FFF" />}
      />

      {/* SEÇÃO CHATBOT HUMANIZADO */}
      <Destaque
        inverter
        tema={{
          fundo: "linear-gradient(135deg, #F8FAFC 0%, #E2E8F0 100%)", brilho: "rgba(37,211,102,0.14)", brilhoPos: { bottom: -160, left: -140 },
          seloFundo: "rgba(37,211,102,0.15)", seloBorda: "rgba(37,211,102,0.4)", seloCor: "#16A34A",
          titulo: "#0F172A", texto: "#475569",
          cardFundo: "#FFF", cardBorda: "rgba(0,0,0,0.05)", cardSombra: "0 4px 6px rgba(0,0,0,0.02)", cardTitulo: "#0F172A", cardTexto: "#64748B",
          nota: "#64748B",
        }}
        selo="💬 CHATBOT WHATSAPP HUMANIZADO"
        titulo="Chega de robôs que irritam o seu cliente"
        texto={<>O robô de atendimento do FireHub é diferente de tudo o que você já viu. Ele <strong style={{ color: "#0F172A" }}>escuta áudios</strong> e entende naturalmente o que o cliente quer, montando o pedido direto na conversa sem forçar seu cliente a sair do WhatsApp para abrir links confusos.</>}
        cards={[
          { t: "🎙️ Entende Áudios", d: "Compreende perfeitamente pedidos e instruções enviadas por voz" },
          { t: "🛍️ Monta Pedidos", d: "Adiciona itens ao carrinho sem que o cliente abra links do cardápio" },
          { t: "❤️ Atendimento Empático", d: "Uma conversa natural, como se fosse o seu melhor atendente humano" },
          { t: "🚀 Aumenta Vendas", d: "Zera desistências de quem odeia lidar com sistemas e sites complexos" },
        ]}
        acao={<>
          <a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem", background: "linear-gradient(135deg,#22C55E,#16A34A)", boxShadow: "0 6px 24px rgba(22,163,74,.28)" }}>💬 Testar o Robô Grátis</a>
        </>}
        visual={<Moldura src="/images/chatbot_ui.webp" alt="FireHub Chatbot Humanizado" borda="1px solid rgba(0,0,0,0.05)" sombra="0 20px 40px rgba(0,0,0,0.1)" fundo="#FFF" />}
      />

      {/* NOVO: DISPAROS PELA API OFICIAL — fatos em lib/disparo-oficial/regras.ts
          (R$ 0,46 por entregue com o custo da Meta de out/2026, recarga mínima
          R$ 50) e components/ApresentacaoDisparoOficial.tsx. O disparo pelo QR
          Code está desligado (lib/disparo-em-massa.ts). */}
      <Destaque
        id="disparos"
        inverter
        tema={{
          fundo: "linear-gradient(150deg,#042F2E 0%,#0F3D3A 55%,#134E4A 100%)", brilho: "rgba(45,212,191,0.20)", brilhoPos: { top: -140, left: -140 },
          seloFundo: "rgba(45,212,191,0.14)", seloBorda: "rgba(45,212,191,0.4)", seloCor: "#5EEAD4",
          titulo: "#FFF", texto: "#A7C4C0",
          cardFundo: "rgba(255,255,255,0.05)", cardBorda: "rgba(45,212,191,0.22)", cardTitulo: "#FFF", cardTexto: "#A7C4C0",
          nota: "#A7C4C0",
        }}
        novo
        selo="✅ DISPAROS PELA API OFICIAL DA META"
        titulo={<>Faça disparos <span style={{ color: "#5EEAD4" }}>sem perder o seu WhatsApp</span></>}
        texto={<>Mande promoção para os seus clientes pelo <strong style={{ color: "#FFF" }}>canal oficial da Meta</strong>, do mesmo número da loja. Seu WhatsApp continua no celular, seu robô continua atendendo — e quem toca em “Quero pedir” já cai na conversa para fechar o pedido.</>}
        cards={[
          { t: "🛡️ Número Protegido", d: "Nada de disparador pelo QR Code, que é o que faz número ser banido" },
          { t: "📱 Mesmo Número, Mesmo Robô", d: "Sem chip novo: o cliente responde onde sempre conversou com a loja" },
          { t: "🛒 Botão “Quero Pedir”", d: "Um toque e o robô manda o cardápio e anota o pedido na hora" },
          { t: "📊 Relatório de Verdade", d: "Quantos receberam, leram e responderam em cada campanha" },
        ]}
        acao={<>
          <div className="lp-preco-modulo" style={{ width: "100%", marginBottom: 6, background: "rgba(255,255,255,.05)", borderColor: "rgba(94,234,212,.4)" }}>
            <strong style={{ color: "#5EEAD4" }}>R$ 0,46<small style={{ color: "#99F6E4" }}> por mensagem entregue</small></strong>
            <span style={{ color: "#A7C4C0" }}><b style={{ color: "#E6FFFA" }}>Crédito pré-pago por Pix</b>, a partir de R$ 50, sem mensalidade a mais. Mensagem que não chega volta para o seu saldo.</span>
          </div>
          <a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem", background: "linear-gradient(135deg,#14B8A6,#0F766E)", boxShadow: "0 6px 24px rgba(20,184,166,.3)" }}>✅ Quero Disparar sem Risco</a>
          <span className="nota" style={{ color: "#A7C4C0" }}>Estamos liberando loja por loja — a gente ativa a sua pelo WhatsApp</span>
        </>}
        visual={<DisparoDemo />}
      />

      {/* SEÇÃO INTEGRAÇÕES — só as que estão ligadas hoje. Keeta: código pronto,
          desligada até a Keeta liberar o app. Facebook não é marketplace (é o
          Tráfego Pago, que tem seção própria). */}
      <section className="sec" style={{ background: "#FFFFFF", padding: "4rem 0", borderTop: "1px solid rgba(0,0,0,0.05)" }}>
        <div className="w">
          <div style={{ textAlign: "center", marginBottom: "2rem" }} data-revela>
            <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#0F172A", margin: "0 0 16px", letterSpacing: "-0.5px" }}>
              Integramos com os maiores apps de pedido do Brasil
            </h2>
          </div>
        </div>
        <div className="lp-marquee" data-revela>
          <div className="lp-marquee-trilho">
            {[0, 1].map((rep) => (
              <div key={rep} style={{ display: "flex", gap: "4.5rem", alignItems: "center" }} aria-hidden={rep === 1}>
                <div className="lp-logo"><img src="/images/logos/ifood.png" alt="iFood" /></div>
                <div className="lp-logo"><img src="/images/logos/99.svg" alt="99Food" style={{ maxHeight: 36 }} /></div>
                <div className="lp-logo"><img src="/images/logos/jotaja.png" alt="Jotajá" /></div>
                <div className="lp-logo"><img src="/images/logos/brendi.webp" alt="Brendi" style={{ maxHeight: 34 }} /></div>
                <div className="lp-logo lp-logo-txt" style={{ color: "#7C3AED" }}>wabiz</div>
              </div>
            ))}
          </div>
        </div>
        <div className="w">
          <div data-revela style={{ textAlign: "center", background: "#F8FAFC", padding: "20px", borderRadius: "12px", border: "1px solid #E2E8F0", maxWidth: 650, margin: "0 auto" }}>
            <p style={{ margin: 0, fontSize: "1.05rem", color: "#334155" }}>
              <strong>Precisa integrar com algum marketplace que não temos?</strong> <br />
              <a href={WA} target="_blank" rel="noopener noreferrer" style={{ color: "#EF4444", fontWeight: 700, textDecoration: "none", display: "inline-block", marginTop: "8px" }}>
                Fale com nossa equipe aí no nosso WhatsApp!
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* NOVO: MODO CONTINGÊNCIA — fatos em store/contingencia/ModoContingenciaClient.tsx.
          Sem cobrança (decisão do Douglas, 13/10/2026). Na queda o iFood não
          recebe pedido: ele é pausado e reaberto sozinho (lib/loja-sem-conexao.ts). */}
      <Destaque
        id="contingencia"
        className="lp-cont"
        inverter
        tema={{
          fundo: "radial-gradient(1000px 500px at 85% 10%, rgba(34,197,94,0.10), transparent 60%), linear-gradient(160deg,#07111F 0%,#0B1A2E 100%)", brilho: "rgba(34,197,94,0.14)", brilhoPos: { bottom: -180, left: -160 },
          seloFundo: "rgba(34,197,94,0.15)", seloBorda: "rgba(34,197,94,0.4)", seloCor: "#4ADE80",
          titulo: "#FFF", texto: "#94A3B8",
          cardFundo: "rgba(255,255,255,0.04)", cardBorda: "rgba(34,197,94,0.2)", cardTitulo: "#FFF", cardTexto: "#94A3B8",
          nota: "#94A3B8",
        }}
        novo
        selo="🛡️ MODO CONTINGÊNCIA"
        titulo={<>A internet caiu? <span style={{ color: "#4ADE80" }}>Sua loja não para.</span></>}
        texto={<>Instale o FireHub no computador do caixa. Se a internet da loja ou o próprio FireHub cair, <strong style={{ color: "#FFF" }}>as telas passam sozinhas para esse computador</strong>: você continua lançando pedido, abrindo e fechando mesa e imprimindo, como se nada tivesse acontecido.</>}
        cards={[
          { t: "⚡ Troca Sozinha", d: "Em uns 15 segundos as telas vão para o computador da loja" },
          { t: "🖨️ Mesmas Telas e Impressão", d: "Balcão, mesas, cozinha e caixa seguem iguais, com comanda saindo" },
          { t: "🔄 Sobe Tudo Sozinho", d: "Quando a conexão volta, tudo vai para o sistema, sem duplicar" },
          { t: "💰 Incluído no Plano", d: "Sem custo a mais — você ativa no painel quando quiser" },
        ]}
        acao={<>
          <a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem", background: "linear-gradient(135deg,#22C55E,#15803D)", boxShadow: "0 6px 24px rgba(34,197,94,.3)" }}>🛡️ Quero Minha Loja Sem Parar</a>
          <span className="nota" style={{ color: "#94A3B8" }}>Funciona em computador Windows</span>
        </>}
        visual={<>
          <ContingenciaDemo />
          <div className="lp-requisitos">
            <b>Como funciona na prática:</b> com internet, tudo segue como hoje e o computador do caixa guarda uma cópia da loja (cardápio, mesas, pedidos e caixa). A TV da cozinha e o celular do garçom no Wi-Fi da loja, depois de preparados uma vez, trocam sozinhos para ele. Se a internet da loja cair, o iFood fica pausado e reabre sozinho na volta.
          </div>
        </>}
      />

      {/* SEÇÃO ALERTA DE BEBIDAS NA NOTINHA TÉRMICA */}
      <Destaque
        id="alerta-bebidas"
        borda="1px solid rgba(56,189,248,0.15)"
        tema={{
          fundo: "linear-gradient(135deg, #0A1128 0%, #1C2541 100%)", brilho: "rgba(56,189,248,0.18)", brilhoPos: { top: -100, left: -100 },
          seloFundo: "rgba(56,189,248,0.15)", seloBorda: "rgba(56,189,248,0.4)", seloCor: "#38BDF8",
          titulo: "#FFF", texto: "#94A3B8",
          cardFundo: "rgba(255,255,255,0.04)", cardBorda: "rgba(56,189,248,0.2)", cardTitulo: "#FFF", cardTexto: "#94A3B8",
          nota: "#94A3B8",
        }}
        selo="🥤 REVOLUÇÃO NA EXPEDIÇÃO · ZERO ESQUECIMENTO"
        titulo={<>Nunca mais mande um pedido sem a <span style={{ color: "#38BDF8" }}>bebida gelada</span></>}
        texto={<>O maior motivo de <strong>avaliações 1 estrela, estornos e prejuízo</strong> no delivery é a bebida esquecida na geladeira enquanto o lanche quente é embalado na pressa. O FireHub <strong style={{ color: "#FFF" }}>detecta automaticamente qualquer bebida ou refrigerante</strong> (mesmo dentro de combos) e carimba a notinha impressa com destaque inconfundível para sua equipe!</>}
        cards={[
          { t: "🏷️ Carimbo <=== BEBIDA", d: "Marcação clara e direta ao lado de cada refrigerante ou suco na comanda" },
          { t: "⬛ Faixa de Alerta em Negrito", d: "Imprime faixa de aviso em preto invertido: \"ATENÇÃO: POSSUI BEBIDA\"" },
          { t: "🍔 Detecta Itens de Combos", d: "Se o cliente escolheu Coca-Cola ou Guaraná no combo, a nota destaca!" },
          { t: "⭐ Zero Retrabalho & Reclamação", d: "Acabe com motoboy voltando para levar refrigerante e avaliações negativas" },
        ]}
        acao={<>
          <a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem", background: "linear-gradient(135deg, #0284C7, #0369A1)" }}>🔥 Experimentar no Meu Restaurante</a>
          <span className="nota" style={{ color: "#94A3B8" }}>Funciona em impressoras térmicas 80mm e 58mm</span>
        </>}
        visual={
          <Moldura src="/images/alerta_bebida_cupom.webp" alt="Alerta Automático de Bebidas na Impressão Térmica FireHub" borda="1.5px solid rgba(56,189,248,0.3)" sombra="0 25px 50px rgba(0,0,0,0.8), 0 0 35px rgba(56,189,248,0.15)" fundo="#000">
            <div style={{ position: "absolute", bottom: 14, left: 14, right: 14, background: "rgba(10,17,40,0.85)", backdropFilter: "blur(8px)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "1.2rem" }}>🖨️</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#FFF" }}>Impressão Térmica com Tag de Bebida</div>
                  <div style={{ fontSize: "0.72rem", color: "#38BDF8" }}>Identificação automática pelo nome da bebida</div>
                </div>
              </div>
              <span style={{ background: "#0284C7", color: "#FFF", fontSize: "0.7rem", fontWeight: 800, padding: "4px 8px", borderRadius: 6 }}>Exclusivo</span>
            </div>
          </Moldura>
        }
      />

      {/* SEÇÃO ROTEIRIZADOR */}
      <Destaque
        tema={{
          fundo: "#020617", brilho: "rgba(59,130,246,0.15)", brilhoPos: { bottom: -100, left: -100 },
          seloFundo: "rgba(59,130,246,0.2)", seloBorda: "rgba(59,130,246,0.5)", seloCor: "#60A5FA",
          titulo: "#FFF", texto: "#94A3B8",
          cardFundo: "rgba(255,255,255,0.05)", cardBorda: "rgba(255,255,255,0.1)", cardTitulo: "#FFF", cardTexto: "#94A3B8",
          nota: "#94A3B8",
        }}
        selo="🗺️ LOGÍSTICA INTELIGENTE"
        titulo={<>Roteirizador que coloca o seu restaurante em <span style={{ color: "#3B82F6" }}>outro nível</span></>}
        texto="Não jogue dinheiro fora com entregas desorganizadas. Nosso sistema de roteirização inteligente permite acompanhar os motoboys e criar rotas perfeitas, garantindo que os pedidos saiam juntos e cheguem na temperatura ideal."
        cards={[
          { t: "🗺️ Rotas Otimizadas", d: "Agrupa pedidos próximos automaticamente para um único motoboy" },
          { t: "🛵 Controle Total", d: "Saiba exatamente quem está disponível na loja e quem está na rua" },
          { t: "⏱️ Previsão Exata", d: "Reduza atrasos em horários de pico despachando no momento certo" },
          { t: "💰 Economia de Taxas", d: "Aproveite melhor sua equipe e evite idas e vindas desnecessárias" },
        ]}
        acao={<a href={TRIAL} className="btn-primary" style={{ padding: "14px 28px", fontSize: "1rem", background: "linear-gradient(135deg,#3B82F6,#1D4ED8)", boxShadow: "0 6px 24px rgba(59,130,246,.3)" }}>🗺️ Organizar Minhas Entregas</a>}
        visual={<Moldura src="/images/roteirizador_ui.webp" alt="FireHub Roteirizador" borda="1px solid rgba(255,255,255,0.15)" sombra="0 20px 40px rgba(0,0,0,0.8)" fundo="#000" />}
      />

      {/* SEÇÃO MÓDULO DE VALIDADE & ETIQUETAS — /store/etiquetas, do FireHub. */}
      <Destaque
        inverter
        borda="1px solid rgba(234,88,12,0.15)"
        tema={{
          fundo: "linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)", brilho: "rgba(234,88,12,0.15)", brilhoPos: { top: -100, right: -100 },
          seloFundo: "rgba(234,88,12,0.15)", seloBorda: "rgba(234,88,12,0.4)", seloCor: "#C2410C",
          titulo: "#431407", texto: "#7C2D12",
          cardFundo: "#FFF", cardBorda: "rgba(234,88,12,0.15)", cardSombra: "0 4px 12px rgba(234,88,12,0.05)", cardTitulo: "#431407", cardTexto: "#7C2D12",
          nota: "#7C2D12",
        }}
        selo="🏷️ MÓDULO DE VALIDADE & ETIQUETAS INCLUSO"
        titulo={<>Chega de ficar pagando caro por módulo para ter sua <span style={{ color: "#EA580C" }}>impressora de etiquetas e validade</span></>}
        texto={<>Cliente <strong>FireHub</strong> tem essa funcionalidade por nossa conta, <strong>sem pagar nada a mais por isso!</strong> Cadastre insumos internos da sua cozinha, imprima etiquetas com QR Code, lote e data de manipulação e reduza o desperdício sem gastar com licenças abusivas de outros sistemas.</>}
        cards={[
          { t: "🏷️ Impressão em 1 Clique", d: "Etiquetas prontas para insumos fracionados, molhos, carnes e massas" },
          { t: "🛡️ Validade Sempre à Vista", d: "Data de preparo e de vencimento em cada pote da sua cozinha" },
          { t: "💰 100% Grátis e Incluso", d: "Sem cobrar mensalidade extra por módulo de etiquetas de validade" },
          { t: "♻️ Redução de Desperdício", d: "Validade impressa em cada pote: usa o que vence primeiro e joga menos fora" },
        ]}
        visual={<Moldura real src="/images/tela-etiqueta-de-validade.webp" alt="Tela do FireHub: etiqueta de validade com fabricação, validade e QR Code" borda="1.5px solid rgba(234,88,12,0.25)" sombra="0 25px 50px rgba(234,88,12,0.12)" fundo="#FFF" />}
      />

      {/* SEÇÃO ENGENHARIA DE CARDÁPIO E MÓDULO FISCAL — a economia depende do
          regime e do contador; nenhum percentual é prometido. */}
      <Destaque
        inverter
        borda="1px solid rgba(255,255,255,0.05)"
        tema={{
          fundo: "#090D16", brilho: "rgba(16,185,129,0.15)", brilhoPos: { top: -100, right: -100 },
          seloFundo: "rgba(16,185,129,0.15)", seloBorda: "rgba(16,185,129,0.4)", seloCor: "#34D399",
          titulo: "#FFF", texto: "#94A3B8",
          cardFundo: "rgba(255,255,255,0.04)", cardBorda: "rgba(16,185,129,0.2)", cardTitulo: "#FFF", cardTexto: "#94A3B8",
          nota: "#94A3B8",
        }}
        selo="🧾 ENGENHARIA DE CARDÁPIO & FISCAL INTELIGENTE"
        titulo={<>A mesma estratégia dos <span style={{ color: "#10B981" }}>gigantes do Fast Food</span> para pagar menos imposto</>}
        texto={<>Reduza seus impostos <strong>100% dentro da lei, sem sonegar nada</strong>. Nossa tecnologia exclusiva de engenharia fiscal de cardápio permite que você configure o valor exato de cada item dentro dos seus combos para sair detalhado na nota fiscal, maximizando a isenção de PIS e COFINS Monofásico.</>}
        cards={[
          { t: "🍔 Decomposição de Combos", d: "Defina o preço individual de bebidas e acompanhamentos isentos na nota fiscal" },
          { t: "⚖️ 100% Dentro da Lei", d: "A mesma separação de itens que as grandes redes usam na nota" },
          { t: "📉 Redução de PIS / COFINS", d: "Pague menos imposto sobre bebidas e itens monofásicos" },
          { t: "⚡ Emissão de NFC-e Automática", d: "Sai sozinha no aceite ou na saída do pedido (na entrega, quando o cliente informa o CPF)" },
        ]}
        visual={<Moldura real src="/images/tela-engenharia-de-combos.webp" alt="Tela do FireHub: engenharia fiscal do combo, com o valor de cada item na nota" borda="1px solid rgba(16,185,129,0.3)" sombra="0 25px 50px rgba(0,0,0,0.9), 0 0 30px rgba(16,185,129,0.15)" fundo="#FFF" />}
      />

      {/* SEÇÃO FINANCEIRO INTELIGENTE COM IA — a IA preenche, o lojista confere
          e salva (components/FinanceForm.tsx). */}
      <Destaque
        borda="1px solid rgba(236,72,153,0.15)"
        tema={{
          fundo: "linear-gradient(135deg, #FDF2F8 0%, #FCE7F3 100%)", brilho: "rgba(236,72,153,0.15)", brilhoPos: { bottom: -100, left: -100 },
          seloFundo: "rgba(236,72,153,0.15)", seloBorda: "rgba(236,72,153,0.4)", seloCor: "#DB2777",
          titulo: "#831843", texto: "#9F1239",
          cardFundo: "#FFF", cardBorda: "rgba(236,72,153,0.15)", cardSombra: "0 4px 12px rgba(236,72,153,0.05)", cardTitulo: "#831843", cardTexto: "#9F1239",
          nota: "#9F1239",
        }}
        selo="📸 CONTROLE FINANCEIRO & LEITURA COM IA"
        titulo={<>Tire foto de um boleto e a <span style={{ color: "#DB2777" }}>IA preenche tudo sozinha</span></>}
        texto="Diga adeus à digitação manual de notas fiscais e boletos de fornecedores. Com a nossa tecnologia de inteligência artificial baseada no Gemini, basta apontar a câmera do celular para a conta ou boleto: o sistema lê o fornecedor, valor, código de barras e data de vencimento e preenche o seu Contas a Pagar em segundos — você só confere e salva."
        cards={[
          { t: "📷 Leitura Instantânea", d: "Foto da conta extrai nome do recebedor, valor e vencimento em segundos" },
          { t: "📊 Contas a Pagar & Compras", d: "Organização automatizada do fluxo de caixa e notas fiscais de entrada" },
          { t: "⚡ Código de Barras Automático", d: "Copia a linha digitável direto pro app do seu banco sem erro de digitação" },
          { t: "🔔 Vencimentos em Destaque", d: "Veja na hora o que vence hoje e o que está atrasado" },
        ]}
        visual={<Moldura real src="/images/tela-contas-a-pagar.webp" alt="Tela do FireHub: contas a pagar com leitura do boleto por foto (IA)" borda="1.5px solid rgba(236,72,153,0.25)" sombra="0 25px 50px rgba(236,72,153,0.12)" fundo="#FFF" />}
      />

      {/* COMO FUNCIONA */}
      <section className="sec sec-alt" id="como-funciona">
        <div className="w">
          <div className="sec-title" data-revela>
            <h2>Comece a vender em <em>4 passos simples</em></h2>
            <p>Seu restaurante online em minutos, sem burocracia.</p>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={i} className="step" data-revela style={{ "--atraso": `${i * 120}ms` } as CSSProperties}>
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
          <div className="sec-title" data-revela>
            <h2>Juntos com você do <em>primeiro pedido até sua rede de lojas!</em></h2>
            <p>Nós existimos para mudar a realidade do seu delivery, e por isso você pode ter acesso a todas as funcionalidades por um preço que se adapta à realidade do seu negócio.</p>
          </div>
          <div className="pricing-card" data-revela="zoom" style={{maxWidth:560}}>
            <div className="pricing-header" style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)"}}>
              <h3>Plano Único</h3>
              <p>Todas as funcionalidades incluídas</p>
            </div>
            <div className="pricing-body">
              {/* Slider */}
              <div style={{marginBottom:28}}>
                <p style={{textAlign:"center",fontWeight:600,fontSize:".88rem",color:"#374151",marginBottom:12}}>Selecione seu faturamento mensal atual:</p>
                <p style={{textAlign:"center",fontSize:".78rem",color:"#9CA3AF",marginBottom:12}}>Considere tudo que passa pelo FireHub: cardápio digital, WhatsApp, mesa, balcão, iFood, 99Food e Jotajá.</p>
                <div style={{textAlign:"center",marginBottom:16}}>
                  <span style={{display:"inline-block",padding:"8px 24px",background:"#FEF2F2",border:"2px solid #EF4444",borderRadius:12,color:"#EF4444",fontWeight:800,fontSize:"1.3rem",fontVariantNumeric:"tabular-nums"}}>
                    R$ {sliderValue.toLocaleString("pt-BR")}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={25000}
                  step={500}
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  aria-label="Faturamento mensal"
                  style={{width:"100%",accentColor:"#EF4444",cursor:"pointer"}}
                />
                <div style={{display:"flex",justifyContent:"space-between",fontSize:".72rem",color:"#9CA3AF",marginTop:4}}>
                  <span>R$ 0</span><span>R$ 5k</span><span>R$ 10k</span><span>R$ 15k</span><span>R$ 20k</span><span>R$ 25k</span>
                </div>
              </div>

              {/* Preço calculado */}
              <div className="pricing-price">
                <span key={calculatedPrice} className="amount lp-pula" style={{color:"#EF4444",fontVariantNumeric:"tabular-nums"}}>R$ {calculatedPrice.toFixed(2).replace(".",",")}</span>
                <span className="period">/mês</span>
              </div>

              {/* Percentual info */}
              <div style={{display:"flex",justifyContent:"center",gap:24,marginBottom:20}}>
                <div style={{textAlign:"center"}}>
                  <p style={{fontSize:"1.5rem",fontWeight:900,color:"#EF4444"}}>2%</p>
                  <p style={{fontSize:".72rem",color:"#9CA3AF"}}>do faturamento</p>
                </div>
                <div style={{width:1,background:"#E5E7EB"}} />
                <div style={{textAlign:"center"}}>
                  <p style={{fontSize:"1.5rem",fontWeight:900,color:"#374151"}}>R$ 100</p>
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
                <p style={{fontWeight:700,fontSize:".9rem",marginBottom:4}}>{(() => {
                  if (sliderValue === 0) return "Zero faturamento e sem uso ativo?";
                  const fat = `R$ ${sliderValue.toLocaleString("pt-BR")}`;
                  const pct = sliderValue * 0.02;
                  const r = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
                  // Acima do teto só aparece o limite: nenhum valor maior que R$ 400 na tela.
                  if (pct > 400) return `Faturamento de ${fat} → ${r(400)} (limite máximo)`;
                  return `Faturamento de ${fat} × 2% = ${r(pct)}`;
                })()}</p>
                <p style={{fontSize:".82rem",color:"#6B7280",lineHeight:1.5}}>{sliderValue === 0 ? "Sem vendas E sem usar as funcionalidades ativamente, a taxa é R$ 0. Se houver uso ativo (ex: Chatbot), aplica-se a taxa mínima." : calculatedPrice <= 100 ? "Valor mínimo de R$ 100,00 para ter acesso a todas as funcionalidades." : calculatedPrice >= 400 ? "Valor máximo de R$ 400,00 por mês. Acima de R$ 20k de faturamento, você não paga mais." : "Simples e justo: quanto mais você cresce, nós crescemos junto."}</p>
              </div>

              {/* O que vem no plano: o que a página mostra lá em cima, em uma
                  lista curta. Tráfego pago fica fora porque é módulo à parte. */}
              <ul className="pricing-features">
                <li><span className="ck">✓</span> Cardápio digital, robô no WhatsApp e quadro de pedidos</li>
                <li><span className="ck">✓</span> iFood, 99Food, Jotajá, Brendi e Wabiz no mesmo painel</li>
                <li><span className="ck">✓</span> Cozinha, impressão com alerta de bebida e roteirizador</li>
                <li><span className="ck">✓</span> Caixa, financeiro, estoque e NFC-e (Simples Nacional e MEI)</li>
                <li><span className="ck">✓</span> Modo Contingência — a loja não para se a internet cair</li>
              </ul>

              <div className="pricing-cta">
                <a href={TRIAL} className="btn-primary btn-pulse" style={{width:"100%",justifyContent:"center",padding:16}}>🔥 Testar Grátis Agora</a>
              </div>
              <p className="pricing-note">Sem cartão de crédito · Cancele quando quiser · Sem multa</p>
              <p className="pricing-note" style={{marginTop:6}}>À parte: Tráfego Pago (R$ 50 por semana de campanha ativa) e Disparos pela API oficial (R$ 0,46 por mensagem entregue).</p>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARATIVO */}
      <section className="sec sec-alt" id="comparativo">
        <div className="w">
          <div className="sec-title" data-revela>
            <h2>Por que escolher o <em>FireHub</em>?</h2>
            <p>Compare e veja por que somos a melhor opção para o seu restaurante.</p>
          </div>
          <div className="compare-wrap" data-revela>
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
          <p style={{textAlign:"center",color:"#6B7280",fontSize:".8rem",marginTop:12}}>🏆 Funcionalidade exclusiva do FireHub</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec" id="faq">
        <div className="w">
          <div className="sec-title" data-revela><h2>Perguntas <em>Frequentes</em></h2><p>Tire suas dúvidas sobre o FireHub</p></div>
          <div className="faq-list">
            {FAQ.map((f, i) => (
              <div key={i} data-revela style={{ "--atraso": `${Math.min(i, 5) * 60}ms` } as CSSProperties} className={`faq-item ${openFaq===i?"open":""}`}>
                <button type="button" className="faq-q" aria-expanded={openFaq===i} onClick={() => setOpenFaq(openFaq===i?null:i)} style={{width:"100%",background:"none",border:0,textAlign:"left",fontFamily:"inherit",color:"inherit"}}>
                  {f.q}
                  <span className="faq-icon">+</span>
                </button>
                <div className="lp-faq-a"><div><div className="faq-a">{f.a}</div></div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="cta-final" style={{ position: "relative", overflow: "hidden" }}>
        <div className="lp-bolha" style={{ width: 420, height: 420, background: "rgba(255,255,255,.18)", top: -160, right: -120, zIndex: 0 }} />
        <div className="w" style={{ position: "relative" }}>
          <div className="cta-content" data-revela="zoom">
            <h2>Pronto para vender mais?</h2>
            <p>Comece agora com 15 dias grátis. Sem cartão, sem compromisso, sem multa para cancelar.</p>
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
              <a href="#trafego-pago">Tráfego Pago</a>
              <a href="#contingencia">Modo Contingência</a>
              <a href="#disparos">Disparos pela API Oficial</a>
              <a href="#como-funciona">Como funciona</a>
              <a href="#planos">Planos</a>
              <a href="#faq">FAQ</a>
              {/* Produto separado, vendido para quem não é cliente do FireHub:
                  fica no rodapé de propósito, para não competir com o funil
                  do sistema lá em cima. */}
              <a href="/prazos">🔥 FireHub Prazos (extensão)</a>
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

      {/* Barra fixa do celular: aparece depois do topo, com o mesmo botão. */}
      <div className={`lp-barra ${barra ? "on" : ""}`}>
        <small><b>15 dias grátis</b><br />Sem cartão · 2%, máx. R$ 400/mês</small>
        <a href={TRIAL} className="btn-primary">🔥 Testar Grátis</a>
      </div>
    </main>
  );
}
