"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Bike, Check, ChevronRight, Clock, Minus, Plus, Search, ShoppingBag, Star, X } from "lucide-react";
import { MARCA_DOS_EXTRAS, reais, type ConfigDaVitrine, type MarcaDaVitrine, type ProdutoDaVitrine } from "@/lib/multimarcas/vitrine";
import s from "./Vitrine.module.css";

/**
 * A VITRINE DO MULTIMARCAS — banners, as marcas uma embaixo da outra (nota,
 * tipo, prazo), busca em todas e uma fileira de destaques. Dois usos:
 *
 * - `publica` (página /marcas/<slug>): tocar numa marca abre o cardápio de
 *   sempre da loja só com as categorias dela (/loja/<slug>?marca=<id>). A
 *   sacola é a da LOJA (localStorage `fh_cart_<slug>`, a mesma do cardápio):
 *   o cliente põe de uma marca, volta, põe de outra e fecha UM pedido com UMA
 *   entrega, pelo checkout de sempre.
 * - demonstração (página de venda e prévia do editor, `embutida`): tudo aqui
 *   dentro, com uma sacola de mentira e a tela "assim chega na cozinha".
 */

type ItemDaSacola = { produtoId: string; qtd: number; obs: string };
type Tela = { tipo: "inicio" } | { tipo: "marca"; id: string } | { tipo: "pronto"; numero: number; itens: ItemDaSacola[]; total: number };

type Catalogo = { produtos: ProdutoDaVitrine[]; porId: Map<string, ProdutoDaVitrine> };
const catalogoDe = (produtos: ProdutoDaVitrine[]): Catalogo => ({ produtos, porId: new Map(produtos.map((p) => [p.id, p])) });
const CatalogoCtx = createContext<Catalogo>(catalogoDe([]));
const useCatalogo = () => useContext(CatalogoCtx);

/** Página pública: para onde cada toque leva. */
type Publica = { slug: string };
const linkDaMarca = (pub: Publica, marca: string) => `/loja/${pub.slug}?marca=${encodeURIComponent(marca)}`;
const linkDaSacola = (pub: Publica) => `/loja/${pub.slug}?sacola=1`;
type Acao = { href?: string; onClick?: () => void };

/** "Smash da Vila" → "SV": palavras curtas (da, do) e símbolos não entram. */
export function iniciais(nome: string) {
  const palavras = nome.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter((p) => p.length > 2 || /\d/.test(p));
  const usadas = palavras.length ? palavras : nome.split(/\s+/);
  return ((usadas[0]?.[0] ?? "?") + (usadas[1]?.[0] ?? "")).toUpperCase();
}

function LogoDaMarca({ marca, tamanho = 56 }: { marca: Pick<MarcaDaVitrine, "logo" | "cor" | "nome">; tamanho?: number }) {
  if (marca.logo) return <img className={s.logo} src={marca.logo} alt="" style={{ width: tamanho, height: tamanho }} />;
  return (
    <div className={s.logoLetra} style={{ width: tamanho, height: tamanho, background: marca.cor, fontSize: tamanho * 0.36 }} aria-hidden>
      {iniciais(marca.nome)}
    </div>
  );
}

function Nota({ marca }: { marca: MarcaDaVitrine }) {
  if (marca.nota === null || marca.avaliacoes === 0) return <span className={s.nova}>Nova</span>;
  return (
    <span className={s.nota}>
      <Star size={13} fill="currentColor" strokeWidth={0} /> {marca.nota.toFixed(1).replace(".", ",")}
      <span className={s.notaQtd}>({marca.avaliacoes})</span>
    </span>
  );
}

