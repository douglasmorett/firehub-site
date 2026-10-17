"use client";
/**
 * Aba Avaliações — os três cenários do checklist de Review:
 *
 *   1. listar (com os campos obrigatórios), filtrar por data e testar o limite
 *      de página (100 tem que voltar 400 do iFood);
 *   2. abrir os detalhes completos e testar um ID inexistente (404);
 *   3. responder três avaliações em NOT_REPLIED, tentar responder uma
 *      PUBLISHED e mandar um texto inválido.
 *
 * As recusas do iFood não são barradas antes: a regra aparece como aviso e a
 * chamada sai, porque o que se avalia é o tratamento da resposta da API.
 */
import React, { useEffect, useState } from "react";
import { Loader, RefreshCw, Star, Search, Send, ExternalLink, MessageSquare } from "lucide-react";

const LARANJA = "#E8360C";
const VERDE = "#0F766E";
const TINTA = "#0F172A";
const CINZA = "#64748B";
const LINHA = "#E2E8F0";

const LINK_POLITICA = "https://comunidade.ifood.com.br/t/conheca-nossa-politica-de-avaliacoes-de-pedidos/87541";
const NOME_STATUS: Record<string, string> = {
  CREATED: "Recebida", NOT_REPLIED: "Aguardando resposta", REPLIED: "Respondida",
  PUBLISHED: "Publicada", INVALID: "Inválida", DISCARDED: "Descartada", UNKNOWN: "Desconhecido",
};
const COR_STATUS: Record<string, string> = { NOT_REPLIED: LARANJA, REPLIED: VERDE, PUBLISHED: "#334155" };

const agora = () => new Date().toLocaleTimeString("pt-BR");
const corDoStatus = (s: number) => (s >= 200 && s < 300 ? VERDE : s >= 400 && s < 500 ? "#B45309" : "#C92E09");
const dataHora = (s?: string) => (s ? new Date(s).toLocaleString("pt-BR") : "—");
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function Estrelas({ nota }: { nota: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} fill={i <= Math.round(nota) ? "#F59E0B" : "none"} color={i <= Math.round(nota) ? "#F59E0B" : "#CBD5E1"} />
      ))}
    </span>
  );
}

