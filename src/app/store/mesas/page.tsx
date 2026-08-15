"use client";

import { useState, useEffect, useCallback } from "react";
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
  category?: { name: string; emoji: string } | null;
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
const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";
const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

function elapsed(from: string) {
  const ms = Date.now() - new Date(from).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function MesasPage() {
  const router = useRouter();
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<TableItem | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showNewTableModal, setShowNewTableModal] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<{ item: MenuItem; qty: number }[]>([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Close modal
  const [serviceFee, setServiceFee] = useState(10);
  const [useServiceFee, setUseServiceFee] = useState(true);
  const [splitCount, setSplitCount] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("Dinheiro");
  // New table modal
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newTableLabel, setNewTableLabel] = useState("");
  // Config
  const [editingTable, setEditingTable] = useState<TableItem | null>(null);

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

  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(fetchTables, 15000);
    return () => clearInterval(interval);
  }, [fetchTables]);

  const fetchSessionDetail = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/store/table-sessions?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setSessionDetail(data.sessions?.[0] || data);
      }
    } catch { /* silent */ }
  };

  const fetchMenu = async () => {
    try {
      const res = await fetch("/api/v1/menu");
      if (res.ok) {
        const data = await res.json();
        const items: MenuItem[] = [];
        for (const cat of data.categories || []) {
          for (const p of cat.products || []) {
            items.push({ id: p.id, name: p.name, price: p.price, category: { name: cat.name, emoji: cat.emoji || "🍽️" } });
          }
        }
        setMenuItems(items);
      }
    } catch { /* silent */ }
  };

  // ─── Actions ───────────────────────────────────────────────────────────────
  const openTable = async (table: TableItem) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/store/table-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id }),
      });
      if (res.ok) {
        showToast(`✅ Mesa ${table.number} aberta!`);
        await fetchTables();
        // Select the table to show the panel
        const updated = await fetch("/api/store/tables");
        if (updated.ok) {
          const data = await updated.json();
          const t = (data.tables || []).find((t: TableItem) => t.id === table.id);
          if (t) setSelectedTable(t);
        }
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao abrir mesa"}`);
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
        showToast(`✅ Pedido adicionado à Mesa ${selectedTable.number}!`);
        setCart([]);
        setShowAddModal(false);
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
          paymentMethods: [{ method: paymentMethod, amount: 0 }], // 0 = full amount
          serviceFeePercent: useServiceFee ? serviceFee : 0,
        }),
      });
      if (res.ok) {
        showToast(`✅ Mesa ${selectedTable.number} fechada!`);
        setShowCloseModal(false);
        setSelectedTable(null);
        setSessionDetail(null);
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao fechar mesa"}`);
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

  // ─── Computed ──────────────────────────────────────────────────────────────
  const occupiedTables = tables.filter(t => t.openSession);
  const totalConsumo = occupiedTables.reduce((s, t) => s + (t.openSession?.totalAmount || 0), 0);

  const filteredMenu = menuItems.filter(m =>
    m.name.toLowerCase().includes(menuSearch.toLowerCase()) ||
    m.category?.name.toLowerCase().includes(menuSearch.toLowerCase())
  );

  const cartTotal = cart.reduce((s, c) => s + c.item.price * c.qty, 0);

  const sessionTotal = sessionDetail?.orders.reduce((s, o) => s + o.totalAmount, 0) || selectedTable?.openSession?.totalAmount || 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F8FAFC", fontFamily: FONT }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🍽️</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#475569" }}>Carregando mesas...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#F8FAFC", fontFamily: FONT }}>
      {/* ─── Header ─── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 24px", background: "#fff", borderBottom: "1px solid #E2E8F0",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/store/pedidos-clientes")} style={{
            background: "none", border: "1px solid #E2E8F0", borderRadius: 8,
            padding: "6px 12px", cursor: "pointer", fontSize: 14, color: "#64748B",
          }}>← Pedidos</button>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>🍽️ Mesas</h1>
          <span style={{
            background: "#F0FDF4", color: "#16A34A", fontSize: 13, fontWeight: 700,
            padding: "3px 10px", borderRadius: 20,
          }}>
            {occupiedTables.length} ocupada{occupiedTables.length !== 1 ? "s" : ""}
          </span>
          {totalConsumo > 0 && (
            <span style={{
              background: "#FEF3C7", color: "#D97706", fontSize: 13, fontWeight: 700,
              padding: "3px 10px", borderRadius: 20,
            }}>
              {fmt(totalConsumo)} em consumo
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowNewTableModal(true)} style={{
            background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10,
            padding: "8px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}>+ Nova Mesa</button>
          <button onClick={() => setShowConfigModal(true)} style={{
            background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0", borderRadius: 10,
            padding: "8px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}>⚙️ Configurar</button>
        </div>
      </header>

      {/* ─── Content ─── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ─── Table Grid ─── */}
        <div style={{
          flex: 1, overflowY: "auto", padding: 24,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 16, alignContent: "start",
        }}>
          {tables.length === 0 ? (
            <div style={{
              gridColumn: "1 / -1", textAlign: "center", padding: 60,
            }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🍽️</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Nenhuma mesa cadastrada</h2>
              <p style={{ color: "#64748B", marginBottom: 20 }}>Clique em &quot;+ Nova Mesa&quot; para começar</p>
              <button onClick={() => {
                // Create 10 default tables
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
                background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10,
                padding: "12px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer",
              }}>Criar 10 mesas padrão</button>
            </div>
          ) : (
            tables.map(table => {
              const occupied = !!table.openSession;
              const isSelected = selectedTable?.id === table.id;
              return (
                <button
                  key={table.id}
                  onClick={() => {
                    if (occupied) {
                      setSelectedTable(table);
                      if (table.openSession) fetchSessionDetail(table.openSession.id);
                    } else {
                      openTable(table);
                    }
                  }}
                  style={{
                    background: isSelected ? "#7C3AED" : occupied ? "#FEF2F2" : "#fff",
                    border: `2px solid ${isSelected ? "#7C3AED" : occupied ? "#FECACA" : "#E2E8F0"}`,
                    borderRadius: 16, padding: 16, cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 6, transition: "all 0.15s",
                    boxShadow: isSelected ? "0 4px 20px rgba(124,58,237,0.3)" : "0 1px 3px rgba(0,0,0,0.06)",
                    minHeight: 130,
                  }}
                >
                  <span style={{
                    fontSize: 28, fontWeight: 900,
                    color: isSelected ? "#fff" : occupied ? "#DC2626" : "#334155",
                  }}>
                    {table.label || table.number.toString().padStart(2, "0")}
                  </span>
                  <span style={{ fontSize: 24 }}>{occupied ? "🔴" : "🟢"}</span>
                  {occupied ? (
                    <>
                      <span style={{
                        fontSize: 15, fontWeight: 800,
                        color: isSelected ? "#E9D5FF" : "#DC2626",
                      }}>
                        {fmt(table.openSession!.totalAmount)}
                      </span>
                      <span style={{
                        fontSize: 11, color: isSelected ? "#C4B5FD" : "#9CA3AF",
                        fontWeight: 600,
                      }}>
                        {table.openSession!.orderCount} pedido{table.openSession!.orderCount !== 1 ? "s" : ""} · {elapsed(table.openSession!.openedAt)}
                      </span>
                    </>
                  ) : (
                    <span style={{
                      fontSize: 13, fontWeight: 600,
                      color: "#16A34A",
                    }}>Livre</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* ─── Side Panel (when table selected) ─── */}
        {selectedTable && selectedTable.openSession && (
          <div style={{
            width: 380, borderLeft: "1px solid #E2E8F0", background: "#fff",
            display: "flex", flexDirection: "column", flexShrink: 0,
          }}>
            {/* Panel Header */}
            <div style={{
              padding: "16px 20px", borderBottom: "1px solid #E2E8F0",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", margin: 0 }}>
                  🍽️ Mesa {selectedTable.number}
                </h2>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                  Aberta há {elapsed(selectedTable.openSession.openedAt)}
                  {selectedTable.openSession.customerName && ` · ${selectedTable.openSession.customerName}`}
                </span>
              </div>
              <button onClick={() => { setSelectedTable(null); setSessionDetail(null); }} style={{
                background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9CA3AF",
              }}>✕</button>
            </div>

            {/* Orders list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
              {sessionDetail?.orders.map((order, i) => (
                <div key={order.id} style={{
                  padding: "12px 0", borderBottom: i < (sessionDetail?.orders.length || 0) - 1 ? "1px solid #F1F5F9" : "none",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "#334155" }}>
                      Pedido #{order.dailyOrderNumber || "—"}
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 14, color: "#7C3AED" }}>
                      {fmt(order.totalAmount)}
                    </span>
                  </div>
                  {order.items.map((item, j) => (
                    <div key={j} style={{ fontSize: 13, color: "#64748B", paddingLeft: 8 }}>
                      {item.quantity}x {item.menuProduct.name} — {fmt(item.price * item.quantity)}
                    </div>
                  ))}
                </div>
              )) || (
                <div style={{ textAlign: "center", padding: 20, color: "#9CA3AF" }}>
                  Nenhum pedido ainda
                </div>
              )}
            </div>

            {/* Panel Footer */}
            <div style={{
              padding: "16px 20px", borderTop: "1px solid #E2E8F0",
              background: "#F8FAFC",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", marginBottom: 12,
                fontSize: 18, fontWeight: 800, color: "#0F172A",
              }}>
                <span>Total</span>
                <span>{fmt(sessionTotal)}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { fetchMenu(); setShowAddModal(true); }} style={{
                  flex: 1, background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10,
                  padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>+ Adicionar</button>
                <button onClick={() => setShowCloseModal(true)} style={{
                  flex: 1, background: "#DC2626", color: "#fff", border: "none", borderRadius: 10,
                  padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>💰 Fechar Conta</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Add Items Modal ─── */}
      {showAddModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowAddModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, width: "90%", maxWidth: 600,
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontWeight: 800 }}>Adicionar à Mesa {selectedTable?.number}</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "12px 20px" }}>
              <input
                placeholder="🔍 Buscar produto..."
                value={menuSearch}
                onChange={e => setMenuSearch(e.target.value)}
                autoFocus
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  border: "1.5px solid #E2E8F0", fontSize: 14, outline: "none",
                  fontFamily: FONT,
                }}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
              {filteredMenu.map(item => {
                const inCart = cart.find(c => c.item.id === item.id);
                return (
                  <div key={item.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 0", borderBottom: "1px solid #F1F5F9",
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#334155" }}>
                        {item.category?.emoji} {item.name}
                      </div>
                      <div style={{ fontSize: 13, color: "#7C3AED", fontWeight: 700 }}>{fmt(item.price)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {inCart ? (
                        <>
                          <button onClick={() => setCart(prev => prev.map(c => c.item.id === item.id ? { ...c, qty: Math.max(1, c.qty - 1) } : c))}
                            style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC", cursor: "pointer", fontWeight: 700 }}>−</button>
                          <span style={{ fontWeight: 800, fontSize: 15, minWidth: 20, textAlign: "center" }}>{inCart.qty}</span>
                          <button onClick={() => setCart(prev => prev.map(c => c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c))}
                            style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "#7C3AED", color: "#fff", cursor: "pointer", fontWeight: 700 }}>+</button>
                          <button onClick={() => setCart(prev => prev.filter(c => c.item.id !== item.id))}
                            style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", fontSize: 12 }}>✕</button>
                        </>
                      ) : (
                        <button onClick={() => setCart(prev => [...prev, { item, qty: 1 }])}
                          style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F0EDFF", color: "#7C3AED", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                          + Adicionar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {cart.length > 0 && (
              <div style={{ padding: "12px 20px", borderTop: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 16 }}>{cart.reduce((s, c) => s + c.qty, 0)} itens</span>
                  <span style={{ color: "#7C3AED", fontWeight: 800, fontSize: 16, marginLeft: 12 }}>{fmt(cartTotal)}</span>
                </div>
                <button onClick={addOrderToSession} disabled={actionLoading} style={{
                  background: "#16A34A", color: "#fff", border: "none", borderRadius: 10,
                  padding: "10px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                  opacity: actionLoading ? 0.6 : 1,
                }}>
                  {actionLoading ? "Enviando..." : "✅ Enviar Pedido"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Close Account Modal ─── */}
      {showCloseModal && selectedTable?.openSession && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowCloseModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, width: "90%", maxWidth: 480,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)", padding: 24,
          }}>
            <h3 style={{ margin: "0 0 16px", fontWeight: 800, fontSize: 20 }}>💰 Fechar Conta — Mesa {selectedTable.number}</h3>

            <div style={{ background: "#F8FAFC", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 8 }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 700 }}>{fmt(sessionTotal)}</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={useServiceFee} onChange={e => setUseServiceFee(e.target.checked)} />
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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 900, marginTop: 12, paddingTop: 12, borderTop: "2px solid #E2E8F0" }}>
                <span>TOTAL</span>
                <span style={{ color: "#7C3AED" }}>{fmt(sessionTotal + (useServiceFee ? sessionTotal * serviceFee / 100 : 0))}</span>
              </div>
            </div>

            {/* Split */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, display: "block" }}>Dividir em:</label>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSplitCount(n)} style={{
                    flex: 1, padding: "8px 0", borderRadius: 8,
                    border: splitCount === n ? "2px solid #7C3AED" : "1px solid #E2E8F0",
                    background: splitCount === n ? "#F0EDFF" : "#fff",
                    color: splitCount === n ? "#7C3AED" : "#64748B",
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                  }}>{n === 1 ? "Inteiro" : `${n}x`}</button>
                ))}
              </div>
              {splitCount > 1 && (
                <div style={{ textAlign: "center", marginTop: 8, fontSize: 14, color: "#7C3AED", fontWeight: 700 }}>
                  {fmt((sessionTotal + (useServiceFee ? sessionTotal * serviceFee / 100 : 0)) / splitCount)} por pessoa
                </div>
              )}
            </div>

            {/* Payment method */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, display: "block" }}>Pagamento:</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
            }}>
              {actionLoading ? "Fechando..." : "Fechar Conta"}
            </button>
          </div>
        </div>
      )}

      {/* ─── New Table Modal ─── */}
      {showNewTableModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowNewTableModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, width: "90%", maxWidth: 400,
            padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <h3 style={{ margin: "0 0 16px", fontWeight: 800 }}>+ Nova Mesa</h3>
            <input placeholder="Número (auto se vazio)" value={newTableNumber} onChange={e => setNewTableNumber(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, marginBottom: 10, fontFamily: FONT }} />
            <input placeholder="Nome (opcional, ex: Varanda 1)" value={newTableLabel} onChange={e => setNewTableLabel(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, marginBottom: 16, fontFamily: FONT }} />
            <button onClick={createTable} disabled={actionLoading} style={{
              width: "100%", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10,
              padding: "12px 0", fontWeight: 700, fontSize: 15, cursor: "pointer",
            }}>
              {actionLoading ? "Criando..." : "Criar Mesa"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Config Modal ─── */}
      {showConfigModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowConfigModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, width: "90%", maxWidth: 500,
            maxHeight: "80vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontWeight: 800 }}>⚙️ Configurar Mesas</h3>
              <button onClick={() => setShowConfigModal(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
              {tables.map(table => (
                <div key={table.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 0", borderBottom: "1px solid #F1F5F9",
                }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>Mesa {table.number}</span>
                    {table.label && <span style={{ color: "#9CA3AF", fontSize: 13, marginLeft: 8 }}>{table.label}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {!table.openSession && (
                      <button onClick={() => deleteTable(table.id)} style={{
                        padding: "4px 10px", borderRadius: 6, border: "1px solid #FECACA",
                        background: "#FEF2F2", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}>Remover</button>
                    )}
                    {table.openSession && (
                      <span style={{ fontSize: 12, color: "#D97706", fontWeight: 600 }}>🔴 Ocupada</span>
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
          fontWeight: 700, fontSize: 14, zIndex: 2000, boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
