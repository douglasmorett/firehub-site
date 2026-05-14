"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit3, X, Image as ImageIcon, Pause, Play, Package, Monitor, Truck, Tablet, UtensilsCrossed } from "lucide-react";

const CHANNELS = [
  { key: "activePDV",      label: "PDV",      icon: "🖥️",  color: "#3B82F6", desc: "Atendimento no balcão/caixa" },
  { key: "activeDelivery", label: "Delivery", icon: "🛵",  color: "#10B981", desc: "Pedidos online pelo site" },
  { key: "activeTotem",    label: "Totem",    icon: "📲",  color: "#8B5CF6", desc: "Autoatendimento no totem" },
  { key: "activeGarcom",   label: "Garçom",   icon: "🍽️", color: "#F59E0B", desc: "Cardápio do garçom/mesa" },
];

function ChannelBadges({ product, onToggle }: { product: any; onToggle: (key: string, val: boolean) => void }) {
  return (
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
      {CHANNELS.map(ch => {
        const active = product[ch.key] ?? false;
        return (
          <button key={ch.key} onClick={() => onToggle(ch.key, !active)} title={ch.desc}
            style={{
              padding: "2px 8px", borderRadius: "20px", fontSize: "0.68rem", fontWeight: 700,
              border: `1.5px solid ${active ? ch.color : "#E2E8F0"}`,
              background: active ? ch.color + "18" : "#F8FAFC",
              color: active ? ch.color : "#94A3B8",
              cursor: "pointer", transition: "all 0.15s",
            }}>
            {ch.icon} {ch.label}
          </button>
        );
      })}
    </div>
  );
}

