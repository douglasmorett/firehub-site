"use client";

/**
 * A apresentação do Multimarcas para quem ainda não ativou.
 *
 * Douglas, 17/10/2026: "deixe claro que uma das vantagens desse módulo é que o
 * cliente pode entrar numa loja, botar coisa no carrinho, entrar na outra loja,
 * botar coisa no carrinho. Ele consegue pedir em todas as suas multimarcas em
 * um único painel e com o layout que ele já conhece." — por isso a sacola
 * única é o centro da página: o título, a sequência animada "Como o seu
 * cliente pede" e o antes × depois.
 *
 * Tudo o que aparece é da rede FICTÍCIA de lib/multimarcas/exemplo.ts.
 */

import { useEffect, useState } from "react";
import {
  ArrowRight, Bike, Check, ChevronRight, Clock, LayoutGrid, Megaphone, Plus, Rocket, Search, ShoppingBag,
  Smartphone, Sparkles, Star, Store, TrendingUp, X,
} from "lucide-react";
import VitrineDaRede from "@/components/rede/VitrineDaRede";
import { CONFIG_DO_EXEMPLO, PRODUTOS_DO_EXEMPLO } from "@/lib/multimarcas/exemplo";
import type { DadosDoMultimarcas } from "./MultimarcasClient";
import s from "./Oferta.module.css";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: v % 1 ? 2 : 0 });

const marca = (id: string) => CONFIG_DO_EXEMPLO.marcas.find((m) => m.id === id)!;
const produto = (id: string) => PRODUTOS_DO_EXEMPLO.find((p) => p.id === id)!;
const TAXA = CONFIG_DO_EXEMPLO.entrega.taxa;
/** "Smash da Vila" → "SV": as palavras curtas (da, do) não entram. */
const iniciais = (nome: string) => nome.split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0].toUpperCase()).join("");

// Os três momentos da sacola única, com produtos do exemplo.
const BURGUER = { marca: marca("smash"), produto: produto("s1") };
const FRANGO = { marca: marca("frango"), produto: produto("f1") };

export default function OfertaDoMultimarcas({ dados, salvando, onAtivar }: { dados: DadosDoMultimarcas; salvando: boolean; onAtivar: () => void }) {
  const m = dados.mensalidade;
  const isento = dados.estado.isento;
  const comTeste = !isento && !dados.estado.jaTestou;
  const botao = salvando ? "Ativando…" : comTeste ? `Ativar com ${dados.diasDeTeste} dias grátis` : "Ativar o Multimarcas";
  const precoCurto = isento ? "Liberado para a sua conta" : <><strong>{reais(dados.preco)}/mês</strong> · à parte da mensalidade</>;

  return (
    <div className={s.oferta}>
      <Topo botao={botao} precoCurto={precoCurto} salvando={salvando} onAtivar={onAtivar} />
      <ComoOClientePede />
      <AntesEDepois />
      <OLayoutQueEleConhece />
      <NaSuaCozinha />
      <ParaVoce />
      <ComoFunciona />
      <Preco dados={dados} comTeste={comTeste} botao={botao} salvando={salvando} onAtivar={onAtivar} />
      <Duvidas dados={dados} />
      <Fechamento botao={botao} precoCurto={precoCurto} salvando={salvando} onAtivar={onAtivar} />
    </div>
  );
}

// ─── 1. Topo ─────────────────────────────────────────────────────────────

function Topo({ botao, precoCurto, salvando, onAtivar }: { botao: string; precoCurto: React.ReactNode; salvando: boolean; onAtivar: () => void }) {
  return (
    <section className={s.hero}>
      <div className={s.heroTexto}>
        <span className={s.selo}><Sparkles size={14} /> Multimarcas · novo no FireHub</span>
        <h1>Todas as suas marcas.<br /><span>Uma sacola só.</span></h1>
        <p className={s.heroFrase}>
          Uma página com todas as marcas da sua cozinha, no jeito de app de delivery que o cliente já conhece.
          Ele entra numa loja, põe no carrinho, entra em outra, põe mais — e <strong>recebe tudo numa entrega só</strong>.
        </p>
        <div className={s.heroAcoes}>
          <button className={s.cta} onClick={onAtivar} disabled={salvando}>{botao} <ArrowRight size={18} /></button>
          <span className={s.precoCurto}>{precoCurto}</span>
        </div>
        <ul className={s.garantias}>
          <li><Check size={16} /><span>Sem comissão por pedido</span></li>
          <li><Check size={16} /><span>Quantas marcas quiser</span></li>
          <li><Check size={16} /><span>Desativa quando quiser</span></li>
        </ul>
      </div>
      <div className={s.palco}>
        <span className={`${s.etiqueta} ${s.etiqueta1}`}><ShoppingBag size={15} /> Sacola única entre as marcas</span>
        <span className={`${s.etiqueta} ${s.etiqueta2}`}><Megaphone size={15} /> Banners de oferta</span>
        <span className={`${s.etiqueta} ${s.etiqueta3}`}><Star size={15} /> Nota de cada marca</span>
        <div className={s.telefone}>
          <VitrineDaRede config={CONFIG_DO_EXEMPLO} produtos={PRODUTOS_DO_EXEMPLO} embutida />
        </div>
        <span className={s.dicaDoTelefone}><span className={s.pulso} /> Exemplo funcionando: toque, entre nas marcas e monte a sacola</span>
      </div>
    </section>
  );
}

