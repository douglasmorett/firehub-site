"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Bike, Check, ChevronRight, Clock, Minus, Plus, Search, ShoppingBag, Star, X } from "lucide-react";
import { PRODUTOS_DA_REDE, type ProdutoDaRede } from "@/lib/rede/previa-dados";
import {
  CHAVE_DA_CONFIG, CHAVE_DA_SACOLA, CONFIG_PADRAO, MARCA_DOS_EXTRAS, lerConfig, reais,
  type ConfigDaRede, type MarcaDaRede,
} from "@/lib/rede/config";
import s from "./VitrineDaRede.module.css";

/**
 * PRÉVIA — a página da rede de marcas (Lucas / Frangoso, 17/10/2026).
 * Início com banners e as lojas da rede uma embaixo da outra; dentro da loja,
 * o cardápio dela; a sacola é UMA para todas as lojas e o pedido sai com UMA
 * entrega. Sem banco: cardápio de previa-dados.ts, config do painel no
 * localStorage. `embutida` = dentro do painel, com a config vinda por prop.
 */

type ItemDaSacola = { produtoId: string; qtd: number; obs: string };
type Tela = { tipo: "inicio" } | { tipo: "marca"; id: string } | { tipo: "pronto"; numero: number; itens: ItemDaSacola[]; total: number };

/** O cardápio que a vitrine mostra: o da prévia do Lucas ou o exemplo da página de venda. */
type Catalogo = { produtos: ProdutoDaRede[]; porId: Map<string, ProdutoDaRede> };
const catalogoDe = (produtos: ProdutoDaRede[]): Catalogo => ({ produtos, porId: new Map(produtos.map((p) => [p.id, p])) });
const CatalogoCtx = createContext<Catalogo>(catalogoDe(PRODUTOS_DA_REDE));
const useCatalogo = () => useContext(CatalogoCtx);

function iniciais(nome: string) {
  const palavras = nome.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter((p) => p.length > 1 || /\d/.test(p));
  return (palavras[0]?.[0] ?? "?").toUpperCase() + (palavras[1]?.[0] ?? "").toUpperCase();
}

function LogoDaMarca({ marca, tamanho = 56 }: { marca: MarcaDaRede; tamanho?: number }) {
  if (marca.logo) return <img className={s.logo} src={marca.logo} alt="" style={{ width: tamanho, height: tamanho }} />;
  return (
    <div className={s.logoLetra} style={{ width: tamanho, height: tamanho, background: marca.cor, fontSize: tamanho * 0.36 }} aria-hidden>
      {iniciais(marca.nome)}
    </div>
  );
}

function Nota({ marca }: { marca: MarcaDaRede }) {
  return (
    <span className={s.nota}>
      <Star size={13} fill="currentColor" strokeWidth={0} /> {marca.nota.toFixed(1).replace(".", ",")}
      <span className={s.notaQtd}>({marca.avaliacoes})</span>
    </span>
  );
}

