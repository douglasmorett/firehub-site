"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TableItem {
  id: string;
  number: number;
  label: string | null;
  capacity: number;
  isActive: boolean;
  openSession: {
    id: string;
    customerName: string | null;
    waiterName: string | null;
    openedAt: string;
    totalAmount: number;
    orderCount: number;
  } | null;
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category?: string;
  isCombo?: boolean;
}

interface SessionOrder {
  id: string;
  dailyOrderNumber: number | null;
  totalAmount: number;
  createdAt: string;
  status: string;
  items: { quantity: number; price: number; menuProduct: { name: string } }[];
}

interface SessionDetail {
  id: string;
  customerName: string | null;
  waiterName: string | null;
  openedAt: string;
  status: string;
  table: { number: number; label: string | null };
  orders: SessionOrder[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

function elapsed(from: string) {
  const ms = Date.now() - new Date(from).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 > 0 ? ` ${m % 60}min` : ""}`;
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function MesasPage() {
  const router = useRouter();

  // Data
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuCategories, setMenuCategories] = useState<string[]>([]);

  // UI State
  const [selectedTable, setSelectedTable] = useState<TableItem | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [view, setView] = useState<"grid" | "order">("grid"); // grid=mapa, order=fazendo pedido
  const [toast, setToast] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [tick, setTick] = useState(0);

  // Modals
  const [confirmOpen, setConfirmOpen] = useState<TableItem | null>(null); // confirm open table
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showNewTableModal, setShowNewTableModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<TableItem | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editLabel, setEditLabel] = useState("");

  // Open table form
  const [openCustomerName, setOpenCustomerName] = useState("");
  const [openWaiterName, setOpenWaiterName] = useState("");

  // Order form
  const [cart, setCart] = useState<{ item: MenuItem; qty: number }[]>([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuCat, setMenuCat] = useState("Todos");

  // Close form
  const [serviceFee, setServiceFee] = useState(10);
  const [useServiceFee, setUseServiceFee] = useState(true);
  const [splitCount, setSplitCount] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("Dinheiro");

  // New table
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newTableLabel, setNewTableLabel] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Data Fetching ─────────────────────────────────────────────────────────
  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch("/api/store/tables");
      if (res.ok) {
        const data = await res.json();
        setTables(data.tables || []);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTables(); }, [fetchTables]);
  useEffect(() => {
    const i = setInterval(fetchTables, 8000);
    return () => clearInterval(i);
  }, [fetchTables]);
  // Timer for elapsed display
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/store/table-sessions?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setSessionDetail(data);
      }
    } catch { /* silent */ }
  }, []);

  const fetchMenu = useCallback(async () => {
    if (menuItems.length > 0) return;
    try {
      const res = await fetch("/api/admin/menu-products");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const items = data.filter((p: any) => p.active).map((p: any) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            category: p.category || "Outros",
            isCombo: p.isCombo,
          }));
          setMenuItems(items);
          const cats = ["Todos", ...Array.from(new Set(items.map((i: MenuItem) => i.category || "Outros")))];
          setMenuCategories(cats as string[]);
        }
      }
    } catch { /* silent */ }
  }, [menuItems.length]);

  // ─── Actions ───────────────────────────────────────────────────────────────
  const openTable = async () => {
    if (!confirmOpen) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/store/table-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: confirmOpen.id,
          customerName: openCustomerName || null,
          waiterName: openWaiterName || null,
        }),
      });
      if (res.ok) {
        showToast(`✅ Mesa ${confirmOpen.number} ocupada!`);
        setConfirmOpen(null);
        setOpenCustomerName("");
        setOpenWaiterName("");
        await fetchTables();
        // Select the now-opened table
        const updated = await fetch("/api/store/tables");
        if (updated.ok) {
          const data = await updated.json();
          const t = (data.tables || []).find((t: TableItem) => t.id === confirmOpen.id);
          if (t) {
            setSelectedTable(t);
            if (t.openSession) fetchSessionDetail(t.openSession.id);
          }
        }
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao abrir mesa"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const freeTable = async (table: TableItem) => {
    if (!table.openSession) return;
    if (!confirm(`Liberar Mesa ${table.number}? Todos os pedidos vinculados serão mantidos.`)) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/store/table-sessions/${table.openSession.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethods: [], serviceFeePercent: 0 }),
      });
      if (res.ok) {
        showToast(`✅ Mesa ${table.number} liberada!`);
        setSelectedTable(null);
        setSessionDetail(null);
        setView("grid");
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const addOrderToSession = async () => {
    if (!selectedTable?.openSession || cart.length === 0) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/store/table-sessions/${selectedTable.openSession.id}/add-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map(c => ({
            menuProductId: c.item.id,
            quantity: c.qty,
            price: c.item.price,
          })),
        }),
      });
      if (res.ok) {
        showToast(`✅ Pedido enviado para Mesa ${selectedTable.number}!`);
        setCart([]);
        setView("grid");
        await fetchTables();
        // Refresh selected table
        const updated = await fetch("/api/store/tables");
        if (updated.ok) {
          const data = await updated.json();
          const t = (data.tables || []).find((t: TableItem) => t.id === selectedTable.id);
          if (t) {
            setSelectedTable(t);
            if (t.openSession) fetchSessionDetail(t.openSession.id);
          }
        }
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao adicionar pedido"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const closeSession = async () => {
    if (!selectedTable?.openSession) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/store/table-sessions/${selectedTable.openSession.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethods: [{ method: paymentMethod, amount: 0 }],
          serviceFeePercent: useServiceFee ? serviceFee : 0,
        }),
      });
      if (res.ok) {
        showToast(`✅ Mesa ${selectedTable.number} fechada com sucesso!`);
        setShowCloseModal(false);
        setSelectedTable(null);
        setSessionDetail(null);
        setView("grid");
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao fechar mesa"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const updateTable = async () => {
    if (!showEditModal) return;
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = { id: showEditModal.id };
      if (editNumber) body.number = parseInt(editNumber);
      if (editLabel !== undefined) body.label = editLabel || null;
      const res = await fetch("/api/store/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast(`✅ Mesa atualizada!`);
        setShowEditModal(null);
        setEditNumber("");
        setEditLabel("");
        await fetchTables();
        // Update selected table if it was the one being edited
        if (selectedTable?.id === showEditModal.id) {
          const updated = await fetch("/api/store/tables");
          if (updated.ok) {
            const data = await updated.json();
            const t = (data.tables || []).find((t: TableItem) => t.id === showEditModal.id);
            if (t) setSelectedTable(t);
          }
        }
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao atualizar"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const createTable = async () => {
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = {};
      if (newTableNumber) body.number = parseInt(newTableNumber);
      if (newTableLabel) body.label = newTableLabel;
      const res = await fetch("/api/store/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast("✅ Mesa criada!");
        setShowNewTableModal(false);
        setNewTableNumber("");
        setNewTableLabel("");
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const deleteTable = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover esta mesa?")) return;
    try {
      const res = await fetch(`/api/store/tables?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("✅ Mesa removida!");
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error}`);
      }
    } catch { showToast("❌ Erro"); }
  };

  const transferTable = async (toTableId: string) => {
    // Transfer session to another table
    if (!selectedTable?.openSession) return;
    setActionLoading(true);
    try {
      // Close current session and open new one on target table
      // For now, show toast
      showToast("🔄 Funcionalidade de transferência em breve!");
      setShowTransferModal(false);
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Computed ──────────────────────────────────────────────────────────────
  const occupiedTables = tables.filter(t => t.openSession);
  const freeTables = tables.filter(t => !t.openSession);
  const totalConsumo = occupiedTables.reduce((s, t) => s + (t.openSession?.totalAmount || 0), 0);

  const filteredMenu = useMemo(() => {
    return menuItems.filter(m => {
      const matchSearch = m.name.toLowerCase().includes(menuSearch.toLowerCase());
      const matchCat = menuCat === "Todos" || m.category === menuCat;
      return matchSearch && matchCat;
    });
  }, [menuItems, menuSearch, menuCat]);

  const cartTotal = cart.reduce((s, c) => s + c.item.price * c.qty, 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const sessionTotal = sessionDetail?.orders.reduce((s, o) => s + o.totalAmount, 0) || selectedTable?.openSession?.totalAmount || 0;

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20, background: "#7C3AED",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32, margin: "0 auto 16px", boxShadow: "0 8px 32px rgba(124,58,237,0.3)",
          }}>🍽️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#64748B" }}>Carregando mesas...</div>
        </div>
      </div>
    );
  }

  // ─── ORDER VIEW (making order for a table) ────────────────────────────────
  if (view === "order" && selectedTable?.openSession) {
    return (
      <div style={{
        display: "flex", height: "100vh",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        background: "#F8FAFC",
      }}>
        {/* LEFT: Menu */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            padding: "14px 20px", background: "#7C3AED",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <button onClick={() => { setView("grid"); setCart([]); setMenuSearch(""); setMenuCat("Todos"); }}
              style={{
                background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8,
                color: "#fff", padding: "6px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}>← Voltar</button>
            <div style={{ color: "#fff" }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                Pedido — Mesa {selectedTable.number}
                {selectedTable.label ? ` (${selectedTable.label})` : ""}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {selectedTable.openSession.customerName || ""}
                {selectedTable.openSession.waiterName ? ` · Garçom: ${selectedTable.openSession.waiterName}` : ""}
              </div>
            </div>
          </div>

          {/* Search + Categories */}
          <div style={{ padding: "12px 16px 8px", background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
            <input
              placeholder="🔍 Buscar no cardápio..."
              value={menuSearch}
              onChange={e => setMenuSearch(e.target.value)}
              autoFocus
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: "1.5px solid #E2E8F0", fontSize: 14, outline: "none",
                fontFamily: "inherit", marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
              {menuCategories.map(cat => (
                <button key={cat} onClick={() => setMenuCat(cat)} style={{
                  padding: "5px 12px", borderRadius: 20, border: "none", fontSize: 12, fontWeight: 700,
                  cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  background: menuCat === cat ? "#7C3AED" : "#F1F5F9",
                  color: menuCat === cat ? "#fff" : "#64748B",
                }}>{cat}</button>
              ))}
            </div>
          </div>

          {/* Products Grid */}
          <div style={{
            flex: 1, overflowY: "auto", padding: 12,
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 8, alignContent: "start",
          }}>
            {filteredMenu.map(item => {
              const inCart = cart.find(c => c.item.id === item.id);
              return (
                <button key={item.id} onClick={() => {
                  if (inCart) {
                    setCart(prev => prev.map(c => c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c));
                  } else {
                    setCart(prev => [...prev, { item, qty: 1 }]);
                  }
                }} style={{
                  background: inCart ? "#F0EDFF" : "#fff",
                  border: inCart ? "2px solid #7C3AED" : "1px solid #E2E8F0",
                  borderRadius: 12, padding: "12px 10px", cursor: "pointer",
                  textAlign: "left", position: "relative", transition: "all 0.1s",
                }}>
                  {inCart && (
                    <span style={{
                      position: "absolute", top: -6, right: -6,
                      background: "#7C3AED", color: "#fff", borderRadius: "50%",
                      width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 900,
                    }}>{inCart.qty}</span>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", lineHeight: 1.3, marginBottom: 6 }}>
                    {item.isCombo ? "🍱 " : ""}{item.name}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#7C3AED" }}>{fmt(item.price)}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Cart */}
        <div style={{
          width: 340, borderLeft: "1px solid #E2E8F0", background: "#fff",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            padding: "16px 18px", borderBottom: "1px solid #E2E8F0",
            fontWeight: 800, fontSize: 16, color: "#1E293B",
          }}>
            🛒 Carrinho ({cartCount} {cartCount === 1 ? "item" : "itens"})
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🍽️</div>
                <div style={{ fontSize: 14 }}>Toque nos produtos para adicionar</div>
              </div>
            ) : (
              cart.map((c, i) => (
                <div key={c.item.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 0", borderBottom: i < cart.length - 1 ? "1px solid #F1F5F9" : "none",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>{c.item.name}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED" }}>{fmt(c.item.price * c.qty)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => {
                      if (c.qty <= 1) setCart(prev => prev.filter(x => x.item.id !== c.item.id));
                      else setCart(prev => prev.map(x => x.item.id === c.item.id ? { ...x, qty: x.qty - 1 } : x));
                    }} style={{
                      width: 28, height: 28, borderRadius: 7, border: "1px solid #E2E8F0",
                      background: "#F8FAFC", cursor: "pointer", fontWeight: 700, fontSize: 16,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>−</button>
                    <span style={{ fontWeight: 800, fontSize: 14, minWidth: 18, textAlign: "center" }}>{c.qty}</span>
                    <button onClick={() => setCart(prev => prev.map(x => x.item.id === c.item.id ? { ...x, qty: x.qty + 1 } : x))}
                      style={{
                        width: 28, height: 28, borderRadius: 7, border: "none",
                        background: "#7C3AED", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>+</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div style={{ padding: "14px 18px", borderTop: "2px solid #E2E8F0", background: "#FAFAFE" }}>
              <div style={{
                display: "flex", justifyContent: "space-between", marginBottom: 12,
                fontSize: 18, fontWeight: 900, color: "#1E293B",
              }}>
                <span>Total</span>
                <span style={{ color: "#7C3AED" }}>{fmt(cartTotal)}</span>
              </div>
              <button onClick={addOrderToSession} disabled={actionLoading} style={{
                width: "100%", background: "#16A34A", color: "#fff", border: "none", borderRadius: 12,
                padding: "14px 0", fontWeight: 800, fontSize: 15, cursor: "pointer",
                opacity: actionLoading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(22,163,74,0.3)",
              }}>
                {actionLoading ? "Enviando..." : "✅ Enviar Pedido para Mesa"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── GRID VIEW (main view) ────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      {/* ─── Header ─── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", background: "#fff",
        borderBottom: "1px solid #E2E8F0", flexShrink: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => router.push("/store/pedidos-clientes")} style={{
            background: "none", border: "1px solid #E2E8F0", borderRadius: 8,
            padding: "5px 10px", cursor: "pointer", fontSize: 13, color: "#64748B",
          }}>← Pedidos</button>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: "#7C3AED",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, boxShadow: "0 2px 8px rgba(124,58,237,0.2)",
          }}>🍽️</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", margin: 0 }}>Mesas</h1>
            <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
              <span style={{ color: "#16A34A", fontWeight: 700 }}>🟢 {freeTables.length} livres</span>
              <span style={{ color: "#DC2626", fontWeight: 700 }}>🔴 {occupiedTables.length} ocupadas</span>
              {totalConsumo > 0 && <span style={{ color: "#D97706", fontWeight: 700 }}>{fmt(totalConsumo)} em consumo</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setShowNewTableModal(true)} style={{
            background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10,
            padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
            boxShadow: "0 2px 8px rgba(124,58,237,0.25)",
          }}>+ Nova Mesa</button>
          <button onClick={() => setShowConfigModal(true)} style={{
            background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0", borderRadius: 10,
            padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>⚙️</button>
        </div>
      </header>

      {/* ─── Content ─── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ─── Table Grid ─── */}
        <div style={{
          flex: 1, overflowY: "auto", padding: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))",
          gap: 12, alignContent: "start",
        }}>
          {tables.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 60 }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🍽️</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Nenhuma mesa cadastrada</h2>
              <p style={{ color: "#64748B", marginBottom: 20 }}>Comece criando suas mesas</p>
              <button onClick={() => {
                (async () => {
                  for (let i = 1; i <= 10; i++) {
                    await fetch("/api/store/tables", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ number: i }),
                    });
                  }
                  showToast("✅ 10 mesas criadas!");
                  fetchTables();
                })();
              }} style={{
                background: "#7C3AED", color: "#fff", border: "none", borderRadius: 12,
                padding: "12px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer",
                boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
              }}>Criar 10 mesas padrão</button>
            </div>
          ) : (
            tables.map(table => {
              const occupied = !!table.openSession;
              const isSelected = selectedTable?.id === table.id;
              const hasValue = occupied && (table.openSession?.totalAmount || 0) > 0;
              return (
                <button
                  key={table.id}
                  onClick={() => {
                    if (occupied) {
                      setSelectedTable(table);
                      if (table.openSession) fetchSessionDetail(table.openSession.id);
                    } else {
                      // Show confirm modal
                      setConfirmOpen(table);
                    }
                  }}
                  style={{
                    background: isSelected
                      ? "linear-gradient(135deg, #7C3AED, #6D28D9)"
                      : occupied
                        ? hasValue ? "#FEF2F2" : "#FFF7ED"
                        : "#fff",
                    border: `2px solid ${isSelected ? "#7C3AED" : occupied ? (hasValue ? "#FECACA" : "#FED7AA") : "#E2E8F0"}`,
                    borderRadius: 16, padding: "14px 10px", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 4, transition: "all 0.15s",
                    boxShadow: isSelected
                      ? "0 4px 20px rgba(124,58,237,0.35)"
                      : occupied
                        ? "0 2px 8px rgba(220,38,38,0.08)"
                        : "0 1px 3px rgba(0,0,0,0.04)",
                    minHeight: 120, position: "relative",
                  }}
                >
                  {/* Number */}
                  <span style={{
                    fontSize: 26, fontWeight: 900, letterSpacing: "-0.5px",
                    color: isSelected ? "#fff" : occupied ? "#DC2626" : "#334155",
                  }}>
                    {table.label || table.number.toString().padStart(2, "0")}
                  </span>

                  {/* Status indicator */}
                  <span style={{ fontSize: 18 }}>{occupied ? "🔴" : "🟢"}</span>

                  {occupied ? (
                    <>
                      <span style={{
                        fontSize: 14, fontWeight: 800,
                        color: isSelected ? "#E9D5FF" : "#DC2626",
                      }}>
                        {fmt(table.openSession!.totalAmount)}
                      </span>
                      <span style={{
                        fontSize: 10, color: isSelected ? "#C4B5FD" : "#9CA3AF",
                        fontWeight: 600,
                      }}>
                        {table.openSession!.orderCount} ped. · {elapsed(table.openSession!.openedAt)}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#16A34A" }}>Livre</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* ─── Side Panel ─── */}
        {selectedTable && selectedTable.openSession && (
          <div style={{
            width: 370, borderLeft: "1px solid #E2E8F0", background: "#fff",
            display: "flex", flexDirection: "column", flexShrink: 0,
            boxShadow: "-4px 0 20px rgba(0,0,0,0.04)",
          }}>
            {/* Panel Header */}
            <div style={{
              padding: "14px 18px", background: "linear-gradient(135deg, #7C3AED, #6D28D9)",
              color: "#fff",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>
                    Mesa {selectedTable.number}
                    {selectedTable.label ? ` — ${selectedTable.label}` : ""}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                    ⏱ {elapsed(selectedTable.openSession.openedAt)}
                    {selectedTable.openSession.waiterName && ` · 👤 ${selectedTable.openSession.waiterName}`}
                    {selectedTable.openSession.customerName && ` · ${selectedTable.openSession.customerName}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => {
                    setEditNumber(selectedTable.number.toString());
                    setEditLabel(selectedTable.label || "");
                    setShowEditModal(selectedTable);
                  }} style={{
                    background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8,
                    color: "#fff", width: 32, height: 32, fontSize: 14, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✏️</button>
                  <button onClick={() => { setSelectedTable(null); setSessionDetail(null); }} style={{
                    background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8,
                    color: "#fff", width: 32, height: 32, fontSize: 18, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✕</button>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6,
              padding: "10px 18px", borderBottom: "1px solid #E2E8F0",
            }}>
              <button onClick={() => { fetchMenu(); setView("order"); }} style={{
                padding: "10px 0", borderRadius: 10, border: "none",
                background: "#16A34A", color: "#fff", fontWeight: 800, fontSize: 13,
                cursor: "pointer", boxShadow: "0 2px 6px rgba(22,163,74,0.2)",
              }}>+ Novo Pedido</button>
              <button onClick={() => setShowCloseModal(true)} style={{
                padding: "10px 0", borderRadius: 10, border: "none",
                background: "#DC2626", color: "#fff", fontWeight: 800, fontSize: 13,
                cursor: "pointer", boxShadow: "0 2px 6px rgba(220,38,38,0.2)",
              }}>💰 Fechar Conta</button>
              {(selectedTable.openSession.totalAmount === 0) && (
                <button onClick={() => freeTable(selectedTable)} style={{
                  padding: "10px 0", borderRadius: 10, border: "1.5px solid #F59E0B",
                  background: "#FFFBEB", color: "#D97706", fontWeight: 800, fontSize: 13,
                  cursor: "pointer", gridColumn: "1 / -1",
                }}>🔓 Liberar Mesa (sem consumo)</button>
              )}
              {(selectedTable.openSession.totalAmount > 0) && (
                <button onClick={() => freeTable(selectedTable)} style={{
                  padding: "10px 0", borderRadius: 10, border: "1.5px solid #E2E8F0",
                  background: "#F8FAFC", color: "#64748B", fontWeight: 700, fontSize: 12,
                  cursor: "pointer", gridColumn: "1 / -1",
                }}>🔓 Liberar Mesa</button>
              )}
            </div>

            {/* Orders */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Pedidos da mesa
              </div>
              {sessionDetail?.orders && sessionDetail.orders.length > 0 ? (
                sessionDetail.orders.map((order, i) => (
                  <div key={order.id} style={{
                    padding: "10px 12px", marginBottom: 6, borderRadius: 10,
                    background: "#F8FAFC", border: "1px solid #F1F5F9",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#334155" }}>
                        Pedido #{order.dailyOrderNumber || "—"}
                      </span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: "#7C3AED" }}>
                        {fmt(order.totalAmount)}
                      </span>
                    </div>
                    {order.items.map((item, j) => (
                      <div key={j} style={{ fontSize: 12, color: "#64748B", paddingLeft: 4 }}>
                        {item.quantity}x {item.menuProduct.name} — {fmt(item.price * item.quantity)}
                      </div>
                    ))}
                    <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 4 }}>
                      {new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: "center", padding: 30, color: "#CBD5E1" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 13 }}>Nenhum pedido ainda</div>
                  <div style={{ fontSize: 12 }}>Toque em &quot;+ Novo Pedido&quot;</div>
                </div>
              )}
            </div>

            {/* Panel Footer - Total */}
            <div style={{
              padding: "14px 18px", borderTop: "2px solid #E2E8F0",
              background: "#FAFAFE",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 20, fontWeight: 900, color: "#0F172A",
              }}>
                <span>Total</span>
                <span style={{ color: "#7C3AED" }}>{fmt(sessionTotal)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                {selectedTable.openSession.orderCount} pedido{selectedTable.openSession.orderCount !== 1 ? "s" : ""} · Aberta há {elapsed(selectedTable.openSession.openedAt)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── CONFIRM OPEN TABLE MODAL ─── */}
      {confirmOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { setConfirmOpen(null); setOpenCustomerName(""); setOpenWaiterName(""); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 420,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: "#F0EDFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, margin: "0 auto 12px",
              }}>🍽️</div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 20 }}>Ocupar Mesa {confirmOpen.number}?</h3>
              <p style={{ color: "#64748B", fontSize: 14, margin: "6px 0 0" }}>
                {confirmOpen.label ? `"${confirmOpen.label}" · ` : ""}Capacidade: {confirmOpen.capacity} pessoas
              </p>
              <button onClick={() => {
                setEditNumber(confirmOpen.number.toString());
                setEditLabel(confirmOpen.label || "");
                setShowEditModal(confirmOpen);
                setConfirmOpen(null);
              }} style={{
                marginTop: 8, background: "none", border: "none", color: "#7C3AED",
                fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline",
              }}>✏️ Editar número/nome da mesa</button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>
                Nome do cliente (opcional)
              </label>
              <input value={openCustomerName} onChange={e => setOpenCustomerName(e.target.value)}
                placeholder="Ex: João, Família Silva..."
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit",
                }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>
                Garçom (opcional)
              </label>
              <input value={openWaiterName} onChange={e => setOpenWaiterName(e.target.value)}
                placeholder="Nome do garçom"
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit",
                }} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setConfirmOpen(null); setOpenCustomerName(""); setOpenWaiterName(""); }}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                  color: "#64748B", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>Cancelar</button>
              <button onClick={openTable} disabled={actionLoading}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12, border: "none",
                  background: "#7C3AED", color: "#fff", fontWeight: 800, fontSize: 14,
                  cursor: "pointer", boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
                  opacity: actionLoading ? 0.6 : 1,
                }}>
                {actionLoading ? "Abrindo..." : "✅ Ocupar Mesa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── EDIT TABLE MODAL ─── */}
      {showEditModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { setShowEditModal(null); setEditNumber(""); setEditLabel(""); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 400,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, background: "#F0EDFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, margin: "0 auto 10px",
              }}>✏️</div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>Editar Mesa {showEditModal.number}</h3>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>Número da Mesa</label>
              <input value={editNumber} onChange={e => setEditNumber(e.target.value)} type="number"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>Nome/Label (opcional)</label>
              <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                placeholder="Ex: Varanda, VIP, Terraço"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setShowEditModal(null); setEditNumber(""); setEditLabel(""); }}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                  color: "#64748B", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>Cancelar</button>
              <button onClick={updateTable} disabled={actionLoading}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12, border: "none",
                  background: "#7C3AED", color: "#fff", fontWeight: 800, fontSize: 14,
                  cursor: "pointer", boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
                  opacity: actionLoading ? 0.6 : 1,
                }}>
                {actionLoading ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CLOSE ACCOUNT MODAL ─── */}
      {showCloseModal && selectedTable?.openSession && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowCloseModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 480,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)", padding: 28,
          }}>
            <h3 style={{ margin: "0 0 18px", fontWeight: 800, fontSize: 20, textAlign: "center" }}>
              💰 Fechar Conta — Mesa {selectedTable.number}
            </h3>

            <div style={{ background: "#F8FAFC", borderRadius: 14, padding: 16, marginBottom: 16, border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 8 }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 700 }}>{fmt(sessionTotal)}</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={useServiceFee} onChange={e => setUseServiceFee(e.target.checked)} style={{ accentColor: "#7C3AED" }} />
                Taxa de serviço
                <input type="number" value={serviceFee} onChange={e => setServiceFee(Number(e.target.value))}
                  style={{ width: 50, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", textAlign: "center" }} />%
              </label>
              {useServiceFee && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#D97706" }}>
                  <span>Taxa ({serviceFee}%)</span>
                  <span style={{ fontWeight: 700 }}>{fmt(sessionTotal * serviceFee / 100)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 900, marginTop: 12, paddingTop: 12, borderTop: "2px solid #E2E8F0" }}>
                <span>TOTAL</span>
                <span style={{ color: "#7C3AED" }}>{fmt(sessionTotal + (useServiceFee ? sessionTotal * serviceFee / 100 : 0))}</span>
              </div>
            </div>

            {/* Split */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, display: "block" }}>Dividir em:</label>
              <div style={{ display: "flex", gap: 5 }}>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSplitCount(n)} style={{
                    flex: 1, padding: "8px 0", borderRadius: 8,
                    border: splitCount === n ? "2px solid #7C3AED" : "1px solid #E2E8F0",
                    background: splitCount === n ? "#F0EDFF" : "#fff",
                    color: splitCount === n ? "#7C3AED" : "#64748B",
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                  }}>{n === 1 ? "Total" : `${n}x`}</button>
                ))}
              </div>
              {splitCount > 1 && (
                <div style={{ textAlign: "center", marginTop: 8, fontSize: 15, color: "#7C3AED", fontWeight: 800 }}>
                  {fmt((sessionTotal + (useServiceFee ? sessionTotal * serviceFee / 100 : 0)) / splitCount)} por pessoa
                </div>
              )}
            </div>

            {/* Payment */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, display: "block" }}>Pagamento:</label>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {["Dinheiro", "Pix", "Débito", "Crédito", "Misto"].map(m => (
                  <button key={m} onClick={() => setPaymentMethod(m)} style={{
                    padding: "8px 14px", borderRadius: 8,
                    border: paymentMethod === m ? "2px solid #7C3AED" : "1px solid #E2E8F0",
                    background: paymentMethod === m ? "#F0EDFF" : "#fff",
                    color: paymentMethod === m ? "#7C3AED" : "#64748B",
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                  }}>{m}</button>
                ))}
              </div>
            </div>

            <button onClick={closeSession} disabled={actionLoading} style={{
              width: "100%", background: "#DC2626", color: "#fff", border: "none", borderRadius: 12,
              padding: "14px 0", fontWeight: 800, fontSize: 16, cursor: "pointer",
              opacity: actionLoading ? 0.6 : 1,
              boxShadow: "0 4px 12px rgba(220,38,38,0.25)",
            }}>
              {actionLoading ? "Fechando..." : "Fechar Conta e Liberar Mesa"}
            </button>
          </div>
        </div>
      )}

      {/* ─── NEW TABLE MODAL ─── */}
      {showNewTableModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowNewTableModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 400,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, background: "#F0EDFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, margin: "0 auto 10px",
              }}>➕</div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>Nova Mesa</h3>
            </div>
            <input placeholder="Número (auto se vazio)" value={newTableNumber} onChange={e => setNewTableNumber(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, marginBottom: 10, fontFamily: "inherit" }} />
            <input placeholder="Nome/Label (ex: Varanda 1)" value={newTableLabel} onChange={e => setNewTableLabel(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, marginBottom: 16, fontFamily: "inherit" }} />
            <button onClick={createTable} disabled={actionLoading} style={{
              width: "100%", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 12,
              padding: "12px 0", fontWeight: 800, fontSize: 15, cursor: "pointer",
              opacity: actionLoading ? 0.6 : 1,
              boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
            }}>
              {actionLoading ? "Criando..." : "Criar Mesa"}
            </button>
          </div>
        </div>
      )}

      {/* ─── CONFIG MODAL ─── */}
      {showConfigModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowConfigModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 500,
            maxHeight: "80vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontWeight: 800 }}>⚙️ Gerenciar Mesas</h3>
              <button onClick={() => setShowConfigModal(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px" }}>
              {tables.map(table => (
                <div key={table.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 0", borderBottom: "1px solid #F1F5F9",
                }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>Mesa {table.number}</span>
                    {table.label && <span style={{ color: "#9CA3AF", fontSize: 13, marginLeft: 8 }}>({table.label})</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => {
                      setEditNumber(table.number.toString());
                      setEditLabel(table.label || "");
                      setShowEditModal(table);
                      setShowConfigModal(false);
                    }} style={{
                      padding: "4px 10px", borderRadius: 6, border: "1px solid #DDD6FE",
                      background: "#F5F3FF", color: "#7C3AED", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>✏️ Editar</button>
                    {table.openSession ? (
                      <span style={{ fontSize: 12, color: "#D97706", fontWeight: 700 }}>🔴 Ocupada</span>
                    ) : (
                      <button onClick={() => deleteTable(table.id)} style={{
                        padding: "4px 10px", borderRadius: 6, border: "1px solid #FECACA",
                        background: "#FEF2F2", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}>Remover</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast ─── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1E293B", color: "#fff", padding: "12px 24px", borderRadius: 12,
          fontWeight: 700, fontSize: 14, zIndex: 2000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          animation: "fadeIn 0.2s",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