function Prazo({ config }: { config: ConfigDaVitrine }) {
  const { min, max, taxa } = config.entrega;
  const partes: ReactNode[] = [];
  if (min && max) partes.push(<><Clock size={13} /> {min}–{max} min</>);
  if (taxa !== null) partes.push(taxa > 0 ? reais(taxa) : "Entrega grátis");
  if (!partes.length) return <span className={s.prazo}>Aberta agora</span>;
  return <>{partes.map((p, i) => <span key={i} className={s.prazo}>{i > 0 && <span className={s.ponto2}>•</span>}{p}</span>)}</>;
}

/** Botão ou link: na página pública cada toque é um link de verdade. */
function Toque({ href, onClick, className, children, style, disabled }: Acao & {
  className?: string; children: ReactNode; style?: CSSProperties; disabled?: boolean;
}) {
  if (href) return <a href={href} className={className} style={style}>{children}</a>;
  return <button className={className} onClick={onClick} style={style} disabled={disabled}>{children}</button>;
}

/** A sacola da LOJA, lida do mesmo lugar que o cardápio grava (CustomerStorePage, `fh_cart_<slug>`, 6 h). */
function useSacolaDaLoja(pub: Publica | undefined) {
  const [qtd, setQtd] = useState(0);
  useEffect(() => {
    if (!pub) return;
    const ler = () => {
      try {
        const bruto = JSON.parse(localStorage.getItem(`fh_cart_${pub.slug}`) || "null");
        const itens = Array.isArray(bruto?.items) ? bruto.items : [];
        const velho = bruto?.at && Date.now() - Number(bruto.at) > 6 * 60 * 60 * 1000;
        setQtd(velho ? 0 : itens.reduce((t: number, i: any) => t + (Number(i?.quantity) || 1), 0));
      } catch { setQtd(0); }
    };
    ler();
    window.addEventListener("storage", ler);
    window.addEventListener("pageshow", ler);
    return () => { window.removeEventListener("storage", ler); window.removeEventListener("pageshow", ler); };
  }, [pub]);
  return qtd;
}

