"use client";

/**
 * "Tela do tablet" na aba Tablet na mesa: o dono monta os banners do topo e os
 * "Recomendados pela casa" vendo o tablet de verdade ao lado — a prévia
 * (/tablet/previa) numa moldura, que recebe o rascunho a cada mudança por
 * postMessage. Salvo, os tablets pegam no próximo sinal (20 s), sem recarregar.
 * Nada escolhido = automático (os produtos marcados como Destaque).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Monitor, Plus, Smartphone, Trash2, X } from "lucide-react";
import { MAXIMO_DE_BANNERS, MAXIMO_DE_RECOMENDADOS, type BannerDoTablet, type VitrineDoTablet } from "@/lib/tablet-da-mesa/vitrine";

type Produto = { id: string; name: string; imageUrl: string | null; category: string | null; price: number };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const TAMANHOS = { deitado: { w: 1280, h: 800 }, empe: { w: 800, h: 1280 } } as const;

function mover<T>(lista: T[], i: number, para: number): T[] {
  if (para < 0 || para >= lista.length) return lista;
  const nova = [...lista];
  const [x] = nova.splice(i, 1);
  nova.splice(para, 0, x);
  return nova;
}

export default function EditorDaTelaDoTablet({ onAviso }: { onAviso: (a: { tipo: "ok" | "erro"; texto: string }) => void }) {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [salva, setSalva] = useState<VitrineDoTablet | null>(null);
  const [rascunho, setRascunho] = useState<VitrineDoTablet | null>(null);
  const [aba, setAba] = useState<"banners" | "recomendados">("banners");
  const [foco, setFoco] = useState<number | null>(null);
  const [posicao, setPosicao] = useState<keyof typeof TAMANHOS>("deitado");
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null);
  const moldura = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch("/api/store/tablet-na-mesa/vitrine", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { setProdutos(j.produtos || []); setSalva(j.vitrine); setRascunho(j.vitrine); })
      .catch(() => onAviso({ tipo: "erro", texto: "Não deu para carregar a tela do tablet." }));
  }, [onAviso]);

  // A prévia recebe o rascunho a cada mudança, e de novo quando termina de abrir.
  const mandarParaAPrevia = useCallback(() => {
    if (!rascunho) return;
    moldura.current?.contentWindow?.postMessage(
      { tipo: "fh-vitrine-do-tablet", vitrine: rascunho, foco: aba === "banners" ? foco : null },
      window.location.origin,
    );
  }, [rascunho, foco, aba]);
  useEffect(() => { mandarParaAPrevia(); }, [mandarParaAPrevia]);
  useEffect(() => {
    const ouvir = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.tipo === "fh-previa-do-tablet-pronta") mandarParaAPrevia();
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, [mandarParaAPrevia]);

  // A moldura tem o tamanho de um tablet de verdade, encolhida para caber.
  const caixa = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.5);
  const tam = TAMANHOS[posicao];
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setEscala(Math.min(1, (el.clientWidth - 24) / tam.w, posicao === "empe" ? 720 / tam.h : 1));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tam.w, tam.h, posicao]);

  if (!produtos || !rascunho || !salva) return <section style={S.cartao}><p style={{ color: "#64748B", margin: 0 }}>Carregando a tela do tablet…</p></section>;

  const porId = new Map(produtos.map((p) => [p.id, p]));
  const mudou = JSON.stringify(rascunho) !== JSON.stringify(salva);
  const banners = rascunho.banners;
  const mudarBanners = (b: BannerDoTablet[]) => setRascunho({ ...rascunho, banners: b });
  const mudarBanner = (i: number, parte: Partial<BannerDoTablet>) => mudarBanners(banners.map((b, k) => (k === i ? { ...b, ...parte } : b)));
  const categorias = [...new Set(produtos.map((p) => p.category || "Outros"))];
  const opcoesDeProduto = categorias.map((c) => (
    <optgroup key={c} label={c}>
      {produtos.filter((p) => (p.category || "Outros") === c).map((p) => <option key={p.id} value={p.id}>{p.name} — {reais(p.price)}</option>)}
    </optgroup>
  ));

  async function enviarFoto(i: number, arquivo: File) {
    const id = banners[i].id;
    setEnviandoFoto(id);
    try {
      const fd = new FormData();
      fd.append("file", arquivo);
      const r = await fetch("/api/upload-store-image", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error || "A foto não subiu.");
      setRascunho((v) => v && { ...v, banners: v.banners.map((b) => (b.id === id ? { ...b, imagem: j.url } : b)) });
    } catch (e: any) {
      onAviso({ tipo: "erro", texto: e.message });
    } finally {
      setEnviandoFoto(null);
    }
  }

  function novoBanner() {
    const n: BannerDoTablet = { id: `b${Date.now().toString(36)}`, imagem: null, chapeu: "Destaque da casa", titulo: "", texto: "", produtoId: null };
    mudarBanners([...banners, n]);
    setFoco(banners.length);
  }

  async function salvar() {
    // Banner sem foto e sem produto não tem o que mostrar: avisa em vez de sumir com ele.
    const vazio = banners.findIndex((b) => !b.imagem && !b.produtoId);
    if (vazio >= 0) {
      setAba("banners"); setFoco(vazio);
      onAviso({ tipo: "erro", texto: `O banner ${vazio + 1} está sem foto e sem produto. Envie uma foto ou escolha o produto.` });
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch("/api/store/tablet-na-mesa/vitrine", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rascunho) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não deu para salvar.");
      setSalva(j.vitrine);
      setRascunho(j.vitrine);
      onAviso({ tipo: "ok", texto: "Salvo! Os tablets das mesas mudam em até 20 segundos." });
    } catch (e: any) {
      onAviso({ tipo: "erro", texto: e.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section style={S.cartao}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Tela do tablet</h2>
          <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: 14 }}>Monte o que o cliente vê na mesa. A prévia muda na hora; os tablets recebem quando você salvar.</p>
        </div>
        <div style={S.seletor}>
          <button type="button" style={posicao === "deitado" ? S.seletorAtivo : S.seletorBotao} onClick={() => setPosicao("deitado")}><Monitor size={15} /> Deitado</button>
          <button type="button" style={posicao === "empe" ? S.seletorAtivo : S.seletorBotao} onClick={() => setPosicao("empe")}><Smartphone size={15} /> Em pé</button>
        </div>
      </div>

      <div style={S.grade}>
        {/* EDITOR */}
        <div style={S.editor}>
          <div style={S.abas}>
            <button type="button" style={aba === "banners" ? S.abaAtiva : S.aba} onClick={() => setAba("banners")}>Banners do topo ({banners.length})</button>
            <button type="button" style={aba === "recomendados" ? S.abaAtiva : S.aba} onClick={() => setAba("recomendados")}>Recomendados ({rascunho.recomendados.length})</button>
          </div>

          {aba === "banners" ? (
            <div style={{ display: "grid", gap: 10 }}>
              {banners.length === 0 && (
                <div style={S.auto}><b>Automático.</b> Sem banner seu, o tablet passa os produtos marcados como <b>⭐ Destaque</b> no cardápio. Adicione um banner para escolher a foto e o texto.</div>
              )}
              {banners.map((b, i) => {
                const produto = b.produtoId ? porId.get(b.produtoId) : undefined;
                const foto = b.imagem || produto?.imageUrl || null;
                const ativo = foco === i;
                return (
                  <div key={b.id} style={{ ...S.item, borderColor: ativo ? "#EA580C" : "#E9E3DC", boxShadow: ativo ? "0 0 0 3px rgba(234,88,12,.15)" : "none" }} onFocusCapture={() => setFoco(i)} onClick={() => setFoco(i)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <b style={{ flex: 1, fontSize: 14 }}>Banner {i + 1}</b>
                      <button type="button" style={S.mini} aria-label="Subir" onClick={() => { mudarBanners(mover(banners, i, i - 1)); setFoco(i - 1); }} disabled={i === 0}><ArrowUp size={15} /></button>
                      <button type="button" style={S.mini} aria-label="Descer" onClick={() => { mudarBanners(mover(banners, i, i + 1)); setFoco(i + 1); }} disabled={i === banners.length - 1}><ArrowDown size={15} /></button>
                      <button type="button" style={{ ...S.mini, color: "#B91C1C" }} aria-label="Apagar banner" onClick={() => { mudarBanners(banners.filter((_, k) => k !== i)); setFoco(null); }}><Trash2 size={15} /></button>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                      <label style={{ ...S.foto, backgroundImage: foto ? `url("${foto}")` : undefined }} title="Trocar a foto do banner">
                        {!foto && <ImagePlus size={22} color="#9A8F86" />}
                        <span style={S.fotoRotulo}>{enviandoFoto === b.id ? "Enviando…" : b.imagem ? "Trocar foto" : "Enviar foto"}</span>
                        <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarFoto(i, f); e.target.value = ""; }} />
                      </label>
                      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                        <select style={S.campo} value={b.produtoId || ""} onChange={(e) => mudarBanner(i, { produtoId: e.target.value || null })}>
                          <option value="">Sem produto (só a imagem)</option>
                          {opcoesDeProduto}
                        </select>
                        <input style={S.campo} maxLength={30} placeholder="Etiqueta (ex.: Novidade)" value={b.chapeu} onChange={(e) => mudarBanner(i, { chapeu: e.target.value })} />
                      </div>
                    </div>
                    <input style={{ ...S.campo, marginTop: 6, fontWeight: 800 }} maxLength={60} placeholder={produto ? `Título (vazio = ${produto.name})` : "Título do banner"} value={b.titulo} onChange={(e) => mudarBanner(i, { titulo: e.target.value })} />
                    <input style={{ ...S.campo, marginTop: 6 }} maxLength={140} placeholder={produto ? "Texto (vazio = descrição do produto)" : "Texto curto (opcional)"} value={b.texto} onChange={(e) => mudarBanner(i, { texto: e.target.value })} />
                    {b.imagem && produto?.imageUrl && (
                      <button type="button" style={S.link} onClick={() => mudarBanner(i, { imagem: null })}>Usar a foto do produto</button>
                    )}
                    {!foto && <div style={{ fontSize: 12.5, color: "#B45309", marginTop: 6 }}>Envie uma foto ou escolha um produto com foto.</div>}
                  </div>
                );
              })}
              <button type="button" style={{ ...S.adicionar, opacity: banners.length >= MAXIMO_DE_BANNERS ? 0.5 : 1 }} disabled={banners.length >= MAXIMO_DE_BANNERS} onClick={novoBanner}>
                <Plus size={16} /> Adicionar banner {banners.length >= MAXIMO_DE_BANNERS ? `(máximo ${MAXIMO_DE_BANNERS})` : ""}
              </button>
              <div style={{ fontSize: 12.5, color: "#78716C" }}>Foto deitada fica melhor (por exemplo 1600 × 900). O texto aparece à esquerda, por cima da foto.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {rascunho.recomendados.length === 0 && (
                <div style={S.auto}><b>Automático.</b> Sem escolha sua, a fileira mostra os <b>⭐ Destaques</b> e as ofertas do cardápio.</div>
              )}
              {rascunho.recomendados.map((id, i) => {
                const p = porId.get(id);
                return (
                  <div key={id} style={S.linhaProduto}>
                    <span style={{ ...S.miniFoto, backgroundImage: p?.imageUrl ? `url("${p.imageUrl}")` : undefined }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p?.name || "Produto fora do cardápio"}</div>
                      {p && <div style={{ fontSize: 12.5, color: "#64748B" }}>{reais(p.price)}</div>}
                    </div>
                    <button type="button" style={S.mini} aria-label="Subir" disabled={i === 0} onClick={() => setRascunho({ ...rascunho, recomendados: mover(rascunho.recomendados, i, i - 1) })}><ArrowUp size={15} /></button>
                    <button type="button" style={S.mini} aria-label="Descer" disabled={i === rascunho.recomendados.length - 1} onClick={() => setRascunho({ ...rascunho, recomendados: mover(rascunho.recomendados, i, i + 1) })}><ArrowDown size={15} /></button>
                    <button type="button" style={{ ...S.mini, color: "#B91C1C" }} aria-label="Tirar" onClick={() => setRascunho({ ...rascunho, recomendados: rascunho.recomendados.filter((x) => x !== id) })}><X size={15} /></button>
                  </div>
                );
              })}
              {rascunho.recomendados.length < MAXIMO_DE_RECOMENDADOS && (
                <select style={{ ...S.campo, height: 44, fontWeight: 700, color: "#EA580C" }} value="" onChange={(e) => { if (e.target.value) setRascunho({ ...rascunho, recomendados: [...rascunho.recomendados, e.target.value] }); }}>
                  <option value="">+ Adicionar produto aos recomendados</option>
                  {categorias.map((c) => (
                    <optgroup key={c} label={c}>
                      {produtos.filter((p) => (p.category || "Outros") === c && !rascunho.recomendados.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} — {reais(p.price)}</option>)}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
          )}

          <div style={S.rodape}>
            <span style={{ fontSize: 13, color: mudou ? "#B45309" : "#15803D", fontWeight: 700, flex: 1 }}>{mudou ? "Alterações ainda não salvas" : "Os tablets estão com esta tela"}</span>
            {mudou && <button type="button" style={S.botaoLeve} onClick={() => { setRascunho(salva); setFoco(null); }} disabled={salvando}>Desfazer</button>}
            <button type="button" style={{ ...S.cta, opacity: !mudou || salvando ? 0.5 : 1 }} disabled={!mudou || salvando} onClick={() => void salvar()}>
              {salvando ? "Salvando…" : "Salvar nos tablets"}
            </button>
          </div>
        </div>

        {/* PRÉVIA */}
        <div ref={caixa} style={{ flex: "999 1 480px", minWidth: 0, position: "sticky", top: 12 }}>
          <div style={{ ...S.aparelho, width: tam.w * escala + 24, height: tam.h * escala + 24 }}>
            <div style={{ width: tam.w * escala, height: tam.h * escala, overflow: "hidden", borderRadius: 12, background: "#120D0A" }}>
              <iframe
                ref={moldura}
                src="/tablet/previa"
                title="Prévia do tablet"
                onLoad={mandarParaAPrevia}
                style={{ width: tam.w, height: tam.h, border: 0, transform: `scale(${escala})`, transformOrigin: "0 0", display: "block" }}
              />
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "#78716C", marginTop: 8, textAlign: "center" }}>É o tablet de verdade: dá para tocar, abrir produto e montar a sacola. Daqui nenhum pedido é enviado.</div>
        </div>
      </div>
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  cartao: { marginTop: 16, padding: 18, borderRadius: 18, background: "#fff", border: "1px solid #E9E3DC" },
  grade: { display: "flex", flexWrap: "wrap", gap: 18, marginTop: 16, alignItems: "flex-start" },
  editor: { flex: "1 1 340px", maxWidth: 440, minWidth: 0, display: "grid", gap: 12, alignContent: "start" },
  abas: { display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "#F5F1ED" },
  aba: { flex: 1, height: 38, border: 0, borderRadius: 9, background: "transparent", color: "#57524C", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  abaAtiva: { flex: 1, height: 38, border: 0, borderRadius: 9, background: "#fff", color: "#15120F", fontWeight: 800, fontSize: 13.5, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,.08)" },
  auto: { padding: 12, borderRadius: 12, background: "#FFF7ED", border: "1px solid #FED7AA", fontSize: 13.5, color: "#7C2D12", lineHeight: 1.5 },
  item: { padding: 12, borderRadius: 14, border: "1.5px solid #E9E3DC", background: "#FCFBFA", cursor: "default" },
  mini: { width: 32, height: 32, borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#475569", display: "grid", placeItems: "center", cursor: "pointer" },
  foto: { position: "relative", width: 120, height: 80, flexShrink: 0, borderRadius: 10, border: "1px dashed #CFC6BD", background: "#F5F1ED center/cover no-repeat", display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden" },
  fotoRotulo: { position: "absolute", left: 0, right: 0, bottom: 0, padding: "3px 0", background: "rgba(15,12,9,.65)", color: "#fff", fontSize: 11.5, fontWeight: 700, textAlign: "center" },
  campo: { width: "100%", height: 38, borderRadius: 10, border: "1px solid #D6D3D1", padding: "0 10px", fontSize: 14, background: "#fff", boxSizing: "border-box", minWidth: 0 },
  link: { marginTop: 6, padding: 0, border: 0, background: "none", color: "#EA580C", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  adicionar: { height: 44, borderRadius: 12, border: "1.5px dashed #FDBA74", background: "#FFF7ED", color: "#C2410C", fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer" },
  linhaProduto: { display: "flex", alignItems: "center", gap: 8, padding: 8, borderRadius: 12, border: "1px solid #E9E3DC", background: "#FCFBFA" },
  miniFoto: { width: 44, height: 44, borderRadius: 10, flexShrink: 0, background: "#F5F1ED center/cover no-repeat" },
  rodape: { position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "12px 0 4px", background: "#fff", borderTop: "1px solid #F1EDE9" },
  cta: { display: "inline-flex", alignItems: "center", gap: 6, height: 44, padding: "0 18px", border: 0, borderRadius: 12, background: "#EA580C", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  botaoLeve: { height: 40, padding: "0 14px", borderRadius: 10, border: "1px solid #D6D3D1", background: "#fff", color: "#57524C", fontWeight: 700, cursor: "pointer" },
  seletor: { display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "#F5F1ED" },
  seletorBotao: { display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", border: 0, borderRadius: 9, background: "transparent", color: "#57524C", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  seletorAtivo: { display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", border: 0, borderRadius: 9, background: "#fff", color: "#15120F", fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,.08)" },
  aparelho: { margin: "0 auto", padding: 12, borderRadius: 26, background: "linear-gradient(160deg,#2A2522,#0D0B0A)", boxShadow: "0 18px 40px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.06)" },
};
