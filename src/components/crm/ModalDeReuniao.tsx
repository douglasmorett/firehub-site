"use client";
import React, { useEffect, useState } from "react";
import { ROTULO_DO_TIPO_DE_REUNIAO, TIPOS_DE_REUNIAO } from "@/lib/crm/etapas";
import { Modal, api } from "./comum";

export type ContatoEscolhido = { id: string; rotulo: string };

/**
 * Marcar na agenda da equipe — pela grade (horário livre clicado) ou pela
 * ficha do contato ("Marcar demonstração"). O vendedor marca só na coluna
 * dele; o admin escolhe a coluna. Contato novo pode nascer aqui mesmo.
 */
export default function ModalDeReuniao({
  modo, vendedores, inicial, aoFechar, aoSalvar,
}: {
  modo: "ADMIN" | "VENDEDOR";
  vendedores: { id: string; nome: string }[];
  inicial: { vendedorId?: string; data: string; hora: string; contato?: ContatoEscolhido | null; tipo?: string };
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [vendedorId, setVendedorId] = useState(inicial.vendedorId || vendedores[0]?.id || "");
  const [data, setData] = useState(inicial.data);
  const [hora, setHora] = useState(inicial.hora);
  const [duracao, setDuracao] = useState(45);
  const [tipo, setTipo] = useState(inicial.tipo || "DEMONSTRACAO");
  const [titulo, setTitulo] = useState("");
  const [local, setLocal] = useState("");
  const [observacao, setObservacao] = useState("");
  const [contato, setContato] = useState<ContatoEscolhido | null>(inicial.contato || null);
  const [novo, setNovo] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");
  const [novaLoja, setNovaLoja] = useState("");
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<ContatoEscolhido[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (contato || novo || busca.trim().length < 2) { setAchados([]); return; }
    const t = setTimeout(async () => {
      const r = await api(`/api/crm/conversas?busca=${encodeURIComponent(busca.trim())}&limite=8`);
      if (r.ok) setAchados((r.dados.contatos || []).map((c: any) => ({ id: c.id, rotulo: `${c.nomeDaLoja || c.nome || c.telefone || "Contato"}${c.telefone ? ` · ${c.telefone}` : ""}` })));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, contato, novo]);

  const salvar = async () => {
    setErro(null);
    if (!vendedorId && modo === "ADMIN") { setErro("Escolha o vendedor."); return; }
    setSalvando(true);
    const r = await api("/api/crm/agenda", {
      method: "POST",
      json: {
        vendedorId, data, hora, duracaoMin: duracao, tipo, titulo, local, observacao,
        contatoId: contato?.id || null,
        novoContato: !contato && novo ? { nome: novoNome, telefone: novoTelefone, nomeDaLoja: novaLoja } : null,
      },
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    aoSalvar();
  };

  const bloqueio = tipo === "BLOQUEIO";

  return (
    <Modal titulo={bloqueio ? "Bloquear horário" : "Marcar na agenda"} aoFechar={aoFechar} largura={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="crm-grade2">
          {modo === "ADMIN" ? (
            <label><span className="crm-rotulo">Vendedor</span>
              <select className="crm-select" style={{ width: "100%" }} value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </label>
          ) : null}
          <label><span className="crm-rotulo">Tipo</span>
            <select className="crm-select" style={{ width: "100%" }} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS_DE_REUNIAO.map((t) => <option key={t} value={t}>{ROTULO_DO_TIPO_DE_REUNIAO[t]}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 10 }}>
          <label><span className="crm-rotulo">Dia</span><input className="crm-input" type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label><span className="crm-rotulo">Hora</span><input className="crm-input" type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></label>
          <label><span className="crm-rotulo">Duração</span>
            <select className="crm-select" style={{ width: "100%" }} value={duracao} onChange={(e) => setDuracao(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? " 30" : ""}`}</option>)}
            </select>
          </label>
        </div>

        {!bloqueio && (
          <div>
            <span className="crm-rotulo">Com quem</span>
            {contato ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #E2E8F0", borderRadius: 9, padding: "7px 10px" }}>
                <span style={{ flex: 1, fontSize: "0.84rem", fontWeight: 600 }}>{contato.rotulo}</span>
                <button className="crm-btn crm-btn-sm" onClick={() => setContato(null)}>Trocar</button>
              </div>
            ) : novo ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="crm-grade2">
                  <input className="crm-input" placeholder="Nome da pessoa" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                  <input className="crm-input" placeholder="WhatsApp com DDD" value={novoTelefone} onChange={(e) => setNovoTelefone(e.target.value)} />
                </div>
                <input className="crm-input" placeholder="Nome da loja" value={novaLoja} onChange={(e) => setNovaLoja(e.target.value)} />
                <button className="crm-btn crm-btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setNovo(false)}>Procurar contato existente</button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input className="crm-input" placeholder="Buscar contato do CRM (nome, loja ou telefone)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {achados.length > 0 && (
                  <div className="crm-card" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 5, maxHeight: 220, overflowY: "auto" }}>
                    {achados.map((a) => (
                      <div key={a.id} className="crm-item" onClick={() => { setContato(a); setBusca(""); }} style={{ fontSize: "0.82rem" }}>{a.rotulo}</div>
                    ))}
                  </div>
                )}
                <button className="crm-btn crm-btn-sm" style={{ marginTop: 6 }} onClick={() => setNovo(true)}>+ Contato novo</button>
              </div>
            )}
          </div>
        )}

        <label><span className="crm-rotulo">{bloqueio ? "Motivo" : "Título (opcional)"}</span>
          <input className="crm-input" placeholder={bloqueio ? "Folga, médico, outra reunião…" : "Ex.: Demonstração — Pizzaria do João"} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </label>
        {!bloqueio && (
          <label><span className="crm-rotulo">Link da chamada ou local</span>
            <input className="crm-input" placeholder="https://meet.google.com/… ou endereço" value={local} onChange={(e) => setLocal(e.target.value)} />
          </label>
        )}
        <label><span className="crm-rotulo">Observação</span>
          <textarea className="crm-textarea" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </label>
        {erro && <div className="crm-erro">{erro}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="crm-btn" onClick={aoFechar}>Cancelar</button>
          <button className="crm-btn crm-btn-primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : bloqueio ? "Bloquear" : "Marcar"}</button>
        </div>
      </div>
    </Modal>
  );
}
