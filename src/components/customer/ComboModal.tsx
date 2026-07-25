"use client";
import { useState } from "react";
import { X, Plus, Minus, Check } from "lucide-react";

type ComboGroupData = {
  id: string;
  title: string;
  maxQty: number;
  items: { id: string; additionalPrice?: number; menuProduct: { id: string; name: string; active: boolean; imageUrl: string | null } }[];
};

type Selections = Record<string, Record<string, number>>;

export default function ComboModal({ product, onClose, onConfirm }: {
  product: { id: string; name: string; price: number; imageUrl?: string | null; comboGroups: ComboGroupData[] };
  onClose: () => void;
  onConfirm: (selections: Selections, extraSum: number) => void;
}) {
  const groups = product.comboGroups || [];
  const [selections, setSelections] = useState<Selections>(() => {
    const init: Selections = {};
    groups.forEach(g => { init[g.id] = {}; });
    return init;
  });

  const getGroupTotal = (gId: string) => Object.values(selections[gId] || {}).reduce((s, v) => s + v, 0);

  const updateQty = (gId: string, optionName: string, delta: number) => {
    setSelections(prev => {
      const group = { ...prev[gId] };
      const maxQty = groups.find(g => g.id === gId)!.maxQty;
      const currentTotal = Object.values(group).reduce((s, v) => s + v, 0);
      const current = group[optionName] || 0;
      const newVal = current + delta;
      if (newVal < 0 || (delta > 0 && currentTotal >= maxQty)) return prev;
      if (newVal === 0) delete group[optionName]; else group[optionName] = newVal;
      return { ...prev, [gId]: group };
    });
  };

  const allComplete = groups.every(g => getGroupTotal(g.id) === g.maxQty);

  const extraSum = groups.reduce((sum, group) => {
    const groupSelections = selections[group.id] || {};
    return sum + group.items.reduce((gSum, item) => {
      const qty = groupSelections[item.menuProduct.name] || 0;
      const addPrice = item.additionalPrice || 0;
      return gSum + (qty * addPrice);
    }, 0);
  }, 0);

  const finalPrice = product.price + extraSum;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ backgroundColor: "white", borderRadius: "16px", width: "100%", maxWidth: "520px", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {product.imageUrl && <img src={product.imageUrl} alt="" style={{ width: "50px", height: "50px", borderRadius: "10px", objectFit: "cover" }} />}
            <div>
              <h3 style={{ fontWeight: 700, fontSize: "1.05rem" }}>{product.name}</h3>
              <p style={{ color: "#C62828", fontWeight: 800, margin: 0 }}>
                R$ {finalPrice.toFixed(2).replace(".", ",")}
                {extraSum > 0 && <span style={{ fontSize: "0.75rem", color: "#D97706", fontWeight: 700, marginLeft: "6px" }}>(+ R$ {extraSum.toFixed(2).replace(".", ",")} acréscimo)</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ cursor: "pointer", background: "none", border: "none" }}><X size={22} /></button>
        </div>

        {/* Groups */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1.25rem" }}>
          {groups.map(group => {
            const total = getGroupTotal(group.id);
            const complete = total === group.maxQty;
            const activeItems = group.items.filter(i => i.menuProduct.active);
            return (
              <div key={group.id} style={{ marginBottom: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", position: "sticky", top: 0, backgroundColor: "white", zIndex: 5, padding: "4px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <h4 style={{ fontWeight: 700, fontSize: "0.95rem", margin: 0 }}>{group.title}</h4>
                    <span style={{ backgroundColor: "#0F172A", color: "#FFF", padding: "2px 8px", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 800 }}>Obrigatório</span>
                  </div>
                  <span style={{ padding: "0.2rem 0.6rem", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 700,
                    backgroundColor: complete ? "#DCFCE7" : "#FEF3C7", color: complete ? "#16A34A" : "#D97706"
                  }}>{complete ? <><Check size={12} style={{ display: "inline", verticalAlign: "middle" }} /> Completo</> : `${total}/${group.maxQty}`}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {activeItems.map(item => {
                    const qty = selections[group.id]?.[item.menuProduct.name] || 0;
                    const addPrice = item.additionalPrice || 0;
                    return (
                      <div key={item.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "0.6rem 0.75rem", backgroundColor: qty > 0 ? "#FFF7ED" : "#F8FAFC",
                        borderRadius: "8px", border: qty > 0 ? "1.5px solid #FB923C" : "1px solid #E2E8F0"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          {item.menuProduct.imageUrl && <img src={item.menuProduct.imageUrl} alt="" style={{ width: "32px", height: "32px", borderRadius: "6px", objectFit: "cover" }} />}
                          <div>
                            <span style={{ fontSize: "0.85rem", fontWeight: qty > 0 ? 700 : 500 }}>{item.menuProduct.name}</span>
                            {addPrice > 0 && (
                              <span style={{ fontSize: "0.75rem", color: "#D97706", fontWeight: 700, marginLeft: "6px" }}>
                                (+ R$ {addPrice.toFixed(2).replace(".", ",")})
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          {qty > 0 && <button onClick={() => updateQty(group.id, item.menuProduct.name, -1)} style={{ width: "26px", height: "26px", borderRadius: "50%", border: "1px solid #CBD5E1", backgroundColor: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>}
                          {qty > 0 && <span style={{ fontWeight: 700, fontSize: "0.85rem", minWidth: "16px", textAlign: "center" }}>{qty}</span>}
                          <button onClick={() => updateQty(group.id, item.menuProduct.name, 1)} disabled={total >= group.maxQty}
                            style={{ width: "26px", height: "26px", borderRadius: "50%", border: "none", backgroundColor: total >= group.maxQty ? "#E2E8F0" : "#C62828", color: "white", cursor: total >= group.maxQty ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid #E2E8F0" }}>
          <button onClick={() => allComplete && onConfirm(selections, extraSum)} disabled={!allComplete}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "none", cursor: allComplete ? "pointer" : "not-allowed",
              background: allComplete ? "linear-gradient(135deg, #C62828, #E53935)" : "#E2E8F0",
              color: allComplete ? "white" : "#94A3B8", fontWeight: 700, fontSize: "0.95rem"
            }}>{allComplete ? `Adicionar à Sacola • R$ ${finalPrice.toFixed(2).replace(".", ",")}` : "Complete todas as escolhas"}</button>
        </div>
      </div>
    </div>
  );
}
