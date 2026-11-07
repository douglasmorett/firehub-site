"use client";

/**
 * Os produtos que a loja COMPRA. Quatro jeitos de cadastrar (anotação do
 * Douglas, 07/11/2026: "cadastro de produtos que ele compra, ou carregar por
 * áudio ou PDF"): digitando, colando a lista, pela foto/PDF da nota ou da
 * lista, e falando. O que a IA entendeu aparece numa lista para o lojista
 * conferir e mexer ANTES de gravar.
 *
 * Ligar ao insumo do estoque é o que faz o "precisa comprar" e a entrada no
 * estoque ao receber; quando a unidade de compra é outra (cx × un), o fator
 * diz quantas unidades vêm na caixa.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lerListaDeProdutos, UNIDADES_DE_COMPRA } from "@/lib/cotacao/leitura";
import { fatorDeConversao } from "@/lib/unidades";
import { COR, COR_CLARA, Janela, S, VERMELHO, arquivoEmBase64, fotoReduzida, numero, pedir, type Aviso } from "./ui";

type Insumo = { id: string; name: string; unit: string; quantity: number; minQuantity: number | null };
type Produto = {
  id: string; nome: string; categoria: string | null; unidade: string; quantidadePadrao: number | null; stockItemId: string | null;
  fatorDoInsumo: number | null; apelidos: string[]; ativo: boolean; insumo: { id: string; name: string; quantity: number; minQuantity: number | null; unit: string } | null;
};
type Lido = { nome: string; unidade: string; quantidade: number | null; categoria: string | null; stockItemId?: string | null; jaCadastrado?: boolean; marcado?: boolean };

const NOME_DA_UNIDADE: Record<string, string> = { un: "unidade", kg: "kg", g: "g", cx: "caixa", fd: "fardo", pct: "pacote", dz: "dúzia", l: "litro", ml: "ml", sc: "saco", bd: "bandeja", gf: "garrafa", lt: "lata" };
const precisaDeFator = (unidade: string, insumo: { unit: string } | null | undefined) => !!insumo && fatorDeConversao(unidade, insumo.unit) === null;

export default function Produtos({ onAviso, onMudou }: { onAviso: (a: Aviso) => void; onMudou: () => void }) {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [editando, setEditando] = useState<Produto | "novo" | null>(null);
  const [revisando, setRevisando] = useState<Lido[] | null>(null);
  const [colando, setColando] = useState(false);
  const [lendo, setLendo] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState("");
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const arquivo = useRef<HTMLInputElement | null>(null);

  const carregar = useCallback(async () => {
    try {
      const j = await pedir<{ produtos: Produto[]; insumos: Insumo[] }>("/api/store/cotacao/produtos");
      setProdutos(j.produtos);
      setInsumos(j.insumos);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não carregou os produtos", detalhe: e.message });
    }
  }, [onAviso]);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (produtos || []).filter((p) => !q || p.nome.toLowerCase().includes(q) || (p.categoria || "").toLowerCase().includes(q));
  }, [produtos, busca]);
  const categorias = useMemo(() => [...new Set((produtos || []).map((p) => p.categoria).filter((c): c is string => !!c))].sort(), [produtos]);

  async function lerComIa(corpo: { texto?: string; midia?: { base64: string; mimeType: string } }, oQue: string) {
    setLendo(oQue);
    try {
      const j = await pedir<{ lidos: Lido[] }>("/api/store/cotacao/produtos/ler", "POST", corpo);
      setRevisando(j.lidos.map((l) => ({ ...l, marcado: !l.jaCadastrado })));
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não consegui ler", detalhe: e.message });
    } finally {
      setLendo(null);
    }
  }
  async function escolheuArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type.startsWith("image/")) return lerComIa({ midia: await fotoReduzida(f) }, "a foto");
    if (f.type === "application/pdf") {
      if (f.size > 15 * 1024 * 1024) return onAviso({ tipo: "atencao", titulo: "PDF grande demais (até 15 MB)." });
      return lerComIa({ midia: { base64: await arquivoEmBase64(f), mimeType: "application/pdf" } }, "o PDF");
    }
    onAviso({ tipo: "atencao", titulo: "Mande uma foto ou um PDF." });
  }
  async function gravar() {
    if (gravando) { gravador.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      pedacos.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) pedacos.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const blob = new Blob(pedacos.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        await lerComIa({ midia: { base64: await arquivoEmBase64(blob), mimeType: (rec.mimeType || "audio/webm").split(";")[0] } }, "o áudio");
      };
      gravador.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      onAviso({ tipo: "erro", titulo: "O navegador não liberou o microfone", detalhe: "Permita o microfone no cadeado da barra de endereço." });
    }
  }

  async function apagar(p: Produto) {
    if (!window.confirm(`Apagar ${p.nome}? Os preços dele saem do comparativo.`)) return;
    try {
      const j = await pedir<{ produtos: Produto[] }>(`/api/store/cotacao/produtos?id=${encodeURIComponent(p.id)}`, "DELETE");
      setProdutos(j.produtos);
      onMudou();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para apagar", detalhe: e.message });
    }
  }

  if (!produtos) return <div style={{ ...S.cartao, color: "#64748B" }}>Carregando…</div>;

  return (
    <>
      <section style={{ ...S.cartao }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 240px" }}>
            <h2 style={S.h2}>O que você compra <span style={{ color: "#94A3B8", fontWeight: 700 }}>· {produtos.length}</span></h2>
            <p style={{ ...S.texto, fontSize: 13 }}>É a lista que vai no pedido de cotação e as linhas do comparativo.</p>
          </div>
          <button type="button" style={S.botao} onClick={() => setEditando("novo")}>+ Produto</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 12 }}>
          <button type="button" style={OPCAO} onClick={() => setColando(true)}><span style={{ fontSize: 22 }}>📋</span><b>Colar lista</b><small>do bloco de notas ou do WhatsApp</small></button>
          <button type="button" style={OPCAO} onClick={() => arquivo.current?.click()} disabled={!!lendo}><span style={{ fontSize: 22 }}>📷</span><b>Foto ou PDF</b><small>da nota de compra ou da lista</small></button>
          <button type="button" style={{ ...OPCAO, ...(gravando ? { borderColor: VERMELHO, background: "#FEF2F2" } : {}) }} onClick={gravar} disabled={!!lendo}>
            <span style={{ fontSize: 22 }}>{gravando ? "⏹️" : "🎤"}</span><b>{gravando ? "Parar e ler" : "Falar a lista"}</b><small>{gravando ? "gravando… fale os produtos" : "“tomate, cebola, 10 caixas de coca…”"}</small>
          </button>
          <input ref={arquivo} type="file" accept="image/*,application/pdf" hidden onChange={escolheuArquivo} />
        </div>
        {lendo && <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: COR_CLARA, color: COR, fontWeight: 800 }}>⏳ Lendo {lendo}… isso leva alguns segundos.</div>}
      </section>

      {produtos.length > 0 && (
        <section style={{ ...S.cartao, marginTop: 12, padding: 0, overflow: "hidden" }}>
          {produtos.length > 8 && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar produto" aria-label="Buscar produto" style={{ ...S.campo, height: 40, padding: "0 12px" }} />
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#F8FAFC", color: "#475569", fontSize: 12.5, textAlign: "left" }}>
                  <th style={TH}>Produto</th><th style={TH}>Compra em</th><th style={TH}>Qtd. de costume</th><th style={TH}>No estoque</th><th style={TH} />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid #F1F5F9", opacity: p.ativo ? 1 : 0.55 }}>
                    <td style={TD}>
                      <div style={{ fontWeight: 800, color: "#0F172A" }}>{p.nome}</div>
                      <div style={{ fontSize: 12, color: "#94A3B8" }}>{p.categoria || "sem categoria"}{p.apelidos.length ? ` · também chamado de ${p.apelidos.slice(0, 2).join(", ")}` : ""}</div>
                    </td>
                    <td style={TD}>{NOME_DA_UNIDADE[p.unidade] || p.unidade}</td>
                    <td style={TD}>{p.quantidadePadrao ? `${numero(p.quantidadePadrao)} ${p.unidade}` : "—"}</td>
                    <td style={TD}>
                      {p.insumo ? (
                        <>
                          <div style={{ fontWeight: 700 }}>{p.insumo.name}</div>
                          <div style={{ fontSize: 12, color: p.insumo.minQuantity && p.insumo.quantity <= p.insumo.minQuantity ? "#B45309" : "#64748B" }}>
                            tem {numero(p.insumo.quantity)} {p.insumo.unit}{p.insumo.minQuantity ? ` · mín. ${numero(p.insumo.minQuantity)}` : ""}
                            {p.fatorDoInsumo ? ` · 1 ${p.unidade} = ${numero(p.fatorDoInsumo)} ${p.insumo.unit}` : precisaDeFator(p.unidade, p.insumo) ? <b style={{ color: VERMELHO }}> · falta dizer quantos {p.insumo.unit} vêm em 1 {p.unidade}</b> : ""}
                          </div>
                        </>
                      ) : <span style={{ color: "#94A3B8" }}>não ligado</span>}
                    </td>
                    <td style={{ ...TD, whiteSpace: "nowrap", textAlign: "right" }}>
                      <button type="button" style={S.botaoPequeno} onClick={() => setEditando(p)}>Editar</button>{" "}
                      <button type="button" style={{ ...S.botaoPequeno, color: VERMELHO }} onClick={() => apagar(p)} aria-label={`Apagar ${p.nome}`}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editando && (
        <FormularioDoProduto inicial={editando === "novo" ? null : editando} insumos={insumos} categorias={categorias} onFechar={() => setEditando(null)} onAviso={onAviso}
          onSalvou={(l) => { setProdutos(l); setEditando(null); onMudou(); }} />
      )}
      {colando && (
        <ColarProdutos onFechar={() => setColando(false)} onLer={(lidos) => { setColando(false); setRevisando(lidos.map((l) => ({ ...l, marcado: !produtos.some((p) => p.nome.toLowerCase() === l.nome.toLowerCase()) }))); }}
          onIa={(texto) => { setColando(false); lerComIa({ texto }, "a lista"); }} />
      )}
      {revisando && (
        <RevisarProdutos lidos={revisando} insumos={insumos} onFechar={() => setRevisando(null)} onAviso={onAviso}
          onSalvou={(l) => { setProdutos(l); setRevisando(null); onMudou(); }} />
      )}
    </>
  );
}

const OPCAO: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "12px 14px", borderRadius: 14, border: "1.5px solid #E2E8F0",
  background: "#F8FAFC", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: "#0F172A", fontSize: 14,
};
const TH: React.CSSProperties = { padding: "10px 12px", fontWeight: 800 };
const TD: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };

function CampoDoInsumo({ unidade, stockItemId, fator, insumos, onMudar }: {
  unidade: string; stockItemId: string; fator: string; insumos: Insumo[]; onMudar: (stockItemId: string, fator: string) => void;
}) {
  const insumo = insumos.find((i) => i.id === stockItemId);
  return (
    <div>
      <label style={S.rotulo}>Insumo do estoque</label>
      <select value={stockItemId} onChange={(e) => onMudar(e.target.value, fator)} style={S.campo}>
        <option value="">Não ligar</option>
        {insumos.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
      </select>
      {insumo && precisaDeFator(unidade, insumo) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 13.5, fontWeight: 700, color: "#334155" }}>
          1 {unidade} =
          <input value={fator} onChange={(e) => onMudar(stockItemId, e.target.value.replace(/[^\d,.]/g, ""))} inputMode="decimal" placeholder="12" style={{ ...S.campo, width: 80, height: 34, padding: "0 8px" }} />
          {insumo.unit}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 3 }}>Ligado, o estoque avisa quando precisa comprar e o pedido recebido entra no saldo.</div>
    </div>
  );
}

function FormularioDoProduto({ inicial, insumos, categorias, onFechar, onAviso, onSalvou }: {
  inicial: Produto | null; insumos: Insumo[]; categorias: string[]; onFechar: () => void; onAviso: (a: Aviso) => void; onSalvou: (l: Produto[]) => void;
}) {
  const [p, setP] = useState({
    nome: inicial?.nome || "", categoria: inicial?.categoria || "", unidade: inicial?.unidade || "un",
    quantidadePadrao: inicial?.quantidadePadrao ? String(inicial.quantidadePadrao).replace(".", ",") : "",
    stockItemId: inicial?.stockItemId || "", fatorDoInsumo: inicial?.fatorDoInsumo ? String(inicial.fatorDoInsumo).replace(".", ",") : "", ativo: inicial?.ativo ?? true,
  });
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    if (!p.nome.trim()) return onAviso({ tipo: "atencao", titulo: "Dê um nome ao produto." });
    setSalvando(true);
    try {
      const j = inicial
        ? await pedir<{ produtos: Produto[] }>("/api/store/cotacao/produtos", "PUT", { id: inicial.id, ...p })
        : await pedir<{ produtos: Produto[] }>("/api/store/cotacao/produtos", "POST", { produto: p });
      onAviso({ tipo: "ok", titulo: inicial ? "Produto salvo." : `${p.nome.trim()} cadastrado!` });
      onSalvou(j.produtos);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para salvar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }
  const linha: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 };
  return (
    <Janela titulo={inicial ? `Editar ${inicial.nome}` : "Novo produto"} onFechar={onFechar} largura={600}
      rodape={<><button type="button" style={S.botaoLeve} onClick={onFechar}>Cancelar</button><button type="button" style={S.botao} onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar produto"}</button></>}>
      <div style={linha}>
        <div style={{ gridColumn: "1 / -1" }}><label style={S.rotulo}>Nome *</label><input autoFocus value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} placeholder="Ex.: Queijo mussarela" style={S.campo} /></div>
      </div>
      <div style={linha}>
        <div>
          <label style={S.rotulo}>Compra em</label>
          <select value={p.unidade} onChange={(e) => setP({ ...p, unidade: e.target.value })} style={S.campo}>
            {[...new Set([...UNIDADES_DE_COMPRA, p.unidade])].map((u) => <option key={u} value={u}>{NOME_DA_UNIDADE[u] || u}</option>)}
          </select>
        </div>
        <div><label style={S.rotulo}>Quantidade de costume</label><input value={p.quantidadePadrao} onChange={(e) => setP({ ...p, quantidadePadrao: e.target.value.replace(/[^\d,.]/g, "") })} inputMode="decimal" placeholder="Ex.: 10" style={S.campo} /></div>
        <div>
          <label style={S.rotulo}>Categoria</label>
          <input value={p.categoria} onChange={(e) => setP({ ...p, categoria: e.target.value })} placeholder="Ex.: Hortifruti" list="cot-cat-produto" style={S.campo} />
          <datalist id="cot-cat-produto">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      <CampoDoInsumo unidade={p.unidade} stockItemId={p.stockItemId} fator={p.fatorDoInsumo} insumos={insumos} onMudar={(stockItemId, fatorDoInsumo) => setP({ ...p, stockItemId, fatorDoInsumo })} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, fontSize: 14, marginTop: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={p.ativo} onChange={(e) => setP({ ...p, ativo: e.target.checked })} style={{ width: 18, height: 18, accentColor: COR }} />
        Entra na cotação e no comparativo
      </label>
    </Janela>
  );
}

function ColarProdutos({ onFechar, onLer, onIa }: { onFechar: () => void; onLer: (l: Lido[]) => void; onIa: (texto: string) => void }) {
  const [texto, setTexto] = useState("");
  const lidos = useMemo(() => lerListaDeProdutos(texto), [texto]);
  return (
    <Janela titulo="Colar lista de produtos" subtitulo="Um produto por linha. Unidade e quantidade, se quiser: “Tomate kg 10”." onFechar={onFechar} largura={620}
      rodape={<>
        <button type="button" style={S.botaoLeve} onClick={() => texto.trim() && onIa(texto)} disabled={!texto.trim()} title="Para lista bagunçada: a IA organiza">✨ Organizar com IA</button>
        <button type="button" style={S.botao} onClick={() => onLer(lidos)} disabled={!lidos.length}>Conferir {lidos.length || ""} →</button>
      </>}>
      <textarea autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} rows={10} placeholder={"HORTIFRUTI:\nTomate kg 10\nCebola kg 5\n\nBEBIDAS:\nCoca-Cola lata 350ml cx 4"} style={{ ...S.campo, fontFamily: "ui-monospace, monospace", fontSize: 13.5, resize: "vertical" }} />
      <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>Linha terminando em “:” vira a categoria dos itens de baixo.</div>
    </Janela>
  );
}

function RevisarProdutos({ lidos, insumos, onFechar, onAviso, onSalvou }: { lidos: Lido[]; insumos: Insumo[]; onFechar: () => void; onAviso: (a: Aviso) => void; onSalvou: (l: Produto[]) => void }) {
  const [itens, setItens] = useState<(Lido & { fator?: string })[]>(lidos);
  const [salvando, setSalvando] = useState(false);
  const marcados = itens.filter((i) => i.marcado && i.nome.trim());
  const muda = (i: number, campo: Partial<Lido & { fator?: string }>) => setItens((l) => l.map((x, j) => (j === i ? { ...x, ...campo } : x)));
  async function salvar() {
    setSalvando(true);
    try {
      const j = await pedir<{ cadastrados: number; repetidos: string[]; produtos: Produto[] }>("/api/store/cotacao/produtos", "POST", {
        lista: marcados.map((i) => ({ nome: i.nome, unidade: i.unidade, quantidadePadrao: i.quantidade, categoria: i.categoria, stockItemId: i.stockItemId || null, fatorDoInsumo: i.fator || null })),
      });
      onAviso({ tipo: "ok", titulo: `${j.cadastrados} produto${j.cadastrados === 1 ? "" : "s"} cadastrado${j.cadastrados === 1 ? "" : "s"}.`, detalhe: j.repetidos.length ? `${j.repetidos.length} já estavam na lista.` : undefined });
      onSalvou(j.produtos);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para cadastrar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Janela titulo="Confira o que eu entendi" subtitulo="Mexa no que precisar e desmarque o que não quer. Nada foi gravado ainda." onFechar={onFechar} largura={860}
      rodape={<><button type="button" style={S.botaoLeve} onClick={onFechar}>Cancelar</button><button type="button" style={S.botao} onClick={salvar} disabled={salvando || !marcados.length}>{salvando ? "Cadastrando…" : `Cadastrar ${marcados.length} produto${marcados.length === 1 ? "" : "s"}`}</button></>}>
      <div style={{ display: "grid", gap: 8 }}>
        {itens.map((it, i) => {
          const insumo = insumos.find((x) => x.id === it.stockItemId);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "28px minmax(160px, 2fr) 90px 80px minmax(120px, 1fr) minmax(150px, 1.4fr)", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 12, border: "1px solid #E2E8F0", background: it.marcado ? "#fff" : "#F8FAFC", opacity: it.marcado ? 1 : 0.6, overflowX: "auto" }}>
              <input type="checkbox" checked={!!it.marcado} onChange={(e) => muda(i, { marcado: e.target.checked })} style={{ width: 18, height: 18, accentColor: COR }} aria-label={`Cadastrar ${it.nome}`} />
              <div>
                <input value={it.nome} onChange={(e) => muda(i, { nome: e.target.value })} style={{ ...S.campo, height: 36, padding: "0 8px", fontSize: 14 }} aria-label="Nome" />
                {it.jaCadastrado && <div style={{ fontSize: 11.5, color: "#B45309", fontWeight: 700 }}>já está cadastrado</div>}
              </div>
              <select value={it.unidade} onChange={(e) => muda(i, { unidade: e.target.value })} style={{ ...S.campo, height: 36, padding: "0 6px", fontSize: 14 }} aria-label="Unidade">
                {[...new Set([...UNIDADES_DE_COMPRA, it.unidade])].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <input value={it.quantidade ?? ""} onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); muda(i, { quantidade: Number.isFinite(n) && n > 0 ? n : null }); }} inputMode="decimal" placeholder="qtd" style={{ ...S.campo, height: 36, padding: "0 8px", fontSize: 14 }} aria-label="Quantidade de costume" />
              <input value={it.categoria || ""} onChange={(e) => muda(i, { categoria: e.target.value || null })} placeholder="categoria" style={{ ...S.campo, height: 36, padding: "0 8px", fontSize: 14 }} aria-label="Categoria" />
              <div>
                <select value={it.stockItemId || ""} onChange={(e) => muda(i, { stockItemId: e.target.value || null })} style={{ ...S.campo, height: 36, padding: "0 6px", fontSize: 13 }} aria-label="Insumo do estoque">
                  <option value="">sem insumo</option>
                  {insumos.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                </select>
                {insumo && precisaDeFator(it.unidade, insumo) && (
                  <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, marginTop: 3 }}>
                    1 {it.unidade} = <input value={it.fator || ""} onChange={(e) => muda(i, { fator: e.target.value.replace(/[^\d,.]/g, "") })} placeholder="?" style={{ ...S.campo, width: 50, height: 26, padding: "0 4px", fontSize: 12 }} /> {insumo.unit}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Janela>
  );
}
