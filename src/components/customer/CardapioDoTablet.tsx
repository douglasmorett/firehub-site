"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X, ShoppingBag, Plus, ChevronRight, ChevronLeft } from "lucide-react";
import { seloDoDestaque } from "./FileiraDeDestaques";
import css from "./CardapioDoTablet.module.css";
import type { VitrineDoTablet } from "@/lib/tablet-da-mesa/vitrine";

/**
 * O cardápio do Tablet na mesa (app/tablet/mesa): tela de vitrine, não de
 * celular esticado. Categorias com foto na lateral, a faixa da mesa no topo
 * (Garçom, Minha conta, Sacola), um banner grande que passa os destaques,
 * "Recomendados pela casa" e as categorias em cartões de foto grande.
 *
 * Só desenha: sacola, tela do produto (ComboModal) e envio continuam no
 * CustomerStorePage, que passa as funções. Banners e recomendados: os que a
 * loja montou na aba do tablet (`vitrine`) ou, sem eles, os automáticos.
 */

export type ProdutoDoTablet = {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  isCombo?: boolean;
  tags?: string | null;
};

const TROCA_DO_BANNER_MS = 7000;

type Slide = { chave: string; imagem: string | null; chapeu: string; titulo: string; texto: string; produto: ProdutoDoTablet | null };
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Ícone da categoria sem foto: pelo nome. */
function emojiDaCategoria(nome: string): string {
  const n = nome.toLowerCase();
  const tabela: [RegExp, string][] = [
    [/pizza/, "🍕"], [/burger|lanche|hamb|x-/, "🍔"], [/cerveja|chopp|drink|caipi|dose/, "🍺"],
    [/bebida|refri|suco|água|agua/, "🥤"], [/caf[eé]/, "☕"], [/por[cç][aã]o|petisco|batata|frita/, "🍟"],
    [/doce|sobremesa|bolo|torta|sorvete/, "🍰"], [/a[cç]a[ií]/, "🍧"], [/sushi|japa|temaki/, "🍣"],
    [/salgad|pastel|coxinha/, "🥟"], [/salada|fit|leve/, "🥗"], [/combo|promo/, "🔥"],
    [/carne|churras|espeto|grelh/, "🥩"], [/frango/, "🍗"], [/massa|macarr|lasanha/, "🍝"],
    [/peixe|camar|frutos do mar/, "🦐"], [/kids|infantil/, "🧒"],
  ];
  return tabela.find(([r]) => r.test(n))?.[1] ?? "🍽️";
}