export default function Vitrine({ config, produtos, embutida = false, publica }: {
  config: ConfigDaVitrine; produtos: ProdutoDaVitrine[]; embutida?: boolean; publica?: Publica;
}) {
  const catalogo = useMemo(() => catalogoDe(produtos), [produtos]);
  const PRODUTO = catalogo.porId;
  const [tela, setTela] = useState<Tela>({ tipo: "inicio" });
  const [tipo, setTipo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [sacola, setSacola] = useState<ItemDaSacola[]>([]);
  const [sacolaAberta, setSacolaAberta] = useState(false);
  const [aberto, setAberto] = useState<ProdutoDaVitrine | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const qtdDaLoja = useSacolaDaLoja(publica);

  const marcas = config.marcas.filter((m) => !m.oculta);
  const marcaPorId = useMemo(() => new Map(config.marcas.map((m) => [m.id, m])), [config.marcas]);
  const tipos = useMemo(() => [...new Set(marcas.map((m) => m.tipo).filter(Boolean))], [marcas]);
  const estiloDaCor = { "--cor": config.cor } as CSSProperties;
  // Na página pública, o que é "para acompanhar" abre na primeira marca (aparece em todas).
  const marcaDoProduto = (p: ProdutoDaVitrine) => (p.marca === MARCA_DOS_EXTRAS ? marcas[0]?.id ?? null : p.marca);

  function irPara(t: Tela) {
    setTela(t);
    setBusca("");
    if (embutida) raiz.current?.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
  }

  function adicionar(p: ProdutoDaVitrine, qtd = 1, obs = "") {
    setSacola((atual) => {
      const i = atual.findIndex((x) => x.produtoId === p.id && x.obs === obs);
      if (i < 0) return [...atual, { produtoId: p.id, qtd, obs }];
      const nova = [...atual];
      nova[i] = { ...nova[i], qtd: nova[i].qtd + qtd };
      return nova;
    });
  }
  function mudarQtd(idx: number, delta: number) {
    setSacola((atual) => atual.flatMap((x, i) => (i !== idx ? [x] : x.qtd + delta <= 0 ? [] : [{ ...x, qtd: x.qtd + delta }])));
  }

  const subtotal = sacola.reduce((t, i) => t + (PRODUTO.get(i.produtoId)?.preco ?? 0) * i.qtd, 0);
  const qtdItens = publica ? qtdDaLoja : sacola.reduce((t, i) => t + i.qtd, 0);
  const lojasNaSacola = [...new Set(sacola.map((i) => PRODUTO.get(i.produtoId)?.marca))].filter((m) => m && m !== MARCA_DOS_EXTRAS).length;
  const taxa = config.entrega.taxa ?? 0;

  const termo = busca.trim().toLowerCase();
  const achados = termo.length >= 2
    ? produtos.filter((p) => (p.marca === MARCA_DOS_EXTRAS || (marcaPorId.get(p.marca) && !marcaPorId.get(p.marca)!.oculta))
        && (p.nome.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo) || p.categoria.toLowerCase().includes(termo)))
    : [];

  const marcaAtual = tela.tipo === "marca" ? marcaPorId.get(tela.id) ?? null : null;
  const abrirMarca = (id: string | null): Acao => (publica ? (id ? { href: linkDaMarca(publica, id) } : {}) : { onClick: () => { if (id) irPara({ tipo: "marca", id }); } });
  const abrirProduto = (p: ProdutoDaVitrine): Acao => (publica ? abrirMarca(marcaDoProduto(p)) : { onClick: () => setAberto(p) });
  const abrirSacola: Acao = publica ? { href: linkDaSacola(publica) } : { onClick: () => setSacolaAberta(true) };

  return (
    <CatalogoCtx.Provider value={catalogo}>
    <div ref={raiz} className={`${s.pagina} ${embutida ? s.embutida : ""}`} style={estiloDaCor}>
      <header className={s.barra}>
        <div className={s.barraDentro}>
          {tela.tipo === "inicio" ? (
            <div className={s.marcaDaRede}>
              {config.logo ? <img className={s.seloImg} src={config.logo} alt="" /> : <span className={s.selo}>{iniciais(config.nome)}</span>}
              <span>
                <strong>{config.nome}</strong>
                {config.local ? <small><Bike size={12} /> Entrega em {config.local}</small> : config.frase ? <small>{config.frase}</small> : null}
              </span>
            </div>
          ) : (
            <button className={s.voltar} onClick={() => irPara({ tipo: "inicio" })}>
              <ArrowLeft size={18} /> Todas as marcas
            </button>
          )}
          <Toque className={s.botaoSacola} {...abrirSacola}>
            <ShoppingBag size={20} />
            {qtdItens > 0 && <span className={s.contador}>{qtdItens}</span>}
          </Toque>
        </div>
      </header>

      {tela.tipo === "inicio" && (
        <main className={s.conteudo}>
          <label className={s.busca}>
            <Search size={18} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar em todas as marcas" />
            {busca && <button onClick={() => setBusca("")} aria-label="Limpar"><X size={16} /></button>}
          </label>

          {termo.length >= 2 ? (
            <section className={s.secao}>
              <h2 className={s.tituloSecao}>{achados.length ? `${achados.length} resultado${achados.length > 1 ? "s" : ""}` : "Nada encontrado"}</h2>
              <div className={s.listaProdutos}>
                {achados.map((p) => (
                  <LinhaDoProduto key={p.id} p={p} marca={marcaPorId.get(p.marca) ?? null} mostrarMarca
                    fechada={!!marcaPorId.get(p.marca) && !marcaPorId.get(p.marca)!.aberta}
                    toque={abrirProduto(p)} onAdicionar={publica ? undefined : () => adicionar(p)} />
                ))}
              </div>
            </section>
          ) : (
            <>
              <Banners config={config} marcaPorId={marcaPorId} abrir={abrirMarca} />

              {marcas.length > 1 && (
                <div className={s.faixaUmaEntrega}>
                  <ShoppingBag size={20} />
                  <span><strong>Monte uma sacola só com várias marcas.</strong> Põe de uma, entra em outra, põe mais — e recebe tudo numa entrega.</span>
                </div>
              )}

              {tipos.length > 1 && (
                <nav className={s.filtros} aria-label="Tipo de comida">
                  <button className={tipo === null ? s.filtroAtivo : s.filtro} onClick={() => setTipo(null)}>Todas</button>
                  {tipos.map((t) => (
                    <button key={t} className={tipo === t ? s.filtroAtivo : s.filtro} onClick={() => setTipo(tipo === t ? null : t)}>{t}</button>
                  ))}
                </nav>
              )}

              <section className={s.secao}>
                <h2 className={s.tituloSecao}>Nossas marcas</h2>
                {marcas.length === 0 && <p className={s.vazio}>As marcas aparecem aqui assim que forem cadastradas.</p>}
                <div className={s.gradeDeLojas}>
                  {marcas.filter((m) => !tipo || m.tipo === tipo).map((m) => (
                    <CartaoDaMarca key={m.id} marca={m} config={config} toque={abrirMarca(m.id)} />
                  ))}
                </div>
              </section>

              <Destaques marcaPorId={marcaPorId} toque={abrirProduto} />
            </>
          )}
        </main>
      )}

      {tela.tipo === "marca" && marcaAtual && (
        <PaginaDaMarca marca={marcaAtual} config={config} onAbrir={setAberto} onAdicionar={(p) => adicionar(p)} />
      )}

      {tela.tipo === "pronto" && (
        <PedidoEnviado tela={tela} config={config} marcaPorId={marcaPorId} onVoltar={() => irPara({ tipo: "inicio" })} />
      )}

      {qtdItens > 0 && !sacolaAberta && tela.tipo !== "pronto" && (
        <Toque className={s.barraDaSacola} {...abrirSacola}>
          <span className={s.barraQtd}>{qtdItens}</span>
          <span className={s.barraTexto}>
            Ver sacola
            <small>{publica ? "uma entrega para tudo" : lojasNaSacola > 1 ? `${lojasNaSacola} marcas · uma entrega só` : "uma entrega só"}</small>
          </span>
          {publica ? <ChevronRight size={20} /> : <strong>{reais(subtotal)}</strong>}
        </Toque>
      )}

      {aberto && (
        <FolhaDoProduto p={aberto} marca={marcaPorId.get(aberto.marca) ?? null}
          fechada={!!marcaPorId.get(aberto.marca) && !marcaPorId.get(aberto.marca)!.aberta}
          onFechar={() => setAberto(null)}
          onAdicionar={(qtd, obs) => { adicionar(aberto, qtd, obs); setAberto(null); }} />
      )}

      {sacolaAberta && (
        <Sacola config={config} sacola={sacola} marcaPorId={marcaPorId} subtotal={subtotal}
          onFechar={() => setSacolaAberta(false)} onQtd={mudarQtd}
          onFinalizar={() => {
            const itens = sacola;
            setSacola([]);
            setSacolaAberta(false);
            irPara({ tipo: "pronto", numero: 100 + Math.floor(Math.random() * 900), itens, total: subtotal + taxa });
          }} />
      )}
    </div>
    </CatalogoCtx.Provider>
  );
}

