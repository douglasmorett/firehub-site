"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, ClipboardList, Store, Users, ShoppingBag, ExternalLink, LogOut, UtensilsCrossed, Bike, BarChart2, Printer, Zap, X, AlertTriangle, History, PieChart, Package, Monitor, Bot, Send, Puzzle } from "lucide-react";
import { useState, useTransition, useEffect, useRef } from "react";
import StoreSelector from "./StoreSelector";

const NAV_ITEMS = [
  { href: "/store", label: "Início", icon: Home },
  { href: "/store/pedidos-clientes", label: "Pedidos", icon: ClipboardList, highlight: true },
  { href: "/store/kds", label: "KDS", icon: Monitor },
  { href: "/store/chatbot", label: "Chatbot IA", icon: Bot, badge: "NOVO" },
  { href: "/store/estoque", label: "Estoque", icon: Package },
  { href: "/store/financeiro", label: "Financeiro", icon: BarChart2 },
  { href: "/store/meta-ads", label: "Tráfego Pago", icon: Zap, badge: "IA" },
  { href: "/store/motoboys", label: "Motoboys", icon: Bike },
  { href: "/store/funcionarios", label: "Funcionários", icon: Users },
  { href: "/store/minha-loja", label: "Minha Loja", icon: Store },
];

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

const METHODS = [
  { key: "cash",    label: "💵 Dinheiro" },
  { key: "debit",   label: "💳 Débito" },
  { key: "credit",  label: "💳 Crédito" },
  { key: "pix",     label: "⚡ PIX" },
  { key: "voucher", label: "🎟️ Voucher" },
];

