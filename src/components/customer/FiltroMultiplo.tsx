"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X, Check } from "lucide-react";

/**
 * Filtro de marcar vários, com busca.
 *
 * ── Por que não um `<select multiple>` ──────────────────────────────────────
 *
 * O nativo exige Ctrl+clique para marcar o segundo item — e quem não sabe
 * disso perde o primeiro ao clicar no segundo, sem entender por quê. Também
 * não tem busca: a NIK tem 20 categorias e centenas de produtos, e achar
 * "Esfihas Doces" numa caixa de rolagem de 4 linhas é caçar.
 *
 * Aqui é caixinha de marcar, com busca e com o que está marcado aparecendo em
 * etiquetas ABAIXO do campo — o lojista vê o filtro ativo sem precisar abrir a
 * lista, que é o que faz a tela se explicar sozinha.
 *
 * ── Nada marcado = TODOS ────────────────────────────────────────────────────
 *
 * Lista vazia não é "nenhum", é "todos". É o estado em que a tela abre e o
 * único que o lojista consegue alcançar sem querer (desmarcando tudo) — e
 * relatório que zera porque alguém desmarcou o último item pareceria quebrado.
 */

export type OpcaoDoFiltro = {
  valor: string;
  rotulo: string;
  /** Texto pequeno à direita (categoria do produto, canal da loja…). */
  detalhe?: string;
  /** Bolinha colorida antes do nome, quando a opção tem cor própria. */
  cor?: string;
};