// ─── Início ──────────────────────────────────────────────────────────────

function Banners({ config, marcaPorId, abrir }: { config: ConfigDaVitrine; marcaPorId: Map<string, MarcaDaVitrine>; abrir: (id: string | null) => Acao }) {
  const ativos = config.banners.filter((b) => b.ativo && (b.titulo || b.imagem));
  const [atual, setAtual] = useState(0);
  if (!ativos.length) return null;
  return (
    <section className={s.banners} aria-label="Ofertas">
      <div className={s.trilho}
        onScroll={(e) => { const el = e.currentTarget; setAtual(Math.round(el.scrollLeft / (el.firstElementChild as HTMLElement).offsetWidth)); }}>
        {ativos.map((b) => {
          const marca = b.marca ? marcaPorId.get(b.marca) : null;
          const toque = marca && !marca.oculta ? abrir(marca.id) : {};
          return (
            <Toque key={b.id} className={s.banner} {...toque} disabled={!toque.href && !toque.onClick}
              style={{ background: marca?.cor ?? config.cor }}>
              {b.imagem && <img src={b.imagem} alt="" className={s.bannerFoto} />}
              {(b.titulo || b.texto) && <span className={s.bannerVeu} />}
              <span className={s.bannerTexto}>
                {marca && b.titulo && <span className={s.bannerMarca}>{marca.nome}</span>}
                {b.titulo && <strong>{b.titulo}</strong>}
                {b.texto && <span>{b.texto}</span>}
                {marca && b.titulo && <span className={s.bannerAcao}>Pedir agora <ChevronRight size={14} /></span>}
              </span>
            </Toque>
          );
        })}
      </div>
      {ativos.length > 1 && (
        <div className={s.pontos}>
          {ativos.map((b, i) => <span key={b.id} className={i === atual ? s.pontoAtivo : s.ponto} />)}
        </div>
      )}
    </section>
  );
}