export default function TabAvaliacoes() {
  const [lista, setLista] = useState<any>(null);
  const [resumo, setResumo] = useState<any>(null);
  const [filtro, setFiltro] = useState({ dateFrom: diasAtras(30), dateTo: hoje(), pageSize: "10", page: 1, sort: "DESC" });
  const [sel, setSel] = useState<any>(null);
  const [idBusca, setIdBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [chamadas, setChamadas] = useState<any[]>([]);

  const registrar = (c: any) => setChamadas((a) => [{ ...c, hora: agora() }, ...a].slice(0, 50));

  async function chamar(metodo: "GET" | "POST", params: Record<string, any>) {
    setErro("");
    const url = metodo === "GET"
      ? `/api/ifood/review?${new URLSearchParams({ ...params, distribuido: "1" }).toString()}`
      : "/api/ifood/review?distribuido=1";
    const r = await fetch(url, {
      method: metodo,
      ...(metodo === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) } : {}),
    });
    const d = await r.json().catch(() => ({}));
    if (d?.endpoint) {
      registrar({ metodo: d.endpoint.split(" ")[0], endpoint: d.endpoint.split(" ").slice(1).join(" "), status: d?.ifood?.status ?? r.status, origem: d?.ifood?.origem });
    }
    if (!r.ok) {
      const det = d?.detalhe ? (typeof d.detalhe === "string" ? d.detalhe : JSON.stringify(d.detalhe)) : "";
      const e: any = new Error(`${d?.error || "Falha na chamada ao iFood."}${det ? ` — resposta do iFood: ${det}` : ""}`);
      e.status = d?.ifood?.status ?? r.status;
      throw e;
    }
    return d;
  }

  async function executar(nome: string, fn: () => Promise<any>) {
    setOcupado(nome);
    setAviso("");
    try { return await fn(); } catch (e: any) { setErro(`Erro ${e.status ?? ""}: ${e.message}`); } finally { setOcupado(""); }
  }

  const buscar = (pagina = 1) => executar("lista", async () => {
    const p: any = { acao: "lista", page: pagina, pageSize: filtro.pageSize, sort: filtro.sort };
    if (filtro.dateFrom) p.dateFrom = `${filtro.dateFrom}T00:00:00Z`;
    if (filtro.dateTo) p.dateTo = `${filtro.dateTo}T23:59:59Z`;
    setFiltro((f) => ({ ...f, page: pagina }));
    const d = await chamar("GET", p);
    setLista(d.data);
  });

  const carregarResumo = () => executar("resumo", async () => {
    try {
      const d = await chamar("GET", { acao: "resumo" });
      setResumo(d.data);
    } catch (e: any) {
      // Loja sem nenhuma avaliação: o iFood responde 404 "Summary not found".
      if (e.status === 404) { setResumo({ totalReviewsCount: 0, validReviewsCount: 0, score: null }); return; }
      throw e;
    }
  });

  useEffect(() => { buscar(1); carregarResumo(); }, []);

  const abrir = (reviewId: string) => executar("detalhe", async () => {
    setSel(null);
    setTexto("");
    const d = await chamar("GET", { acao: "detalhe", reviewId });
    setSel(d.data);
  });

  const responder = () => executar("responder", async () => {
    const d = await chamar("POST", { acao: "responder", reviewId: sel.id, texto });
    setAviso(`Resposta enviada (${d?.ifood?.status}). Criada em ${dataHora(d?.data?.createdAt)}.`);
    setTexto("");
    const r = await chamar("GET", { acao: "detalhe", reviewId: sel.id });
    setSel(r.data);
    buscar(filtro.page);
  });

  const n = texto.trim().length;
  const avisoTexto = !texto ? null : n < 10 ? `${n} caracteres — o iFood exige de 10 a 300.` : n > 300 ? `${n} caracteres — o iFood aceita até 300.` : null;

  // ── estilos ──
  const cartao: React.CSSProperties = { background: "#fff", border: `1.5px solid ${LINHA}`, borderRadius: 14, padding: "1.1rem 1.25rem" };
  const rotulo: React.CSSProperties = { display: "block", fontSize: "0.7rem", fontWeight: 700, color: CINZA, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 };
  const campo: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${LINHA}`, borderRadius: 9, fontSize: "0.85rem", fontFamily: "inherit", color: TINTA, boxSizing: "border-box" };
  const botao = (cor: string, desab = false): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", background: desab ? "#CBD5E1" : cor,
    color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, fontSize: "0.83rem", cursor: desab ? "not-allowed" : "pointer", fontFamily: "inherit",
  });
  const th: React.CSSProperties = { textAlign: "left", fontSize: "0.68rem", color: CINZA, fontWeight: 800, textTransform: "uppercase", padding: "6px 6px", borderBottom: `1.5px solid ${LINHA}` };
  const td: React.CSSProperties = { fontSize: "0.78rem", color: TINTA, padding: "7px 6px", borderBottom: `1px solid ${LINHA}`, verticalAlign: "top" };

  const avaliacoes: any[] = lista?.reviews ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 270px", gap: "1.1rem", alignItems: "start" }}>
      <div>
        {/* resumo + política */}
        <div style={{ ...cartao, marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
            <div>
              <div style={rotulo}>Nota da loja</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 900, color: TINTA }}>{resumo?.score != null ? Number(resumo.score).toFixed(1) : "—"}</div>
            </div>
            <div><div style={rotulo}>Avaliações</div><div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{resumo?.totalReviewsCount ?? "—"}</div></div>
            <div><div style={rotulo}>Válidas p/ a nota</div><div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{resumo?.validReviewsCount ?? "—"}</div></div>
            <button onClick={carregarResumo} disabled={!!ocupado} style={{ display: "inline-flex", padding: 6, background: "#F1F5F9", border: "none", borderRadius: 7, cursor: "pointer", color: CINZA }}>
              {ocupado === "resumo" ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
            </button>
          </div>
          <a href={LINK_POLITICA} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.82rem", fontWeight: 800, color: LARANJA, textDecoration: "none" }}>
            <ExternalLink size={14} /> Política de Avaliações do iFood
          </a>
        </div>

        {erro && <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", color: "#B71C1C", borderRadius: 10, padding: "10px 13px", marginBottom: "1rem", fontSize: "0.84rem", wordBreak: "break-word" }}>{erro}</div>}
        {aviso && <div style={{ background: "#F0FDFA", border: "1.5px solid #99F6E4", color: VERDE, borderRadius: 10, padding: "10px 13px", marginBottom: "1rem", fontSize: "0.84rem" }}>{aviso}</div>}

        {/* filtros + lista */}
        <div style={{ ...cartao, marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr 0.9fr auto", gap: "0.6rem", alignItems: "end", marginBottom: "0.9rem" }}>
            <div><label style={rotulo}>De</label><input type="date" style={campo} value={filtro.dateFrom} onChange={(e) => setFiltro({ ...filtro, dateFrom: e.target.value })} /></div>
            <div><label style={rotulo}>Até</label><input type="date" style={campo} value={filtro.dateTo} onChange={(e) => setFiltro({ ...filtro, dateTo: e.target.value })} /></div>
            <div><label style={rotulo}>Por página</label>
              <select style={campo} value={filtro.pageSize} onChange={(e) => setFiltro({ ...filtro, pageSize: e.target.value })}>
                {["3", "10", "25", "50", "100"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select></div>
            <div><label style={rotulo}>Ordem</label>
              <select style={campo} value={filtro.sort} onChange={(e) => setFiltro({ ...filtro, sort: e.target.value })}>
                <option value="DESC">Mais recentes</option><option value="ASC">Mais antigas</option>
              </select></div>
            <button onClick={() => buscar(1)} disabled={!!ocupado} style={botao(LARANJA, !!ocupado)}>
              {ocupado === "lista" ? <Loader size={14} className="spin" /> : <Search size={14} />} Buscar
            </button>
          </div>
          {filtro.pageSize === "100" && <div style={{ fontSize: "0.74rem", color: "#92400E", marginBottom: "0.6rem" }}>O iFood aceita no máximo 50 avaliações por página.</div>}

          {lista && (
            <div style={{ fontSize: "0.74rem", color: CINZA, marginBottom: "0.5rem" }}>
              Página {lista.page} de {lista.pageCount ?? "?"} · {lista.size} por página · {lista.total ?? avaliacoes.length} no total
            </div>
          )}
          {avaliacoes.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.82rem", color: CINZA }}>{lista ? "Nenhuma avaliação no período." : "Carregando…"}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Data</th><th style={th}>Pedido</th><th style={th}>Nota</th><th style={th}>Comentário</th>
                  <th style={th}>Status</th><th style={th}>Visib.</th><th style={th}>Versão</th><th style={th}>Respostas</th><th style={th}>ID</th>
                </tr></thead>
                <tbody>
                  {avaliacoes.map((a) => (
                    <tr key={a.id} onClick={() => abrir(a.id)} style={{ cursor: "pointer", background: sel?.id === a.id ? "#FFF7F5" : undefined }}>
                      <td style={td}>{dataHora(a.createdAt)}</td>
                      <td style={td}>#{a.order?.shortId ?? "—"}</td>
                      <td style={td}><Estrelas nota={a.score} /> {a.score}</td>
                      <td style={{ ...td, maxWidth: 220 }}>{a.comment || <span style={{ color: CINZA }}>sem comentário</span>}</td>
                      <td style={{ ...td, fontWeight: 800, color: COR_STATUS[a.status] ?? CINZA }}>{NOME_STATUS[a.status] ?? a.status}<div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: CINZA, fontWeight: 400 }}>{a.status}</div></td>
                      <td style={td}>{a.visibility}</td>
                      <td style={td}>{a.version}</td>
                      <td style={td}>{(a.replies ?? []).length}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: "0.62rem", color: CINZA }}>{String(a.id).slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {lista && (lista.pageCount ?? 1) > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: "0.7rem" }}>
              <button onClick={() => buscar(Math.max(1, filtro.page - 1))} disabled={filtro.page <= 1 || !!ocupado} style={botao("#64748B", filtro.page <= 1 || !!ocupado)}>Anterior</button>
              <button onClick={() => buscar(filtro.page + 1)} disabled={filtro.page >= lista.pageCount || !!ocupado} style={botao("#64748B", filtro.page >= lista.pageCount || !!ocupado)}>Próxima</button>
            </div>
          )}
        </div>

        {/* busca por id */}
        <div style={{ ...cartao, marginBottom: "1rem", display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label style={rotulo}>Abrir avaliação pelo ID</label>
            <input style={{ ...campo, fontFamily: "monospace" }} value={idBusca} placeholder="00000000-0000-0000-0000-000000000000" onChange={(e) => setIdBusca(e.target.value)} />
          </div>
          <button onClick={() => abrir(idBusca.trim())} disabled={!!ocupado || !idBusca.trim()} style={botao("#475569", !!ocupado || !idBusca.trim())}>
            {ocupado === "detalhe" ? <Loader size={14} className="spin" /> : <Search size={14} />} Abrir
          </button>
        </div>

        {/* detalhe */}
        {sel && (
          <div style={cartao}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: "0.7rem" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: TINTA }}>Avaliação do pedido #{sel.order?.shortId ?? "—"}</h3>
                <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: CINZA }}>{sel.id}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, color: COR_STATUS[sel.status] ?? CINZA, fontSize: "0.85rem" }}>{NOME_STATUS[sel.status] ?? sel.status}</div>
                <div style={{ fontSize: "0.7rem", color: CINZA }}>{sel.visibility} · {sel.version}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.3rem 1rem", fontSize: "0.8rem", color: TINTA }}>
              <div><strong>Cliente:</strong> {sel.customerName ?? "—"}</div>
              <div><strong>Nota:</strong> <Estrelas nota={sel.score} /> {sel.score}{sel.hasScoreChanged ? ` (antes ${sel.previousScore})` : ""}</div>
              <div><strong>Avaliada em:</strong> {dataHora(sel.createdAt)}</div>
              <div><strong>Pedido feito em:</strong> {dataHora(sel.order?.createdAt)}</div>
              <div><strong>Loja:</strong> {sel.merchant?.name ?? "—"}</div>
              <div><strong>Pesquisa:</strong> <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{sel.surveyId ?? "—"}</span></div>
              <div style={{ gridColumn: "1 / -1" }}><strong>Comentário:</strong> {sel.comment || "—"}</div>
            </div>
            {(sel.questions ?? []).length > 0 && (
              <div style={{ marginTop: "0.7rem", fontSize: "0.78rem", color: TINTA }}>
                <strong>Questionário:</strong>
                {(sel.questions ?? []).map((q: any) => (
                  <div key={q.id} style={{ marginLeft: 8 }}>• {q.title} ({q.type}): {(q.answers ?? []).map((a: any) => a.title).join(", ") || "—"}</div>
                ))}
              </div>
            )}
            <div style={{ marginTop: "0.8rem" }}>
              <strong style={{ fontSize: "0.8rem" }}>Respostas ({(sel.replies ?? []).length})</strong>
              {(sel.replies ?? []).map((r: any, i: number) => (
                <div key={i} style={{ marginTop: 5, padding: "7px 10px", borderRadius: 8, background: r.from === "MERCHANT" ? "#F0FDFA" : "#F8FAFC", fontSize: "0.78rem" }}>
                  <strong>{r.from === "MERCHANT" ? "Loja" : "Cliente"}</strong> <span style={{ fontFamily: "monospace", fontSize: "0.66rem", color: CINZA }}>({r.from}) {dataHora(r.createdAt)}</span>
                  <div>{r.text}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: "1rem", borderTop: `1.5px solid ${LINHA}`, paddingTop: "0.9rem" }}>
              <label style={rotulo}><MessageSquare size={11} /> Responder ao cliente</label>
              {sel.status !== "NOT_REPLIED" && (
                <div style={{ fontSize: "0.76rem", color: "#92400E", marginBottom: 6 }}>
                  Só avaliações "Aguardando resposta" (NOT_REPLIED) aceitam resposta; esta está {NOME_STATUS[sel.status] ?? sel.status}.
                </div>
              )}
              <textarea style={{ ...campo, minHeight: 70, resize: "vertical" }} value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder="Obrigado pelo retorno! Já conversamos com a equipe para o pedido chegar quente da próxima vez." />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 }}>
                <span style={{ fontSize: "0.72rem", color: avisoTexto ? "#B45309" : CINZA }}>{avisoTexto ?? `${n}/300 caracteres`}</span>
                <button onClick={responder} disabled={!!ocupado || !texto} style={botao(VERDE, !!ocupado || !texto)}>
                  {ocupado === "responder" ? <Loader size={14} className="spin" /> : <Send size={14} />} Enviar resposta
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── chamadas ── */}
      <div style={{ ...cartao, position: "sticky", top: 12 }}>
        <h4 style={{ margin: "0 0 0.3rem", fontSize: "0.88rem", fontWeight: 800, color: TINTA }}>Chamadas ao iFood</h4>
        <p style={{ margin: "0 0 0.8rem", fontSize: "0.72rem", color: CINZA, lineHeight: 1.4 }}>Cada ação da tela com o status devolvido pela API.</p>
        {chamadas.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: CINZA }}>Nenhuma chamada ainda.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 560, overflowY: "auto" }}>
            {chamadas.map((c, i) => (
              <div key={i} style={{ border: `1px solid ${LINHA}`, borderRadius: 8, padding: "7px 9px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 700, color: CINZA }}>{c.metodo}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.76rem", fontWeight: 800, color: corDoStatus(c.status) }}>{c.status}</span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: TINTA, wordBreak: "break-all", marginTop: 2 }}>{c.endpoint}</div>
                <div style={{ fontSize: "0.65rem", color: CINZA, marginTop: 2 }}>{c.hora}{c.origem ? ` · app ${c.origem}` : ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