export default function VitrineDaRede({ config: configDaProp, produtos = PRODUTOS_DA_REDE, embutida = false, chaveDaSacola = CHAVE_DA_SACOLA }: {
  config?: ConfigDaRede; produtos?: ProdutoDaRede[]; embutida?: boolean; chaveDaSacola?: string;
}) {
  const catalogo = useMemo(() => catalogoDe(produtos), [produtos]);
  const PRODUTO = catalogo.porId;
  const [configSalva, setConfigSalva] = useState<ConfigDaRede>(CONFIG_PADRAO);
  const config = configDaProp ?? configSalva;
  const [tela, setTela] = useState<Tela>({ tipo: "inicio" });
  const [tipo, setTipo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [sacola, setSacola] = useState<ItemDaSacola[]>([]);
  const [sacolaAberta, setSacolaAberta] = useState(false);
  const [aberto, setAberto] = useState<ProdutoDaRede | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  // Config do painel (outra aba grava → esta atualiza) e sacola guardada.
  useEffect(() => {
    if (configDaProp) return;
    setConfigSalva(lerConfig());
    const aoMudar = (e: StorageEvent) => { if (e.key === CHAVE_DA_CONFIG) setConfigSalva(lerConfig()); };
    window.addEventListener("storage", aoMudar);
    return () => window.removeEventListener("storage", aoMudar);
  }, [configDaProp]);
  useEffect(() => {
    if (embutida) return;
    try {
      const s = JSON.parse(localStorage.getItem(chaveDaSacola) || "[]");
      if (Array.isArray(s)) setSacola(s.filter((i) => PRODUTO.has(i.produtoId)));
    } catch {}
  }, [embutida]);
  useEffect(() => {
    if (embutida) return;
    try { localStorage.setItem(chaveDaSacola, JSON.stringify(sacola)); } catch {}
  }, [sacola, embutida, chaveDaSacola]);

  const marcas = config.marcas.filter((m) => !m.oculta);
  const marcaPorId = useMemo(() => new Map(config.marcas.map((m) => [m.id, m])), [config.marcas]);
  const tipos = useMemo(() => [...new Set(marcas.map((m) => m.tipo))], [marcas]);
  const estiloDaCor = { "--cor": config.cor } as CSSProperties;

  function irPara(t: Tela) {
    setTela(t);
    setBusca("");
    if (embutida) raiz.current?.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
  }

  function adicionar(p: ProdutoDaRede, qtd = 1, obs = "") {
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
  const qtdItens = sacola.reduce((t, i) => t + i.qtd, 0);
  const marcasNaSacola = [...new Set(sacola.map((i) => PRODUTO.get(i.produtoId)!.marca))];
  const lojasNaSacola = marcasNaSacola.filter((m) => m !== MARCA_DOS_EXTRAS).length;

  // ─── Busca em todas as lojas ───
  const termo = busca.trim().toLowerCase();
  const achados = termo.length >= 2
    ? produtos.filter((p) => (p.marca === MARCA_DOS_EXTRAS || marcaPorId.get(p.marca) && !marcaPorId.get(p.marca)!.oculta)
        && (p.nome.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo) || p.categoria.toLowerCase().includes(termo)))
    : [];

  const marcaAtual = tela.tipo === "marca" ? marcaPorId.get(tela.id) ?? null : null;

  return (
    <CatalogoCtx.Provider value={catalogo}>
    <div ref={raiz} className={`${s.pagina} ${embutida ? s.embutida : ""}`} style={estiloDaCor}>
      <header className={s.barra}>
        <div className={s.barraDentro}>
          {tela.tipo === "inicio" ? (
            <button className={s.marcaDaRede} onClick={() => irPara({ tipo: "inicio" })}>
              <span className={s.selo}>{iniciais(config.nome)}</span>
              <span>
                <strong>{config.nome}</strong>
                <small><Bike size={12} /> Entrega em {config.local || CONFIG_PADRAO.local}</small>
              </span>
            </button>
          ) : (
            <button className={s.voltar} onClick={() => irPara({ tipo: "inicio" })}>
              <ArrowLeft size={18} /> Todas as lojas
            </button>
          )}
          <button className={s.botaoSacola} onClick={() => setSacolaAberta(true)} aria-label="Abrir sacola">
            <ShoppingBag size={20} />
            {qtdItens > 0 && <span className={s.contador}>{qtdItens}</span>}
          </button>
        </div>
      </header>

      {tela.tipo === "inicio" && (
        <main className={s.conteudo}>
          <label className={s.busca}>
            <Search size={18} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar em todas as lojas: burguer, frango, açaí…" />
            {busca && <button onClick={() => setBusca("")} aria-label="Limpar"><X size={16} /></button>}
          </label>

          {termo.length >= 2 ? (
            <section className={s.secao}>
              <h2 className={s.tituloSecao}>{achados.length ? `${achados.length} resultado${achados.length > 1 ? "s" : ""}` : "Nada encontrado"}</h2>
              <div className={s.listaProdutos}>
                {achados.map((p) => (
                  <LinhaDoProduto key={p.id} p={p} marca={marcaPorId.get(p.marca) ?? null} mostrarMarca
                    fechada={!!marcaPorId.get(p.marca) && !marcaPorId.get(p.marca)!.aberta}
                    onAbrir={() => setAberto(p)} onAdicionar={() => adicionar(p)} />
                ))}
              </div>
            </section>
          ) : (
            <>
              <Banners config={config} marcaPorId={marcaPorId} onIr={(id) => irPara({ tipo: "marca", id })} />

              <div className={s.faixaUmaEntrega}>
                <Bike size={20} />
                <span><strong>Peça de várias lojas, pague uma entrega só.</strong> Tudo sai da mesma cozinha, junto.</span>
              </div>

              <nav className={s.filtros} aria-label="Tipo de comida">
                <button className={tipo === null ? s.filtroAtivo : s.filtro} onClick={() => setTipo(null)}>Todas</button>
                {tipos.map((t) => (
                  <button key={t} className={tipo === t ? s.filtroAtivo : s.filtro} onClick={() => setTipo(tipo === t ? null : t)}>{t}</button>
                ))}
              </nav>

              <section className={s.secao}>
                <h2 className={s.tituloSecao}>Lojas da rede</h2>
                <div className={s.gradeDeLojas}>
                  {marcas.filter((m) => !tipo || m.tipo === tipo).map((m) => (
                    <CartaoDaMarca key={m.id} marca={m} config={config} onAbrir={() => irPara({ tipo: "marca", id: m.id })} />
                  ))}
                </div>
              </section>

              <MaisPedidos marcaPorId={marcaPorId} onAbrir={setAberto} />
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
        <button className={s.barraDaSacola} onClick={() => setSacolaAberta(true)}>
          <span className={s.barraQtd}>{qtdItens}</span>
          <span className={s.barraTexto}>
            Ver sacola
            <small>{lojasNaSacola > 1 ? `${lojasNaSacola} lojas · uma entrega só` : "uma entrega só"}</small>
          </span>
          <strong>{reais(subtotal)}</strong>
        </button>
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
            const total = subtotal + config.entrega.taxa;
            const itens = sacola;
            setSacola([]);
            setSacolaAberta(false);
            irPara({ tipo: "pronto", numero: 100 + Math.floor(Math.random() * 900), itens, total });
          }} />
      )}
    </div>
    </CatalogoCtx.Provider>
  );
}

// ─── Início ──────────────────────────────────────────────────────────────

function Banners({ config, marcaPorId, onIr }: { config: ConfigDaRede; marcaPorId: Map<string, MarcaDaRede>; onIr: (id: string) => void }) {
  const ativos = config.banners.filter((b) => b.ativo);
  const trilho = useRef<HTMLDivElement>(null);
  const [atual, setAtual] = useState(0);
  if (!ativos.length) return null;
  return (
    <section className={s.banners} aria-label="Ofertas">
      <div ref={trilho} className={s.trilho}
        onScroll={(e) => { const el = e.currentTarget; setAtual(Math.round(el.scrollLeft / (el.firstElementChild as HTMLElement).offsetWidth)); }}>
        {ativos.map((b) => {
          const marca = b.marca ? marcaPorId.get(b.marca) : null;
          return (
            <button key={b.id} className={s.banner} onClick={() => marca && onIr(marca.id)} disabled={!marca}
              style={{ background: marca?.cor ?? config.cor }}>
              {b.imagem && <img src={b.imagem} alt="" className={s.bannerFoto} />}
              <span className={s.bannerVeu} />
              <span className={s.bannerTexto}>
                {marca && <span className={s.bannerMarca}>{marca.nome}</span>}
                <strong>{b.titulo}</strong>
                {b.texto && <span>{b.texto}</span>}
                {marca && <span className={s.bannerAcao}>Pedir agora <ChevronRight size={14} /></span>}
              </span>
            </button>
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

function CartaoDaMarca({ marca, config, onAbrir }: { marca: MarcaDaRede; config: ConfigDaRede; onAbrir: () => void }) {
  return (
    <button className={`${s.cartao} ${marca.aberta ? "" : s.cartaoFechado}`} onClick={onAbrir}>
      <LogoDaMarca marca={marca} />
      <span className={s.cartaoInfo}>
        <strong className={s.cartaoNome}>{marca.nome}</strong>
        <span className={s.cartaoLinha}>
          <Nota marca={marca} /> <span className={s.ponto2}>•</span> {marca.tipo}
        </span>
        <span className={s.cartaoLinha}>
          {marca.aberta ? (
            <><Clock size={13} /> {config.entrega.min}–{config.entrega.max} min <span className={s.ponto2}>•</span> {reais(config.entrega.taxa)}</>
          ) : (
            <span className={s.fechada}>Fechada agora · abre às 18h30</span>
          )}
        </span>
      </span>
      <ChevronRight size={18} className={s.cartaoSeta} />
    </button>
  );
}

function MaisPedidos({ marcaPorId, onAbrir }: { marcaPorId: Map<string, MarcaDaRede>; onAbrir: (p: ProdutoDaRede) => void }) {
  // Os "Destaques" de cada loja visível — na versão real, os mais vendidos da semana.
  const { produtos } = useCatalogo();
  const lista = produtos.filter((p) => p.foto && p.categoria === "Destaques" && marcaPorId.get(p.marca) && !marcaPorId.get(p.marca)!.oculta);
  if (!lista.length) return null;
  return (
    <section className={s.secao}>
      <h2 className={s.tituloSecao}>Mais pedidos da rede</h2>
      <div className={s.carrossel}>
        {lista.map((p) => (
          <button key={p.id} className={s.miniProduto} onClick={() => onAbrir(p)}>
            <img src={p.foto!} alt="" />
            <span className={s.miniMarca}>{marcaPorId.get(p.marca)?.nome}</span>
            <strong>{p.nome}</strong>
            <span className={s.miniPreco}>{reais(p.preco)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ─── Dentro da loja ──────────────────────────────────────────────────────

function PaginaDaMarca({ marca, config, onAbrir, onAdicionar }: {
  marca: MarcaDaRede; config: ConfigDaRede; onAbrir: (p: ProdutoDaRede) => void; onAdicionar: (p: ProdutoDaRede) => void;
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
            <Nota marca={marca} /> <span className={s.ponto2}>•</span> {marca.tipo}
            <span className={s.ponto2}>•</span> Pedido mínimo {reais(config.entrega.minimo)}
          </p>
          <p className={s.cartaoLinha}>
            {marca.aberta ? (
              <><Clock size={13} /> {config.entrega.min}–{config.entrega.max} min <span className={s.ponto2}>•</span> Entrega {reais(config.entrega.taxa)}</>
            ) : <span className={s.fechada}>Fechada agora · abre às 18h30. Dá para olhar o cardápio.</span>}
          </p>
        </div>
      </div>

      <nav className={s.abasDoCardapio}>
        {[...categorias, ...categoriasExtras].map((c) => (
          <button key={c} className={c === catAtiva ? s.abaAtiva : s.aba} onClick={() => rolarPara(c)}>{c}</button>
        ))}
      </nav>

      {categorias.map((c) => (
        <section key={c} id={`cat-${marca.id}-${c}`} className={s.secaoCardapio}>
          <h2 className={s.tituloSecao}>{c}</h2>
          <div className={s.listaProdutos}>
            {produtos.filter((p) => p.categoria === c).map((p) => (
              <LinhaDoProduto key={p.id} p={p} marca={marca} fechada={!marca.aberta} onAbrir={() => onAbrir(p)} onAdicionar={() => onAdicionar(p)} />
            ))}
          </div>
        </section>
      ))}

      <div className={s.avisoExtras}>
        <strong>Para acompanhar</strong> — bebidas, porções e sobremesas da rede. Vão na mesma entrega, de qualquer loja.
      </div>
      {categoriasExtras.map((c) => (
        <section key={c} id={`cat-${marca.id}-${c}`} className={s.secaoCardapio}>
          <h2 className={s.tituloSecao}>{c}</h2>
          <div className={s.listaProdutos}>
            {extras.filter((p) => p.categoria === c).map((p) => (
              <LinhaDoProduto key={p.id} p={p} marca={null} fechada={false} onAbrir={() => onAbrir(p)} onAdicionar={() => onAdicionar(p)} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function LinhaDoProduto({ p, marca, mostrarMarca, fechada, onAbrir, onAdicionar }: {
  p: ProdutoDaRede; marca: MarcaDaRede | null; mostrarMarca?: boolean; fechada: boolean; onAbrir: () => void; onAdicionar: () => void;
}) {
  return (
    <div className={s.produto}>
      <button className={s.produtoTexto} onClick={onAbrir}>
        {mostrarMarca && <span className={s.miniMarca}>{marca?.nome ?? "Para acompanhar"}</span>}
        <strong>{p.nome}</strong>
        {p.descricao && <span className={s.descricao}>{p.descricao}</span>}
        <span className={s.preco}>{reais(p.preco)}</span>
      </button>
      <div className={s.produtoFoto}>
        {p.foto ? <img src={p.foto} alt="" loading="lazy" /> : <span className={s.semFoto} style={{ background: marca?.cor ?? "#868E96" }}>{iniciais(p.nome)}</span>}
        {!fechada && (
          <button className={s.mais} onClick={onAdicionar} aria-label={`Adicionar ${p.nome}`}><Plus size={18} /></button>
        )}
      </div>
    </div>
  );
}

function FolhaDoProduto({ p, marca, fechada, onFechar, onAdicionar }: {
  p: ProdutoDaRede; marca: MarcaDaRede | null; fechada: boolean; onFechar: () => void; onAdicionar: (qtd: number, obs: string) => void;
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
            {fechada ? "Loja fechada agora" : <>Adicionar <span>{reais(p.preco * qtd)}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sacola única ────────────────────────────────────────────────────────

function agruparPorMarca(itens: ItemDaSacola[], PRODUTO: Map<string, ProdutoDaRede>) {
  const grupos = new Map<string, { item: ItemDaSacola; idx: number }[]>();
  itens.forEach((item, idx) => {
    const m = PRODUTO.get(item.produtoId)!.marca;
    if (!grupos.has(m)) grupos.set(m, []);
    grupos.get(m)!.push({ item, idx });
  });
  // Extras por último.
  return [...grupos.entries()].sort(([a], [b]) => Number(a === MARCA_DOS_EXTRAS) - Number(b === MARCA_DOS_EXTRAS));
}

function Sacola({ config, sacola, marcaPorId, subtotal, onFechar, onQtd, onFinalizar }: {
  config: ConfigDaRede; sacola: ItemDaSacola[]; marcaPorId: Map<string, MarcaDaRede>; subtotal: number;
  onFechar: () => void; onQtd: (idx: number, delta: number) => void; onFinalizar: () => void;
}) {
  const PRODUTO = useCatalogo().porId;
  const falta = config.entrega.minimo - subtotal;
  return (
    <div className={s.fundo} onClick={onFechar}>
      <div className={`${s.folha} ${s.folhaSacola}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sacola">
        <div className={s.sacolaTopo}>
          <h3>Sua sacola</h3>
          <button onClick={onFechar} aria-label="Fechar"><X size={20} /></button>
        </div>
        {sacola.length === 0 ? (
          <p className={s.vazio}>Sacola vazia. Entre numa loja e escolha à vontade — pode misturar lojas.</p>
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
                    const p = PRODUTO.get(item.produtoId)!;
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
              <div><span>Entrega <em>(uma só, todas as lojas juntas)</em></span><span>{reais(config.entrega.taxa)}</span></div>
              <div className={s.total}><span>Total</span><span>{reais(subtotal + config.entrega.taxa)}</span></div>
            </div>
          </div>
        )}
        {sacola.length > 0 && (
          <div className={s.folhaRodape}>
            <button className={s.botaoPrincipal} disabled={falta > 0} onClick={onFinalizar}>
              {falta > 0 ? `Faltam ${reais(falta)} para o pedido mínimo` : <>Fazer pedido <span>{reais(subtotal + config.entrega.taxa)}</span></>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pedido enviado: como chega na cozinha ───────────────────────────────

function PedidoEnviado({ tela, config, marcaPorId, onVoltar }: {
  tela: Extract<Tela, { tipo: "pronto" }>; config: ConfigDaRede; marcaPorId: Map<string, MarcaDaRede>; onVoltar: () => void;
}) {
  const PRODUTO = useCatalogo().porId;
  return (
    <main className={s.conteudo}>
      <div className={s.pronto}>
        <span className={s.prontoIcone}><Check size={28} /></span>
        <h1>Pedido #{tela.numero} enviado</h1>
        <p>Chega tudo junto, numa entrega só, em {config.entrega.min}–{config.entrega.max} min.</p>
      </div>
      <h2 className={s.tituloSecao}>Assim ele chega na cozinha</h2>
      <p className={s.explica}>Um pedido só no painel, um motoboy, uma comanda separada por loja — a equipe sabe de qual marca é cada item e qual embalagem usar.</p>
      <div className={s.comanda}>
        <div className={s.comandaTopo}>
          <strong>{config.nome.toUpperCase()}</strong>
          <span>PEDIDO #{tela.numero} · ENTREGA</span>
        </div>
        {agruparPorMarca(tela.itens, PRODUTO).map(([mId, itens]) => (
          <div key={mId} className={s.comandaGrupo}>
            <div className={s.comandaMarca}>== {(marcaPorId.get(mId)?.nome ?? "Acompanhamentos").toUpperCase()} ==</div>
            {itens.map(({ item, idx }) => (
              <div key={idx}>
                {item.qtd}x {PRODUTO.get(item.produtoId)!.nome}
                {item.obs && <div className={s.comandaObs}>  obs: {item.obs}</div>}
              </div>
            ))}
          </div>
        ))}
        <div className={s.comandaTotal}>TOTAL {reais(tela.total)}</div>
      </div>
      <button className={s.botaoPrincipal} onClick={onVoltar}>Voltar para as lojas</button>
    </main>
  );
}