function CartaoDaMarca({ marca, config, toque }: { marca: MarcaDaVitrine; config: ConfigDaVitrine; toque: Acao }) {
  return (
    <Toque className={`${s.cartao} ${marca.aberta ? "" : s.cartaoFechado}`} {...toque}>
      <LogoDaMarca marca={marca} />
      <span className={s.cartaoInfo}>
        <strong className={s.cartaoNome}>{marca.nome}</strong>
        <span className={s.cartaoLinha}>
          <Nota marca={marca} />{marca.tipo && <><span className={s.ponto2}>•</span> {marca.tipo}</>}
        </span>
        <span className={s.cartaoLinha}>
          {marca.aberta ? <Prazo config={config} /> : <span className={s.fechada}>{config.avisoFechada || "Fechada agora"}</span>}
        </span>
      </span>
      <ChevronRight size={18} className={s.cartaoSeta} />
    </Toque>
  );
}

function Destaques({ marcaPorId, toque }: { marcaPorId: Map<string, MarcaDaVitrine>; toque: (p: ProdutoDaVitrine) => Acao }) {
  const { produtos } = useCatalogo();
  // Um produto com foto por marca visível: a fileira mostra a variedade da rede.
  const vistas = new Set<string>();
  const lista = produtos.filter((p) => {
    const m = marcaPorId.get(p.marca);
    if (!p.foto || !m || m.oculta || vistas.has(p.marca)) return false;
    vistas.add(p.marca);
    return true;
  });
  if (lista.length < 2) return null;
  return (
    <section className={s.secao}>
      <h2 className={s.tituloSecao}>Para abrir o apetite</h2>
      <div className={s.carrossel}>
        {lista.map((p) => (
          <Toque key={p.id} className={s.miniProduto} {...toque(p)}>
            <img src={p.foto!} alt="" loading="lazy" />
            <span className={s.miniMarca}>{marcaPorId.get(p.marca)?.nome}</span>
            <strong>{p.nome}</strong>
            <span className={s.miniPreco}>{reais(p.preco)}</span>
          </Toque>
        ))}
      </div>
    </section>
  );
}

// ─── Dentro da marca (só na demonstração; na página pública é o cardápio da loja) ──

