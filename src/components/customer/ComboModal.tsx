"use client";
import React, { useState, useMemo } from "react";
import { X, Plus, Minus, Check, AlertCircle } from "lucide-react";

export type ComboGroupData = {
  id: string;
  title: string;
  maxQty: number;
  /** Mínimo de escolhas. Nulo = regra antiga: exige exatamente `maxQty`. */
  minQty?: number | null;
  items: {
    id: string;
    additionalPrice?: number;
    /** Teto desta opção sozinha. Nulo = só vale o teto do grupo. */
    maxPerItem?: number | null;
    /** Linha curta sob o nome da opção ("13cm"), quando o grupo define uma. */
    optionNote?: string | null;
    menuProduct: {
      id: string;
      name: string;
      description?: string | null;
      active: boolean;
      imageUrl: string | null;
      price?: number;
    };
  }[];
};

export type Selections = Record<string, Record<string, number>>;

/**
 * Grupo em que não há escolha nenhuma a fazer já vem marcado.
 *
 * É o caso do que acompanha um combo: "4 mini pastéis + batata frita +
 * guaravita" tem a batata e o guaravita como parte fixa. Eles precisam existir
 * como grupo para chegarem à cozinha — o KDS só imprime o que está nas
 * seleções, então componente que não é escolha nenhuma sumia da comanda e a
 * produção montava o combo pela memória.
 *
 * Marcar sozinho evita transformar isso em clique obrigatório sem alternativa.
 * Só vale quando as opções cabem EXATAMENTE no teto do grupo — havendo
 * qualquer liberdade de escolha, quem decide é o cliente.
 */
function preenchimentoForcado(group: ComboGroupData): Record<string, number> {
  const max = Math.max(1, group.maxQty || 1);
  const itens = (group.items || []).filter(i => i.menuProduct?.active !== false);
  if (itens.length === 0) return {};

  const tetos = itens.map(i => {
    const t = Number(i.maxPerItem);
    return Number.isFinite(t) && t > 0 ? t : max;
  });
  if (tetos.reduce((s, t) => s + t, 0) !== max) return {};

  const forcado: Record<string, number> = {};
  itens.forEach((i, idx) => {
    const nome = i.menuProduct?.name;
    if (nome) forcado[nome] = tetos[idx];
  });
  return forcado;
}

interface ComboModalProps {
  product: {
    id: string;
    name: string;
    description?: string | null;
    price: number;
    imageUrl?: string | null;
    comboGroups: ComboGroupData[];
  };
  onClose: () => void;
  onConfirm: (selections: Selections, extraSum: number, qty: number, notes?: string) => void;
}