// ─── 2. Como o seu cliente pede (sequência animada) ──────────────────────

const PASSOS_DO_CLIENTE = [
  { titulo: "Entra numa marca e põe no carrinho", texto: "Um smash no Smash da Vila." },
  { titulo: "Volta, entra em outra e põe mais", texto: "Um box no Box do Frango. A sacola continua com o burguer." },
  { titulo: "Fecha tudo junto", texto: "Uma sacola, um pagamento, uma taxa de entrega." },
];

function ComoOClientePede() {
  const [passo, setPasso] = useState(0);
  const [parado, setParado] = useState(false);
  useEffect(() => {
    if (parado) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setPasso((p) => (p + 1) % 3), 2600);
    return () => clearInterval(t);
  }, [parado]);

  return (
    <section className={s.secao}>
      <span className={s.sobretitulo}>O grande diferencial</span>
      <h2>O cliente não escolhe uma loja.<br />Ele pede de todas.</h2>
      <p className={s.sub}>No app de delivery comum, cada loja é um pedido, uma taxa e uma espera. No Multimarcas, a sacola é uma só para todas as suas marcas.</p>

      <div className={s.sequencia} onPointerEnter={() => setParado(true)} onPointerLeave={() => setParado(false)}>
        {PASSOS_DO_CLIENTE.map((p, i) => (
          <button key={p.titulo} className={`${s.cena} ${i === passo ? s.cenaAtiva : ""}`} onClick={() => setPasso(i)}>
            <span className={s.cenaNumero}>{i + 1}</span>
            <div className={s.miniTela}>
              {i === 0 && <MiniLoja item={BURGUER} sacola={1} animar={passo === 0} />}
              {i === 1 && <MiniLoja item={FRANGO} sacola={2} animar={passo === 1} />}
              {i === 2 && <MiniSacola animar={passo === 2} />}
            </div>
            <strong>{p.titulo}</strong>
            <span>{p.texto}</span>
          </button>
        ))}
      </div>
      <div className={s.resumoDaSequencia}>
        <span><b>1</b> página</span><ChevronRight size={16} />
        <span><b>1</b> sacola</span><ChevronRight size={16} />
        <span><b>1</b> entrega</span><ChevronRight size={16} />
        <span><b>1</b> pedido no seu painel</span>
      </div>
    </section>
  );
}

function MiniLoja({ item, sacola, animar }: { item: typeof BURGUER; sacola: number; animar: boolean }) {
  return (
    <div className={s.miniLoja}>
      <div className={s.miniCapa} style={{ background: item.marca.cor }}>
        {item.marca.capa && <img src={item.marca.capa} alt="" />}
        <span className={s.miniSacolaIcone}><ShoppingBag size={13} /><i key={animar ? "a" : "b"} className={animar ? s.contadorPulando : ""}>{sacola}</i></span>
      </div>
      <div className={s.miniNome}>
        <span className={s.miniLogo} style={{ background: item.marca.cor }}>{iniciais(item.marca.nome)}</span>
        <div><strong>{item.marca.nome}</strong><small><Star size={10} fill="currentColor" strokeWidth={0} /> {item.marca.nota.toFixed(1).replace(".", ",")} · {item.marca.tipo}</small></div>
      </div>
      <div className={`${s.miniProduto} ${animar ? s.miniProdutoAtivo : ""}`}>
        <div><strong>{item.produto.nome}</strong><small>{reais(item.produto.preco)}</small></div>
        {item.produto.foto && <img src={item.produto.foto} alt="" />}
        <span className={s.miniMais}><Plus size={12} /></span>
      </div>
      <div className={`${s.miniToast} ${animar ? s.miniToastVisivel : ""}`}><Check size={12} /> Adicionado à sacola</div>
    </div>
  );
}