function PaginaDaMarca({ marca, config, onAbrir, onAdicionar }: {
  marca: MarcaDaVitrine; config: ConfigDaVitrine; onAbrir: (p: ProdutoDaVitrine) => void; onAdicionar: (p: ProdutoDaVitrine) => void;
}) {
  const { produtos: todos } = useCatalogo();
  const produtos = todos.filter((p) => p.marca === marca.id);
  const extras = todos.filter((p) => p.marca === MARCA_DOS_EXTRAS);
  const categorias = [...new Set(produtos.map((p) => p.categoria))].sort((a, b) => Number(b === "Destaques") - Number(a === "Destaques"));
  const categoriasExtras = [...new Set(extras.map((p) => p.categoria))];
  const [catAtiva, setCatAtiva] = useState(categorias[0]);

  function rolarPara(cat: string) {
    setCatAtiva(cat);
    document.getElementById(`cat-${marca.id}-${cat}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className={s.conteudoMarca}>
      <div className={s.capa} style={{ background: marca.cor }}>
        {marca.capa && <img src={marca.capa} alt="" />}
        <span className={s.capaVeu} />
      </div>
      <div className={s.cabecalhoMarca}>
        <LogoDaMarca marca={marca} tamanho={72} />
        <div>
          <h1>{marca.nome}</h1>
          <p className={s.cartaoLinha}>
            <Nota marca={marca} />{marca.tipo && <><span className={s.ponto2}>•</span> {marca.tipo}</>}
            {config.entrega.minimo > 0 && <><span className={s.ponto2}>•</span> Pedido mínimo {reais(config.entrega.minimo)}</>}
          </p>
          <p className={s.cartaoLinha}>
            {marca.aberta ? <Prazo config={config} /> : <span className={s.fechada}>Fechada agora. Dá para olhar o cardápio.</span>}
          </p>
        </div>
      </div>

      {categorias.length + categoriasExtras.length > 0 && (
        <nav className={s.abasDoCardapio}>
          {[...categorias, ...categoriasExtras].map((c) => (
            <button key={c} className={c === catAtiva ? s.abaAtiva : s.aba} onClick={() => rolarPara(c)}>{c}</button>
          ))}
        </nav>
      )}

      {categorias.map((c) => (
        <section key={c} id={`cat-${marca.id}-${c}`} className={s.secaoCardapio}>
          <h2 className={s.tituloSecao}>{c}</h2>
          <div className={s.listaProdutos}>
            {produtos.filter((p) => p.categoria === c).map((p) => (
              <LinhaDoProduto key={p.id} p={p} marca={marca} fechada={!marca.aberta} toque={{ onClick: () => onAbrir(p) }} onAdicionar={() => onAdicionar(p)} />
            ))}
          </div>
        </section>
      ))}

      {extras.length > 0 && (
        <div className={s.avisoExtras}>
          <strong>Para acompanhar</strong> — vai na mesma entrega, de qualquer marca.
        </div>
      )}
      {categoriasExtras.map((c) => (
        <section key={c} id={`cat-${marca.id}-${c}`} className={s.secaoCardapio}>
          <h2 className={s.tituloSecao}>{c}</h2>
          <div className={s.listaProdutos}>
            {extras.filter((p) => p.categoria === c).map((p) => (
              <LinhaDoProduto key={p.id} p={p} marca={null} fechada={false} toque={{ onClick: () => onAbrir(p) }} onAdicionar={() => onAdicionar(p)} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function LinhaDoProduto({ p, marca, mostrarMarca, fechada, toque, onAdicionar }: {
  p: ProdutoDaVitrine; marca: MarcaDaVitrine | null; mostrarMarca?: boolean; fechada: boolean; toque: Acao; onAdicionar?: () => void;
}) {
  return (
    <div className={s.produto}>
      <Toque className={s.produtoTexto} {...toque}>
        {mostrarMarca && <span className={s.miniMarca}>{marca?.nome ?? "Para acompanhar"}</span>}
        <strong>{p.nome}</strong>
        {p.descricao && <span className={s.descricao}>{p.descricao}</span>}
        <span className={s.preco}>{reais(p.preco)}</span>
      </Toque>
      <div className={s.produtoFoto}>
        {p.foto ? <img src={p.foto} alt="" loading="lazy" /> : <span className={s.semFoto} style={{ background: marca?.cor ?? "#868E96" }}>{iniciais(p.nome)}</span>}
        {!fechada && onAdicionar && (
          <button className={s.mais} onClick={onAdicionar} aria-label={`Adicionar ${p.nome}`}><Plus size={18} /></button>
        )}
      </div>
    </div>
  );
}

function FolhaDoProduto({ p, marca, fechada, onFechar, onAdicionar }: {
  p: ProdutoDaVitrine; marca: MarcaDaVitrine | null; fechada: boolean; onFechar: () => void; onAdicionar: (qtd: number, obs: string) => void;
}) {
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState("");
  return (
    <div className={s.fundo} onClick={onFechar}>
      <div className={s.folha} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.nome}>
        <button className={s.fecharFolha} onClick={onFechar} aria-label="Fechar"><X size={20} /></button>
        {p.foto && <img src={p.foto} alt="" className={s.folhaFoto} />}
        <div className={s.folhaCorpo}>
          <span className={s.miniMarca}>{marca?.nome ?? "Para acompanhar · vai em qualquer pedido"}</span>
          <h3>{p.nome}</h3>
          {p.descricao && <p className={s.descricao}>{p.descricao}</p>}
          <p className={s.preco}>{reais(p.preco)}</p>
          <label className={s.obs}>
            Alguma observação?
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: sem cebola, molho à parte" rows={2} maxLength={140} />
          </label>
        </div>
        <div className={s.folhaRodape}>
          <div className={s.quantidade}>
            <button onClick={() => setQtd(Math.max(1, qtd - 1))} aria-label="Menos"><Minus size={16} /></button>
            <span>{qtd}</span>
            <button onClick={() => setQtd(qtd + 1)} aria-label="Mais"><Plus size={16} /></button>
          </div>
          <button className={s.botaoPrincipal} disabled={fechada} onClick={() => onAdicionar(qtd, obs.trim())}>
            {fechada ? "Fechada agora" : <>Adicionar <span>{reais(p.preco * qtd)}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sacola da demonstração ──────────────────────────────────────────────

function agruparPorMarca(itens: ItemDaSacola[], PRODUTO: Map<string, ProdutoDaVitrine>) {
  const grupos = new Map<string, { item: ItemDaSacola; idx: number }[]>();
  itens.forEach((item, idx) => {
    const m = PRODUTO.get(item.produtoId)?.marca ?? MARCA_DOS_EXTRAS;
    if (!grupos.has(m)) grupos.set(m, []);
    grupos.get(m)!.push({ item, idx });
  });
  return [...grupos.entries()].sort(([a], [b]) => Number(a === MARCA_DOS_EXTRAS) - Number(b === MARCA_DOS_EXTRAS));
}

function Sacola({ config, sacola, marcaPorId, subtotal, onFechar, onQtd, onFinalizar }: {
  config: ConfigDaVitrine; sacola: ItemDaSacola[]; marcaPorId: Map<string, MarcaDaVitrine>; subtotal: number;
  onFechar: () => void; onQtd: (idx: number, delta: number) => void; onFinalizar: () => void;
}) {
  const PRODUTO = useCatalogo().porId;
  const taxa = config.entrega.taxa ?? 0;
  const falta = config.entrega.minimo - subtotal;
  return (
    <div className={s.fundo} onClick={onFechar}>
      <div className={`${s.folha} ${s.folhaSacola}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sacola">
        <div className={s.sacolaTopo}>
          <h3>Sua sacola</h3>
          <button onClick={onFechar} aria-label="Fechar"><X size={20} /></button>
        </div>
        {sacola.length === 0 ? (
          <p className={s.vazio}>Sacola vazia. Entre numa marca e escolha à vontade — pode misturar marcas.</p>
        ) : (
          <div className={s.folhaCorpo}>
            {agruparPorMarca(sacola, PRODUTO).map(([mId, itens]) => {
              const marca = marcaPorId.get(mId);
              return (
                <div key={mId} className={s.grupo}>
                  <div className={s.grupoTopo}>
                    {marca ? <LogoDaMarca marca={marca} tamanho={28} /> : <span className={s.logoExtras}>+</span>}
                    <strong>{marca?.nome ?? "Para acompanhar"}</strong>
                  </div>
                  {itens.map(({ item, idx }) => {
                    const p = PRODUTO.get(item.produtoId);
                    if (!p) return null;
                    return (
                      <div key={idx} className={s.itemDaSacola}>
                        <div>
                          <span>{p.nome}</span>
                          {item.obs && <small>Obs.: {item.obs}</small>}
                          <small>{reais(p.preco * item.qtd)}</small>
                        </div>
                        <div className={s.quantidade}>
                          <button onClick={() => onQtd(idx, -1)} aria-label="Menos"><Minus size={14} /></button>
                          <span>{item.qtd}</span>
                          <button onClick={() => onQtd(idx, 1)} aria-label="Mais"><Plus size={14} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className={s.contas}>
              <div><span>Subtotal</span><span>{reais(subtotal)}</span></div>
              <div><span>Entrega <em>(uma só, todas as marcas juntas)</em></span><span>{reais(taxa)}</span></div>
              <div className={s.total}><span>Total</span><span>{reais(subtotal + taxa)}</span></div>
            </div>
          </div>
        )}
        {sacola.length > 0 && (
          <div className={s.folhaRodape}>
            <button className={s.botaoPrincipal} disabled={falta > 0} onClick={onFinalizar}>
              {falta > 0 ? `Faltam ${reais(falta)} para o pedido mínimo` : <>Fazer pedido <span>{reais(subtotal + taxa)}</span></>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PedidoEnviado({ tela, config, marcaPorId, onVoltar }: {
  tela: Extract<Tela, { tipo: "pronto" }>; config: ConfigDaVitrine; marcaPorId: Map<string, MarcaDaVitrine>; onVoltar: () => void;
}) {
  const PRODUTO = useCatalogo().porId;
  return (
    <main className={s.conteudo}>
      <div className={s.pronto}>
        <span className={s.prontoIcone}><Check size={28} /></span>
        <h1>Pedido #{tela.numero} enviado</h1>
        <p>Chega tudo junto, numa entrega só{config.entrega.min && config.entrega.max ? `, em ${config.entrega.min}–${config.entrega.max} min` : ""}.</p>
      </div>
      <h2 className={s.tituloSecao}>Assim ele chega na cozinha</h2>
      <p className={s.explica}>Um pedido só no painel, um motoboy, e cada item com o nome da marca na comanda — a equipe sabe qual embalagem usar.</p>
      <div className={s.comanda}>
        <div className={s.comandaTopo}>
          <strong>{config.nome.toUpperCase()}</strong>
          <span>PEDIDO #{tela.numero} · ENTREGA</span>
        </div>
        {agruparPorMarca(tela.itens, PRODUTO).map(([mId, itens]) => (
          <div key={mId} className={s.comandaGrupo}>
            {itens.map(({ item, idx }) => (
              <div key={idx}>
                {item.qtd}x {marcaPorId.get(mId) ? `[${marcaPorId.get(mId)!.nome.toUpperCase()}] ` : ""}{PRODUTO.get(item.produtoId)?.nome}
                {item.obs && <div className={s.comandaObs}>  obs: {item.obs}</div>}
              </div>
            ))}
          </div>
        ))}
        <div className={s.comandaTotal}>TOTAL {reais(tela.total)}</div>
      </div>
      <button className={s.botaoPrincipal} onClick={onVoltar}>Voltar para as marcas</button>
    </main>
  );
}