export default function ComboModal({ product, onClose, onConfirm }: ComboModalProps) {
  const groups = product.comboGroups || [];
  const [comboQty, setComboQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const [selections, setSelections] = useState<Selections>(() => {
    const init: Selections = {};
    groups.forEach(g => { init[g.id] = preenchimentoForcado(g); });
    return init;
  });

  const getGroupTotal = (gId: string) =>
    Object.values(selections[gId] || {}).reduce((s, v) => s + v, 0);

  // Quantas escolhas o grupo exige. Nulo mantém a regra antiga (exatamente
  // maxQty) — é o que os combos gravados antes da coluna minQty esperam.
  const groupMin = (group: ComboGroupData) => {
    const max = Math.max(1, group.maxQty || 1);
    if (group.minQty === null || group.minQty === undefined) return max;
    const min = Number(group.minQty);
    if (!Number.isFinite(min) || min < 0) return max;
    return Math.min(min, max);
  };

  const isGroupRequired = (group: ComboGroupData) => groupMin(group) > 0;

  // Completo = dentro da faixa. Um grupo opcional já nasce completo; um
  // obrigatório de 4/4 só fecha com os 4. Antes exigia-se `total === maxQty`
  // sempre, e por isso não havia como ter adicional que o cliente pode dispensar.
  const isGroupComplete = (group: ComboGroupData) => {
    const total = getGroupTotal(group.id);
    return total >= groupMin(group) && total <= Math.max(1, group.maxQty || 1);
  };

  const allComplete = groups.every(g => isGroupComplete(g));

  const handleSelectSingle = (gId: string, optionName: string) => {
    setSelections(prev => {
      const currentVal = prev[gId]?.[optionName] || 0;
      if (currentVal === 1) {
        // Toggle off if clicking same item
        return { ...prev, [gId]: {} };
      }
      return { ...prev, [gId]: { [optionName]: 1 } };
    });
  };

  const updateQty = (gId: string, optionName: string, delta: number) => {
    const group = groups.find(g => g.id === gId);
    const maxQty = group?.maxQty || 1;

    if (maxQty === 1) {
      if (delta > 0) handleSelectSingle(gId, optionName);
      else setSelections(prev => ({ ...prev, [gId]: {} }));
      return;
    }

    // Teto da opção sozinha, quando ela define um. O grupo aceita 4 adicionais
    // no total, mas cada um tem o seu "Máx 2" — sem isto, a mesma opção podia
    // ser repetida até encher o grupo.
    const item = group?.items?.find(i => i.menuProduct?.name === optionName);
    const maxDoItem = Number(item?.maxPerItem) > 0 ? Number(item!.maxPerItem) : maxQty;

    setSelections(prev => {
      const currentGroup = { ...(prev[gId] || {}) };
      const currentTotal = Object.values(currentGroup).reduce((s, v) => s + v, 0);
      const current = currentGroup[optionName] || 0;
      const newVal = current + delta;

      if (newVal < 0 || (delta > 0 && currentTotal >= maxQty)) return prev;
      if (delta > 0 && newVal > maxDoItem) return prev;
      if (newVal === 0) delete currentGroup[optionName];
      else currentGroup[optionName] = newVal;

      return { ...prev, [gId]: currentGroup };
    });
  };

  const extraSum = useMemo(() => {
    return groups.reduce((sum, group) => {
      const groupSelections = selections[group.id] || {};
      return sum + (group.items || []).reduce((gSum, item) => {
        const qty = groupSelections[item.menuProduct.name] || 0;
        const addPrice = item.additionalPrice || 0;
        return gSum + (qty * addPrice);
      }, 0);
    }, 0);
  }, [groups, selections]);

  // ── COBRANÇA EM DOBRO (CORRIGIDA) ───────────────────────────────────────
  // O código anterior procurava um "preço mínimo" somando
  //     additionalPrice + preço do produto-opção
  // e, quando o produto base custava R$ 0,00, usava esse mínimo como base —
  // somando o additionalPrice da escolha DE NOVO por cima.
  //
  // No "Nugget" (base R$ 0,00; opção "6 Nuggets" com additionalPrice R$ 9,90 e
  // produto-opção de R$ 9,90), quem pedisse 6 unidades via:
  //     mínimo 9,90 + 9,90 = 19,80  →  base 19,80 + adicional 9,90 = R$ 29,70
  // três vezes os R$ 9,90 que o item custa.
  //
  // O preço do produto-opção é o valor de vendê-lo avulso no cardápio; dentro
  // do combo quem manda é o additionalPrice. A conta agora é a mesma do
  // servidor e do cardápio: base + adicionais escolhidos.
  const basePrice = product.price || 0;
  const unitFinalPrice = basePrice + extraSum;
  const grandTotal = unitFinalPrice * comboQty;

  const handleSubmit = () => {
    if (!allComplete) {
      setAttemptedSubmit(true);
      return;
    }
    onConfirm(selections, extraSum, comboQty, notes.trim());
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(15, 23, 42, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0.75rem",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "20px",
          width: "100%",
          maxWidth: "540px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 60px -12px rgba(0, 0, 0, 0.35)",
          position: "relative",
          animation: "modalFadeIn 0.2s ease-out",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* CLOSE BUTTON */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "14px",
            right: "14px",
            zIndex: 10,
            width: "34px",
            height: "34px",
            minWidth: "34px",
            minHeight: "34px",
            maxWidth: "34px",
            maxHeight: "34px",
            aspectRatio: "1 / 1",
            padding: 0,
            borderRadius: "50%",
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#1E293B",
            flexShrink: 0,
            boxSizing: "border-box",
            lineHeight: 1,
          }}
          title="Fechar"
        >
          <X size={18} />
        </button>

        {/* SCROLLABLE BODY */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "1rem" }}>
          {/* HERO BANNER */}
          {product.imageUrl ? (
            <div style={{ width: "100%", height: "200px", position: "relative", backgroundColor: "#F1F5F9" }}>
              <img
                src={product.imageUrl}
                alt={product.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 50%)",
                }}
              />
            </div>
          ) : (
            <div style={{ height: "20px" }} />
          )}

          {/* PRODUCT HEADER INFO */}
          <div style={{ padding: "1.25rem 1.25rem 0.75rem" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#0F172A", margin: "0 0 6px 0", lineHeight: 1.3 }}>
              {product.name}
            </h2>
            {product.description && (
              <p style={{ fontSize: "0.85rem", color: "#64748B", margin: "0 0 10px 0", lineHeight: 1.45 }}>
                {product.description}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "1.15rem", fontWeight: 800, color: "#059669" }}>
                {product.price > 0 ? `R$ ${product.price.toFixed(2).replace(".", ",")}` : `A partir de R$ ${basePrice.toFixed(2).replace(".", ",")}`}
              </span>
              {extraSum > 0 && (
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#D97706", backgroundColor: "#FEF3C7", padding: "2px 8px", borderRadius: "12px" }}>
                  + R$ {extraSum.toFixed(2).replace(".", ",")} adicionais
                </span>
              )}
            </div>
          </div>

          {/* GROUPS LIST */}
          <div style={{ padding: "0.5rem 1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {groups.map((group, gIdx) => {
              const total = getGroupTotal(group.id);
              const max = group.maxQty || 1;
              const min = groupMin(group);
              const complete = isGroupComplete(group);
              const obrigatorio = min > 0;
              const isSingle = max === 1;
              const activeItems = (group.items || []).filter(i => i.menuProduct?.active !== false);
              // Grupo opcional nunca fica "faltando": ele já nasce completo.
              const isMissing = attemptedSubmit && !complete;

              return (
                <div
                  key={group.id}
                  style={{
                    backgroundColor: "#FFFFFF",
                    borderRadius: "14px",
                    border: isMissing ? "1.5px solid #EF4444" : "1px solid #E2E8F0",
                    overflow: "hidden",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
                    transition: "border-color 0.2s ease",
                  }}
                >
                  {/* GROUP HEADER */}
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      backgroundColor: complete && total > 0 ? "#F0FDF4" : isMissing ? "#FEF2F2" : "#F8FAFC",
                      borderBottom: "1px solid #E2E8F0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "0.92rem", fontWeight: 800, color: "#1E293B" }}>
                          {gIdx + 1}. {group.title}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "2px" }}>
                        {min === max
                          ? (isSingle ? "Escolha 1 opção" : `Escolha ${max} itens`)
                          : min > 0
                            ? `Escolha de ${min} a ${max} itens`
                            : `Escolha até ${max} ${max === 1 ? "item" : "itens"}`}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                      {obrigatorio && (
                        <span
                          style={{
                            fontSize: "0.68rem",
                            fontWeight: 800,
                            padding: "3px 8px",
                            borderRadius: "6px",
                            backgroundColor: "#0F172A",
                            color: "#FFFFFF",
                            letterSpacing: "0.02em",
                          }}
                        >
                          OBRIGATÓRIO
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: "20px",
                          backgroundColor: complete && total > 0 ? "#DCFCE7" : isMissing ? "#FEE2E2" : "#FEF3C7",
                          color: complete && total > 0 ? "#16A34A" : isMissing ? "#DC2626" : "#D97706",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        {complete && total > 0 ? (
                          <>
                            <Check size={12} strokeWidth={3} /> Escolhido
                          </>
                        ) : (
                          `${total} / ${max}`
                        )}
                      </span>
                    </div>
                  </div>

                  {/* GROUP ITEMS */}
                  <div style={{ padding: "0.5rem 0.75rem", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {activeItems.map(item => {
                      const optName = item.menuProduct.name;
                      const qty = selections[group.id]?.[optName] || 0;
                      const isSelected = qty > 0;
                      const addPrice = item.additionalPrice || 0;

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (isSingle) handleSelectSingle(group.id, optName);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "0.65rem 0.85rem",
                            borderRadius: "10px",
                            backgroundColor: isSelected ? "#F0FDF4" : "#FFFFFF",
                            border: isSelected ? "1.5px solid #86EFAC" : "1px solid #F1F5F9",
                            cursor: isSingle ? "pointer" : "default",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {/* Item Info */}
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0, paddingRight: "8px" }}>
                            {item.menuProduct.imageUrl && (
                              <img
                                src={item.menuProduct.imageUrl}
                                alt={optName}
                                style={{ width: "42px", height: "42px", borderRadius: "8px", objectFit: "cover", flexShrink: 0 }}
                              />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "0.85rem", fontWeight: isSelected ? 700 : 600, color: "#1E293B", lineHeight: 1.3 }}>
                                {optName}
                              </div>
                              {/* A nota do grupo ganha da descrição do produto: "Baby" é
                                  o mesmo item em dezenas de grupos, e o que muda de um
                                  para outro é o "13cm" que o grupo define. */}
                              {(item.optionNote || item.menuProduct.description) && (
                                <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "1px", lineHeight: 1.25 }}>
                                  {item.optionNote || item.menuProduct.description}
                                </div>
                              )}
                              {addPrice > 0 ? (
                                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#059669", marginTop: "2px" }}>
                                  + R$ {addPrice.toFixed(2).replace(".", ",")}
                                </div>
                              ) : (
                                <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#94A3B8", marginTop: "1px" }}>
                                  Incluso
                                </div>
                              )}
                              {!isSingle && Number(item.maxPerItem) > 0 && Number(item.maxPerItem) < max && (
                                <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: "1px" }}>
                                  Máx {item.maxPerItem}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Controls */}
                          {isSingle ? (
                            <div
                              style={{
                                width: "22px",
                                height: "22px",
                                minWidth: "22px",
                                minHeight: "22px",
                                maxWidth: "22px",
                                maxHeight: "22px",
                                aspectRatio: "1 / 1",
                                borderRadius: "50%",
                                border: isSelected ? "6px solid #10B981" : "2px solid #CBD5E1",
                                backgroundColor: "#FFFFFF",
                                flexShrink: 0,
                                boxSizing: "border-box",
                                transition: "all 0.15s ease",
                              }}
                            />
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                              {qty > 0 && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    updateQty(group.id, optName, -1);
                                  }}
                                  style={{
                                    width: "30px",
                                    height: "30px",
                                    minWidth: "30px",
                                    minHeight: "30px",
                                    maxWidth: "30px",
                                    maxHeight: "30px",
                                    aspectRatio: "1 / 1",
                                    padding: 0,
                                    borderRadius: "50%",
                                    border: "1px solid #CBD5E1",
                                    backgroundColor: "#FFFFFF",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "#334155",
                                    flexShrink: 0,
                                    boxSizing: "border-box",
                                    lineHeight: 1,
                                  }}
                                >
                                  <Minus size={14} strokeWidth={2.5} />
                                </button>
                              )}
                              {qty > 0 && (
                                <span style={{ fontWeight: 800, fontSize: "0.88rem", minWidth: "18px", textAlign: "center", color: "#0F172A" }}>
                                  {qty}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  updateQty(group.id, optName, 1);
                                }}
                                disabled={total >= max}
                                style={{
                                  width: "30px",
                                  height: "30px",
                                  minWidth: "30px",
                                  minHeight: "30px",
                                  maxWidth: "30px",
                                  maxHeight: "30px",
                                  aspectRatio: "1 / 1",
                                  padding: 0,
                                  borderRadius: "50%",
                                  border: "none",
                                  backgroundColor: total >= max ? "#E2E8F0" : "#10B981",
                                  color: total >= max ? "#94A3B8" : "#FFFFFF",
                                  cursor: total >= max ? "not-allowed" : "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  boxShadow: total >= max ? "none" : "0 2px 6px rgba(16, 185, 129, 0.3)",
                                  flexShrink: 0,
                                  boxSizing: "border-box",
                                  lineHeight: 1,
                                }}
                              >
                                <Plus size={15} strokeWidth={2.5} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* OBSERVATIONS FIELD */}
            <div style={{ backgroundColor: "#F8FAFC", borderRadius: "14px", border: "1px solid #E2E8F0", padding: "0.85rem 1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#334155" }}>
                  📝 Alguma observação?
                </span>
                <span style={{ fontSize: "0.72rem", color: notes.length > 120 ? "#DC2626" : "#94A3B8" }}>
                  {notes.length}/140
                </span>
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value.slice(0, 140))}
                placeholder="Ex: Sem cebola, molho à parte, bem passado..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "1px solid #CBD5E1",
                  fontSize: "0.82rem",
                  fontFamily: "inherit",
                  outline: "none",
                  resize: "none",
                  backgroundColor: "#FFFFFF",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        </div>

        {/* STICKY FOOTER */}
        <div
          style={{
            padding: "0.85rem 1.25rem",
            borderTop: "1px solid #E2E8F0",
            backgroundColor: "#FFFFFF",
            boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          {/* Main Combo Quantity Stepper */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#F1F5F9",
              padding: "4px 8px",
              borderRadius: "12px",
              border: "1px solid #E2E8F0",
            }}
          >
            <button
              type="button"
              onClick={() => setComboQty(q => Math.max(1, q - 1))}
              disabled={comboQty <= 1}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: comboQty <= 1 ? "transparent" : "#FFFFFF",
                color: comboQty <= 1 ? "#CBD5E1" : "#1E293B",
                cursor: comboQty <= 1 ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: comboQty <= 1 ? "none" : "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <Minus size={14} strokeWidth={2.5} />
            </button>
            <span style={{ fontWeight: 800, fontSize: "0.95rem", minWidth: "22px", textAlign: "center", color: "#0F172A" }}>
              {comboQty}
            </span>
            <button
              type="button"
              onClick={() => setComboQty(q => q + 1)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#FFFFFF",
                color: "#1E293B",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <Plus size={14} strokeWidth={2.5} />
            </button>
          </div>

          {/* Add to Cart CTA Button */}
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              flex: 1,
              padding: "0.85rem 1rem",
              borderRadius: "12px",
              border: "none",
              cursor: allComplete ? "pointer" : "default",
              backgroundColor: allComplete ? "#059669" : "#E2E8F0",
              color: allComplete ? "#FFFFFF" : "#64748B",
              fontWeight: 800,
              fontSize: "0.92rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: allComplete ? "0 4px 14px rgba(5, 150, 105, 0.35)" : "none",
              transition: "all 0.2s ease",
            }}
          >
            <span>{allComplete ? "Adicionar ao Pedido" : "Selecione as opções obrigatórias"}</span>
            <span style={{ fontSize: "1rem" }}>R$ {grandTotal.toFixed(2).replace(".", ",")}</span>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
