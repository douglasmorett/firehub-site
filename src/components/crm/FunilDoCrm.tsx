"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ETAPAS, ORIGENS, ROTULO_DA_ETAPA, ROTULO_DA_ORIGEM, type Etapa } from "@/lib/crm/etapas";
import type { ContatoDaLista } from "@/lib/crm/serializar";
import { EstiloDoCrm, Iniciais, Modal, SeloDaEtapa, api, quandoCurto } from "./comum";
import FichaDoContato, { type DetalheDoContato } from "./FichaDoContato";

/**
 * O FUNIL DO CRM — colunas por etapa (arrastar muda a etapa) ou lista com
 * seleção para distribuir em lote. Admin vê todos; vendedor, os dele.
 */
export default function FunilDoCrm({ modo, aoAbrirConversa }: { modo: "ADMIN" | "VENDEDOR"; aoAbrirConversa?: (id: string) => void }) {
  const [contatos, setContatos] = useState<ContatoDaLista[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [vendedorFiltro, setVendedorFiltro] = useState("");
  const [vista, setVista] = useState<"colunas" | "lista">("colunas");
  const [vendedores, setVendedores] = useState<{ id: string; nome: string }[]>([]);
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheDoContato | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [loteVendedor, setLoteVendedor] = useState("");
  const [loteEtapa, setLoteEtapa] = useState("");
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    void api("/api/crm/equipe").then((r) => { if (r.ok) setVendedores(r.dados.vendedores || []); });
  }, []);

  const carregar = useCallback(async () => {
    const p = new URLSearchParams({ limite: "1000" });
    if (busca.trim()) p.set("busca", busca.trim());
    if (vendedorFiltro) p.set("vendedor", vendedorFiltro);
    const r = await api(`/api/crm/conversas?${p.toString()}`);
    setCarregou(true);
    if (!r.ok) { setErro(r.erro); return; }
    setErro(null);
    setContatos(r.dados.contatos || []);
  }, [busca, vendedorFiltro]);

  useEffect(() => {
    const t = setTimeout(() => void carregar(), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  const carregarDetalhe = useCallback(async (id: string) => {
    const r = await api(`/api/crm/contatos/${id}`);
    if (r.ok) setDetalhe({ contato: r.dados.contato, loja: r.dados.loja, reunioes: r.dados.reunioes, eventos: r.dados.eventos });
  }, []);

  useEffect(() => {
    if (aberto) void carregarDetalhe(aberto); else setDetalhe(null);
  }, [aberto, carregarDetalhe]);

  const porEtapa = useMemo(() => {
    const m = new Map<string, ContatoDaLista[]>();
    for (const e of ETAPAS) m.set(e, []);
    for (const c of contatos) (m.get(c.etapa) || m.get("NOVO")!).push(c);
    return m;
  }, [contatos]);

  const soltar = async (etapa: Etapa) => {
    const id = arrastando;
    setArrastando(null);
    setSobre(null);
    if (!id) return;
    const atual = contatos.find((c) => c.id === id);
    if (!atual || atual.etapa === etapa) return;
    let motivoPerda: string | null = null;
    if (etapa === "PERDIDO") {
      motivoPerda = prompt("Por que perdeu? (preço, já tem sistema, não respondeu…)");
      if (motivoPerda === null) return;
    }
    setContatos((l) => l.map((c) => (c.id === id ? { ...c, etapa } : c)));
    const r = await api(`/api/crm/contatos/${id}`, { method: "PATCH", json: { etapa, motivoPerda } });
    if (!r.ok) { setErro(r.erro); void carregar(); }
  };

  const aplicarLote = async (corpo: Record<string, unknown>) => {
    if (marcados.size === 0) return;
    setAplicando(true);
    const r = await api("/api/crm/contatos/lote", { method: "POST", json: { ids: [...marcados], ...corpo } });
    setAplicando(false);
    if (!r.ok || r.dados.erros?.length) setErro(r.erro || r.dados.erros.join("; "));
    setMarcados(new Set());
    void carregar();
  };

  const nomeDe = (c: ContatoDaLista) => c.nomeDaLoja || c.nome || c.telefone || "Contato";

  // Função, e não componente: um componente declarado aqui dentro seria outro a
  // cada render, e o cartão que está sendo arrastado seria trocado no meio do
  // arrasto (o navegador cancela o drag).
  const cartao = (c: ContatoDaLista) => (
    <div
      key={c.id}
      className="crm-cartao"
      draggable
      onDragStart={() => setArrastando(c.id)}
      onDragEnd={() => { setArrastando(null); setSobre(null); }}
      onClick={() => setAberto(c.id)}
      style={{ opacity: arrastando === c.id ? 0.5 : 1 }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Iniciais texto={nomeDe(c)} tamanho={28} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.82rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nomeDe(c)}</div>
          <div className="crm-sub" style={{ fontSize: "0.7rem" }}>{c.nomeDaLoja && c.nome ? `${c.nome} · ` : ""}{c.telefone || "sem telefone"}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, marginTop: 7, alignItems: "center", flexWrap: "wrap" }}>
        {c.aguardandoHumano && <span className="crm-selo" style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: "0.62rem", padding: "2px 6px" }}>🙋 pessoa</span>}
        {c.ehLojista && <span className="crm-selo" style={{ background: "#F1F5F9", color: "#334155", fontSize: "0.62rem", padding: "2px 6px" }}>🏪 loja</span>}
        {c.naoLidas > 0 && <span className="crm-bolinha">{c.naoLidas}</span>}
        <span style={{ flex: 1 }} />
        <span className="crm-sub" style={{ fontSize: "0.66rem" }}>
          {modo === "ADMIN" ? (c.vendedorNome ? c.vendedorNome.split(/\s+/)[0] : "sem vendedor") + " · " : ""}{quandoCurto(c.ultimaMensagemEm || c.criadoEm)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="crm">
      <EstiloDoCrm />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input className="crm-input" style={{ flex: "1 1 260px", maxWidth: 420 }} placeholder="Buscar nome, loja, cidade, e-mail ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {modo === "ADMIN" && (
          <select className="crm-select" value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)}>
            <option value="">Todos os vendedores</option>
            <option value="sem">Sem vendedor</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
        )}
        <div style={{ display: "inline-flex", gap: 4 }}>
          <button className={`crm-chip${vista === "colunas" ? " on" : ""}`} onClick={() => setVista("colunas")}>Colunas</button>
          <button className={`crm-chip${vista === "lista" ? " on" : ""}`} onClick={() => setVista("lista")}>Lista</button>
        </div>
        <span style={{ flex: 1 }} />
        <span className="crm-sub">{contatos.length} contato(s)</span>
        <button className="crm-btn crm-btn-primary" onClick={() => setNovo(true)}>+ Novo contato</button>
      </div>

      {erro && <div className="crm-erro" style={{ marginBottom: 12 }}>{erro}</div>}
      {carregou && contatos.length === 0 && !busca && (
        <div className="crm-card crm-vazio" style={{ height: "auto", marginBottom: 12 }}>
          <div style={{ fontSize: "1.6rem" }}>🎯</div>
          Nenhum contato ainda. Eles entram sozinhos quando alguém escreve para o WhatsApp do FireHub ou se cadastra no site — ou cadastre à mão em "+ Novo contato".
        </div>
      )}

      {vista === "colunas" ? (
        <div className="crm-kanban">
          {ETAPAS.map((e) => (
            <div
              key={e}
              className={`crm-coluna${sobre === e ? " soltar" : ""}`}
              onDragOver={(ev) => { ev.preventDefault(); if (sobre !== e) setSobre(e); }}
              onDragLeave={() => setSobre((s) => (s === e ? null : s))}
              onDrop={(ev) => { ev.preventDefault(); void soltar(e); }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 2px 4px" }}>
                <SeloDaEtapa etapa={e} />
                <span className="crm-sub" style={{ fontWeight: 800 }}>{porEtapa.get(e)!.length}</span>
              </div>
              {porEtapa.get(e)!.slice(0, 150).map((c) => cartao(c))}
              {porEtapa.get(e)!.length > 150 && <div className="crm-sub" style={{ textAlign: "center" }}>+{porEtapa.get(e)!.length - 150} — use a busca ou a lista</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="crm-card" style={{ overflow: "hidden" }}>
          {modo === "ADMIN" && marcados.size > 0 && (
            <div style={{ padding: "10px 12px", borderBottom: "1px solid #EEF0F3", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#FFF4F0" }}>
              <b style={{ fontSize: "0.82rem" }}>{marcados.size} selecionado(s)</b>
              <select className="crm-select" value={loteVendedor} onChange={(e) => setLoteVendedor(e.target.value)}>
                <option value="">Passar para…</option>
                <option value="__nenhum">— Sem vendedor —</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
              <button className="crm-btn crm-btn-dark crm-btn-sm" disabled={!loteVendedor || aplicando} onClick={() => aplicarLote({ vendedorId: loteVendedor === "__nenhum" ? null : loteVendedor })}>Aplicar</button>
              <select className="crm-select" value={loteEtapa} onChange={(e) => setLoteEtapa(e.target.value)}>
                <option value="">Mudar etapa…</option>
                {ETAPAS.map((e) => <option key={e} value={e}>{ROTULO_DA_ETAPA[e]}</option>)}
              </select>
              <button className="crm-btn crm-btn-dark crm-btn-sm" disabled={!loteEtapa || aplicando} onClick={() => aplicarLote({ etapa: loteEtapa })}>Aplicar</button>
              <button className="crm-btn crm-btn-sm" onClick={() => setMarcados(new Set())}>Limpar</button>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="crm-tabela">
              <thead>
                <tr>
                  {modo === "ADMIN" && (
                    <th style={{ width: 30 }}>
                      <input type="checkbox" checked={contatos.length > 0 && marcados.size === contatos.length} onChange={(e) => setMarcados(e.target.checked ? new Set(contatos.map((c) => c.id)) : new Set())} />
                    </th>
                  )}
                  <th>Contato</th><th>Telefone</th><th>Etapa</th>{modo === "ADMIN" && <th>Vendedor</th>}<th>Origem</th><th>Última conversa</th><th>Entrou</th>
                </tr>
              </thead>
              <tbody>
                {contatos.map((c) => (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setAberto(c.id)}>
                    {modo === "ADMIN" && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={marcados.has(c.id)} onChange={(e) => {
                          const s = new Set(marcados);
                          if (e.target.checked) s.add(c.id); else s.delete(c.id);
                          setMarcados(s);
                        }} />
                      </td>
                    )}
                    <td>
                      <div style={{ fontWeight: 700 }}>{nomeDe(c)} {c.ehLojista && "🏪"} {c.aguardandoHumano && "🙋"}</div>
                      {c.nome && c.nomeDaLoja && <div className="crm-sub">{c.nome}{c.cidade ? ` · ${c.cidade}` : ""}</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{c.telefone || <span className="crm-muted">—</span>}</td>
                    <td><SeloDaEtapa etapa={c.etapa} pequeno /></td>
                    {modo === "ADMIN" && <td>{c.vendedorNome || <span className="crm-muted">—</span>}</td>}
                    <td className="crm-sub">{ROTULO_DA_ORIGEM[c.origem as keyof typeof ROTULO_DA_ORIGEM] || c.origem}</td>
                    <td className="crm-sub" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.ultimaMensagemEm ? `${quandoCurto(c.ultimaMensagemEm)} · ${c.ultimaMensagemTexto || ""}` : "—"}
                    </td>
                    <td className="crm-sub" style={{ whiteSpace: "nowrap" }}>{quandoCurto(c.criadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aberto && (
        <Modal titulo="Contato" aoFechar={() => { setAberto(null); void carregar(); }} largura={460}>
          {detalhe ? (
            <FichaDoContato
              modo={modo}
              detalhe={detalhe}
              vendedores={vendedores}
              aoAtualizar={() => void carregarDetalhe(aberto)}
              aoAbrirConversa={aoAbrirConversa ? (id) => { setAberto(null); aoAbrirConversa(id); } : undefined}
            />
          ) : (
            <div className="crm-sub">Carregando…</div>
          )}
        </Modal>
      )}

      {novo && (
        <NovoContato
          modo={modo}
          vendedores={vendedores}
          aoFechar={() => setNovo(false)}
          aoCriar={(id) => { setNovo(false); void carregar(); setAberto(id); }}
        />
      )}
    </div>
  );
}

function NovoContato({ modo, vendedores, aoFechar, aoCriar }: {
  modo: "ADMIN" | "VENDEDOR"; vendedores: { id: string; nome: string }[]; aoFechar: () => void; aoCriar: (id: string) => void;
}) {
  const [f, setF] = useState({ telefone: "", nome: "", nomeDaLoja: "", cidade: "", email: "", origem: "INSTAGRAM", vendedorId: "", notas: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setErro(null);
    setSalvando(true);
    const r = await api("/api/crm/contatos", { method: "POST", json: { ...f, vendedorId: f.vendedorId || null } });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    if (r.dados.jaExistia) alert("Esse número já estava no CRM — abrindo o contato que existe.");
    aoCriar(r.dados.contato.id);
  };
  return (
    <Modal titulo="Novo contato" aoFechar={aoFechar} largura={500}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="crm-grade2">
          <label><span className="crm-rotulo">WhatsApp (com DDD)</span><input className="crm-input" autoFocus value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="(22) 99999-9999" /></label>
          <label><span className="crm-rotulo">Nome da pessoa</span><input className="crm-input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
        </div>
        <div className="crm-grade2">
          <label><span className="crm-rotulo">Loja</span><input className="crm-input" value={f.nomeDaLoja} onChange={(e) => setF({ ...f, nomeDaLoja: e.target.value })} /></label>
          <label><span className="crm-rotulo">Cidade</span><input className="crm-input" value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} /></label>
        </div>
        <div className="crm-grade2">
          <label><span className="crm-rotulo">E-mail</span><input className="crm-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label><span className="crm-rotulo">De onde veio</span>
            <select className="crm-select" style={{ width: "100%" }} value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })}>
              {ORIGENS.map((o) => <option key={o} value={o}>{ROTULO_DA_ORIGEM[o]}</option>)}
            </select>
          </label>
        </div>
        {modo === "ADMIN" && (
          <label><span className="crm-rotulo">Vendedor</span>
            <select className="crm-select" style={{ width: "100%" }} value={f.vendedorId} onChange={(e) => setF({ ...f, vendedorId: e.target.value })}>
              <option value="">— Sem vendedor por enquanto —</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
          </label>
        )}
        <label><span className="crm-rotulo">Notas</span><textarea className="crm-textarea" rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
        {erro && <div className="crm-erro">{erro}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="crm-btn" onClick={aoFechar}>Cancelar</button>
          <button className="crm-btn crm-btn-primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Cadastrar"}</button>
        </div>
      </div>
    </Modal>
  );
}
