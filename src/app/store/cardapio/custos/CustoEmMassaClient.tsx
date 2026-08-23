"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Save, CheckCircle, AlertTriangle, Search, TrendingUp } from "lucide-react";

type Product = { id: string; name: string; price: number; cost: number; category: string; active: boolean };

function fmtR(v: number) { return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function margem(price: number, cost: number) {
  if (!cost || !price) return null;
  return (((price - cost) / price) * 100).toFixed(0);
}

export default function CustoEmMassaClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [custos, setCustos] = useState<Record<string, string>>(
    Object.fromEntries(products.map(p => [p.id, p.cost > 0 ? String(p.cost) : ""]))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterSemCusto, setFilterSemCusto] = useState(false);

  const categories = useMemo(() => [...new Set(products.map(p => p.category))], [products]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (filterSemCusto && custos[p.id]) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.category.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, custos, search, filterSemCusto]);

  const semCustoCount = products.filter(p => !custos[p.id] || parseFloat(custos[p.id]) === 0).length;
  const preenchidos = products.filter(p => custos[p.id] && parseFloat(custos[p.id]) > 0).length;

  const handleSaveAll = async () => {
    setSaving(true);
    const toSave = products.filter(p => {
      const val = parseFloat(custos[p.id] || "0");
      return val > 0 && val !== p.cost;
    });

    const savedIds: string[] = [];
    for (const p of toSave) {
      const res = await fetch("/api/admin/menu-products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, cost: parseFloat(custos[p.id]) }),
      });
      if (res.ok) savedIds.push(p.id);
    }
    setSaved(savedIds);
    setSaving(false);
    setTimeout(() => { setSaved([]); router.refresh(); }, 2500);
  };

  const handleSaveOne = async (id: string) => {
    const val = parseFloat(custos[id] || "0");
    await fetch("/api/admin/menu-products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, cost: val }),
    });
    setSaved([id]);
    setTimeout(() => setSaved([]), 2000);
  };

  const byCategory = useMemo(() => {
    const map: Record<string, Product[]> = {};
    filtered.forEach(p => {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    });
    return map;
  }, [filtered]);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8FAFC", minHeight: "100vh", padding: "1.5rem" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontWeight: 900, fontSize: "1.5rem", color: "#0F172A", margin: 0 }}>
              💰 Custo em Massa
            </h1>
            <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "4px 0 0" }}>
              Preencha o custo de cada produto de uma vez · Impacta diretamente o CMV no DRE
            </p>
          </div>
          <button
            onClick={handleSaveAll}
            disabled={saving}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: saving ? "#94A3B8" : "#0F172A", color: "#fff",
              border: "none", borderRadius: "12px", padding: "12px 24px",
              fontWeight: 800, fontSize: "0.9rem", cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}>
            <Save size={16} />
            {saving ? "Salvando..." : "Salvar Todos"}
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "16px 20px", marginBottom: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0F172A" }}>
              {preenchidos} de {products.length} produtos com custo
            </span>
            <span style={{ fontSize: "0.82rem", color: semCustoCount > 0 ? "#F59E0B" : "#16A34A", fontWeight: 700 }}>
              {semCustoCount > 0 ? `⚠️ ${semCustoCount} sem custo` : "✅ Completo!"}
            </span>
          </div>
          <div style={{ height: "8px", background: "#F1F5F9", borderRadius: "999px", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: "999px",
              background: preenchidos === products.length ? "#16A34A" : "#F59E0B",
              width: `${(preenchidos / products.length) * 100}%`,
              transition: "width 0.3s",
            }} />
          </div>
        </div>

        {/* Filtros */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "1rem", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: "200px", display: "flex", alignItems: "center", gap: "8px", background: "#fff", borderRadius: "10px", border: "1.5px solid #E2E8F0", padding: "8px 12px" }}>
            <Search size={15} color="#94A3B8" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar produto..."
              style={{ border: "none", outline: "none", background: "transparent", fontSize: "0.83rem", width: "100%", fontFamily: "inherit" }} />
          </div>
          <button
            onClick={() => setFilterSemCusto(v => !v)}
            style={{
              padding: "9px 16px", borderRadius: "10px", fontWeight: 700, fontSize: "0.8rem",
              border: filterSemCusto ? "none" : "1.5px solid #FCD34D",
              background: filterSemCusto ? "#F59E0B" : "#FFFBEB",
              color: filterSemCusto ? "#fff" : "#92400E", cursor: "pointer", fontFamily: "inherit",
            }}>
            {filterSemCusto ? "⚠️ Só sem custo (ativo)" : "⚠️ Só sem custo"}
          </button>
        </div>

        {/* Tabela por categoria */}
        {Object.entries(byCategory).map(([cat, prods]) => (
          <div key={cat} style={{ background: "#fff", borderRadius: "14px", marginBottom: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9", overflow: "hidden" }}>
            <div style={{ padding: "10px 20px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "#475569" }}>📂 {cat}</span>
              <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>({prods.length} produtos)</span>
            </div>

            {/* Cabeçalho */}
            <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1.2fr 1fr auto", gap: "0", padding: "8px 20px", borderBottom: "1px solid #F1F5F9" }}>
              {["Produto", "Preço Venda", "Custo (R$)", "Margem", ""].map((h, i) => (
                <span key={i} style={{ fontSize: "0.68rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>{h}</span>
              ))}
            </div>

            {prods.map((p, idx) => {
              const custoVal = parseFloat(custos[p.id] || "0");
              const m = margem(p.price, custoVal);
              const isSaved = saved.includes(p.id);
              const hasChanged = custoVal !== p.cost && custoVal > 0;

              return (
                <div key={p.id} style={{
                  display: "grid", gridTemplateColumns: "3fr 1fr 1.2fr 1fr auto",
                  gap: "0", padding: "10px 20px", alignItems: "center",
                  borderBottom: idx < prods.length - 1 ? "1px solid #F9FAFB" : "none",
                  background: isSaved ? "#F0FDF4" : "transparent",
                  transition: "background 0.3s",
                }}>
                  {/* Nome */}
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "0.85rem", color: "#0F172A", margin: 0 }}>
                      {p.name}
                      {!p.active && <span style={{ fontSize: "0.65rem", color: "#EF4444", marginLeft: "6px" }}>⏸️</span>}
                    </p>
                  </div>

                  {/* Preço */}
                  <div>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#16A34A" }}>{fmtR(p.price)}</span>
                  </div>

                  {/* Input custo */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "0.8rem", color: "#94A3B8", fontWeight: 600 }}>R$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={custos[p.id]}
                        onChange={e => setCustos(prev => ({ ...prev, [p.id]: e.target.value }))}
                        onBlur={() => { if (hasChanged) handleSaveOne(p.id); }}
                        placeholder="0,00"
                        style={{
                          width: "80px", padding: "5px 8px", borderRadius: "8px",
                          border: `1.5px solid ${custos[p.id] ? (parseFloat(custos[p.id]) > p.price ? "#EF4444" : "#10B981") : "#E2E8F0"}`,
                          fontSize: "0.85rem", outline: "none", fontFamily: "inherit",
                          background: custos[p.id] ? "#F0FDF4" : "#F8FAFC",
                        }}
                      />
                    </div>
                    {custoVal > p.price && (
                      <p style={{ fontSize: "0.65rem", color: "#EF4444", margin: "2px 0 0", fontWeight: 600 }}>⚠️ Custo &gt; Preço!</p>
                    )}
                  </div>

                  {/* Margem */}
                  <div>
                    {m ? (
                      <span style={{
                        fontSize: "0.78rem", fontWeight: 800,
                        color: parseInt(m) < 20 ? "#EF4444" : parseInt(m) < 40 ? "#F59E0B" : "#16A34A",
                      }}>
                        {m}%
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.75rem", color: "#CBD5E1" }}>—</span>
                    )}
                  </div>

                  {/* Salvo */}
                  <div style={{ width: "24px" }}>
                    {isSaved && <CheckCircle size={16} color="#16A34A" />}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div style={{ textAlign: "center", padding: "1rem" }}>
          <p style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
            💡 O custo é salvo automaticamente quando você sai do campo. Ou clique "Salvar Todos" para salvar tudo de uma vez.
          </p>
        </div>
      </div>
    </div>
  );
}
