"use client";
/**
 * Aba Cardápio — os três cenários da homologação do módulo Catalog.
 *
 * A tela é o que o iFood avalia. Eles não olham o back-end e recusam
 * explicitamente Postman, curl e dashboard de BI: o que vale é a interface
 * funcional gerando requisições reais.
 *
 * Daí o painel de chamadas à direita. Ele mostra método, caminho e status HTTP
 * de cada requisição no instante em que acontece — é a prova, dentro do próprio
 * vídeo, de que o botão disparou a API e não uma simulação. E os status são
 * conferidos um a um pelo analista.
 *
 * Os nomes "Teste Homologação" e "Produto Teste" já vêm preenchidos porque o
 * roteiro do iFood pede exatamente esses, com essa grafia.
 */
import React, { useState, useRef } from "react";
import { Loader, Plus, RefreshCw, Image as ImageIcon, Pause, Play, Tag, Check } from "lucide-react";

// ── paleta usada no resto da tela ──────────────────────────
const LARANJA = "#E8360C";
const VERDE = "#16A34A";
const TINTA = "#0F172A";
const CINZA = "#64748B";
const LINHA = "#E2E8F0";

type Chamada = {
  hora: string;
  metodo: string;
  endpoint: string;
  status: number;
  ok: boolean;
  origem?: string | null;
};

const agora = () => new Date().toLocaleTimeString("pt-BR");

const corDoStatus = (s: number) =>
  s >= 200 && s < 300 ? VERDE : s >= 400 && s < 500 ? "#D97706" : "#DC2626";