export default function CardapioDoTablet({
  logo, nomeDaLoja, nomeDaMesa, acoes,
  porCategoria, destaques, ofertas, vitrine, bannerEmFoco,
  busca, setBusca, quantidade, abrir, preco,
  itensNaSacola, totalDaSacola, abrirSacola, sacola, fecharSacola,
}: {
  logo: string | null;
  nomeDaLoja: string;
  nomeDaMesa: string;
  /** Chamar garçom e Minha conta (TabletDaMesa). */
  acoes: ReactNode;
  /** Já na ordem da loja e filtrado pela busca. */
  porCategoria: Record<string, ProdutoDoTablet[]>;
  destaques: ProdutoDoTablet[];
  ofertas: ProdutoDoTablet[];
  vitrine: VitrineDoTablet | null;
  /** A prévia do painel: o banner que o lojista está editando fica parado na tela. */
  bannerEmFoco: number | null;
  busca: string;
  setBusca: (v: string) => void;
  quantidade: (id: string) => number;
  abrir: (p: ProdutoDoTablet) => void;
  preco: (p: ProdutoDoTablet, tamanho: string, cor: string) => ReactNode;
  itensNaSacola: number;
  totalDaSacola: number;
  abrirSacola: () => void;
  /** A sacola do CustomerStorePage quando aberta (e o fechamento do pedido dentro dela). */
  sacola: ReactNode | null;
  fecharSacola: () => void;
}) {
  const categorias = Object.keys(porCategoria);
  const buscando = busca.trim().length > 0;
  const secoes = useRef<Record<string, HTMLElement | null>>({});
  const [ativa, setAtiva] = useState<string>("inicio");

  const porId = useMemo(() => {
    const m = new Map<string, ProdutoDoTablet>();
    for (const p of [...Object.values(porCategoria).flat(), ...destaques, ...ofertas]) m.set(p.id, p);
    return m;
  }, [porCategoria, destaques, ofertas]);

  // Banners da loja; sem eles, os destaques com foto, as ofertas ou os primeiros com foto.
  const doBanner = useMemo<Slide[]>(() => {
    if (vitrine?.banners.length) {
      return vitrine.banners.map((b) => {
        const produto = b.produtoId ? porId.get(b.produtoId) ?? null : null;
        return { chave: b.id, imagem: b.imagem || produto?.imageUrl || null, chapeu: b.chapeu, titulo: b.titulo || produto?.name || "", texto: b.texto || produto?.description || "", produto };
      }).filter((s) => s.imagem || s.titulo);
    }
    const comFoto = (l: ProdutoDoTablet[]) => l.filter((p) => p.imageUrl);
    const todos = Object.values(porCategoria).flat();
    const escolha = comFoto(destaques).length ? comFoto(destaques) : comFoto(ofertas).length ? comFoto(ofertas) : comFoto(todos);
    return escolha.slice(0, 6).map((p) => ({
      chave: p.id, imagem: p.imageUrl ?? null, titulo: p.name, texto: p.description || "", produto: p,
      chapeu: destaques.some((d) => d.id === p.id) ? "Destaque da casa" : ofertas.some((o) => o.id === p.id) ? "Oferta" : "Experimente",
    }));
  }, [vitrine, porId, destaques, ofertas, porCategoria]);

  const recomendados = useMemo(() => {
    if (vitrine?.recomendados.length) return vitrine.recomendados.map((id) => porId.get(id)).filter((p): p is ProdutoDoTablet => Boolean(p));
    const vistos = new Set<string>();
    return [...destaques, ...ofertas].filter((p) => !vistos.has(p.id) && vistos.add(p.id)).slice(0, 12);
  }, [vitrine, porId, destaques, ofertas]);

  // A foto de cada categoria: a do primeiro produto que tem.
  const fotoDaCategoria = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const c of categorias) m[c] = porCategoria[c].find((p) => p.imageUrl)?.imageUrl ?? null;
    return m;
  }, [categorias, porCategoria]);

  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (bannerEmFoco !== null && bannerEmFoco >= 0) setSlide(bannerEmFoco);
  }, [bannerEmFoco]);
  useEffect(() => {
    if (doBanner.length < 2 || (bannerEmFoco !== null && bannerEmFoco >= 0)) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % doBanner.length), TROCA_DO_BANNER_MS);
    return () => clearInterval(t);
  }, [doBanner.length, bannerEmFoco]);
  const noBanner = doBanner[slide % Math.max(1, doBanner.length)];

  // A categoria acesa na lateral acompanha a rolagem.
  useEffect(() => {
    const obs = new IntersectionObserver((entradas) => {
      const visivel = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visivel) setAtiva((visivel.target as HTMLElement).dataset.secao || "inicio");
    }, { rootMargin: "-90px 0px -60% 0px" });
    Object.values(secoes.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [categorias.length, buscando]);

  function irPara(chave: string) {
    setAtiva(chave);
    if (chave === "inicio") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const el = secoes.current[chave];
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: "smooth" });
  }

  const cartao = (p: ProdutoDoTablet, largo = false) => {
    const q = quantidade(p.id);
    const selo = seloDoDestaque(p);
    return (
      <button key={p.id} type="button" className={`${css.cartao} ${largo ? css.cartaoLargo : ""} ${q > 0 ? css.naSacola : ""}`} onClick={() => abrir(p)}>
        <div className={css.foto}>
          {p.imageUrl
            ? <img src={p.imageUrl} alt="" loading="lazy" decoding="async" />
            : <span className={css.semFoto} aria-hidden>{emojiDaCategoria(p.category || p.name)}</span>}
          {selo && <span className={css.selo}>{selo}</span>}
          {q > 0 && <span className={css.qtd}>{q} na sacola</span>}
        </div>
        <div className={css.corpo}>
          <div className={css.nome}>{p.name}</div>
          {p.description && <div className={css.desc}>{p.description}</div>}
          <div className={css.rodape}>
            <span className={css.preco}>{preco(p, "1.15rem", "#FDBA74")}</span>
            <span className={css.mais} aria-hidden><Plus size={22} strokeWidth={3} /></span>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className={css.tela}>
      {/* LATERAL: logo e categorias */}
      <nav className={css.lateral} aria-label="Categorias">
        <div className={css.logo}>
          {logo ? <img src={logo} alt={nomeDaLoja} /> : <span>{nomeDaLoja.slice(0, 2).toUpperCase()}</span>}
        </div>
        <div className={css.cats}>
          <button type="button" className={`${css.cat} ${ativa === "inicio" ? css.catAtiva : ""}`} onClick={() => { setBusca(""); irPara("inicio"); }}>
            <span className={css.catIcone}><span aria-hidden>⭐</span></span>
            <span className={css.catNome}>Início</span>
          </button>
          {ofertas.length > 0 && !buscando && (
            <button type="button" className={`${css.cat} ${ativa === "ofertas" ? css.catAtiva : ""}`} onClick={() => irPara("ofertas")}>
              <span className={css.catIcone}><span aria-hidden>🔥</span></span>
              <span className={css.catNome}>Ofertas</span>
            </button>
          )}
          {categorias.map((c) => (
            <button key={c} type="button" className={`${css.cat} ${ativa === c ? css.catAtiva : ""}`} onClick={() => irPara(c)}>
              <span className={css.catIcone}>
                {fotoDaCategoria[c] ? <img src={fotoDaCategoria[c]!} alt="" loading="lazy" /> : <span aria-hidden>{emojiDaCategoria(c)}</span>}
              </span>
              <span className={css.catNome}>{c}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className={css.principal}>
        {/* TOPO: mesa, busca, garçom, conta, sacola */}
        <header className={css.topo}>
          <div className={css.mesa}>
            <span className={css.mesaRotulo}>Você está na</span>
            <span className={css.mesaNome}>{nomeDaMesa}</span>
          </div>
          <label className={css.busca}>
            <Search size={20} />
            <input type="search" placeholder="O que você quer hoje?" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {buscando && <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca"><X size={18} /></button>}
          </label>
          <div className={css.acoes}>
            {acoes}
            <button type="button" className={css.botaoSacola} onClick={abrirSacola}>
              <ShoppingBag size={22} />
              <span>Sacola</span>
              {itensNaSacola > 0 && <span className={css.contador}>{itensNaSacola}</span>}
            </button>
          </div>
        </header>

        <main className={css.conteudo}>
          {!buscando && (
            <section data-secao="inicio" ref={(el) => { secoes.current.inicio = el; }}>
              {noBanner ? (
                <div className={`${css.banner} ${noBanner.imagem ? "" : css.bannerSemFoto}`}>
                  {doBanner.map((b, i) => b.imagem && (
                    <img key={b.chave} src={b.imagem} alt="" className={`${css.bannerFoto} ${i === slide % doBanner.length ? css.bannerFotoAtiva : ""}`} />
                  ))}
                  <div className={css.bannerSombra} />
                  <div className={css.bannerTexto} key={noBanner.chave}>
                    {noBanner.chapeu && <span className={css.bannerChapeu}>{noBanner.chapeu}</span>}
                    {noBanner.titulo && <h1 className={css.bannerTitulo}>{noBanner.titulo}</h1>}
                    {noBanner.texto && <p className={css.bannerDesc}>{noBanner.texto}</p>}
                    {noBanner.produto && (
                      <div className={css.bannerLinha}>
                        <span className={css.bannerPreco}>{preco(noBanner.produto, "1.7rem", "#FFFFFF")}</span>
                        <button type="button" className={css.bannerBotao} onClick={() => abrir(noBanner.produto!)}>
                          Quero esse <ChevronRight size={22} strokeWidth={3} />
                        </button>
                      </div>
                    )}
                  </div>
                  {doBanner.length > 1 && (
                    <div className={css.pontos}>
                      {doBanner.map((b, i) => (
                        <button key={b.chave} type="button" aria-label={`Banner ${i + 1}`} className={i === slide % doBanner.length ? css.pontoAtivo : ""} onClick={() => setSlide(i)} />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`${css.banner} ${css.bannerSemFoto}`}>
                  <div className={css.bannerTexto}>
                    <span className={css.bannerChapeu}>Bem-vindo</span>
                    <h1 className={css.bannerTitulo}>{nomeDaLoja}</h1>
                    <p className={css.bannerDesc}>Escolha, peça por aqui e o pedido vai direto para a cozinha.</p>
                  </div>
                </div>
              )}

              {recomendados.length > 0 && (
                <>
                  <h2 className={css.titulo}>Recomendados pela casa</h2>
                  <div className={css.fileira}>{recomendados.map((p) => cartao(p, true))}</div>
                </>
              )}
            </section>
          )}

          {!buscando && ofertas.length > 0 && (
            <section data-secao="ofertas" ref={(el) => { secoes.current.ofertas = el; }}>
              <h2 className={css.titulo}>🔥 Ofertas</h2>
              <div className={css.grade}>{ofertas.map((p) => cartao(p))}</div>
            </section>
          )}

          {buscando && categorias.length === 0 && (
            <div className={css.vazio}>Nada encontrado para “{busca}”.</div>
          )}

          {categorias.map((c) => (
            <section key={c} data-secao={c} ref={(el) => { secoes.current[c] = el; }}>
              <h2 className={css.titulo}>{c}</h2>
              <div className={css.grade}>{porCategoria[c].map((p) => cartao(p))}</div>
            </section>
          ))}
          <div style={{ height: 120 }} />
        </main>
      </div>

      {sacola && (
        <div className={css.sacolaFundo} onClick={fecharSacola}>
          <div className={css.sacolaPainel} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={css.sacolaVoltar} onClick={fecharSacola}>
              <ChevronLeft size={20} /> Continuar escolhendo
            </button>
            {sacola}
          </div>
        </div>
      )}

      {itensNaSacola > 0 && !sacola && (
        <button type="button" className={css.verSacola} onClick={abrirSacola}>
          <span className={css.verSacolaQtd}>{itensNaSacola}</span>
          <span>Ver sacola e enviar pedido</span>
          <b>{reais(totalDaSacola)}</b>
        </button>
      )}
    </div>
  );
}
