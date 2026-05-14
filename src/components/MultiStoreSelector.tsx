"use client";
import { useState, useEffect, useRef } from "react";
import { Store, ChevronDown, Check } from "lucide-react";

type StoreOption = {
  id: string;
  name: string;
  slug: string;
};

export default function MultiStoreSelector() {
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selected, setSelected] = useState<string>("all");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Carregar lojas do localStorage ou simular
    const saved = localStorage.getItem("firehub_stores");
    if (saved) {
      setStores(JSON.parse(saved));
    } else {
      // Pegar do session ou usar loja padrão
      const defaultStore = { id: "current", name: "Minha Loja", slug: "minha-loja" };
      setStores([defaultStore]);
      localStorage.setItem("firehub_stores", JSON.stringify([defaultStore]));
    }

    const savedSelected = localStorage.getItem("firehub_selected_store");
    if (savedSelected) setSelected(savedSelected);

    // Fechar ao clicar fora
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectStore = (id: string) => {
    setSelected(id);
    localStorage.setItem("firehub_selected_store", id);
    setOpen(false);
    // Dispatch event para outros componentes reagirem
    window.dispatchEvent(new CustomEvent("store-changed", { detail: id }));
  };

  const selectedName = selected === "all" ? "Todas as Lojas" : stores.find(s => s.id === selected)?.name || "Minha Loja";

  // Só mostra se tem mais de 1 loja OU sempre (para servir de header)
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: "var(--surface)",
          border: "1px solid var(--border-color)",
          borderRadius: 12,
          cursor: "pointer",
          transition: "all 0.2s",
          minWidth: 200,
          boxShadow: open ? "0 4px 12px rgba(0,0,0,0.1)" : "none",
        }}
      >
        <Store size={18} style={{ color: "#EF4444", flexShrink: 0 }} />
        <div style={{ flex: 1, textAlign: "left" }}>
          <p style={{ fontSize: ".65rem", color: "var(--text-muted)", margin: 0, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Multilojas
          </p>
          <p style={{ fontSize: ".88rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            {selectedName}
          </p>
        </div>
        <ChevronDown size={16} style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          right: 0,
          background: "var(--surface)",
          border: "1px solid var(--border-color)",
          borderRadius: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          zIndex: 999,
          overflow: "hidden",
          animation: "fadeIn 0.15s ease",
        }}>
          {/* Opção "Todas" */}
          {stores.length > 1 && (
            <button
              onClick={() => selectStore("all")}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                border: "none",
                borderBottom: "1px solid var(--border-color)",
                background: selected === "all" ? "rgba(239,68,68,0.06)" : "transparent",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              <Store size={16} style={{ color: "#EF4444" }} />
              <span style={{ flex: 1, textAlign: "left", fontSize: ".85rem", fontWeight: selected === "all" ? 700 : 500 }}>Todas as Lojas</span>
              {selected === "all" && <Check size={16} style={{ color: "#EF4444" }} />}
            </button>
          )}

          {/* Lojas individuais */}
          {stores.map(store => (
            <button
              key={store.id}
              onClick={() => selectStore(store.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                border: "none",
                borderBottom: "1px solid var(--border-color)",
                background: selected === store.id ? "rgba(239,68,68,0.06)" : "transparent",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: "linear-gradient(135deg, #EF4444, #DC2626)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: ".7rem", fontWeight: 800,
              }}>
                {store.name.charAt(0)}
              </div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <p style={{ fontSize: ".85rem", fontWeight: selected === store.id ? 700 : 500, margin: 0 }}>{store.name}</p>
                <p style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: 0 }}>{store.slug}</p>
              </div>
              {selected === store.id && <Check size={16} style={{ color: "#EF4444" }} />}
            </button>
          ))}

          {/* Adicionar loja */}
          <button
            onClick={() => {
              const name = prompt("Nome da nova loja:");
              if (name) {
                const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
                const newStore = { id: Date.now().toString(), name, slug };
                const updated = [...stores, newStore];
                setStores(updated);
                localStorage.setItem("firehub_stores", JSON.stringify(updated));
              }
              setOpen(false);
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "#EF4444",
              fontSize: ".85rem",
              fontWeight: 600,
            }}
          >
            + Adicionar loja
          </button>
        </div>
      )}
    </div>
  );
}
