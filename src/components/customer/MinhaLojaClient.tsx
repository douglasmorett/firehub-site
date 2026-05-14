"use client";
import { useState } from "react";
import {
  Store, Clock, Truck, CreditCard, Tag, Gift, ArrowLeft,
  Settings, Image, Phone, MapPin, ChevronRight
} from "lucide-react";
import StoreSettingsForm from "@/components/customer/StoreSettingsForm";
import LoyaltyConfigForm from "@/components/LoyaltyConfigForm";

type Section = "menu" | "info" | "hours" | "delivery" | "payment" | "coupons" | "loyalty";

const SECTIONS = [
  {
    id: "info" as Section,
    icon: <Store size={28} />,
    color: "#C62828",
    bg: "#FFF5F5",
    title: "Informações",
    desc: "Nome, telefone, endereço, logo e banner da loja",
  },
  {
    id: "hours" as Section,
    icon: <Clock size={28} />,
    color: "#1565C0",
    bg: "#E3F2FD",
    title: "Horários",
    desc: "Configure os horários de funcionamento e pausas",
  },
  {
    id: "delivery" as Section,
    icon: <Truck size={28} />,
    color: "#2E7D32",
    bg: "#E8F5E9",
    title: "Entrega",
    desc: "Raio de entrega, bairros, frete grátis e taxa mínima",
  },
  {
    id: "payment" as Section,
    icon: <CreditCard size={28} />,
    color: "#6A1B9A",
    bg: "#F3E5F5",
    title: "Pagamentos",
    desc: "PIX, cartão, dinheiro — taxas por bandeira",
  },
  {
    id: "coupons" as Section,
    icon: <Tag size={28} />,
    color: "#E65100",
    bg: "#FFF3E0",
    title: "Cupons",
    desc: "Crie e gerencie cupons de desconto para clientes",
  },
  {
    id: "loyalty" as Section,
    icon: <Gift size={28} />,
    color: "#AD1457",
    bg: "#FCE4EC",
    title: "Fidelidade",
    desc: "Programa de pontos ou cashback para clientes fiéis",
  },
];

// Mapa de qual aba do StoreSettingsForm abrir
const SECTION_TAB_MAP: Record<string, string> = {
  info: "info",
  hours: "hours",
  delivery: "delivery",
  payment: "payment",
  coupons: "coupons",
};

export default function MinhaLojaClient({ user }: { user: any }) {
  const [section, setSection] = useState<Section>("menu");

  async function saveLoyalty(config: any) {
    await fetch("/api/store-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeLoyalty: config }),
    });
  }

  // ── Menu principal ──────────────────────────────────────────────────────────
  if (section === "menu") {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "1.5rem 1rem" }}>
        {/* Header */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 4px" }}>⚙️ Minha Loja</h1>
          <p style={{ color: "#64748B", fontSize: "0.875rem", margin: 0 }}>
            Selecione o que deseja configurar:
          </p>
        </div>

        {/* Link rápido para ver a loja */}
        {user.slug && (
          <a
            href={`/loja/${user.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#FFF5F5", border: "1px solid #FFCDD2", borderRadius: 12, textDecoration: "none", color: "#C62828", fontWeight: 700, fontSize: "0.875rem", marginBottom: "1.5rem" }}
          >
            <Store size={16} />
            Ver minha loja ao vivo
            <ChevronRight size={14} style={{ marginLeft: "auto" }} />
          </a>
        )}

        {/* Grid de seções */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              style={{
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: 16,
                padding: "1.25rem",
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.15s",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                fontFamily: "inherit",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 18px rgba(0,0,0,0.10)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = s.color;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.transform = "";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#E2E8F0";
              }}
            >
              <div style={{ width: 52, height: 52, borderRadius: 14, background: s.bg, color: s.color, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.75rem" }}>
                {s.icon}
              </div>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: "1rem", color: "#0F172A" }}>{s.title}</p>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", lineHeight: 1.5 }}>{s.desc}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Seção de Fidelidade (componente próprio) ────────────────────────────────
  if (section === "loyalty") {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "1.5rem 1rem" }}>
        <BackBtn onClick={() => setSection("menu")} title="🎁 Programa de Fidelidade" />
        <LoyaltyConfigForm
          initialConfig={user.storeLoyalty || {}}
          onSave={saveLoyalty}
        />
      </div>
    );
  }

  // ── Demais seções — usa o StoreSettingsForm com uma aba pré-selecionada ─────
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <BackBtn onClick={() => setSection("menu")} title={SECTIONS.find(s => s.id === section)?.title || ""} />
      <StoreSettingsForm
        user={user}
        initialTab={section as string}
      />
    </div>
  );
}

function BackBtn({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1.25rem" }}>
      <button
        onClick={onClick}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#F1F5F9", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", color: "#475569", fontFamily: "inherit" }}
      >
        <ArrowLeft size={14} /> Minha Loja
      </button>
      <span style={{ color: "#CBD5E1" }}>›</span>
      <span style={{ fontWeight: 700, color: "#0F172A", fontSize: "0.95rem" }}>{title}</span>
    </div>
  );
}
