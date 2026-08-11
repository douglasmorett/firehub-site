"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Plus, Store as StoreIcon, LayoutGrid } from "lucide-react";
import NewStoreModal from "./NewStoreModal";

interface StoreInfo {
  id: string;
  storeName: string;
  storeOpen: boolean;
  city: string | null;
  isPrimaryStore: boolean;
  ifoodConnected: boolean;
}

export default function StoreSelector() {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNewStoreModal, setShowNewStoreModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Carregar lojas do grupo
  useEffect(() => {
    fetch("/api/store/list")
      .then(r => r.json())
      .then(data => {
        if (data.stores && data.stores.length > 0) {
          setStores(data.stores);
          setActiveStoreId(data.activeStoreId || data.stores[0]?.id);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSwitch = async (storeId: string) => {
    setActiveStoreId(storeId);
    setOpen(false);
    await fetch("/api/store/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    // Recarregar a página para atualizar os dados
    window.location.reload();
  };

  // Se só tem 1 loja, não mostra seletor (mostra só o nome)
  const activeStore = stores.find(s => s.id === activeStoreId);
  const activeName = activeStoreId === "all" ? "Todas as Lojas" : (activeStore?.storeName || "Loja");

  // Não renderizar se carregando ou sem lojas
  if (loading || stores.length === 0) return null;

  // Mesmo com 1 loja, mostra dropdown para poder cadastrar nova

  const selectorUI = (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.3)",
          color: "#fff", fontWeight: 700, fontSize: "0.78rem",
          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        }}
      >
        <StoreIcon size={13} />
        {activeName}
        <ChevronDown size={12} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0,
          background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)", minWidth: 260, zIndex: 600,
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "0.6rem 1rem", borderBottom: "1px solid #F1F5F9",
            fontSize: "0.7rem", fontWeight: 700, color: "#94A3B8",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}>
            Suas Lojas
          </div>

          {/* Lista de lojas */}
          {stores.map(store => (
            <button
              key={store.id}
              onClick={() => handleSwitch(store.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "0.65rem 1rem", border: "none", borderBottom: "1px solid #F8FAFC",
                background: store.id === activeStoreId ? "#FEF2F2" : "#fff",
                cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: store.storeOpen ? "#22C55E" : "#94A3B8",
              }} />
              <div style={{ flex: 1 }}>
                <p style={{
                  margin: 0, fontWeight: 700, fontSize: "0.82rem", color: "#0F172A",
                }}>
                  {store.storeName || "Loja"}
                  {store.isPrimaryStore && (
                    <span style={{
                      fontSize: "0.6rem", background: "#DBEAFE", color: "#1D4ED8",
                      padding: "1px 6px", borderRadius: 6, marginLeft: 6, fontWeight: 600,
                    }}>PRINCIPAL</span>
                  )}
                </p>
                <p style={{ margin: 0, fontSize: "0.68rem", color: "#64748B" }}>
                  {store.city || ""}
                  {store.ifoodConnected && " • 🔴 iFood"}
                </p>
              </div>
              {store.id === activeStoreId && (
                <span style={{ color: "#DC2626", fontWeight: 900, fontSize: "0.75rem" }}>✓</span>
              )}
            </button>
          ))}

          {/* Opção "Todas as Lojas" */}
          <button
            onClick={() => handleSwitch("all")}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "0.65rem 1rem", border: "none", borderTop: "1px solid #E2E8F0",
              background: activeStoreId === "all" ? "#FEF2F2" : "#F8FAFC",
              cursor: "pointer", fontFamily: "inherit", textAlign: "left",
            }}
          >
            <LayoutGrid size={14} style={{ color: "#64748B" }} />
            <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "#334155" }}>
              📋 Todas as Lojas
            </span>
            {activeStoreId === "all" && (
              <span style={{ color: "#DC2626", fontWeight: 900, fontSize: "0.75rem", marginLeft: "auto" }}>✓</span>
            )}
          </button>

          {/* Cadastrar nova loja */}
          <button
            onClick={() => {
              setOpen(false);
              setShowNewStoreModal(true);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "0.7rem 1rem", border: "none", borderTop: "1.5px solid #E2E8F0",
              background: "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
            }}
          >
            <Plus size={14} style={{ color: "#16A34A" }} />
            <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "#16A34A" }}>
              ➕ Cadastrar Nova Loja
            </span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {selectorUI}
      <NewStoreModal open={showNewStoreModal} onClose={() => setShowNewStoreModal(false)} />
    </>
  );
}
