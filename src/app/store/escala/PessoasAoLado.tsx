"use client";

/**
 * A lista de pessoas ao lado da escala (Dia e Semana): arraste alguém para um
 * turno para escalar; arraste alguém de um turno para cá para tirar. Mostra
 * quantos turnos cada um já tem no período — quem está sobrando aparece.
 * Douglas, 12/11/2026: "usar a tela toda e mais dinâmica".
 */

import { useMemo, useState } from "react";
import { chaveDaFuncao } from "@/lib/escala-da-equipe/regras";
import { Avatar, COR, COR_CLARA, S, SELO_DO_TIPO, arrastoAtual, comecarArrasto, lerArrasto, type Arrasto, type Pessoa, type TipoDePessoa, type Turno } from "./ui";

type Filtro = "todos" | TipoDePessoa;

export default function PessoasAoLado({ pessoas, turnos, onTirar, onFechar }: {
  pessoas: Pessoa[]; turnos: Turno[]; onTirar: (a: Extract<Arrasto, { tipo: "inscricao" }>) => void; onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [alvo, setAlvo] = useState(false);

  // Turnos de cada pessoa no período visível.
  const turnosDe = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of turnos) for (const i of t.inscritos) m.set(`${i.pessoaTipo}:${i.pessoaId}`, (m.get(`${i.pessoaTipo}:${i.pessoaId}`) || 0) + 1);
    return m;
  }, [turnos]);

  const lista = useMemo(() => {
    const b = chaveDaFuncao(busca);
    return pessoas
      .filter((p) => p.ativo && (filtro === "todos" || p.tipo === filtro))
      .filter((p) => !b || chaveDaFuncao(p.nome).includes(b) || chaveDaFuncao(p.funcao).includes(b))
      .sort((a, c) => a.nome.localeCompare(c.nome, "pt-BR"));
  }, [pessoas, busca, filtro]);

  const FILTROS: Array<[Filtro, string]> = [["todos", "Todos"], ["motoboy", "🛵"], ["equipe", "👤"], ["freelancer", "⭐"]];

  return (
    <aside
      onDragOver={(e) => { if (arrastoAtual.valor?.tipo === "inscricao") { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!alvo) setAlvo(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo(false); }}
      onDrop={(e) => { e.preventDefault(); setAlvo(false); const a = lerArrasto(e); arrastoAtual.valor = null; if (a?.tipo === "inscricao") onTirar(a); }}
      className="esc-lado"
      style={{
        ...S.cartao, padding: 12, display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)",
        borderColor: alvo ? "#FCA5A5" : "#E2E8F0", background: alvo ? "#FEF2F2" : "#fff", transition: "background .15s, border-color .15s",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 15.5, color: "#0F172A" }}>👥 Pessoas</strong>
        <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>{lista.length}</span>
        <button type="button" onClick={onFechar} title="Esconder a lista" style={{ marginLeft: "auto", border: 0, background: "none", cursor: "pointer", color: "#94A3B8", fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontSize: 12.5, color: alvo ? "#B91C1C" : "#64748B", lineHeight: 1.45, fontWeight: alvo ? 800 : 500 }}>
        {alvo ? "Solte aqui para tirar do turno" : "Arraste para um turno para escalar. Arraste de um turno para cá para tirar."}
      </div>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou função" style={{ ...S.campo, padding: "8px 10px", fontSize: 14 }} />
      <div style={{ display: "flex", gap: 4 }}>
        {FILTROS.map(([f, r]) => (
          <button key={f} type="button" onClick={() => setFiltro(f)} title={f === "todos" ? "Todos" : SELO_DO_TIPO[f].rotulo}
            style={{ flex: 1, height: 30, borderRadius: 8, border: `1.5px solid ${filtro === f ? COR : "#E2E8F0"}`, background: filtro === f ? COR_CLARA : "#fff", color: filtro === f ? COR : "#475569", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            {r}
          </button>
        ))}
      </div>
      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, margin: "0 -4px", padding: "0 4px" }}>
        {lista.length === 0 && <div style={{ fontSize: 13, color: "#94A3B8", padding: 8 }}>Ninguém aqui. Cadastre na aba Pessoas.</div>}
        {lista.map((p) => {
          const n = turnosDe.get(`${p.tipo}:${p.id}`) || 0;
          return (
            <div key={`${p.tipo}:${p.id}`} draggable className="esc-arrastavel"
              onDragStart={(e) => comecarArrasto(e, { tipo: "pessoa", pessoaTipo: p.tipo, pessoaId: p.id, nome: p.nome })}
              onDragEnd={() => { arrastoAtual.valor = null; }}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 10, border: "1px solid #F1F5F9", background: "#fff", cursor: "grab" }}>
              <Avatar nome={p.nome} tipo={p.tipo} tamanho={30} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome}</div>
                <div style={{ fontSize: 11.5, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.funcao || SELO_DO_TIPO[p.tipo].rotulo}</div>
              </div>
              <span title={`${n} turno${n === 1 ? "" : "s"} neste período`} style={{ ...S.chip, fontSize: 11, padding: "1px 7px", color: n ? COR : "#94A3B8", background: n ? COR_CLARA : "#F8FAFC" }}>{n}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