export default function FiltroMultiplo({
  rotulo,
  opcoes,
  selecionados,
  onChange,
  textoTodos,
  placeholderBusca = "buscar…",
  nomeDoTipo,
}: {
  /** O título acima do campo, com emoji. */
  rotulo: string;
  opcoes: OpcaoDoFiltro[];
  selecionados: string[];
  onChange: (novos: string[]) => void;
  /** O que aparece quando nada está marcado. Ex.: "Todas as categorias (20)". */
  textoTodos: string;
  placeholderBusca?: string;
  /** Plural do que se marca aqui: "categorias", "produtos", "lojas". */
  nomeDoTipo: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const caixa = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora e no Esc. Sem isso, dois filtros abertos ao mesmo
  // tempo cobrem a tela e o lojista não acha o relatório embaixo.
  useEffect(() => {
    if (!aberto) return;
    const foraDaCaixa = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", foraDaCaixa);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", foraDaCaixa);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const marcados = useMemo(() => new Set(selecionados), [selecionados]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return opcoes;
    return opcoes.filter(o =>
      o.rotulo.toLowerCase().includes(q) || (o.detalhe || "").toLowerCase().includes(q));
  }, [opcoes, busca]);

  const alternar = (valor: string) => {
    const novo = new Set(selecionados);
    if (novo.has(valor)) novo.delete(valor); else novo.add(valor);
    onChange(Array.from(novo));
  };

  // O resumo no campo fechado: o NOME quando é um só (é a informação), a
  // contagem quando são vários (os nomes não caberiam e cortar engana).
  const resumo = selecionados.length === 0
    ? textoTodos
    : selecionados.length === 1
      ? (opcoes.find(o => o.valor === selecionados[0])?.rotulo || `1 ${nomeDoTipo}`)
      : `${selecionados.length} ${nomeDoTipo}`;

  const etiquetas = selecionados
    .map(v => opcoes.find(o => o.valor === v))
    .filter(Boolean) as OpcaoDoFiltro[];

  return (
    <div ref={caixa} style={{ position: "relative" }}>
      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: 6 }}>
        {rotulo}
      </label>

      <button
        type="button"
        onClick={() => { setAberto(a => !a); setBusca(""); }}
        style={{
          width: "100%", padding: "9px 30px 9px 12px", borderRadius: 10,
          border: `1.5px solid ${selecionados.length > 0 ? "#E8360C" : "#E2E8F0"}`,
          fontSize: "0.85rem", color: "#0F172A",
          background: selecionados.length > 0 ? "#FFF4EF" : "#fff",
          outline: "none", cursor: "pointer", fontFamily: "inherit",
          textAlign: "left", fontWeight: selecionados.length > 0 ? 800 : 400,
          display: "block", position: "relative", whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {resumo}
        <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748B" }} />
      </button>

      {aberto && (
        <div style={{
          position: "absolute", zIndex: 40, top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12,
          boxShadow: "0 12px 28px rgba(15,23,42,0.14)", overflow: "hidden",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid #F1F5F9", position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
            <input
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder={placeholderBusca}
              style={{
                width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8,
                border: "1.5px solid #E2E8F0", fontSize: "0.82rem", outline: "none", fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            <button
              type="button"
              onClick={() => onChange([])}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "9px 12px", border: "none", background: selecionados.length === 0 ? "#FFF4EF" : "#fff",
                cursor: "pointer", fontFamily: "inherit", fontSize: "0.83rem",
                fontWeight: 800, color: "#0F172A", textAlign: "left",
                borderBottom: "1px solid #F1F5F9",
              }}
            >
              <Quadradinho marcado={selecionados.length === 0} />
              {textoTodos}
            </button>

            {filtradas.length === 0 && (
              <div style={{ padding: "1.25rem 12px", textAlign: "center", color: "#94A3B8", fontSize: "0.82rem" }}>
                Nada encontrado para “{busca}”.
              </div>
            )}

            {filtradas.map(o => {
              const marcado = marcados.has(o.valor);
              return (
                <button
                  key={o.valor}
                  type="button"
                  onClick={() => alternar(o.valor)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", border: "none", background: marcado ? "#FFF4EF" : "#fff",
                    cursor: "pointer", fontFamily: "inherit", fontSize: "0.83rem",
                    color: "#0F172A", textAlign: "left",
                  }}
                >
                  <Quadradinho marcado={marcado} />
                  {o.cor && <span style={{ width: 8, height: 8, borderRadius: 4, background: o.cor, flexShrink: 0 }} />}
                  <span style={{ flex: 1, fontWeight: marcado ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.rotulo}
                  </span>
                  {o.detalhe && (
                    <span style={{ fontSize: "0.72rem", color: "#94A3B8", flexShrink: 0 }}>{o.detalhe}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderTop: "1px solid #F1F5F9", background: "#F8FAFC" }}>
            <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 700 }}>
              {selecionados.length === 0 ? `Todos — ${opcoes.length} ${nomeDoTipo}` : `${selecionados.length} de ${opcoes.length} marcados`}
            </span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selecionados.length === 0}
              style={{
                border: "none", background: "none", padding: 0,
                fontSize: "0.75rem", fontWeight: 800, fontFamily: "inherit",
                color: selecionados.length === 0 ? "#CBD5E1" : "#E8360C",
                cursor: selecionados.length === 0 ? "default" : "pointer",
              }}
            >
              Limpar
            </button>
          </div>
        </div>
      )}

      {etiquetas.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {etiquetas.map(o => (
            <span key={o.valor} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 6px 3px 8px", borderRadius: 999,
              background: "#FFF4EF", border: "1px solid #FFD3C2",
              fontSize: "0.72rem", fontWeight: 700, color: "#9A3412", maxWidth: "100%",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.rotulo}</span>
              <button
                type="button"
                aria-label={`Tirar ${o.rotulo} do filtro`}
                onClick={() => alternar(o.valor)}
                style={{ border: "none", background: "none", padding: 0, display: "flex", cursor: "pointer", color: "#9A3412" }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Quadradinho({ marcado }: { marcado: boolean }) {
  return (
    <span style={{
      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
      border: `1.5px solid ${marcado ? "#E8360C" : "#CBD5E1"}`,
      background: marcado ? "#E8360C" : "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {marcado && <Check size={11} color="#fff" strokeWidth={3.5} />}
    </span>
  );
}