export default function TabCardapio() {
  const [chamadas, setChamadas] = useState<Chamada[]>([]);
  const registrar = (c: Omit<Chamada, "hora">) =>
    setChamadas((antes) => [{ ...c, hora: agora() }, ...antes].slice(0, 40));

  // ── estado do cenário 1 ──
  const [categorias, setCategorias] = useState<any[]>([]);
  const [catalogos, setCatalogos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const [nomeCategoria, setNomeCategoria] = useState("Teste Homologação");
  const [categoriaId, setCategoriaId] = useState("");

  const [nomeItem, setNomeItem] = useState("Produto Teste");
  const [descItem, setDescItem] = useState("Item criado para a homologação do módulo Catalog.");
  const [precoItem, setPrecoItem] = useState("29.90");
  const [fotoItem, setFotoItem] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  // ── estado do cenário 2 ──
  const [nomeGrupo, setNomeGrupo] = useState("Escolha a bebida");
  const [comp1, setComp1] = useState({ nome: "Refrigerante lata", preco: "8.00", foto: null as string | null });
  const [comp2, setComp2] = useState({ nome: "Suco natural", preco: "12.00", foto: null as string | null });

  // ── o que foi criado (alimenta o cenário 3) ──
  const [criado, setCriado] = useState<{
    itemId: string;
    productId: string;
    grupos: { id: string; nome: string; complementos: { id: string; productId: string; nome: string }[] }[];
  } | null>(null);

  const [salvando, setSalvando] = useState(false);

  // ── helper de requisição ────────────────────────────────
  async function chamar(metodo: string, url: string, corpo?: any) {
    setErro("");
    // ?distribuido=1 trava a cascata no app distribuído: o vídeo não pode
    // gravar uma chamada que saiu, por fallback, pelo aplicativo antigo.
    const separador = url.includes("?") ? "&" : "?";
    const r = await fetch(`${url}${separador}distribuido=1`, {
      method: metodo,
      ...(corpo ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {}),
    });
    const d = await r.json().catch(() => ({}));
    registrar({
      metodo,
      endpoint: d?.endpoint ?? url.replace("/api/ifood", ""),
      status: d?.ifood?.status ?? r.status,
      ok: r.ok,
      origem: d?.ifood?.origem,
    });
    if (!r.ok) throw new Error(d?.error || "Falha na chamada ao iFood.");
    return d;
  }

  // ── cenário 1 ───────────────────────────────────────────
  async function carregarCardapio() {
    setCarregando(true);
    try {
      const d = await chamar("GET", "/api/ifood/catalog?itens=1");
      setCatalogos(d.catalogos ?? []);
      setCategorias(d.categorias ?? []);
      if (!categoriaId && d.categorias?.[0]?.id) setCategoriaId(d.categorias[0].id);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  async function criarCategoria() {
    setSalvando(true);
    try {
      const d = await chamar("POST", "/api/ifood/catalog/categoria", { nome: nomeCategoria });
      const nova = d.categoria ?? d.data;
      if (nova?.id) setCategoriaId(nova.id);
      await carregarCardapio();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function subirFoto(arquivo: File): Promise<string | null> {
    setEnviandoFoto(true);
    try {
      const dataUri = await new Promise<string>((ok, falhou) => {
        const leitor = new FileReader();
        leitor.onload = () => ok(String(leitor.result));
        leitor.onerror = () => falhou(new Error("Não foi possível ler a imagem."));
        leitor.readAsDataURL(arquivo);
      });
      const d = await chamar("POST", "/api/ifood/catalog/imagem", { imagem: dataUri });
      return d.imagePath ?? null;
    } catch (e: any) {
      setErro(e.message);
      return null;
    } finally {
      setEnviandoFoto(false);
    }
  }

  // ── cenários 1 e 2 juntos: um PUT carrega item, grupo e complementos ──
  async function salvarItemCompleto() {
    setSalvando(true);
    try {
      const d = await chamar("PUT", "/api/ifood/catalog/item", {
        ...(criado?.itemId ? { id: criado.itemId, productId: criado.productId } : {}),
        categoryId: categoriaId,
        nome: nomeItem,
        descricao: descItem,
        preco: Number(precoItem.replace(",", ".")),
        status: "AVAILABLE",
        imagePath: fotoItem,
        grupos: nomeGrupo
          ? [{
              ...(criado?.grupos?.[0]?.id ? { id: criado.grupos[0].id } : {}),
              nome: nomeGrupo,
              min: 0,
              max: 1,
              complementos: [
                {
                  ...(criado?.grupos?.[0]?.complementos?.[0]
                    ? { id: criado.grupos[0].complementos[0].id, productId: criado.grupos[0].complementos[0].productId }
                    : {}),
                  nome: comp1.nome,
                  preco: Number(comp1.preco.replace(",", ".")),
                  status: "AVAILABLE",
                  imagePath: comp1.foto,
                },
                {
                  ...(criado?.grupos?.[0]?.complementos?.[1]
                    ? { id: criado.grupos[0].complementos[1].id, productId: criado.grupos[0].complementos[1].productId }
                    : {}),
                  nome: comp2.nome,
                  preco: Number(comp2.preco.replace(",", ".")),
                  status: "AVAILABLE",
                  imagePath: comp2.foto,
                },
              ],
            }]
          : [],
      });
      if (d.ids) setCriado(d.ids);
      await carregarCardapio();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  // ── cenário 3: preço e pausa, obrigatoriamente por PATCH ──
  async function patchPrecoItem(novo: string) {
    if (!criado?.itemId) return;
    try {
      await chamar("PATCH", "/api/ifood/catalog/preco", {
        itemId: criado.itemId,
        preco: Number(novo.replace(",", ".")),
      });
    } catch (e: any) { setErro(e.message); }
  }

  async function patchStatusItem(status: "AVAILABLE" | "UNAVAILABLE") {
    if (!criado?.itemId) return;
    try {
      await chamar("PATCH", "/api/ifood/catalog/status", { itemId: criado.itemId, status });
    } catch (e: any) { setErro(e.message); }
  }

  async function patchPrecoComplemento(indice: number, novo: string) {
    const opt = criado?.grupos?.[0]?.complementos?.[indice];
    if (!opt) return;
    try {
      await chamar("PATCH", "/api/ifood/catalog/preco", {
        optionId: opt.id,
        preco: Number(novo.replace(",", ".")),
      });
    } catch (e: any) { setErro(e.message); }
  }

  async function patchStatusComplemento(indice: number, status: "AVAILABLE" | "UNAVAILABLE") {
    const opt = criado?.grupos?.[0]?.complementos?.[indice];
    if (!opt) return;
    try {
      await chamar("PATCH", "/api/ifood/catalog/status", { optionId: opt.id, status });
    } catch (e: any) { setErro(e.message); }
  }

  // ── pedaços visuais ─────────────────────────────────────
  const cartao: React.CSSProperties = {
    background: "#fff", border: `1.5px solid ${LINHA}`, borderRadius: 14,
    padding: "1.1rem 1.25rem", marginBottom: "1rem",
  };
  const rotulo: React.CSSProperties = {
    display: "block", fontSize: "0.72rem", fontWeight: 700, color: CINZA,
    textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5,
  };
  const campo: React.CSSProperties = {
    width: "100%", padding: "9px 11px", border: `1.5px solid ${LINHA}`,
    borderRadius: 9, fontSize: "0.88rem", fontFamily: "inherit", color: TINTA,
  };
  const botao = (cor: string, ativo = true): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 15px",
    background: ativo ? cor : "#CBD5E1", color: "#fff", border: "none",
    borderRadius: 9, fontWeight: 800, fontSize: "0.84rem",
    cursor: ativo ? "pointer" : "not-allowed", fontFamily: "inherit",
  });

  function CampoFoto({ valor, aoEnviar }: { valor: string | null; aoEnviar: (p: string | null) => void }) {
    const ref = useRef<HTMLInputElement>(null);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <input
          ref={ref} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) aoEnviar(await subirFoto(f));
          }}
        />
        <button type="button" onClick={() => ref.current?.click()} disabled={enviandoFoto}
          style={{ ...botao("#475569", !enviandoFoto), padding: "8px 12px", fontSize: "0.8rem" }}>
          {enviandoFoto ? <Loader size={13} className="spin" /> : <ImageIcon size={13} />}
          {valor ? "Trocar foto" : "Enviar foto"}
        </button>
        {valor && (
          <span style={{ fontSize: "0.72rem", color: VERDE, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Check size={12} /> enviada
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: "1.1rem", alignItems: "start" }}>
      {/* ── coluna dos cenários ── */}
      <div>
        {erro && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", color: "#991B1B",
            borderRadius: 10, padding: "10px 13px", marginBottom: "1rem", fontSize: "0.85rem" }}>
            {erro}
          </div>
        )}

        {/* Cenário 1 */}
        <div style={cartao}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.9rem", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: TINTA }}>
              Cenário 1 — Categoria e item
            </h3>
            <button onClick={carregarCardapio} disabled={carregando} style={{ ...botao("#475569", !carregando), padding: "7px 12px", fontSize: "0.8rem" }}>
              {carregando ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />} Carregar cardápio
            </button>
          </div>

          {catalogos.length > 0 && (
            <p style={{ margin: "0 0 0.85rem", fontSize: "0.78rem", color: CINZA }}>
              {catalogos.length} catálogo(s) · {categorias.length} categoria(s) no iFood
            </p>
          )}

          <div style={{ display: "flex", gap: 9, alignItems: "flex-end", marginBottom: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={rotulo}>Nome da categoria</label>
              <input style={campo} value={nomeCategoria} onChange={(e) => setNomeCategoria(e.target.value)} />
            </div>
            <button onClick={criarCategoria} disabled={salvando} style={botao(LARANJA, !salvando)}>
              <Plus size={14} /> Criar categoria
            </button>
          </div>

          <div style={{ borderTop: `1px solid ${LINHA}`, paddingTop: "0.9rem", display: "grid", gap: "0.75rem" }}>
            <div>
              <label style={rotulo}>Categoria do item</label>
              <select style={campo} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Escolha…</option>
                {categorias.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={rotulo}>Nome do item</label>
                <input style={campo} value={nomeItem} onChange={(e) => setNomeItem(e.target.value)} />
              </div>
              <div>
                <label style={rotulo}>Preço (R$)</label>
                <input style={campo} value={precoItem} onChange={(e) => setPrecoItem(e.target.value)} inputMode="decimal" />
              </div>
            </div>
            <div>
              <label style={rotulo}>Descrição</label>
              <input style={campo} value={descItem} onChange={(e) => setDescItem(e.target.value)} />
            </div>
            <div>
              <label style={rotulo}>Foto do item</label>
              <CampoFoto valor={fotoItem} aoEnviar={setFotoItem} />
            </div>
          </div>
        </div>

        {/* Cenário 2 */}
        <div style={cartao}>
          <h3 style={{ margin: "0 0 0.9rem", fontSize: "1rem", fontWeight: 800, color: TINTA }}>
            Cenário 2 — Grupo de complementos
          </h3>
          <div style={{ marginBottom: "0.85rem" }}>
            <label style={rotulo}>Nome do grupo</label>
            <input style={campo} value={nomeGrupo} onChange={(e) => setNomeGrupo(e.target.value)} />
          </div>

          {[
            { c: comp1, set: setComp1, n: "Primeiro complemento" },
            { c: comp2, set: setComp2, n: "Segundo complemento" },
          ].map(({ c, set, n }, i) => (
            <div key={i} style={{ border: `1px solid ${LINHA}`, borderRadius: 10, padding: "0.75rem", marginBottom: "0.6rem" }}>
              <p style={{ margin: "0 0 0.6rem", fontSize: "0.78rem", fontWeight: 800, color: CINZA }}>{n}</p>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.6rem", marginBottom: "0.6rem" }}>
                <input style={campo} value={c.nome} placeholder="Nome"
                  onChange={(e) => set({ ...c, nome: e.target.value })} />
                <input style={campo} value={c.preco} placeholder="Preço" inputMode="decimal"
                  onChange={(e) => set({ ...c, preco: e.target.value })} />
              </div>
              <CampoFoto valor={c.foto} aoEnviar={(p) => set({ ...c, foto: p })} />
            </div>
          ))}

          <button onClick={salvarItemCompleto} disabled={salvando || !categoriaId} style={botao(VERDE, !salvando && !!categoriaId)}>
            {salvando ? <Loader size={14} className="spin" /> : <Plus size={14} />}
            {criado ? "Regravar item com complementos" : "Criar item com complementos"}
          </button>
          <p style={{ margin: "0.6rem 0 0", fontSize: "0.74rem", color: CINZA }}>
            Item, produto, grupo e complementos vão numa única chamada <code>PUT /items</code>.
          </p>
        </div>

        {/* Cenário 3 */}
        <div style={{ ...cartao, opacity: criado ? 1 : 0.5 }}>
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem", fontWeight: 800, color: TINTA }}>
            Cenário 3 — Alterar preço e pausar
          </h3>
          <p style={{ margin: "0 0 0.9rem", fontSize: "0.78rem", color: CINZA }}>
            Preço e pausa saem por <strong>PATCH</strong>, como o iFood exige — nunca reenviando o item.
          </p>

          {!criado ? (
            <p style={{ margin: 0, fontSize: "0.82rem", color: CINZA }}>Crie o item nos cenários acima para liberar esta parte.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.8rem" }}>
              <LinhaPatch
                titulo="Item"
                nome={nomeItem}
                aoPreco={(v) => patchPrecoItem(v)}
                aoPausar={() => patchStatusItem("UNAVAILABLE")}
                aoReativar={() => patchStatusItem("AVAILABLE")}
                precoInicial={precoItem}
              />
              {criado.grupos?.[0]?.complementos?.map((c, i) => (
                <LinhaPatch
                  key={c.id}
                  titulo={`Complemento ${i + 1}`}
                  nome={c.nome}
                  aoPreco={(v) => patchPrecoComplemento(i, v)}
                  aoPausar={() => patchStatusComplemento(i, "UNAVAILABLE")}
                  aoReativar={() => patchStatusComplemento(i, "AVAILABLE")}
                  precoInicial={i === 0 ? comp1.preco : comp2.preco}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── painel de chamadas ── */}
      <div style={{ ...cartao, position: "sticky", top: 12, marginBottom: 0 }}>
        <h4 style={{ margin: "0 0 0.3rem", fontSize: "0.88rem", fontWeight: 800, color: TINTA }}>
          Chamadas ao iFood
        </h4>
        <p style={{ margin: "0 0 0.8rem", fontSize: "0.72rem", color: CINZA, lineHeight: 1.4 }}>
          Cada ação da tela aparece aqui com o status devolvido pela API.
        </p>

        {chamadas.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: CINZA }}>Nenhuma chamada ainda.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 460, overflowY: "auto" }}>
            {chamadas.map((c, i) => (
              <div key={i} style={{ border: `1px solid ${LINHA}`, borderRadius: 8, padding: "7px 9px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 700, color: CINZA }}>
                    {c.metodo}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.76rem", fontWeight: 800, color: corDoStatus(c.status) }}>
                    {c.status}
                  </span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: TINTA, wordBreak: "break-all", marginTop: 2 }}>
                  {c.endpoint}
                </div>
                <div style={{ fontSize: "0.65rem", color: CINZA, marginTop: 2 }}>
                  {c.hora}{c.origem ? ` · app ${c.origem}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Uma linha do cenário 3: novo preço, pausar e reativar. */
function LinhaPatch({
  titulo, nome, precoInicial, aoPreco, aoPausar, aoReativar,
}: {
  titulo: string; nome: string; precoInicial: string;
  aoPreco: (v: string) => void; aoPausar: () => void; aoReativar: () => void;
}) {
  const [novo, setNovo] = useState(precoInicial);
  return (
    <div style={{ border: `1px solid ${LINHA}`, borderRadius: 10, padding: "0.75rem" }}>
      <p style={{ margin: "0 0 0.55rem", fontSize: "0.8rem", fontWeight: 800, color: TINTA }}>
        {titulo} <span style={{ fontWeight: 500, color: CINZA }}>· {nome}</span>
      </p>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={novo} onChange={(e) => setNovo(e.target.value)} inputMode="decimal"
          style={{ width: 92, padding: "7px 9px", border: `1.5px solid ${LINHA}`, borderRadius: 8, fontSize: "0.83rem", fontFamily: "inherit" }}
        />
        <button onClick={() => aoPreco(novo)}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 11px", background: "#0EA5E9", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
          <Tag size={12} /> Novo preço
        </button>
        <button onClick={aoPausar}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 11px", background: "#D97706", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
          <Pause size={12} /> Pausar
        </button>
        <button onClick={aoReativar}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 11px", background: VERDE, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
          <Play size={12} /> Reativar
        </button>
      </div>
    </div>
  );
}
