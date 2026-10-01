"use client";

/**
 * Lançar despesa à mão dentro do DRE.
 *
 * O DRE só enxergava o que nasce do pedido (taxa, motoboy) e o custo fixo
 * mensal. O gás que acabou, a embalagem, o conserto da chapa e a diária do
 * ajudante não tinham onde entrar, e o lucro aparecia maior do que era.
 *
 * A categoria é texto livre com sugestões: a loja escreve do jeito dela, e as
 * que ela já usou voltam primeiro na lista, para "Gás" não virar "gas", "GÁS"
 * e "Botijão" no mesmo mês.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

// ── Aviso que desce do topo e some sozinho (no lugar do alert()) ──────────
// Mesma interface do components/AvisoNoTopo.tsx de outra frente, que ainda não
// foi publicado: quando ele estiver no master, basta trocar este bloco pelo import.
type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

export type DespesaDTO = {
  id: string;
  dia: string; // YYYY-MM-DD
  categoria: string;
  descricao: string | null;
  valor: number;
};

const SUGESTOES = [
  "Gás",
  "Embalagens",
  "Material de limpeza",
  "Manutenção e conserto",
  "Diária / ajudante",
  "Marketing e anúncios",
  "Combustível",
  "Impostos e taxas",
  "Compras de insumos",
  "Outros",
];

const fmtR = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

/** Sem passar por Date: "2026-10-01" é 01/10 em qualquer fuso. */
const fmtDia = (dia: string) => {
  const [y, m, d] = dia.split("-");
  return `${d}/${m}/${y}`;
};

export const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function DespesasLancadas({
  todas,
  doPeriodo,
  onMudou,
}: {
  todas: DespesaDTO[];
  doPeriodo: DespesaDTO[];
  onMudou: (despesas: DespesaDTO[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [verLista, setVerLista] = useState(false);
  const [dia, setDia] = useState(hojeLocal);
  const [categoria, setCategoria] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  // As categorias que a loja já usou vêm antes das sugestões.
  const opcoes = useMemo(() => {
    const usadas = Array.from(new Set(todas.map((d) => d.categoria)));
    const vistas = new Set(usadas.map((c) => c.toLowerCase()));
    return [...usadas, ...SUGESTOES.filter((s) => !vistas.has(s.toLowerCase()))];
  }, [todas]);

  const lancar = async () => {
    if (!categoria.trim()) return setAviso({ tipo: "atencao", titulo: "Escolha ou escreva a categoria." });
    if (!valor.trim()) return setAviso({ tipo: "atencao", titulo: "Informe o valor da despesa." });
    setSalvando(true);
    try {
      const res = await fetch("/api/store/despesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dia, categoria: categoria.trim(), descricao, valor }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "erro", titulo: "Não deu para lançar a despesa", detalhe: data?.error });
        return;
      }
      const d = data.despesa;
      onMudou([{ id: d.id, dia: d.dia, categoria: d.categoria, descricao: d.descricao, valor: d.valor }, ...todas]);
      setDescricao("");
      setValor("");
      setAviso({ tipo: "ok", titulo: `Despesa de ${fmtR(d.valor)} lançada em ${fmtDia(d.dia)}` });
    } catch {
      setAviso({ tipo: "erro", titulo: "Sem conexão. A despesa não foi lançada." });
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async (id: string) => {
    setApagando(id);
    try {
      const res = await fetch(`/api/store/despesas?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "erro", titulo: "Não deu para apagar", detalhe: data?.error });
        return;
      }
      onMudou(todas.filter((d) => d.id !== id));
    } catch {
      setAviso({ tipo: "erro", titulo: "Sem conexão. Nada foi apagado." });
    } finally {
      setApagando(null);
    }
  };

  const campo: React.CSSProperties = {
    padding: "9px 12px", border: "1.5px solid #E2E8F0", borderRadius: 8,
    fontSize: "0.85rem", fontFamily: "inherit", background: "#fff", minWidth: 0,
  };

  return (
    <div style={{ padding: "10px 24px 14px", borderTop: "1px solid #F1F5F9" }}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => setAberto((v) => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: aberto ? "#F1F5F9" : "#E11D48", color: aberto ? "#475569" : "#fff",
            border: "none", borderRadius: 8, padding: "8px 14px",
            fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {aberto ? <X size={14} /> : <Plus size={14} />} {aberto ? "Fechar" : "Lançar despesa"}
        </button>
        {doPeriodo.length > 0 && (
          <button
            onClick={() => setVerLista((v) => !v)}
            style={{
              background: "none", border: "1px dashed #CBD5E1", borderRadius: 8, padding: "7px 12px",
              color: "#475569", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {verLista ? "▲ Esconder lançamentos" : `▼ Ver os ${doPeriodo.length} lançamentos do período`}
          </button>
        )}
      </div>

      {aberto && (
        <div style={{ marginTop: 12, background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 12, padding: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>
              Data
              <input type="date" value={dia} max={hojeLocal()} onChange={(e) => setDia(e.target.value)} style={campo} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>
              Categoria
              <input
                list="categorias-de-despesa"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Ex.: Gás"
                maxLength={60}
                style={campo}
              />
              <datalist id="categorias-de-despesa">
                {opcoes.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>
              Valor (R$)
              <input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                style={campo}
              />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: "#475569", marginTop: 10 }}>
            Descrição (opcional)
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !salvando) lancar(); }}
              placeholder="Ex.: botijão P13 da semana"
              maxLength={200}
              style={campo}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.72rem", color: "#9F1239", flex: "1 1 220px" }}>
              Entra no DRE do período em que a data cai. Aluguel e salário ficam em Custos Fixos, para não contar duas vezes.
            </span>
            <button
              onClick={lancar}
              disabled={salvando}
              style={{
                background: "#E11D48", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px",
                fontWeight: 800, fontSize: "0.82rem", cursor: salvando ? "wait" : "pointer",
                opacity: salvando ? 0.7 : 1, fontFamily: "inherit",
              }}
            >
              {salvando ? "Lançando..." : "Lançar"}
            </button>
          </div>
        </div>
      )}

      {verLista && doPeriodo.length > 0 && (
        <div style={{ marginTop: 12, border: "1px solid #F1F5F9", borderRadius: 10, overflow: "hidden" }}>
          {doPeriodo.map((d) => (
            <div
              key={d.id}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                borderTop: "1px solid #F1F5F9", fontSize: "0.82rem",
              }}
            >
              <span style={{ color: "#94A3B8", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtDia(d.dia)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong style={{ color: "#0F172A" }}>{d.categoria}</strong>
                {d.descricao && <span style={{ color: "#64748B" }}> · {d.descricao}</span>}
              </span>
              <span style={{ color: "#C92E09", fontWeight: 700, flexShrink: 0 }}>{fmtR(-d.valor)}</span>
              <button
                onClick={() => apagar(d.id)}
                disabled={apagando === d.id}
                title="Apagar lançamento"
                aria-label={`Apagar ${d.categoria} de ${fmtDia(d.dia)}`}
                style={{
                  background: "none", border: "none", cursor: "pointer", color: "#94A3B8",
                  padding: 4, display: "flex", opacity: apagando === d.id ? 0.4 : 1,
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