export default function MenuProductManager({ products, availableItems }: { products: any[]; availableItems: any[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"items" | "combos">("items");

  // Modal de confirmação customizado
  const [confirmModal, setConfirmModal] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [softDeletedName, setSoftDeletedName] = useState<string | null>(null);

  // Smart Pause — pausar item que está em combos
  const [pauseModal, setPauseModal] = useState<{ id: string; name: string; affectedCombos: any[]; newActive: boolean } | null>(null);
  const [pausing, setPausing] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; color: string } | null>(null);

  const showToast = (text: string, color = "#10B981") => {
    setToastMsg({ text, color });
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Esfihas Salgadas");
  const [imageUrl, setImageUrl] = useState("");
  const [active, setActive] = useState(true);
  const [cost, setCost] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isCombo, setIsCombo] = useState(false);
  const [activePDV, setActivePDV] = useState(true);
  const [activeDelivery, setActiveDelivery] = useState(true);
  const [activeTotem, setActiveTotem] = useState(false);
  const [activeGarcom, setActiveGarcom] = useState(false);
  const [comboGroups, setComboGroups] = useState<{ title: string; maxQty: number; itemIds: string[] }[]>([]);

  const categories = ["Promoção do Dia", "Combos", "Esfihas Salgadas", "Esfihas Doces", "Acompanhamentos", "Bebidas", "Outros"];

  const resetForm = () => {
    setName(""); setDescription(""); setPrice(""); setCost(""); setTags([]); setCategory("Esfihas Salgadas");
    setImageUrl(""); setActive(true); setIsCombo(false); setComboGroups([]);
    setActivePDV(true); setActiveDelivery(true); setActiveTotem(false); setActiveGarcom(false);
    setShowForm(false); setEditingId(null);
  };

  const openEdit = (p: any) => {
    setName(p.name); setDescription(p.description); setPrice(String(p.price));
    setCost(p.cost != null && p.cost > 0 ? String(p.cost) : "");
    try { setTags(p.tags ? JSON.parse(p.tags) : []); } catch { setTags([]); }
    setCategory(p.category); setImageUrl(p.imageUrl || ""); setActive(p.active);
    setIsCombo(p.isCombo);
    setActivePDV(p.activePDV ?? true);
    setActiveDelivery(p.activeDelivery ?? true);
    setActiveTotem(p.activeTotem ?? false);
    setActiveGarcom(p.activeGarcom ?? false);
    if (p.isCombo && p.comboGroups) {
      setComboGroups(p.comboGroups.map((g: any) => ({
        title: g.title, maxQty: g.maxQty,
        itemIds: g.items.map((i: any) => i.menuProduct.id)
      })));
    } else { setComboGroups([]); }
    setEditingId(p.id); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!name || !description || !price) { alert("Preencha nome, descrição e preço."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/menu-products", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId, name, description, price: parseFloat(price),
          cost: cost ? parseFloat(cost) : 0,
          tags: tags.length > 0 ? tags : null,
          category,
          imageUrl: imageUrl || null, active, isCombo,
          activePDV, activeDelivery, activeTotem, activeGarcom,
          comboGroups: isCombo ? comboGroups : undefined
        })
      });
      if (res.ok) { resetForm(); router.refresh(); } else alert("Erro ao salvar.");
    } catch { alert("Erro."); }
    finally { setLoading(false); }
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteConfirmText("");
    setConfirmModal({ id, name });
  };

  const confirmDelete = async () => {
    if (!confirmModal) return;
    setDeleting(true);
    const res = await fetch("/api/admin/menu-products", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: confirmModal.id, name: confirmModal.name })
    });
    const data = await res.json();
    setDeleting(false);
    setConfirmModal(null);
    if (data.softDeleted) {
      // Mostrar aviso suave (não precisa de alert nativo)
      setSoftDeletedName(confirmModal.name);
      setTimeout(() => setSoftDeletedName(null), 4000);
    }
    router.refresh();
  };

  const handleToggle = (id: string, cur: boolean) => {
    const product = products.find(p => p.id === id);
    const newActive = !cur;

    // Se estiver PAUSANDO um item avulso, verificar se há combos que o contêm
    if (!newActive && product && !product.isCombo) {
      const affectedCombos = products.filter(p =>
        p.isCombo &&
        p.comboGroups?.some((g: any) =>
          g.items?.some((i: any) => i.menuProduct?.id === id || i.menuProductId === id)
        )
      );
      if (affectedCombos.length > 0) {
        setPauseModal({ id, name: product.name, affectedCombos, newActive });
        return;
      }
    }
    // Sem combos afetados: toggle direto
    doToggle(id, newActive);
  };

  const doToggle = async (id: string, newActive: boolean, alsoComboIds?: string[]) => {
    setPausing(true);
    await fetch("/api/admin/menu-products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: newActive })
    });
    if (alsoComboIds && alsoComboIds.length > 0) {
      await Promise.all(alsoComboIds.map(cid =>
        fetch("/api/admin/menu-products", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: cid, active: newActive })
        })
      ));
    }
    setPausing(false);
    setPauseModal(null);
    router.refresh();
  };

  // Toggle de canal diretamente na lista (sem abrir form)
  const handleChannelToggle = async (id: string, channelKey: string, val: boolean) => {
    await fetch("/api/admin/menu-products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [channelKey]: val })
    });
    router.refresh();
  };

  const addGroup = () => setComboGroups(prev => [...prev, { title: "", maxQty: 1, itemIds: [] }]);
  const removeGroup = (idx: number) => setComboGroups(prev => prev.filter((_, i) => i !== idx));
  const updateGroup = (idx: number, key: string, val: any) => {
    setComboGroups(prev => prev.map((g, i) => i === idx ? { ...g, [key]: val } : g));
  };
  const toggleGroupItem = (gIdx: number, itemId: string) => {
    setComboGroups(prev => prev.map((g, i) => {
      if (i !== gIdx) return g;
      const has = g.itemIds.includes(itemId);
      return { ...g, itemIds: has ? g.itemIds.filter(id => id !== itemId) : [...g.itemIds, itemId] };
    }));
  };

  const itemProducts = products.filter(p => !p.isCombo);
  const comboProducts = products.filter(p => p.isCombo);

  return (
    <div>
      {/* ===== MODAL DE CONFIRMAÇÃO CUSTOMIZADO ===== */}
      {confirmModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#fff", borderRadius: "16px",
            padding: "2rem", maxWidth: "420px", width: "92%",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            border: "1px solid #E2E8F0",
          }}>
            {/* Ícone */}
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(239,68,68,0.1)", border: "2px solid #EF4444",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.5rem",
              }}>🗑️</div>
            </div>

            <h3 style={{ textAlign: "center", fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.4rem", color: "#111827" }}>
              Excluir produto permanentemente?
            </h3>
            <p style={{ textAlign: "center", color: "#6B7280", fontSize: "0.88rem", marginBottom: "1rem", lineHeight: 1.6 }}>
              Você está prestes a excluir 
              <strong style={{ color: "#111827" }}>“{confirmModal.name}”</strong>.
            </p>

            {/* Aviso de irreversibilidade */}
            <div style={{
              background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "10px",
              padding: "0.75rem 1rem", marginBottom: "1.25rem",
            }}>
              <p style={{ color: "#B91C1C", fontSize: "0.82rem", fontWeight: 600, margin: 0, lineHeight: 1.5 }}>
                ⚠️ <strong>Esta ação é irreversível.</strong> Uma vez excluído, o produto
                não pode ser recuperado. O histórico de pedidos que contêm este item
                será preservado, mas o produto não aparecerá mais no cardápio.
              </p>
            </div>

            {/* Campo de confirmação */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.4rem" }}>
                Para confirmar, digite <strong style={{ color: "#EF4444" }}>excluir</strong> no campo abaixo:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="Digite: excluir"
                autoFocus
                style={{
                  width: "100%", padding: "0.6rem 0.9rem", borderRadius: "8px", fontSize: "0.95rem",
                  border: `2px solid ${deleteConfirmText === "excluir" ? "#10B981" : "#D1D5DB"}`,
                  outline: "none", color: "#111827", boxSizing: "border-box",
                  background: deleteConfirmText === "excluir" ? "#F0FDF4" : "#fff",
                  transition: "border-color 0.2s, background 0.2s",
                  fontFamily: "inherit",
                }}
              />
              {deleteConfirmText.length > 0 && deleteConfirmText !== "excluir" && (
                <p style={{ color: "#EF4444", fontSize: "0.75rem", marginTop: "4px" }}>
                  Digite exatamente: <strong>excluir</strong>
                </p>
              )}
              {deleteConfirmText === "excluir" && (
                <p style={{ color: "#10B981", fontSize: "0.75rem", marginTop: "4px", fontWeight: 600 }}>
                  ✓ Confirmado — botão liberado
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={() => { setConfirmModal(null); setDeleteConfirmText(""); }}
                style={{
                  flex: 1, padding: "0.65rem", borderRadius: "10px", fontWeight: 700,
                  border: "1.5px solid #D1D5DB",
                  background: "#F9FAFB", color: "#374151",
                  cursor: "pointer", fontSize: "0.9rem",
                }}>
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deleteConfirmText !== "excluir"}
                style={{
                  flex: 1, padding: "0.65rem", borderRadius: "10px", fontWeight: 800,
                  border: "none",
                  background: deleteConfirmText !== "excluir" ? "#FCA5A5" : deleting ? "#B91C1C" : "#EF4444",
                  color: "#fff",
                  cursor: (deleting || deleteConfirmText !== "excluir") ? "not-allowed" : "pointer",
                  fontSize: "0.9rem", transition: "background 0.2s",
                  opacity: deleteConfirmText !== "excluir" ? 0.7 : 1,
                }}>
                {deleting ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST genérico */}
      {(toastMsg || softDeletedName) && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9998,
          background: toastMsg?.color || "#F59E0B", color: toastMsg?.color === "#EF4444" ? "#fff" : "#000",
          fontWeight: 700, padding: "0.75rem 1.25rem", borderRadius: "12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontSize: "0.85rem",
        }}>
          {toastMsg ? toastMsg.text : `⚠️ "${softDeletedName}" foi desativado (tem pedidos vinculados).`}
        </div>
      )}

      {/* ===== MODAL PAUSE INTELIGENTE ===== */}
      {pauseModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#fff", borderRadius: "18px",
            padding: "2rem", maxWidth: "460px", width: "92%",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            border: "1px solid #E2E8F0",
          }}>
            {/* Ícone */}
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div style={{
                width: 60, height: 60, borderRadius: "50%",
                background: "rgba(245,158,11,0.1)", border: "2px solid #F59E0B",
                display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "1.8rem",
              }}>⏸️</div>
            </div>

            <h3 style={{ textAlign: "center", fontWeight: 900, fontSize: "1.15rem", color: "#111827", marginBottom: "0.4rem" }}>
              Pausar item vinculado a combos
            </h3>
            <p style={{ textAlign: "center", color: "#6B7280", fontSize: "0.88rem", marginBottom: "1rem", lineHeight: 1.5 }}>
              <strong style={{ color: "#B45309" }}>“{pauseModal.name}”</strong> faz parte de{" "}
              <strong style={{ color: "#111827" }}>{pauseModal.affectedCombos.length} combo{pauseModal.affectedCombos.length > 1 ? "s" : ""}</strong>:
            </p>

            {/* Lista de combos afetados */}
            <div style={{
              background: "#F3F4F6", borderRadius: "10px", padding: "0.6rem 1rem",
              marginBottom: "1.25rem", maxHeight: "120px", overflowY: "auto",
              border: "1px solid #E5E7EB",
            }}>
              {pauseModal.affectedCombos.map((c: any) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0", fontSize: "0.85rem", color: "#374151" }}>
                  <span style={{ fontSize: "0.7rem", background: "#F59E0B", color: "#fff", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>COMBO</span>
                  {c.name}
                </div>
              ))}
            </div>

            {/* Três opções */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <button
                onClick={() => { doToggle(pauseModal.id, false); showToast(`✅ Só “${pauseModal.name}” foi pausado.`); }}
                disabled={pausing}
                style={{
                  padding: "0.7rem 1rem", borderRadius: "10px", fontWeight: 700, border: "1.5px solid #F59E0B",
                  background: "#FFFBEB", color: "#92400E", cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
                }}>
                ⏸️ Pausar só este item
                <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 400, color: "#B45309", marginTop: "2px" }}>
                  Os combos continuarão ativos (mas sem este item disponível)
                </span>
              </button>

              <button
                onClick={() => {
                  doToggle(pauseModal.id, false, pauseModal.affectedCombos.map((c: any) => c.id));
                  showToast(`✅ “${pauseModal.name}” e ${pauseModal.affectedCombos.length} combo(s) foram pausados.`);
                }}
                disabled={pausing}
                style={{
                  padding: "0.7rem 1rem", borderRadius: "10px", fontWeight: 700, border: "1.5px solid #EF4444",
                  background: "#FEF2F2", color: "#B91C1C", cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
                }}>
                ⏸️ Pausar este item + todos os {pauseModal.affectedCombos.length} combo(s)
                <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 400, color: "#DC2626", marginTop: "2px" }}>
                  Recomendado quando o item é essencial para o combo
                </span>
              </button>

              <button
                onClick={() => setPauseModal(null)}
                style={{
                  padding: "0.55rem", borderRadius: "10px", fontWeight: 600,
                  border: "1px solid #D1D5DB", background: "#F9FAFB",
                  color: "#6B7280", cursor: "pointer", fontSize: "0.85rem",
                }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}


      {/* TABS */}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button onClick={() => setTab("items")} className={`btn ${tab === "items" ? "btn-primary" : "btn-outline"}`}>Itens Avulsos ({itemProducts.length})</button>
        <button onClick={() => setTab("combos")} className={`btn ${tab === "combos" ? "btn-primary" : "btn-outline"}`}><Package size={16} style={{ marginRight: "4px" }} /> Combos ({comboProducts.length})</button>
      </div>

      <button onClick={() => { resetForm(); setIsCombo(tab === "combos"); setCategory(tab === "combos" ? "Combos" : "Esfihas Salgadas"); setShowForm(true); }} className="btn btn-primary mb-4">
        <Plus size={18} style={{ marginRight: "4px" }} /> {tab === "combos" ? "Novo Combo" : "Novo Produto"}
      </button>

      {/* FORM */}
      {showForm && (
        <div className="card mb-6">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
            <h3 className="font-bold">{editingId ? "Editar" : "Novo"} {isCombo ? "Combo" : "Produto"}</h3>
            <button onClick={resetForm} style={{ cursor: "pointer" }}><X size={20} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div className="input-group"><label>Nome</label><input className="input-field" value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="input-group"><label>Preço (R$)</label><input className="input-field" type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
            <div className="input-group"><label>Descrição</label><textarea className="input-field" rows={2} value={description} onChange={e => setDescription(e.target.value)} style={{ resize: "vertical" }} /></div>
            <div className="input-group"><label>Categoria</label><select className="input-field" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></div>
            {/* Campo Custo */}
            <div className="input-group" style={{ position: "relative" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                Custo do Produto (R$)
                <span style={{ fontSize: "0.68rem", background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                  Usado no CMV
                </span>
              </label>
              <input
                className="input-field"
                type="number"
                step="0.01"
                min="0"
                placeholder="Ex: 8.50"
                value={cost}
                onChange={e => setCost(e.target.value)}
              />
              {cost && parseFloat(price) > 0 && parseFloat(cost) > 0 && (
                <p style={{ fontSize: "0.72rem", color: "#16A34A", marginTop: "4px", fontWeight: 600 }}>
                  Margem bruta: {(((parseFloat(price) - parseFloat(cost)) / parseFloat(price)) * 100).toFixed(1)}%
                </p>
              )}
            </div>
            <div className="input-group"><label>URL da Imagem</label><input className="input-field" value={imageUrl} onChange={e => setImageUrl(e.target.value)} /></div>
          </div>

          {/* TAGS DE PRODUTO */}
          {!isCombo && (
            <div style={{ marginTop: "1rem", padding: "0.875rem 1rem", background: "#FFF7ED", borderRadius: "10px", border: "1.5px solid #FCD34D" }}>
              <p style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.6rem", color: "#92400E" }}>🏷️ Tags do Produto <span style={{ fontSize: "0.7rem", fontWeight: 400, color: "#B45309" }}>(aparecem no cardápio digital)</span></p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {[
                  { label: "🔥 Mais Vendido", color: "#EF4444" },
                  { label: "✨ Novo", color: "#8B5CF6" },
                  { label: "🏷️ Promoção", color: "#10B981" },
                  { label: "🌱 Vegano", color: "#16A34A" },
                  { label: "🌶️ Picante", color: "#F59E0B" },
                  { label: "⭐ Destaque", color: "#F59E0B" },
                  { label: "❄️ Gelado", color: "#3B82F6" },
                  { label: "🎉 Especial do Dia", color: "#EC4899" },
                ].map(tag => {
                  const active = tags.includes(tag.label);
                  return (
                    <button
                      key={tag.label}
                      onClick={() => setTags(prev => active ? prev.filter(t => t !== tag.label) : [...prev, tag.label])}
                      style={{
                        padding: "4px 12px", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 700,
                        border: `2px solid ${active ? tag.color : "#E2E8F0"}`,
                        background: active ? tag.color + "18" : "#F8FAFC",
                        color: active ? tag.color : "#94A3B8",
                        cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
                      }}
                    >{tag.label}</button>
                  );
                })}
              </div>
              {tags.length > 0 && (
                <p style={{ fontSize: "0.72rem", color: "#92400E", marginTop: "6px" }}>
                  ✅ {tags.length} tag{tags.length > 1 ? "s" : ""} selecionada{tags.length > 1 ? "s" : ""}
                </p>
              )}
            </div>
          )}

          {/* CANAIS DE VENDA */}
          <div style={{ marginTop: "1rem", padding: "0.875rem 1rem", background: "#F8FAFC", borderRadius: "10px", border: "1.5px solid #E2E8F0" }}>
            <p style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.6rem" }}>📡 Canais de Venda</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              {CHANNELS.map(ch => {
                const stateMap: Record<string, [boolean, (v: boolean) => void]> = {
                  activePDV: [activePDV, setActivePDV],
                  activeDelivery: [activeDelivery, setActiveDelivery],
                  activeTotem: [activeTotem, setActiveTotem],
                  activeGarcom: [activeGarcom, setActiveGarcom],
                };
                const [val, setter] = stateMap[ch.key];
                return (
                  <label key={ch.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "8px", border: `1.5px solid ${val ? ch.color : "#E2E8F0"}`, background: val ? ch.color + "10" : "#fff", cursor: "pointer" }}>
                    <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} style={{ accentColor: ch.color }} />
                    <span style={{ fontSize: "0.85rem" }}>{ch.icon}</span>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "0.82rem", color: val ? ch.color : "#64748B" }}>{ch.label}</p>
                      <p style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{ch.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* COMBO BUILDER */}
          {isCombo && (
            <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "var(--bg-color)", borderRadius: "var(--radius-md)", border: "2px dashed var(--primary)" }}>
              <h4 className="font-bold" style={{ marginBottom: "0.75rem" }}>📦 Construtor de Combo</h4>
              {comboGroups.map((group, gIdx) => (
                <div key={gIdx} style={{ marginBottom: "1rem", padding: "0.75rem", backgroundColor: "var(--surface)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "end" }}>
                    <div style={{ flex: 1 }}><label style={{ fontSize: "0.75rem", fontWeight: 600 }}>Título do Grupo</label><input className="input-field" value={group.title} onChange={e => updateGroup(gIdx, "title", e.target.value)} placeholder="Ex: Escolha suas esfirras" /></div>
                    <div style={{ width: "80px" }}><label style={{ fontSize: "0.75rem", fontWeight: 600 }}>Qtd</label><input className="input-field" type="number" min={1} value={group.maxQty} onChange={e => updateGroup(gIdx, "maxQty", parseInt(e.target.value) || 1)} /></div>
                    <button onClick={() => removeGroup(gIdx)} style={{ cursor: "pointer", color: "var(--danger)", padding: "0.5rem" }}><Trash2 size={16} /></button>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Selecione os itens disponíveis ({group.itemIds.length} selecionados):</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {availableItems.map(item => (
                      <button key={item.id} onClick={() => toggleGroupItem(gIdx, item.id)}
                        style={{
                          padding: "0.25rem 0.5rem", borderRadius: "6px", fontSize: "0.7rem", cursor: "pointer",
                          border: group.itemIds.includes(item.id) ? "2px solid var(--primary)" : "1px solid var(--border-color)",
                          backgroundColor: group.itemIds.includes(item.id) ? "var(--primary-light)" : "var(--surface)",
                          fontWeight: group.itemIds.includes(item.id) ? 700 : 400,
                          opacity: item.active ? 1 : 0.4
                        }}>{item.name} {!item.active && "⏸️"}</button>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={addGroup} className="btn btn-outline" style={{ width: "100%", fontSize: "0.85rem" }}>
                <Plus size={14} style={{ marginRight: "4px" }} /> Adicionar Grupo de Seleção
              </button>
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} className="btn btn-primary mt-4" style={{ width: "100%" }}>
            {loading ? "Salvando..." : (editingId ? "Salvar Alterações" : "Cadastrar")}
          </button>
        </div>
      )}

      {/* PRODUCT LIST */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "0.75rem" }}>
        {(tab === "items" ? itemProducts : comboProducts).map(p => (
          <div key={p.id} className="card" style={{ padding: "0.75rem", opacity: p.active ? 1 : 0.55, border: !p.active ? "2px dashed #EF4444" : undefined }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "start" }}>
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} style={{ width: "70px", height: "70px", objectFit: "cover", borderRadius: "8px", flexShrink: 0 }} />
              ) : (
                <div style={{ width: "70px", height: "70px", backgroundColor: "var(--bg-color)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <ImageIcon size={20} color="var(--text-muted)" />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <h3 className="font-bold" style={{ fontSize: "0.9rem" }}>{p.name}</h3>
                    <p className="text-muted" style={{ fontSize: "0.7rem" }}>{p.category}{p.isCombo && " • COMBO"}</p>
                    {/* Custo e margem */}
                    {!p.isCombo && (
                      <div style={{ display: "flex", gap: "5px", marginTop: "3px", flexWrap: "wrap" }}>
                        {p.cost > 0 ? (
                          <>
                            <span style={{ fontSize: "0.63rem", background: "#F0FDF4", color: "#16A34A", border: "1px solid #BBF7D0", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>
                              Custo: R${p.cost.toFixed(2)}
                            </span>
                            <span style={{ fontSize: "0.63rem", background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>
                              Margem: {(((p.price - p.cost) / p.price) * 100).toFixed(0)}%
                            </span>
                          </>
                        ) : (
                          <button
                            onClick={() => openEdit(p)}
                            style={{ fontSize: "0.63rem", background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D", borderRadius: "4px", padding: "1px 8px", fontWeight: 700, cursor: "pointer" }}>
                            ⚠️ Sem custo — clique para cadastrar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="font-extrabold gradient-text">R$ {p.price.toFixed(2)}</span>
                </div>
                {!p.active && <span style={{ fontSize: "0.7rem", color: "#EF4444", fontWeight: 700 }}>⏸️ PAUSADO</span>}

                {/* Tags do produto */}
                {p.tags && (() => { try { const t = JSON.parse(p.tags); return t.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                    {t.map((tag: string) => (
                      <span key={tag} style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px", borderRadius: "20px", background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D" }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null; } catch { return null; } })()}

                {/* Badges de canais inline — clicáveis */}
                <ChannelBadges product={p} onToggle={(key, val) => handleChannelToggle(p.id, key, val)} />

                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
                  <button onClick={() => openEdit(p)} className="btn btn-outline" style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem" }}><Edit3 size={10} /> Editar</button>
                  <button onClick={() => handleToggle(p.id, p.active)} className="btn btn-outline" style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem" }}>
                    {p.active ? <><Pause size={10} /> Pausar</> : <><Play size={10} /> Ativar</>}
                  </button>
                  <button onClick={() => handleDelete(p.id, p.name)} className="btn btn-outline" style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem", color: "var(--danger)" }}><Trash2 size={10} /></button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
