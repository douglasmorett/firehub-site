"use client";

/**
 * O editor do Multimarcas (ativado): o dono cria as marcas, diz quais
 * categorias do cardápio são de cada uma, sobe logo, capa e banners, e vê a
 * página no celular ao lado enquanto mexe. Categoria que não é de nenhuma
 * marca aparece em todas (bebida, sobremesa): a seção "Onde cada categoria
 * aparece" mostra isso como a opção "Todas as marcas" (Lucas, 23/10/2026).
 * Destaques e banners se escolhem pelo item, com busca (Lucas, 25/10/2026).
 * Grava em PUT /api/store/multimarcas/pagina (lib/multimarcas/pagina.ts).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, ExternalLink, Eye, EyeOff, ImagePlus, Loader2, Plus, Search, Sparkles, Star, Trash2, X } from "lucide-react";
import Vitrine from "@/components/multimarcas/Vitrine";
import { MARCA_DOS_EXTRAS, reais, type ConfigDaVitrine, type ProdutoDaVitrine } from "@/lib/multimarcas/vitrine";
import type { BannerDaPagina, ConfigDaPagina, MarcaDaPagina } from "@/lib/multimarcas/pagina";
import s from "./Editor.module.css";

type Categoria = { nome: string; emoji: string; produtos: number };
type Dados = {
  config: ConfigDaPagina;
  salva: boolean;
  limites: { marcas: number; banners: number };
  loja: { slug: string | null; nome: string; logo: string | null };
  categorias: Categoria[];
  sugestoes: string[];
  vitrine: { config: ConfigDaVitrine; produtos: ProdutoDaVitrine[] };
};

const CORES = ["#E8590C", "#C92A2A", "#1F1F23", "#2B8A3E", "#1864AB", "#7048E8", "#F08C00", "#C2255C"];
const TIPOS = ["Hambúrguer", "Pizza", "Frango", "Marmita", "Açaí", "Japonês", "Pastel", "Esfiha", "Doces", "Saudável", "Lanches", "Bebidas"];
const chave = (n: string) => n.trim().toLowerCase();
const LIMITE_DE_DESTAQUES = 20;
const novoId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function mover<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return lista;
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova;
}

async function enviarImagem(arquivo: File): Promise<string> {
  if (arquivo.size > 8 * 1024 * 1024) throw new Error("A imagem passa de 8 MB. Use uma menor.");
  const fd = new FormData();
  fd.append("file", arquivo);
  fd.append("type", "image");
  const r = await fetch("/api/upload-store-image", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || "Não deu para enviar a imagem.");
  return j.url as string;
}

function CampoDeImagem({ valor, rotulo, quadrado, onMudar, onErro }: {
  valor: string | null; rotulo: string; quadrado?: boolean; onMudar: (url: string | null) => void; onErro: (m: string) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <div className={`${s.imagem} ${quadrado ? s.imagemQuadrada : ""}`}>
      <button type="button" className={s.imagemBotao} onClick={() => entrada.current?.click()} disabled={enviando} aria-label={rotulo}>
        {valor ? <img src={valor} alt="" /> : enviando ? <Loader2 size={18} className={s.girando} /> : <><ImagePlus size={18} /><span>{rotulo}</span></>}
      </button>
      {valor && <button type="button" className={s.imagemTirar} onClick={() => onMudar(null)} aria-label={`Tirar ${rotulo}`}><Trash2 size={13} /></button>}
      <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setEnviando(true);
        try { onMudar(await enviarImagem(f)); } catch (err: any) { onErro(err.message); } finally { setEnviando(false); }
      }} />
    </div>
  );
}

export default function EditorDoMultimarcas({ onAviso }: { onAviso: (tipo: "ok" | "erro", titulo: string, detalhe?: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigDaPagina | null>(null);
  const [mudou, setMudou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  /** Apagar marca pede um segundo toque (sem janela do navegador). */
  const [apagando, setApagando] = useState<string | null>(null);
  /** A marca aberta no editor: uma por vez, as outras ficam numa linha só. */
  const [aberta, setAberta] = useState<string | null>(null);
  const [buscaItem, setBuscaItem] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/store/multimarcas/pagina", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Erro ao carregar");
        setDados(j);
        setConfig(j.config);
      } catch (e: any) { setErro(e.message); }
    })();
  }, []);

  // Sair com coisa sem salvar: o navegador pergunta.
  useEffect(() => {
    if (!mudou) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [mudou]);

  const donoDaCategoria = useMemo(() => {
    const m = new Map<string, string>();
    for (const marca of config?.marcas ?? []) for (const c of marca.categorias) m.set(chave(c), marca.id);
    return m;
  }, [config]);

  // A prévia: a vitrine de verdade (notas, prazo, aberta) com as marcas que estão sendo editadas.
  const previa = useMemo(() => {
    if (!dados || !config) return null;
    const notas = new Map(dados.vitrine.config.marcas.map((m) => [m.id, m]));
    const aberta = dados.vitrine.config.marcas[0]?.aberta ?? true;
    const vc: ConfigDaVitrine = {
      ...dados.vitrine.config,
      nome: config.nome, frase: config.frase, cor: config.cor, banners: config.banners, destaques: config.destaques,
      marcas: config.marcas.map((m) => ({
        id: m.id, nome: m.nome, tipo: m.tipo, cor: m.cor, logo: m.logo, capa: m.capa, oculta: m.oculta,
        nota: notas.get(m.id)?.nota ?? null, avaliacoes: notas.get(m.id)?.avaliacoes ?? 0, aberta,
      })),
    };
    const produtos = dados.vitrine.produtos.map((p) => ({ ...p, marca: donoDaCategoria.get(chave(p.categoria)) ?? MARCA_DOS_EXTRAS }));
    return { config: vc, produtos };
  }, [dados, config, donoDaCategoria]);

  if (erro) return <div className={s.erro}>{erro}</div>;
  if (!dados || !config || !previa) return <div className={s.carregando}><Loader2 size={18} className={s.girando} /> Carregando a página das suas marcas…</div>;

  const mudar = (c: ConfigDaPagina) => { setConfig(c); setMudou(true); };
  // Pela marca/banner que existe NA HORA (função): o envio de imagem termina depois, e com o
  // `config` de quando a tela foi desenhada duas imagens subindo juntas apagavam uma à outra.
  const mudarMarca = (i: number, campo: Partial<MarcaDaPagina>) => {
    setConfig((c) => (c ? { ...c, marcas: c.marcas.map((m, k) => (k === i ? { ...m, ...campo } : m)) } : c));
    setMudou(true);
  };
  const mudarBanner = (i: number, campo: Partial<BannerDaPagina>) => {
    setConfig((c) => (c ? { ...c, banners: c.banners.map((b, k) => (k === i ? { ...b, ...campo } : b)) } : c));
    setMudou(true);
  };
  const erroDeImagem = (m: string) => onAviso("erro", "Imagem não enviada", m);

  function novaMarca(nome = "") {
    if (config!.marcas.length >= dados!.limites.marcas) return;
    const nova = { id: novoId("m"), nome: nome || `Marca ${config!.marcas.length + 1}`, tipo: "", cor: CORES[config!.marcas.length % CORES.length], logo: null, capa: null, categorias: [], oculta: false };
    mudar({ ...config!, marcas: [...config!.marcas, nova] });
    setAberta(nova.id);
  }

  /** A categoria vai só para uma marca (`destino` = id) ou para todas (`destino` vazio = sem marca). */
  function moverCategoria(nome: string, destino: string) {
    const k = chave(nome);
    const marcas = config!.marcas.map((m) => {
      const sem = m.categorias.filter((c) => chave(c) !== k);
      return m.id === destino ? { ...m, categorias: [...sem, nome] } : sem.length === m.categorias.length ? m : { ...m, categorias: sem };
    });
    mudar({ ...config!, marcas });
  }

  function alternarDestaque(id: string) {
    const atuais = config!.destaques ?? [];
    if (!atuais.includes(id) && atuais.length >= LIMITE_DE_DESTAQUES) return;
    mudar({ ...config!, destaques: atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id] });
  }

  /** O item vira um banner que abre o item (foto e nome dele); tocar de novo tira. */
  function alternarBannerDoItem(p: ProdutoDaVitrine) {
    const existe = config!.banners.some((b) => b.produto === p.id);
    if (existe) return mudar({ ...config!, banners: config!.banners.filter((b) => b.produto !== p.id) });
    if (config!.banners.length >= dados!.limites.banners) return;
    mudar({
      ...config!,
      banners: [...config!.banners, { id: novoId("b"), titulo: p.nome.slice(0, 60), texto: reais(p.preco), imagem: p.foto, marca: p.marca === MARCA_DOS_EXTRAS ? null : p.marca, produto: p.id, ativo: true }],
    });
  }

  /** Marca a categoria nesta marca (tirando de outra, se estava lá) ou desmarca. */
  function alternarCategoria(i: number, nome: string) {
    const k = chave(nome);
    const marcas = config!.marcas.map((m, idx) => {
      const tem = m.categorias.some((c) => chave(c) === k);
      if (idx === i) return { ...m, categorias: tem ? m.categorias.filter((c) => chave(c) !== k) : [...m.categorias, nome] };
      return tem ? { ...m, categorias: m.categorias.filter((c) => chave(c) !== k) } : m;
    });
    mudar({ ...config!, marcas });
  }

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch("/api/store/multimarcas/pagina", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao salvar");
      setConfig(j.config);
      setMudou(false);
      onAviso("ok", "Página salva", "Em até 1 minuto a página pública mostra as mudanças.");
    } catch (e: any) {
      onAviso("erro", "Não salvou", e.message);
    } finally { setSalvando(false); }
  }

  const link = dados.loja.slug ? `https://firehubfood.com.br/marcas/${dados.loja.slug}` : null;
  const sugestoes = dados.sugestoes.filter((n) => !config.marcas.some((m) => chave(m.nome) === chave(n)));
  const fotos = dados.vitrine.produtos.filter((p) => p.foto).slice(0, 60);
  const marcaPorId = new Map(config.marcas.map((m) => [m.id, m]));
  const destaques = config.destaques ?? [];
  const produtoPorId = new Map(previa.produtos.map((p) => [p.id, p]));

  // A lista de itens para escolher destaque e banner: agrupada por marca (na
  // ordem das marcas) e "Todas as marcas" no fim. A busca acha pelo nome do
  // item, da categoria ou da marca.
  const termo = chave(buscaItem);
  const grupos = [...config.marcas.map((m) => ({ id: m.id, nome: m.nome })), { id: MARCA_DOS_EXTRAS, nome: "Todas as marcas" }]
    .map((g) => ({
      ...g,
      itens: previa.produtos.filter((p) => p.marca === g.id && (!termo
        || chave(p.nome).includes(termo) || chave(p.categoria).includes(termo) || chave(g.nome).includes(termo))),
    }))
    .filter((g) => g.itens.length > 0);

  return (
    <div className={s.editor}>
      <div className={s.barraDoLink}>
        <div>
          <span className={s.rotulo}>Link da sua página</span>
          <b>{link ? link.replace("https://", "") : "A loja ainda não tem link (Minha Loja › endereço do cardápio)"}</b>
          {!dados.salva && <small>Monte as marcas e salve: o link mostra a página assim que tiver uma marca.</small>}
        </div>
        {link && (
          <div className={s.acoesDoLink}>
            <button className={s.botaoLeve} onClick={async () => { try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch {} }}>
              {copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}
            </button>
            <a className={s.botaoLeve} href={link} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Abrir</a>
          </div>
        )}
      </div>

      <div className={s.colunas}>
        <div className={s.formulario}>
          <section className={s.bloco}>
            <div className={s.blocoTopo}>
              <div>
                <h2>1. Suas marcas</h2>
                <p className={s.dica}>Cada marca é uma loja na sua página. Toque na marca para abrir e escolher o nome, a logo e as categorias dela.</p>
              </div>
              <button className={s.botaoEscuro} onClick={() => novaMarca()} disabled={config.marcas.length >= dados.limites.marcas}><Plus size={16} /> Marca</button>
            </div>

            {sugestoes.length > 0 && (
              <div className={s.sugestoes}>
                <Sparkles size={15} /> Suas lojas nos apps:
                {sugestoes.map((n) => <button key={n} onClick={() => novaMarca(n)}>+ {n}</button>)}
              </div>
            )}

            {config.marcas.length === 0 && <div className={s.vazio}>Nenhuma marca ainda. Crie a primeira e escolha as categorias dela.</div>}

            {config.marcas.map((m, i) => (
              <div key={m.id} className={`${s.marca} ${m.oculta ? s.apagado : ""}`}>
                <div className={s.marcaCabeca}>
                  <button className={s.marcaResumo} onClick={() => setAberta(aberta === m.id ? null : m.id)} aria-expanded={aberta === m.id}>
                    {m.logo ? <img src={m.logo} alt="" /> : <span className={s.marcaSigla} style={{ background: m.cor }}>{m.nome.slice(0, 2).toUpperCase()}</span>}
                    <span>
                      <b>{m.nome}</b>
                      <small className={m.categorias.length ? undefined : s.textoAlerta}>
                        {m.categorias.length ? `${m.categorias.length} categoria${m.categorias.length > 1 ? "s" : ""}${m.tipo ? ` · ${m.tipo}` : ""}` : "Sem categoria: abre vazia"}
                        {m.oculta ? " · escondida" : ""}
                      </small>
                    </span>
                    <ChevronDown size={18} className={aberta === m.id ? s.setaAberta : s.seta} />
                  </button>
                  <div className={s.botoesDoItem}>
                    <button onClick={() => mudar({ ...config, marcas: mover(config.marcas, i, -1) })} aria-label="Subir"><ArrowUp size={15} /></button>
                    <button onClick={() => mudar({ ...config, marcas: mover(config.marcas, i, 1) })} aria-label="Descer"><ArrowDown size={15} /></button>
                    <button onClick={() => mudarMarca(i, { oculta: !m.oculta })} aria-label={m.oculta ? "Mostrar" : "Esconder"} title={m.oculta ? "Escondida da página" : "Esconder da página"}>{m.oculta ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                    {apagando === m.id ? (
                      <button className={s.apagarMesmo} onClick={() => { setApagando(null); mudar({ ...config, marcas: config.marcas.filter((_, k) => k !== i), banners: config.banners.map((b) => (b.marca === m.id ? { ...b, marca: null } : b)) }); }}>Apagar?</button>
                    ) : (
                      <button onClick={() => { setApagando(m.id); setTimeout(() => setApagando((x) => (x === m.id ? null : x)), 4000); }} aria-label="Apagar"><Trash2 size={15} /></button>
                    )}
                  </div>
                </div>

                {aberta === m.id && (
                  <>
                    <div className={s.marcaTopo}>
                      <CampoDeImagem valor={m.logo} rotulo="Logo" quadrado onMudar={(url) => mudarMarca(i, { logo: url })} onErro={erroDeImagem} />
                      <div className={s.marcaCampos}>
                        <input className={s.inputNome} value={m.nome} maxLength={40} onChange={(e) => mudarMarca(i, { nome: e.target.value })} aria-label="Nome da marca" />
                        <div className={s.linha}>
                          <input list="tipos-de-comida" value={m.tipo} maxLength={24} placeholder="Tipo (ex.: Hambúrguer)" onChange={(e) => mudarMarca(i, { tipo: e.target.value })} aria-label="Tipo de comida" />
                          <input type="color" value={m.cor} onChange={(e) => mudarMarca(i, { cor: e.target.value })} aria-label="Cor da marca" />
                        </div>
                      </div>
                    </div>
                    <CampoDeImagem valor={m.capa} rotulo="Capa da marca (foto larga)" onMudar={(url) => mudarMarca(i, { capa: url })} onErro={erroDeImagem} />
                    <span className={s.rotulo}>Categorias desta marca</span>
                    <div className={s.categorias}>
                      {dados.categorias.map((c) => {
                        const dono = donoDaCategoria.get(chave(c.nome));
                        const minha = dono === m.id;
                        const deOutra = dono && !minha ? marcaPorId.get(dono) : null;
                        return (
                          <button key={c.nome} className={minha ? s.chipMarcado : s.chip} onClick={() => alternarCategoria(i, c.nome)} title={deOutra ? `Está em ${deOutra.nome} — tocar traz para esta marca` : undefined}>
                            {minha && <Check size={13} />} {c.emoji} {c.nome} <small>{c.produtos}</small>
                            {deOutra && <em>{deOutra.nome}</em>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ))}
            <datalist id="tipos-de-comida">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
          </section>

          {config.marcas.length > 0 && (
            <section className={s.bloco}>
              <div>
                <h2>2. Onde cada categoria aparece</h2>
                <p className={s.dica}>Bebida, sobremesa, acompanhamento: deixe em <b>Todas as marcas</b> e elas aparecem no cardápio de todas. A ordem é a do seu cardápio (Cardápio › Reordenar).</p>
              </div>
              <div className={s.tabelaCategorias}>
                {dados.categorias.map((c) => {
                  const dono = donoDaCategoria.get(chave(c.nome)) ?? "";
                  return (
                    <label key={c.nome} className={s.linhaCategoria}>
                      <span>{c.emoji} {c.nome} <small>{c.produtos} ite{c.produtos === 1 ? "m" : "ns"}</small></span>
                      <select value={dono} onChange={(e) => moverCategoria(c.nome, e.target.value)} className={dono ? undefined : s.selectTodas}>
                        <option value="">⭐ Todas as marcas</option>
                        {config.marcas.map((m) => <option key={m.id} value={m.id}>Só em {m.nome}</option>)}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          <section className={s.bloco}>
            <div>
              <h2>3. Destaques e banners</h2>
              <p className={s.dica}>Ache o item e toque em <b>Destaque</b> (fileira de itens da página) ou <b>Banner</b> (vira um banner que abre o item).</p>
            </div>
            {destaques.length > 0 && (
              <div className={s.escolhidos}>
                <span className={s.rotulo}>Destaques ({destaques.length}/{LIMITE_DE_DESTAQUES}), nesta ordem:</span>
                <div className={s.categorias}>
                  {destaques.map((id) => (
                    <button key={id} className={s.chipMarcado} onClick={() => alternarDestaque(id)} title="Tirar dos destaques">
                      {produtoPorId.get(id)?.nome ?? "Item fora do cardápio"} <X size={13} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className={s.buscaItem}>
              <Search size={16} />
              <input value={buscaItem} onChange={(e) => setBuscaItem(e.target.value)} placeholder="Buscar item ou marca (ex.: smash, coca, Frangoso)" />
            </label>
            <div className={s.listaItens}>
              {grupos.length === 0 && <div className={s.vazio}>Nenhum item com esse nome.</div>}
              {grupos.map((g) => (
                <div key={g.id}>
                  <div className={s.grupoTitulo}>{g.nome} <small>{g.itens.length}</small></div>
                  {g.itens.map((p) => {
                    const ehDestaque = destaques.includes(p.id);
                    const temBanner = config.banners.some((b) => b.produto === p.id);
                    return (
                      <div key={p.id} className={s.itemLinha}>
                        {p.foto ? <img src={p.foto} alt="" className={s.itemFoto} /> : <span className={s.itemFoto} />}
                        <span className={s.itemInfo}><b>{p.nome}</b><small>{p.categoria} · {reais(p.preco)}</small></span>
                        <button className={ehDestaque ? s.botaoLigado : s.botaoDesligado} onClick={() => alternarDestaque(p.id)}
                          disabled={!ehDestaque && destaques.length >= LIMITE_DE_DESTAQUES}>
                          <Star size={14} /> Destaque
                        </button>
                        <button className={temBanner ? s.botaoLigado : s.botaoDesligado} onClick={() => alternarBannerDoItem(p)}
                          disabled={!temBanner && config.banners.length >= dados.limites.banners}>
                          <ImagePlus size={14} /> Banner
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          <section className={s.bloco}>
            <div className={s.blocoTopo}>
              <div>
                <h2>4. Banners</h2>
                <p className={s.dica}>Arte larga (1600 × 800) ou foto do cardápio. O banner pode abrir um item, uma marca, ou ser só um aviso (ex.: um cupom).</p>
              </div>
              <button className={s.botaoEscuro} disabled={config.banners.length >= dados.limites.banners} onClick={() => mudar({
                ...config,
                banners: [...config.banners, { id: novoId("b"), titulo: "Nova oferta", texto: "", imagem: fotos[0]?.foto ?? null, marca: config.marcas[0]?.id ?? null, produto: null, ativo: true }],
              })}><Plus size={16} /> Banner</button>
            </div>
            {config.banners.length === 0 && <div className={s.vazio}>Sem banner a página começa direto nas marcas.</div>}
            {config.banners.map((b, i) => (
              <div key={b.id} className={`${s.marca} ${b.ativo ? "" : s.apagado}`}>
                <div className={s.marcaTopo}>
                  <CampoDeImagem valor={b.imagem} rotulo="Arte" onMudar={(url) => mudarBanner(i, { imagem: url })} onErro={erroDeImagem} />
                  <div className={s.marcaCampos}>
                    <input className={s.inputNome} value={b.titulo} maxLength={60} placeholder="Título (ex.: Cupom PRIMEIRA10, 10% no 1º pedido)" onChange={(e) => mudarBanner(i, { titulo: e.target.value })} />
                    <input value={b.texto} maxLength={90} placeholder="Texto menor (opcional)" onChange={(e) => mudarBanner(i, { texto: e.target.value })} />
                  </div>
                  <div className={s.botoesDoItem}>
                    <button onClick={() => mudar({ ...config, banners: mover(config.banners, i, -1) })} aria-label="Subir"><ArrowUp size={15} /></button>
                    <button onClick={() => mudar({ ...config, banners: mover(config.banners, i, 1) })} aria-label="Descer"><ArrowDown size={15} /></button>
                    <button onClick={() => mudarBanner(i, { ativo: !b.ativo })} aria-label={b.ativo ? "Esconder" : "Mostrar"}>{b.ativo ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                    <button onClick={() => mudar({ ...config, banners: config.banners.filter((_, k) => k !== i) })} aria-label="Apagar"><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className={s.linha}>
                  <label className={s.campo}>Ao tocar, abre
                    <select value={b.produto ? `p:${b.produto}` : b.marca ? `m:${b.marca}` : ""} onChange={(e) => {
                      const v = e.target.value;
                      mudarBanner(i, v.startsWith("p:") ? { produto: v.slice(2) } : { produto: null, marca: v.startsWith("m:") ? v.slice(2) : null });
                    }}>
                      <option value="">Nada (só aviso ou cupom)</option>
                      {b.produto && <option value={`p:${b.produto}`}>O item: {produtoPorId.get(b.produto)?.nome ?? "fora do cardápio"}</option>}
                      {config.marcas.map((m) => <option key={m.id} value={`m:${m.id}`}>A marca {m.nome}</option>)}
                    </select>
                  </label>
                  {fotos.length > 0 && (
                    <label className={s.campo}>Ou use uma foto do cardápio
                      <select value="" onChange={(e) => e.target.value && mudarBanner(i, { imagem: e.target.value })}>
                        <option value="">Escolher…</option>
                        {fotos.map((p) => <option key={p.id} value={p.foto!}>{p.nome}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            ))}
          </section>

          <section className={s.bloco}>
            <h2>5. Aparência da página</h2>
            <label className={s.campo}>Nome que aparece no topo
              <input value={config.nome} maxLength={40} onChange={(e) => mudar({ ...config, nome: e.target.value })} />
            </label>
            <label className={s.campo}>Frase (opcional)
              <input value={config.frase} maxLength={120} placeholder="Ex.: Cinco marcas, uma cozinha. Peça de todas numa sacola só." onChange={(e) => mudar({ ...config, frase: e.target.value })} />
            </label>
            <div className={s.campo}>Cor dos botões
              <div className={s.cores}>
                {CORES.map((c) => <button key={c} className={c === config.cor ? s.corAtiva : s.cor} style={{ background: c }} onClick={() => mudar({ ...config, cor: c })} aria-label={c} />)}
              </div>
            </div>
          </section>
        </div>

        <aside className={s.previa} aria-label="Como o cliente vê">
          <span className={s.rotulo}>Como o cliente vê</span>
          <div className={s.telefone}>
            <Vitrine config={previa.config} produtos={previa.produtos} embutida />
          </div>
        </aside>
      </div>

      <div className={`${s.salvar} ${mudou ? s.salvarVisivel : ""}`}>
        <span>{mudou ? "Você tem mudanças sem salvar." : "Tudo salvo."}</span>
        <button className={s.botaoSalvar} onClick={salvar} disabled={!mudou || salvando}>{salvando ? "Salvando…" : "Salvar a página"}</button>
      </div>
    </div>
  );
}

