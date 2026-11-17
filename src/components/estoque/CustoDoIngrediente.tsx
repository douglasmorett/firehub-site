"use client";
import { useState } from "react";
import { lerNumeroBr } from "@/lib/cmv/numero";
import type { CustoDoIngrediente as Custo } from "@/lib/estoque/custo-da-ficha";

export default function CustoDoIngrediente({ item, custo, quantidade, onSalvo, onPreparo }: {
  item?: { id: string; name: string; unit: string; tipo?: string | null };
  custo?: Custo; quantidade: string; onSalvo: () => void; onPreparo: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  if (!item) return <span>—</span>;
  const preparo = item.tipo?.toUpperCase() === "PREPARO";
  const moeda = (n: number, casas = 2) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: casas });
  const qtd = Number(quantidade.replace(",", "."));
  const salvar = async () => {
    const n = lerNumeroBr(valor);
    if (!Number.isFinite(n) || n <= 0) { setErro("Informe um custo maior que zero."); return; }
    setSalvando(true); setErro("");
    try {
      const r = await fetch("/api/store/estoque/custo", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, custo: n }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível salvar.");
      setEditando(false); onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setSalvando(false); }
  };
  return <div style={{ minWidth: 150, fontSize: 12, display: "grid", gap: 5 }}>
    <span>{custo?.foraDoCmv ? "Fora do CMV" : custo?.custo == null ? "Custo incompleto" : `${moeda(custo.custo, 6)} / ${item.unit}`}</span>
    <strong>Nesta ficha: {custo?.custo != null && Number.isFinite(qtd) && qtd > 0 ? moeda(custo.custo * qtd) : "—"}</strong>
    {editando ? <>
      <label>Custo por {item.unit} (R$)<input aria-label={`Custo por ${item.unit} de ${item.name}`} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!salvando) void salvar(); } }} disabled={salvando} /></label>
      <small>Vale a partir de hoje para todas as fichas que usam este insumo. Não altera o saldo do estoque.</small>
      <div style={{ display: "flex", gap: 8 }}><button type="button" className="btn-secondary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar custo"}</button><button type="button" className="btn-secondary" disabled={salvando} onClick={() => { setEditando(false); setErro(""); }}>Cancelar</button></div>
    </> : <button type="button" className="btn-configure" aria-label={`Editar ${preparo ? "preparo" : "custo de"} ${item.name}`} onClick={() => {
      if (preparo) { onPreparo(); return; }
      setValor(custo?.custo != null ? String(custo.custo).replace(".", ",") : ""); setErro(""); setEditando(true);
    }}>{preparo ? "Editar preparo" : "Editar custo"}</button>}
    {erro && <span role="alert" style={{ color: "#b91c1c" }}>{erro}</span>}
  </div>;
}