export default function StoreTopNav({
  userName, userCity, userSlug, showCompras, isAdmin = false,
  initialStoreOpen = true, initialCashOpen = false,
  showAntecipacao = false,
}: {
  userName: string; userCity: string; userSlug?: string | null;
  showCompras: boolean; isAdmin?: boolean; initialStoreOpen?: boolean; initialCashOpen?: boolean;
  showAntecipacao?: boolean;
}) {
  const pathname = usePathname();
  const menuItems = showAntecipacao
    ? [...NAV_ITEMS, { href: "/store/antecipacao", label: "Antecipação", icon: Zap }]
    : NAV_ITEMS;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const isCompras = pathname?.startsWith("/store/compras") || pathname?.startsWith("/store/orders");
  const storeUrl = userSlug ? `/loja/${userSlug}` : null;

  const [storeOpen, setStoreOpen] = useState(initialStoreOpen);
  const [cashOpen, setCashOpen] = useState(initialCashOpen);
  const [toggling, setToggling] = useState<"store" | null>(null);

  // ── PAUSE MODAL ──────────────────────────────────────────────
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [pauseDuration, setPauseDuration] = useState("1h");
  const [pauseReason, setPauseReason] = useState("Intervalo");
  const [pauseScope, setPauseScope] = useState<"site" | "site+ifood">("site+ifood");
  const [pauseCustomEnd, setPauseCustomEnd] = useState("");
  const [pausing, setPausing] = useState(false);

  // iFood stores dropdown
  const [ifoodStore, setIfoodStore]       = useState<any>(null);
  const [ifoodAvailable, setIfoodAvail]   = useState<boolean | null>(null);
  const [showIfood, setShowIfood]         = useState(false);
  const [ifoodToggling, setIfoodToggling] = useState(false);
  const ifoodRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ifood/auth?step=test").then(r => r.json()).then(d => {
      if (d.connected) {
        setIfoodStore({ name: d.storeName, id: d.merchantId });
        // busca disponibilidade
        fetch("/api/ifood/merchant").then(r => r.json()).then(m => {
          if (m.status) {
            const entries = Array.isArray(m.status) ? m.status : [m.status];
            setIfoodAvail(entries.some((s: any) => s.available === true));
          }
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ifoodRef.current && !ifoodRef.current.contains(e.target as Node)) setShowIfood(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleIfood = async () => {
    if (!ifoodStore || ifoodToggling) return;
    setIfoodToggling(true);
    try {
      if (ifoodAvailable) {
        // Fechar: cria interrupção longa (1 ano)
        const localIso = (d: Date) => {
          const p = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        };
        const now = new Date();
        const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        const resp = await fetch("/api/ifood/interruptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: "Loja fechada manualmente", start: localIso(now), end: localIso(farFuture) }),
        });
        const result = await resp.json();
        if (resp.ok) { setIfoodAvail(false); }
        else { console.error("[iFood] Fechar falhou:", result); }
      } else {
        // Abrir: remove todas as interrupções
        const res = await fetch("/api/ifood/interruptions");
        if (res.ok) {
          const items = await res.json();
          for (const item of (Array.isArray(items) ? items : [])) {
            if (item.id) await fetch(`/api/ifood/interruptions/${item.id}`, { method: "DELETE" });
          }
        }
        setIfoodAvail(true);
      }
    } catch(e) { console.error("[iFood] toggleIfood erro:", e); }
    finally { setIfoodToggling(false); }
  };

  // ── MODALS ──────────────────────────────────────────────────────
  const [showOpenModal, setShowOpenModal]   = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [openingAmount, setOpeningAmount]   = useState("");
  const [opening, setOpening]               = useState(false);

  // Close modal state
  const [expected, setExpected] = useState<Record<string,number>>({ cash:0, debit:0, credit:0, pix:0, voucher:0, total:0 });
  const [actual, setActual]     = useState<Record<string,string>>({ cash:"", debit:"", credit:"", pix:"", voucher:"" });
  const [closing, setClosing]   = useState(false);
  const [closeWarn, setCloseWarn] = useState(false);
  const [diff, setDiff]         = useState(0);

  // Fetch expected values when opening close modal
  useEffect(() => {
    if (!showCloseModal) return;
    fetch("/api/cash-session").then(r => r.json()).then(d => {
      if (d.expected) setExpected(d.expected);
    });
  }, [showCloseModal]);

  // ── OPEN CASH ───────────────────────────────────────────────────
  const handleOpenCash = async () => {
    setOpening(true);
    const res = await fetch("/api/cash-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingAmount: Number(openingAmount) || 0 }),
    });
    setOpening(false);
    if (res.ok) {
      setCashOpen(true);
      setShowOpenModal(false);
      setOpeningAmount("");
      startTransition(() => router.refresh());
    }
  };

  // ── CLOSE CASH ──────────────────────────────────────────────────
  const totalActual = METHODS.reduce((s, m) => s + (Number(actual[m.key]) || 0), 0) + (expected.ifoodOnline || 0) + (expected.ifoodCoupons || 0);

  const tryClose = () => {
    const d = totalActual - expected.total;
    setDiff(d);
    if (Math.abs(d) > 0.01) { setCloseWarn(true); return; }
    doClose();
  };

  const doClose = async () => {
    setClosing(true);
    await fetch("/api/cash-session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        closingCash: Number(actual.cash) || 0,
        closingDebit: Number(actual.debit) || 0,
        closingCredit: Number(actual.credit) || 0,
        closingPix: Number(actual.pix) || 0,
        closingVoucher: Number(actual.voucher) || 0,
        expectedCash: expected.cash, expectedDebit: expected.debit,
        expectedCredit: expected.credit, expectedPix: expected.pix,
        expectedVoucher: expected.voucher, expectedTotal: expected.total,
        difference: diff,
      }),
    });
    setClosing(false);
    setCashOpen(false);
    setShowCloseModal(false);
    setCloseWarn(false);
    setActual({ cash:"", debit:"", credit:"", pix:"", voucher:"" });
    startTransition(() => router.refresh());
  };

  // ── STORE TOGGLE ─────────────────────────────────────────────────
  const handleStoreToggleClick = () => {
    if (storeOpen) {
      // Abrindo modal de pausa em vez de fechar direto
      setShowPauseModal(true);
    } else {
      // Reabrindo loja
      reopenStore();
    }
  };

  const reopenStore = async () => {
    setToggling("store");
    const res = await fetch("/api/store/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeOpen: true }),
    });
    if (res.ok) {
      setStoreOpen(true);
      startTransition(() => router.refresh());
      if (ifoodStore) {
        fetch("/api/ifood/interruptions").then(r => r.json()).then(items => {
          for (const item of (Array.isArray(items) ? items : [])) {
            if (item.id) fetch(`/api/ifood/interruptions/${item.id}`, { method: "DELETE" }).catch(() => {});
          }
          setIfoodAvail(true);
        }).catch(() => {});
      }
    }
    setToggling(null);
  };

  const getPauseEndDate = (): Date => {
    const now = new Date();
    switch (pauseDuration) {
      case "15m": return new Date(now.getTime() + 15 * 60 * 1000);
      case "1h": return new Date(now.getTime() + 60 * 60 * 1000);
      case "6h": return new Date(now.getTime() + 6 * 60 * 60 * 1000);
      case "12h": return new Date(now.getTime() + 12 * 60 * 60 * 1000);
      case "hoje": { const d = new Date(now); d.setHours(23, 59, 59); return d; }
      case "amanha": { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(23, 59, 59); return d; }
      case "custom": return pauseCustomEnd ? new Date(pauseCustomEnd) : new Date(now.getTime() + 60 * 60 * 1000);
      default: return new Date(now.getTime() + 60 * 60 * 1000);
    }
  };

  const confirmPause = async () => {
    setPausing(true);
    const endDate = getPauseEndDate();
    // 1. Fechar site
    const res = await fetch("/api/store/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeOpen: false, storePause: { active: true, until: endDate.toISOString(), reason: pauseReason, scope: pauseScope } }),
    });
    if (res.ok) {
      setStoreOpen(false);
      startTransition(() => router.refresh());
      // 2. Pausar iFood se selecionado
      if (pauseScope === "site+ifood" && ifoodStore) {
        const localIso = (d: Date) => {
          const p = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        };
        const now = new Date();
        fetch("/api/ifood/interruptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: pauseReason, start: localIso(now), end: localIso(endDate) }),
        }).then(() => setIfoodAvail(false)).catch(() => {});
      }
    }
    setPausing(false);
    setShowPauseModal(false);
  };

  const TogglePill = ({ label, isOn, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "6px 12px", borderRadius: 20,
      border: `1.5px solid ${isOn ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)"}`,
      background: isOn ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
      color: "#fff", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer",
      opacity: disabled ? 0.6 : 1, fontFamily: "inherit",
    }}>
      <span style={{ display:"inline-block", width:28, height:15, borderRadius:8, background: isOn ? "#4ADE80" : "#64748B", position:"relative" }}>
        <span style={{ position:"absolute", top:2, left: isOn ? 15 : 2, width:11, height:11, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
      </span>
      {label}{label === "Loja" ? (isOn ? " aberta" : " fechada") : (isOn ? " aberto" : " fechado")}
    </button>
  );

  const SiteToggle = () => (
    <TogglePill label="Site" isOn={storeOpen} onClick={handleStoreToggleClick} disabled={toggling === "store"} />
  );

  const PAUSE_DURATIONS = [
    { key: "15m", label: "15 minutos" }, { key: "1h", label: "1 hora" },
    { key: "6h", label: "6 horas" }, { key: "12h", label: "12 horas" },
    { key: "hoje", label: "Até hoje" }, { key: "amanha", label: "Até amanhã" },
    { key: "custom", label: "Personalizado" },
  ];
  const PAUSE_REASONS = ["Folga", "Força maior", "Intervalo", "Limpeza", "Manutenção", "Treinamento", "Outro"];
  const pauseEnd = getPauseEndDate();
  const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  };
  const card: React.CSSProperties = {
    background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 480,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative",
  };

  return (
    <>
      {/* ── MODAL: PAUSAR LOJA ────────────────────────────── */}
      {showPauseModal && (
        <div style={overlay} onClick={() => setShowPauseModal(false)}>
          <div style={{ ...card, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowPauseModal(false)} style={{ position:"absolute", top:12, right:12, background:"none", border:"none", cursor:"pointer" }}><X size={20} /></button>
            <h2 style={{ margin:"0 0 6px", fontSize:"1.15rem", fontWeight:900 }}>Agendar uma nova pausa</h2>

            {/* Preview */}
            <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:12, padding:"10px 14px", marginBottom:"1rem", fontSize:"0.82rem", color:"#1E40AF", fontWeight:600 }}>
              Pausa de <strong>{fmtDate(new Date())}</strong> até <strong>{fmtDate(pauseEnd)}</strong>
            </div>

            {/* Escopo: site só ou site + iFood */}
            <p style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", margin:"0 0 8px" }}>O que pausar?</p>
            <div style={{ display:"flex", gap:8, marginBottom:"1rem" }}>
              {(["site", "site+ifood"] as const).map(scope => {
                const active = pauseScope === scope;
                return (
                  <button key={scope} onClick={() => setPauseScope(scope)} style={{
                    flex:1, padding:"10px 12px", borderRadius:12, cursor:"pointer", fontFamily:"inherit",
                    border: active ? "2px solid #C62828" : "1.5px solid #E2E8F0",
                    background: active ? "#FEF2F2" : "#fff",
                    color: active ? "#C62828" : "#64748B", fontWeight: active ? 700 : 500, fontSize:"0.82rem",
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"center" }}>
                      <span style={{ width:16, height:16, borderRadius:"50%", border: active ? "5px solid #C62828" : "2px solid #CBD5E1", display:"inline-block", flexShrink:0 }} />
                      {scope === "site" ? "Pausar só o site" : "Pausar site + iFood"}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* iFood stores - se tem iFood conectado e escopo inclui iFood */}
            {pauseScope === "site+ifood" && ifoodStore && (
              <div style={{ background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:10, padding:"10px 14px", marginBottom:"1rem", fontSize:"0.8rem" }}>
                <p style={{ margin:"0 0 6px", fontWeight:700, color:"#92400E", fontSize:"0.75rem" }}>LOJAS IFOOD QUE SERÃO PAUSADAS</p>
                <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                  <input type="checkbox" checked disabled style={{ width:16, height:16, accentColor:"#C62828" }} />
                  <span style={{ fontWeight:600, color:"#0F172A" }}>{ifoodStore.name || "Loja iFood"}</span>
                  <span style={{ fontSize:"0.7rem", color: ifoodAvailable ? "#16A34A" : "#94A3B8", fontWeight:600 }}>{ifoodAvailable ? "(aberta)" : "(fechada)"}</span>
                </label>
              </div>
            )}

            {/* Duração */}
            <p style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", margin:"0 0 8px" }}>Por quanto tempo a loja será fechada?</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom: pauseDuration === "custom" ? 8 : 16 }}>
              {PAUSE_DURATIONS.map(d => {
                const active = pauseDuration === d.key;
                return (
                  <button key={d.key} onClick={() => setPauseDuration(d.key)} style={{
                    padding:"7px 14px", borderRadius:20, cursor:"pointer", fontFamily:"inherit",
                    border: active ? "2px solid #C62828" : "1.5px solid #E2E8F0",
                    background: active ? "#C6282810" : "#fff",
                    color: active ? "#C62828" : "#64748B", fontWeight: active ? 700 : 500, fontSize:"0.78rem",
                  }}>
                    <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ width:14, height:14, borderRadius:"50%", border: active ? "4px solid #C62828" : "2px solid #CBD5E1", display:"inline-block" }} />
                      {d.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {pauseDuration === "custom" && (
              <input type="datetime-local" value={pauseCustomEnd} onChange={e => setPauseCustomEnd(e.target.value)}
                style={{ width:"100%", padding:"9px 12px", borderRadius:10, border:"1.5px solid #E2E8F0", fontSize:"0.85rem", marginBottom:16, fontFamily:"inherit" }} />
            )}

            {/* Motivo */}
            <p style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", margin:"0 0 8px" }}>Qual o motivo da pausa?</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:"1.25rem" }}>
              {PAUSE_REASONS.map(r => {
                const active = pauseReason === r;
                return (
                  <button key={r} onClick={() => setPauseReason(r)} style={{
                    padding:"7px 14px", borderRadius:20, cursor:"pointer", fontFamily:"inherit",
                    border: active ? "2px solid #C62828" : "1.5px solid #E2E8F0",
                    background: active ? "#C6282810" : "#fff",
                    color: active ? "#C62828" : "#64748B", fontWeight: active ? 700 : 500, fontSize:"0.78rem",
                  }}>
                    <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ width:14, height:14, borderRadius:"50%", border: active ? "4px solid #C62828" : "2px solid #CBD5E1", display:"inline-block" }} />
                      {r}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Confirmar */}
            <button onClick={confirmPause} disabled={pausing} style={{
              width:"100%", padding:"13px", background:"linear-gradient(135deg,#B71C1C,#C62828)", color:"#fff",
              border:"none", borderRadius:14, fontWeight:900, fontSize:"1rem", cursor:"pointer", fontFamily:"inherit",
              opacity: pausing ? 0.7 : 1,
            }}>
              {pausing ? "Pausando..." : `⏸️ Confirmar pausa${pauseScope === "site+ifood" ? " (Site + iFood)" : " (só Site)"}`}
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: ABRIR CAIXA ─────────────────────────────── */}
      {showOpenModal && (
        <div style={overlay} onClick={() => setShowOpenModal(false)}>
          <div style={card} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowOpenModal(false)} style={{ position:"absolute", top:12, right:12, background:"none", border:"none", cursor:"pointer" }}><X size={20} /></button>
            <div style={{ fontSize:"1.8rem", marginBottom:8 }}>💰</div>
            <h2 style={{ margin:"0 0 4px", fontSize:"1.1rem", fontWeight:900 }}>Abrir Caixa</h2>
            <p style={{ margin:"0 0 1.2rem", fontSize:"0.85rem", color:"#64748B" }}>Informe o valor de troco disponível para abertura do caixa.</p>
            <label style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", display:"block", marginBottom:6 }}>Valor de abertura (troco em caixa)</label>
            <input
              type="number" min="0" step="0.01" placeholder="Ex: 50,00"
              value={openingAmount} onChange={e => setOpeningAmount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleOpenCash()}
              autoFocus
              style={{ width:"100%", padding:"10px 14px", borderRadius:10, border:"2px solid #E2E8F0", fontSize:"1rem", outline:"none", marginBottom:"1rem", fontFamily:"inherit" }}
            />
            <button onClick={handleOpenCash} disabled={opening} style={{
              width:"100%", padding:"12px", background:"#16A34A", color:"#fff",
              border:"none", borderRadius:12, fontWeight:900, fontSize:"1rem", cursor:"pointer", fontFamily:"inherit",
            }}>
              {opening ? "Abrindo..." : "✅ Confirmar Abertura"}
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: FECHAR CAIXA ────────────────────────────── */}
      {showCloseModal && (
        <div style={overlay} onClick={() => !closeWarn && setShowCloseModal(false)}>
          <div style={{ ...card, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            {!closeWarn ? (
              <>
                <button onClick={() => setShowCloseModal(false)} style={{ position:"absolute", top:12, right:12, background:"none", border:"none", cursor:"pointer" }}><X size={20} /></button>
                <div style={{ fontSize:"1.5rem", marginBottom:4 }}>🏦</div>
                <h2 style={{ margin:"0 0 4px", fontSize:"1.1rem", fontWeight:900 }}>Encerrar Caixa</h2>
                <p style={{ margin:"0 0 1rem", fontSize:"0.82rem", color:"#64748B" }}>
                  Informe o valor <strong>real contado</strong> em cada forma de pagamento. O que importa é o <strong>total</strong>.
                </p>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.85rem", marginBottom:"1rem" }}>
                  <thead>
                    <tr style={{ background:"#F8FAFC" }}>
                      <th style={{ padding:"8px 10px", textAlign:"left", fontWeight:700, color:"#374151", borderBottom:"2px solid #E2E8F0" }}>Pagamento</th>
                      <th style={{ padding:"8px 10px", textAlign:"right", fontWeight:700, color:"#374151", borderBottom:"2px solid #E2E8F0" }}>Sistema espera</th>
                      <th style={{ padding:"8px 10px", textAlign:"right", fontWeight:700, color:"#374151", borderBottom:"2px solid #E2E8F0" }}>Você contou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METHODS.map(m => (
                      <tr key={m.key} style={{ borderBottom:"1px solid #F1F5F9" }}>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:"#374151" }}>{m.label}</td>
                        <td style={{ padding:"8px 10px", textAlign:"right", color:"#64748B" }}>{fmt(expected[m.key] || 0)}</td>
                        <td style={{ padding:"8px 10px", textAlign:"right" }}>
                          <input
                            type="number" min="0" step="0.01"
                            placeholder="0,00"
                            value={actual[m.key]}
                            onChange={e => setActual(prev => ({ ...prev, [m.key]: e.target.value }))}
                            style={{ width:90, padding:"5px 8px", borderRadius:8, border:"1.5px solid #E2E8F0", fontSize:"0.85rem", textAlign:"right", outline:"none", fontFamily:"inherit" }}
                          />
                        </td>
                      </tr>
                    ))}
                    {(expected.ifoodOnline || 0) > 0 && (
                      <tr style={{ borderBottom:"1px solid #F1F5F9", background:"#F0F9FF" }}>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:"#0284C7" }}>🔴 iFood (Pago Online)</td>
                        <td style={{ padding:"8px 10px", textAlign:"right", color:"#0284C7", fontWeight:700 }}>{fmt(expected.ifoodOnline)}</td>
                        <td style={{ padding:"8px 10px", textAlign:"right" }}>
                          <span style={{ display:"inline-block", width:90, padding:"5px 8px", borderRadius:8, background:"#BAE6FD", border:"1.5px solid #7DD3FC", fontSize:"0.78rem", textAlign:"center", color:"#0369A1", fontWeight:700 }}>
                            🔒 {fmt(expected.ifoodOnline)}
                          </span>
                        </td>
                      </tr>
                    )}
                    {(expected.ifoodCoupons || 0) > 0 && (
                      <tr style={{ borderBottom:"1px solid #F1F5F9", background:"#FFF7ED" }}>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:"#EA580C" }}>🔴 iFood (Cupons)</td>
                        <td style={{ padding:"8px 10px", textAlign:"right", color:"#EA580C", fontWeight:700 }}>{fmt(expected.ifoodCoupons)}</td>
                        <td style={{ padding:"8px 10px", textAlign:"right" }}>
                          <span style={{ display:"inline-block", width:90, padding:"5px 8px", borderRadius:8, background:"#FED7AA", border:"1.5px solid #FDBA74", fontSize:"0.78rem", textAlign:"center", color:"#9A3412", fontWeight:700 }}>
                            🔒 {fmt(expected.ifoodCoupons)}
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: Math.abs(totalActual - expected.total) < 0.01 ? "#F0FDF4" : "#FEF2F2" }}>
                      <td style={{ padding:"10px", fontWeight:900, fontSize:"0.95rem" }}>TOTAL</td>
                      <td style={{ padding:"10px", textAlign:"right", fontWeight:700, color:"#374151" }}>{fmt(expected.total)}</td>
                      <td style={{ padding:"10px", textAlign:"right", fontWeight:900, fontSize:"1rem",
                        color: Math.abs(totalActual - expected.total) < 0.01 ? "#16A34A" : "#DC2626" }}>
                        {fmt(totalActual)}
                      </td>
                    </tr>
                    {Math.abs(totalActual - expected.total) >= 0.01 && (
                      <tr>
                        <td colSpan={3} style={{ padding:"6px 10px", textAlign:"center", fontSize:"0.78rem",
                          color: totalActual < expected.total ? "#DC2626" : "#D97706", fontWeight:700 }}>
                          {totalActual < expected.total
                            ? `⚠️ Faltam ${fmt(expected.total - totalActual)} em caixa`
                            : `⚠️ Sobram ${fmt(totalActual - expected.total)} em caixa`}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
                <div style={{ display:"flex", gap:8 }}>
                  <a href="/store/caixa/historico" style={{ flex:1, padding:"11px", background:"#F1F5F9", color:"#374151", border:"none", borderRadius:12, fontWeight:700, fontSize:"0.85rem", cursor:"pointer", textAlign:"center", textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                    <History size={15} /> Histórico
                  </a>
                  <button onClick={tryClose} disabled={closing} style={{ flex:2, padding:"11px", background:"#DC2626", color:"#fff", border:"none", borderRadius:12, fontWeight:900, fontSize:"0.95rem", cursor:"pointer", fontFamily:"inherit" }}>
                    {closing ? "Encerrando..." : "🔒 Encerrar Caixa"}
                  </button>
                </div>
              </>
            ) : (
              /* ── AVISO: TOTAL DIVERGENTE ── */
              <div style={{ textAlign:"center" }}>
                <AlertTriangle size={48} color="#D97706" style={{ margin:"0 auto 12px" }} />
                <h2 style={{ margin:"0 0 8px", fontSize:"1.15rem", fontWeight:900, color:"#92400E" }}>Atenção! Caixa com diferença</h2>
                <p style={{ margin:"0 0 6px", fontSize:"0.9rem", color:"#374151" }}>
                  O sistema esperava <strong>{fmt(expected.total)}</strong> mas você informou <strong>{fmt(totalActual)}</strong>.
                </p>
                <div style={{ background: diff < 0 ? "#FEF2F2" : "#FFFBEB", border:`1px solid ${diff < 0 ? "#FECACA" : "#FDE68A"}`, borderRadius:12, padding:"12px", margin:"12px 0", fontSize:"1.1rem", fontWeight:900, color: diff < 0 ? "#DC2626" : "#D97706" }}>
                  {diff < 0 ? `Faltando ${fmt(Math.abs(diff))}` : `Sobrando ${fmt(diff)}`}
                </div>
                <p style={{ margin:"0 0 1.2rem", fontSize:"0.82rem", color:"#64748B" }}>Deseja encerrar o caixa assim mesmo?</p>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setCloseWarn(false)} style={{ flex:1, padding:"11px", background:"#F1F5F9", color:"#374151", border:"none", borderRadius:12, fontWeight:700, fontSize:"0.9rem", cursor:"pointer", fontFamily:"inherit" }}>
                    ← Corrigir
                  </button>
                  <button onClick={doClose} disabled={closing} style={{ flex:1, padding:"11px", background:"#DC2626", color:"#fff", border:"none", borderRadius:12, fontWeight:900, fontSize:"0.9rem", cursor:"pointer", fontFamily:"inherit" }}>
                    {closing ? "Encerrando..." : "Encerrar assim mesmo"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BARRA DE LOJA FECHADA ──────────────────────────── */}
      {!storeOpen && (
        <div style={{ background:"#EF4444", color:"#fff", textAlign:"center", padding:"6px", fontSize:"0.78rem", fontWeight:700 }}>
          🔴 LOJA FECHADA — Clientes não conseguem fazer pedidos
        </div>
      )}

      {/* ── TOP BAR ────────────────────────────────────────── */}
      <div style={{
        background: isCompras ? "linear-gradient(135deg,#0D47A1,#1565C0)" : "linear-gradient(135deg,#B71C1C,#C62828)",
        padding:"0.45rem 0.85rem", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"0.4rem",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:"0.6rem", flexWrap:"wrap" }}>
          {isCompras ? (
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <img src="/firehub-flame.png" alt="FireHub" style={{ width:30, height:30, borderRadius:7, objectFit:"cover" }} />
              <div style={{ display:"flex", flexDirection:"column", lineHeight:1.1 }}>
                <span style={{ color:"#fff", fontWeight:900, fontSize:"0.95rem" }}>Ice<span style={{ color:"#90CAF9" }}>box</span></span>
                <span style={{ color:"rgba(255,255,255,0.65)", fontWeight:500, fontSize:"0.55rem", letterSpacing:"0.5px", textTransform:"uppercase" }}>Congelados & Insumos</span>
              </div>
            </div>
          ) : (
            <Link href="/store" style={{ display:"flex", alignItems:"center", gap:7, textDecoration:"none" }}>
              <img src="/firehub-flame.png" alt="FireHub" style={{ width:30, height:30, borderRadius:7, objectFit:"cover" }} />
              <div style={{ display:"flex", flexDirection:"column", lineHeight:1.1 }}>
                <span style={{ color:"#fff", fontWeight:900, fontSize:"0.95rem" }}>Fire<span style={{ color:"#FF6B35" }}>Hub</span></span>
                <span style={{ color:"rgba(255,255,255,0.65)", fontWeight:500, fontSize:"0.55rem", letterSpacing:"0.5px", textTransform:"uppercase" }}>Sistema de Pedidos</span>
              </div>
            </Link>
          )}

          {/* ── SELETOR MULTI-LOJAS ── */}
          <StoreSelector />          <div style={{ display:"flex", gap:5, alignItems:"center" }}>
            <TogglePill
              label="Caixa" isOn={cashOpen}
              onClick={() => cashOpen ? setShowCloseModal(true) : setShowOpenModal(true)}
            />
            <SiteToggle />

            {/* iFood stores dropdown */}
            {ifoodStore && (
              <div ref={ifoodRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setShowIfood(v => !v)}
                  style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 11px", borderRadius:20, border:"1.5px solid rgba(255,255,255,0.35)", background: ifoodAvailable ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.25)", color:"#fff", fontWeight:700, fontSize:"0.73rem", cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}
                >
                  Lojas iFood
                  <span style={{ fontSize:"0.6rem", marginLeft:2 }}>▾</span>
                </button>
                {showIfood && (
                  <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, background:"#fff", border:"1px solid #E2E8F0", borderRadius:14, boxShadow:"0 8px 32px rgba(0,0,0,0.18)", minWidth:240, zIndex:500, overflow:"hidden" }}>
                    <div style={{ padding:"0.6rem 1rem", borderBottom:"1px solid #F1F5F9", fontSize:"0.7rem", fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.5px" }}>Lojas iFood</div>
                    <div style={{ padding:"0.75rem 1rem", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin:"0 0 2px", fontWeight:700, fontSize:"0.82rem", color:"#0F172A" }}>{ifoodStore.name || "Loja iFood"}</p>
                        <p style={{ margin:0, fontSize:"0.70rem", color: ifoodAvailable ? "#16A34A" : "#DC2626", fontWeight:600 }}>
                          {ifoodAvailable === null ? "Verificando..." : ifoodAvailable ? "Aberta" : "Fechada"}
                        </p>
                      </div>
                      <button
                        onClick={toggleIfood}
                        disabled={ifoodToggling || ifoodAvailable === null}
                        style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 12px", borderRadius:20, border:`1.5px solid ${ifoodAvailable ? "rgba(22,163,74,0.4)" : "rgba(100,116,139,0.4)"}`, background: ifoodAvailable ? "rgba(22,163,74,0.12)" : "rgba(0,0,0,0.07)", color: ifoodAvailable ? "#16A34A" : "#64748B", fontWeight:700, fontSize:"0.75rem", cursor: ifoodToggling ? "not-allowed" : "pointer", fontFamily:"inherit", opacity: ifoodToggling ? 0.6 : 1, transition:"all 0.2s" }}
                      >
                        <span style={{ display:"inline-block", width:28, height:15, borderRadius:8, background: ifoodAvailable ? "#4ADE80" : "#64748B", position:"relative", flexShrink:0, transition:"background 0.2s" }}>
                          <span style={{ position:"absolute", top:2, left: ifoodAvailable ? 15 : 2, width:11, height:11, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                        </span>
                        {ifoodToggling ? "Aguarde..." : ifoodAvailable ? "Fechar loja" : "Abrir loja"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:"0.35rem", flexWrap:"wrap" }}>
          <a href="/store/impressoras" title="Impressora" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:32, height:32, borderRadius:9, background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.25)", color:"#fff", textDecoration:"none" }}>
            <Printer size={15} />
          </a>
          <a href="/store/extensao-ifood" title="Extensão de mudança de prazo automático" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:32, height:32, borderRadius:9, background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.25)", color:"#fff", textDecoration:"none" }}>
            <Puzzle size={15} />
          </a>
          <a href="/store/integracoes" title="Central de Integrações" style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"0.38rem 0.65rem", borderRadius:8, background:"#E8360C", color:"#fff", fontWeight:700, fontSize:"0.72rem", textDecoration:"none", whiteSpace:"nowrap", border:"1px solid rgba(255,255,255,0.3)" }}>
            🔌 Integrações
          </a>
          {showCompras && (
            <a href="/store/compras" style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"0.38rem 0.8rem", borderRadius:8, background: isCompras ? "rgba(255,255,255,0.2)" : "#FF8A00", color:"#fff", fontWeight:700, fontSize:"0.78rem", textDecoration:"none", whiteSpace:"nowrap" }}>
              <ShoppingBag size={13} /> {isCompras ? "Comprando..." : "Fazer Compras"}
            </a>
          )}
          {storeUrl && (
            <a href={storeUrl} target="_blank" className="nav-view-store" style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"0.38rem 0.65rem", borderRadius:8, background:"rgba(255,255,255,0.15)", color:"#fff", fontWeight:600, fontSize:"0.72rem", textDecoration:"none", border:"1px solid rgba(255,255,255,0.25)", whiteSpace:"nowrap" }}>
              <ExternalLink size={12} /> Ver Loja
            </a>
          )}
          {isAdmin && (
            <a href="/store/admin/lojistas" style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"0.38rem 0.65rem", borderRadius:8, background:"#EF4444", color:"#fff", fontWeight:700, fontSize:"0.72rem", textDecoration:"none", whiteSpace:"nowrap" }}>
              🏪 Lojistas
            </a>
          )}
          <span className="nav-user-label" style={{ color:"rgba(255,255,255,0.85)", fontSize:"0.72rem", padding:"0 0.2rem" }}>{userName} • {userCity}</span>
          <a href="/api/auth/signout" style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"0.38rem 0.6rem", borderRadius:8, background:"rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.85)", fontSize:"0.72rem", textDecoration:"none", border:"1px solid rgba(255,255,255,0.2)" }}>
            <LogOut size={12} /> Sair
          </a>
        </div>
      </div>


      {/* ── NAV (esconde no módulo de compras IceBox) ──── */}
      {!isCompras && (
      <nav style={{ background:"#fff", borderBottom:"2px solid #E2E8F0", padding:"0 0.75rem", position:"sticky", top:0, zIndex:50, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
        <div style={{ maxWidth:"1400px", margin:"0 auto", display:"flex", alignItems:"stretch", gap:0, overflowX:"auto", scrollbarWidth:"none" }}>
          {menuItems.map(item => {
            const Icon = item.icon;
            const active = item.href === "/store" ? pathname === "/store" : pathname?.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} style={{ display:"flex", alignItems:"center", gap:5, padding:"0.65rem 0.8rem", fontSize:"0.8rem", fontWeight: active ? 700 : 500, color: active ? "#C62828" : "#475569", textDecoration:"none", borderBottom: active ? "3px solid #C62828" : "3px solid transparent", whiteSpace:"nowrap", flexShrink:0 }}>
                <Icon size={14} /> {item.label}
                {item.highlight && <span style={{ width:7, height:7, borderRadius:"50%", background:"#C62828", display:"inline-block" }} />}
              </Link>
            );
          })}
        </div>
      </nav>
      )}

      <style>{`
        @media (max-width: 520px) { .nav-user-label { display: none !important; } .nav-view-store { display: none !important; } }
      `}</style>
    </>
  );
}