function MiniSacola({ animar }: { animar: boolean }) {
  const sub = BURGUER.produto.preco + FRANGO.produto.preco;
  return (
    <div className={`${s.miniSacola} ${animar ? s.miniSacolaAtiva : ""}`}>
      <strong className={s.miniSacolaTitulo}>Sua sacola</strong>
      {[BURGUER, FRANGO].map((it) => (
        <div key={it.marca.id} className={s.miniGrupo}>
          <span className={s.miniLogo} style={{ background: it.marca.cor }}>{iniciais(it.marca.nome)}</span>
          <div><small>{it.marca.nome}</small><span>1x {it.produto.nome}</span></div>
        </div>
      ))}
      <div className={s.miniConta}><span>Entrega <em>(uma só)</em></span><span>{reais(TAXA)}</span></div>
      <div className={s.miniTotal}><span>Total</span><span>{reais(sub + TAXA)}</span></div>
      <span className={s.miniBotao}>Fazer pedido</span>
    </div>
  );
}

// ─── 3. Antes × depois ───────────────────────────────────────────────────

function AntesEDepois() {
  return (
    <section className={s.secao}>
      <div className={s.antesDepois}>
        <div className={s.antes}>
          <span className={s.rotuloAntes}>Hoje, com uma loja por pedido</span>
          <ul>
            <li><X size={16} /><span>O cliente escolhe <b>uma</b> marca e esquece as outras</span></li>
            <li><X size={16} /><span>Quer burguer e açaí? São <b>dois pedidos</b> e <b>duas taxas</b></span></li>
            <li><X size={16} /><span>Dois pagamentos, duas esperas, às vezes dois motoboys</span></li>
            <li><X size={16} /><span>Cada marca com o seu link: ninguém sabe que são suas</span></li>
          </ul>
        </div>
        <div className={s.seta}><ArrowRight size={26} /></div>
        <div className={s.depois}>
          <span className={s.rotuloDepois}>Com o Multimarcas</span>
          <ul>
            <li><Check size={16} /><span>Todas as marcas numa página, com a cara da sua rede</span></li>
            <li><Check size={16} /><span>Burguer de uma, açaí de outra: <b>uma sacola</b></span></li>
            <li><Check size={16} /><span><b>Uma taxa</b>, um pagamento, um motoboy</span></li>
            <li><Check size={16} /><span>Um link só para a bio, o WhatsApp e o anúncio</span></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

// ─── 4. O layout que ele já conhece ──────────────────────────────────────

const RECURSOS = [
  { icone: Megaphone, titulo: "Banners de oferta", texto: "Promoção do dia, combo novo, frete grátis. Você troca quando quiser e cada banner leva para a marca.", foto: "/multimarcas/smash-bacon.webp" },
  { icone: LayoutGrid, titulo: "Marcas uma embaixo da outra", texto: "Logo, nota, tipo de comida, prazo e taxa — como nos apps de delivery.", foto: "/multimarcas/pizza.webp" },
  { icone: Search, titulo: "Busca em todas as marcas", texto: "O cliente digita \"açaí\" ou \"frango\" e acha em qualquer uma das suas marcas.", foto: "/multimarcas/acai.webp" },
  { icone: Star, titulo: "Nota de cada marca", texto: "As avaliações dos pedidos aparecem no cartão de cada marca.", foto: "/multimarcas/frango-burguer.webp" },
  { icone: Store, titulo: "Bebida e sobremesa em todas", texto: "O que acompanha aparece dentro de qualquer marca e vai na mesma entrega.", foto: "/multimarcas/marmita.webp" },
  { icone: Smartphone, titulo: "Pronto para virar aplicativo", texto: "O Aplicativo da loja é montado em cima desta mesma página.", foto: "/multimarcas/frango-box.webp" },
];

function OLayoutQueEleConhece() {
  return (
    <section className={s.secao}>
      <span className={s.sobretitulo}>O layout que o cliente já conhece</span>
      <h2>Parece app de delivery.<br />Mas é só seu.</h2>
      <p className={s.sub}>Sem concorrente do lado, sem comissão por pedido. Só as suas marcas.</p>
      <div className={s.recursos}>
        {RECURSOS.map((r) => (
          <div key={r.titulo} className={s.recurso}>
            <div className={s.recursoFoto}><img src={r.foto} alt="" loading="lazy" /><span className={s.recursoIcone}><r.icone size={18} /></span></div>
            <strong>{r.titulo}</strong>
            <p>{r.texto}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── 5. Na sua cozinha ───────────────────────────────────────────────────

function NaSuaCozinha() {
  return (
    <section className={`${s.secao} ${s.cozinha}`}>
      <div className={s.cozinhaTexto}>
        <span className={s.sobretitulo}>Na sua cozinha</span>
        <h2>Um pedido no painel.<br />Separado por marca.</h2>
        <p className={s.sub}>O pedido de várias marcas cai no seu painel como qualquer outro: uma comanda, um motoboy, um acerto. A comanda vem com um bloco para cada marca, e a equipe já sabe qual embalagem usar.</p>
        <ul className={s.listaCozinha}>
          <li><Clock size={16} /> Tudo sai junto, no mesmo prazo</li>
          <li><Bike size={16} /> Um motoboy, uma corrida</li>
          <li><Store size={16} /> Caixa e relatórios como sempre</li>
        </ul>
      </div>
      <div className={s.comanda} aria-label="Exemplo de comanda">
        <div className={s.comandaTopo}><strong>COZINHA CENTRAL</strong><span>PEDIDO #128 · ENTREGA</span></div>
        <div className={s.comandaMarca}>== SMASH DA VILA ==</div>
        <div>1x Smash em dobro</div>
        <div className={s.comandaObs}>   obs: sem cebola</div>
        <div className={s.comandaMarca}>== BOX DO FRANGO ==</div>
        <div>1x Box de frango M</div>
        <div className={s.comandaMarca}>== ACOMPANHAMENTOS ==</div>
        <div>2x Refrigerante lata</div>
        <div className={s.comandaTotal}>TOTAL {reais(BURGUER.produto.preco + FRANGO.produto.preco + 2 * 6.5 + TAXA)}</div>
      </div>
    </section>
  );
}

// ─── 6. Para você ────────────────────────────────────────────────────────

function ParaVoce() {
  const itens = [
    { icone: TrendingUp, titulo: "Pedido maior", texto: "Quem ia pedir só o lanche leva o açaí da outra marca, no mesmo pedido e sem outra taxa." },
    { icone: Rocket, titulo: "Marca nova já nasce vendendo", texto: "Abriu uma pizzaria? Ela entra na página e aparece para todo cliente que já compra das suas outras marcas." },
    { icone: Megaphone, titulo: "Um link para divulgar", texto: "Um anúncio, um QR na embalagem, um link na bio — e o cliente vê tudo o que você vende." },
  ];
  return (
    <section className={s.secao}>
      <span className={s.sobretitulo}>Para você que vende</span>
      <h2>Mais marcas na tela, mais coisa na sacola.</h2>
      <div className={s.paraVoce}>
        {itens.map((i) => (
          <div key={i.titulo} className={s.paraVoceItem}>
            <span className={s.paraVoceIcone}><i.icone size={22} /></span>
            <strong>{i.titulo}</strong>
            <p>{i.texto}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── 7. Como funciona ────────────────────────────────────────────────────

function ComoFunciona() {
  const passos = [
    { titulo: "Ative", texto: "Aceite o termo e o Multimarcas fica liberado na hora." },
    { titulo: "Monte as marcas", texto: "Diga quais categorias do cardápio são de cada marca, suba logo, capa e banners." },
    { titulo: "Divulgue um link só", texto: "Bio, WhatsApp, anúncio. Os pedidos caem no painel como sempre." },
  ];
  return (
    <section className={s.secao}>
      <span className={s.sobretitulo}>Como funciona</span>
      <h2>Pronto em três passos.</h2>
      <ol className={s.passos}>
        {passos.map((p, i) => (
          <li key={p.titulo}><span className={s.numero}>{i + 1}</span><div><strong>{p.titulo}</strong><p>{p.texto}</p></div></li>
        ))}
      </ol>
    </section>
  );
}

// ─── 8. Preço ────────────────────────────────────────────────────────────

function Preco({ dados, comTeste, botao, salvando, onAtivar }: { dados: DadosDoMultimarcas; comTeste: boolean; botao: string; salvando: boolean; onAtivar: () => void }) {
  const m = dados.mensalidade;
  return (
    <section className={s.secao} id="preco">
      <span className={s.sobretitulo}>Quanto custa</span>
      <h2>Um valor fixo, separado da mensalidade.</h2>
      <p className={s.sub}>Uma coisa não mexe na outra.</p>
      <div className={s.precos}>
        <div className={s.caixaContinua}>
          <span className={s.rotulo}>O que você já paga — continua igual</span>
          <div className={s.linhaPreco}><span>Mensalidade de cada loja</span><strong>{m.percentual}% do faturamento</strong></div>
          <p className={s.miudo}>mínimo de {reais(m.minimo)} e teto de {reais(m.teto)} por loja</p>
          <div className={s.linhaPreco}><span>Cada loja extra no iFood ou na 99Food</span><strong>{reais(m.lojaExtraMarketplace)}</strong></div>
        </div>
        <div className={s.mais}>+</div>
        <div className={s.caixaNova}>
          <span className={s.rotulo}>Multimarcas</span>
          <div className={s.valorGrande}>{reais(dados.preco)}<small>/mês</small></div>
          <p>Fixo, com quantas marcas você quiser. Vem numa <strong>linha própria</strong> do mesmo boleto.</p>
          {comTeste && <p className={s.teste}>{dados.diasDeTeste} primeiros dias grátis na primeira ativação.</p>}
        </div>
      </div>
      <div className={s.exemplo}>
        <strong>Exemplo:</strong> sua loja paga {reais(m.teto)} de mensalidade. Com o Multimarcas, o boleto vem com {reais(m.teto)} (mensalidade) + {reais(dados.preco)} (Multimarcas) = <strong>{reais(m.teto + dados.preco)}</strong>.
      </div>
      <div className={s.ctaCentro}>
        <button className={s.cta} onClick={onAtivar} disabled={salvando}>{botao} <ArrowRight size={18} /></button>
      </div>
    </section>
  );
}

// ─── 9. Dúvidas ──────────────────────────────────────────────────────────

function Duvidas({ dados }: { dados: DadosDoMultimarcas }) {
  const m = dados.mensalidade;
  const perguntas: [string, string][] = [
    ["O cliente consegue pedir de mais de uma marca no mesmo pedido?", "Sim, esse é o centro do Multimarcas. Ele entra numa marca, põe no carrinho, entra em outra, põe mais, e fecha tudo num pedido só, com uma taxa de entrega."],
    [`Os ${reais(dados.preco)} substituem a minha mensalidade?`,
      `Não. A mensalidade de cada loja continua igual: ${m.percentual}% do faturamento, com mínimo de ${reais(m.minimo)} e teto de ${reais(m.teto)}. As lojas extras de iFood e 99Food continuam ${reais(m.lojaExtraMarketplace)} cada. O Multimarcas é um valor fixo, à parte, numa linha própria do mesmo boleto.`],
    ["Pago mais se tiver mais marcas?", `Não. São ${reais(dados.preco)} por mês para a página, com quantas marcas você quiser colocar nela.`],
    ["Preciso criar uma loja nova para cada marca?", "Não. Você diz quais categorias do seu cardápio são de cada marca. O pedido continua caindo no seu painel, na sua impressora e no seu caixa."],
    ["E o iFood e os outros apps?", "Não muda nada. O Multimarcas é a sua página própria, sem comissão por pedido."],
    ["Como cancelo?", "Aqui nesta tela, em \"Desativar\". A página sai do ar e o mês seguinte não é cobrado."],
  ];
  return (
    <section className={s.secao}>
      <span className={s.sobretitulo}>Dúvidas</span>
      <h2>Perguntas que todo mundo faz.</h2>
      <div className={s.faq}>
        {perguntas.map(([p, r]) => (
          <details key={p}>
            <summary>{p}</summary>
            <p>{r}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// ─── 10. Fechamento ──────────────────────────────────────────────────────

function Fechamento({ botao, precoCurto, salvando, onAtivar }: { botao: string; precoCurto: React.ReactNode; salvando: boolean; onAtivar: () => void }) {
  return (
    <section className={s.fechamento}>
      <h2>Suas marcas merecem uma vitrine só delas.</h2>
      <p>Uma página, uma sacola, uma entrega. Do jeito que o seu cliente já sabe pedir.</p>
      <button className={s.cta} onClick={onAtivar} disabled={salvando}>{botao} <ArrowRight size={18} /></button>
      <span className={s.precoCurto}>{precoCurto}</span>
    </section>
  );
}
