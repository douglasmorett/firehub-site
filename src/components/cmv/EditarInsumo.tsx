"use client";
/**
 * Editar um insumo com o que o CMV real precisa (lib/cmv):
 *   - onde ele fica (local) e se entra na contagem do dia;
 *   - se está fora do CMV (limpeza, gás);
 *   - se é PREPARO (massa, recheio): a receita de UM lote e quanto o lote
 *     rende. O custo do preparo sai daí, e a contagem do recheio pronto vira R$.
 *
 * Antes desta tela, um insumo cadastrado só mudava nome, unidade e mínimo.
 */
import React, { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { lerNumeroBr } from "@/lib/cmv/numero";

export type InsumoEditavel = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  minQuantity: number | null;
  unitCost: number | null;
  tipo?: string | null;
  rendimento?: number | null;
  local?: string | null;
  contagemDiaria?: boolean | null;
  entraNoCmv?: boolean | null;
  componentes?: { insumoId: string; quantidade: number }[];
};

const LOCAIS = ["Freezer", "Geladeira", "Câmara fria", "Estoque seco", "Bancada", "Bebidas", "Embalagens"];
const UNIDADES = ["g", "kg", "ml", "l", "un"];
const fmt = (n: number, casas = 4) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: casas });

export default function EditarInsumo({ item, todos, onFechar, onSalvo }: {
  item: InsumoEditavel;
  todos: InsumoEditavel[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(item.name);
  const [unidade, setUnidade] = useState(item.unit);
  const [minimo, setMinimo] = useState(item.minQuantity != null ? String(item.minQuantity).replace(".", ",") : "");
  const [custo, setCusto] = useState(item.unitCost != null ? String(item.unitCost).replace(".", ",") : "");
  const [local, setLocal] = useState(item.local || "");
  const [diaria, setDiaria] = useState(Boolean(item.contagemDiaria));
  const [foraDoCmv, setForaDoCmv] = useState(item.entraNoCmv === false);
  const [preparo, setPreparo] = useState(String(item.tipo || "").toUpperCase() === "PREPARO");
  const [rendimento, setRendimento] = useState(item.rendimento != null ? String(item.rendimento).replace(".", ",") : "");
  const [comps, setComps] = useState<{ insumoId: string; quantidade: string }[]>(
    (item.componentes || []).map((c) => ({ insumoId: c.insumoId, quantidade: String(c.quantidade).replace(".", ",") })),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const outros = todos.filter((t) => t.id !== item.id);
  const porId = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos]);
  const locais = useMemo(() => Array.from(new Set([...LOCAIS, ...todos.map((t) => t.local).filter(Boolean) as string[]])), [todos]);

  // Custo do lote pelo custo atual de cada componente (o painel usa o custo
  // da última compra até o dia da contagem; aqui é a prévia de hoje).
  const prevista = useMemo(() => {
    let total = 0, faltam: string[] = [];
    for (const c of comps) {
      const i = porId.get(c.insumoId);
      const q = lerNumeroBr(c.quantidade);
      if (!i || !(q > 0)) continue;
      if (i.unitCost == null || !(i.unitCost > 0)) { faltam.push(i.name); continue; }
      total += q * i.unitCost;
    }
    const r = lerNumeroBr(rendimento);
    return { total, porUnidade: r > 0 ? total / r : null, faltam };
  }, [comps, rendimento, porId]);

  const salvar = async () => {
    setErro(null);
    if (!nome.trim()) { setErro("Dê um nome ao insumo."); return; }
    if (preparo) {
      if (!(lerNumeroBr(rendimento) > 0)) { setErro("Informe quanto um lote rende."); return; }
      if (comps.some((c) => c.insumoId && !(lerNumeroBr(c.quantidade) > 0))) { setErro("Há um componente sem quantidade."); return; }
    }
    setSalvando(true);
    try {
      const custoMudou = custo.trim() !== (item.unitCost != null ? String(item.unitCost).replace(".", ",") : "");
      const r = await fetch("/api/store/estoque/items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          name: nome.trim(),
          unit: unidade,
          minQuantity: minimo.trim() === "" ? "" : lerNumeroBr(minimo),
          tipo: preparo ? "PREPARO" : "INSUMO",
          rendimento: preparo ? rendimento : "",
          local,
          contagemDiaria: diaria,
          entraNoCmv: !foraDoCmv,
          ...(custoMudou ? { custoManual: custo } : {}),
          componentes: preparo ? comps.filter((c) => c.insumoId).map((c) => ({ insumoId: c.insumoId, quantidade: c.quantidade })) : [],
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não salvou.");
      onSalvo();
    } catch (e: any) { setErro(e.message); } finally { setSalvando(false); }
  };

  const campo: React.CSSProperties = { border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.5rem 0.6rem", fontSize: "0.92rem", minWidth: 0 };
  const rotulo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.76rem", fontWeight: 800, color: PALETA.areiaTinta, minWidth: 0 };
  const marca: React.CSSProperties = { display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.86rem", cursor: "pointer" };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="editar-insumo-titulo" onClick={onFechar}
      style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,.45)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "4vh 12px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 620, padding: "1.1rem 1.1rem 1.25rem", color: PALETA.carvao, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
          <h2 id="editar-insumo-titulo" style={{ margin: 0, fontSize: "1.15rem", fontWeight: 900 }}>Editar insumo</h2>
          <button type="button" aria-label="Fechar" onClick={onFechar} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.7rem" }}>
          <label style={{ ...rotulo, gridColumn: "1 / -1" }}>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} style={campo} /></label>
          <label style={rotulo}>Unidade do estoque
            <select value={unidade} onChange={(e) => setUnidade(e.target.value)} style={campo}>
              {Array.from(new Set([unidade, ...UNIDADES])).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label style={rotulo}>Estoque mínimo ({unidade})<input inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} style={campo} /></label>
          {!preparo && (
            <label style={rotulo}>Custo por {unidade} (R$)
              <input inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} style={campo} placeholder="vem da última compra" />
            </label>
          )}
          <label style={rotulo}>Onde fica
            <input list="locais-do-estoque" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Freezer, Geladeira..." style={campo} />
            <datalist id="locais-do-estoque">{locais.map((l) => <option key={l} value={l} />)}</datalist>
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", margin: "1rem 0" }}>
          <label style={marca}>
            <input type="checkbox" checked={diaria} onChange={(e) => setDiaria(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
            <span><strong>Contar todo dia</strong><br /><span style={{ color: PALETA.areiaTinta, fontSize: "0.8rem" }}>Entra na contagem rápida do fechamento. Marque os 10 a 20 que mais pesam no CMV.</span></span>
          </label>
          <label style={marca}>
            <input type="checkbox" checked={foraDoCmv} onChange={(e) => setForaDoCmv(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
            <span><strong>Fora do CMV</strong><br /><span style={{ color: PALETA.areiaTinta, fontSize: "0.8rem" }}>Material de limpeza, gás, descartável de cozinha: é despesa, não custo da comida.</span></span>
          </label>
          <label style={marca}>
            <input type="checkbox" checked={preparo} onChange={(e) => setPreparo(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
            <span><strong>É um preparo da cozinha</strong><br /><span style={{ color: PALETA.areiaTinta, fontSize: "0.8rem" }}>Massa, recheio, molho. O custo sai da receita do lote, e a contagem do que está pronto vira R$.</span></span>
          </label>
        </div>

        {preparo && (
          <section style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.8rem", background: PALETA.areia }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.92rem", fontWeight: 900 }}>Receita de UM lote</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {comps.map((c, i) => {
                const ins = porId.get(c.insumoId);
                return (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <select aria-label={`Componente ${i + 1}`} value={c.insumoId} onChange={(e) => setComps((l) => l.map((x, j) => (j === i ? { ...x, insumoId: e.target.value } : x)))} style={{ ...campo, flex: "2 1 180px" }}>
                      <option value="">Escolha o insumo…</option>
                      {outros.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.unit})</option>)}
                    </select>
                    <input aria-label={`Quantidade ${i + 1}`} inputMode="decimal" value={c.quantidade} placeholder="qtd." onChange={(e) => setComps((l) => l.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)))} style={{ ...campo, flex: "1 1 80px", textAlign: "right" }} />
                    <span style={{ width: 28, fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta }}>{ins?.unit || ""}</span>
                    <button type="button" aria-label={`Tirar componente ${i + 1}`} onClick={() => setComps((l) => l.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", color: PALETA.areiaTinta }}><X size={15} /></button>
                  </div>
                );
              })}
              <button type="button" onClick={() => setComps((l) => [...l, { insumoId: "", quantidade: "" }])} style={{ alignSelf: "flex-start", border: "none", background: "none", color: PALETA.marca, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}>
                <Plus size={14} /> Componente
              </button>
            </div>
            <label style={{ ...rotulo, marginTop: "0.8rem", maxWidth: 260 }}>O lote rende ({unidade})
              <input inputMode="decimal" value={rendimento} onChange={(e) => setRendimento(e.target.value)} placeholder="ex.: 1.315" style={campo} />
            </label>
            <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, margin: "0.4rem 0 0" }}>
              Pese o lote pronto (depois de escorrer, cozinhar ou descansar). Com perda de líquido de 20%, um lote de 1,64 kg de ingredientes rende uns 1.315 g.
            </p>
            {prevista.total > 0 && (
              <p style={{ fontSize: "0.86rem", fontWeight: 800, margin: "0.6rem 0 0" }}>
                Lote de hoje: R$ {fmt(prevista.total, 2)}{prevista.porUnidade != null && <> · R$ {fmt(prevista.porUnidade)} por {unidade}</>}
              </p>
            )}
            {prevista.faltam.length > 0 && (
              <p style={{ fontSize: "0.78rem", color: PALETA.atencao, fontWeight: 700, margin: "0.3rem 0 0" }}>Sem custo ainda: {prevista.faltam.join(", ")}. Lance uma compra deles.</p>
            )}
          </section>
        )}

        {erro && <div role="alert" style={{ marginTop: "0.8rem", background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, color: PALETA.grave, borderRadius: 10, padding: "0.6rem 0.8rem", fontWeight: 700, fontSize: "0.86rem" }}>{erro}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
          <button type="button" className="btn btn-primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</button>
          <button type="button" className="btn btn-outline" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
