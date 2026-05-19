"use client";
import { useState } from "react";
import {
  Store, Clock, Truck, CreditCard, Tag, Gift, ArrowLeft,
  Settings, Image, Phone, MapPin, ChevronRight,
  User, Lock, Save, CheckCircle, ShieldCheck, Eye, EyeOff
} from "lucide-react";
import StoreSettingsForm from "@/components/customer/StoreSettingsForm";
import LoyaltyConfigForm from "@/components/LoyaltyConfigForm";
import { updatePassword } from "@/app/actions/updatePassword";

type Section = "menu" | "info" | "hours" | "delivery" | "payment" | "coupons" | "loyalty" | "conta";

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
  {
    id: "conta" as Section,
    icon: <User size={28} />,
    color: "#0277BD",
    bg: "#E1F5FE",
    title: "Minha Conta",
    desc: "Nome da loja, CNPJ e alteração de senha de acesso",
  },
];

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

  // ── Seção de Fidelidade ──────────────────────────────────────────────────────
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

  // ── Seção Minha Conta ────────────────────────────────────────────────────────
  if (section === "conta") {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "1.5rem 1rem" }}>
        <BackBtn onClick={() => setSection("menu")} title="👤 Minha Conta" />
        <ContaSection user={user} />
      </div>
    );
  }

  // ── Demais seções — usa StoreSettingsForm com aba pré-selecionada ─────────────
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

// ── Seção Conta: dados + senha ───────────────────────────────────────────────
function ContaSection({ user }: { user: any }) {
  const [storeName, setStoreName] = useState(user.storeName || "");
  const [cpfCnpj, setCpfCnpj] = useState(user.cpfCnpj || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passLoading, setPassLoading] = useState(false);
  const [passError, setPassError] = useState("");
  const [passSuccess, setPassSuccess] = useState(false);

  const handleProfileSave = async () => {
    setProfileLoading(true);
    setProfileSuccess(false);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, cpfCnpj }),
      });
      if (res.ok) setProfileSuccess(true);
      else alert("Erro ao salvar.");
    } catch { alert("Erro ao salvar."); } finally { setProfileLoading(false); }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError("");
    setPassSuccess(false);
    if (password !== confirmPassword) { setPassError("As senhas não coincidem."); return; }
    if (password.length < 6) { setPassError("A senha deve ter pelo menos 6 caracteres."); return; }
    setPassLoading(true);
    try {
      await updatePassword(password);
      setPassSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPassError(err.message || "Erro ao atualizar senha.");
    } finally { setPassLoading(false); }
  };

  const inp: React.CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 10,
    border: "1.5px solid #E2E8F0", fontSize: "0.95rem",
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };
  const roInp: React.CSSProperties = { ...inp, background: "#F8FAFC", color: "#94A3B8", cursor: "not-allowed" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* ── Dados Internos (somente leitura) ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={18} color="#94A3B8" />
          <span style={{ fontWeight: 800, color: "#475569", fontSize: "0.92rem" }}>Dados da Conta</span>
          <span style={{ marginLeft: "auto", fontSize: "0.68rem", background: "#F1F5F9", color: "#94A3B8", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>Somente Admin altera</span>
        </div>
        <div style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#94A3B8" }}>Esses dados são gerenciados pela administração do FireHub.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: 5 }}>Nome do Responsável</label>
              <div style={roInp}>{user.name || "—"}</div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: 5 }}>Cidade</label>
              <div style={roInp}>{user.city || "Não definida"}</div>
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: 5 }}>E-mail de Acesso</label>
            <div style={roInp}>{user.email || "—"}</div>
          </div>
        </div>
      </div>

      {/* ── Dados Editáveis ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8 }}>
          <Store size={18} color="#C62828" />
          <span style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.92rem" }}>Dados da Minha Loja</span>
          {profileSuccess && (
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem", color: "#16A34A", fontWeight: 700 }}>
              <CheckCircle size={14} /> Salvo!
            </span>
          )}
        </div>
        <div style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>Nome da Loja</label>
            <input type="text" value={storeName} onChange={e => setStoreName(e.target.value)} style={inp} placeholder="Ex: Pizzaria do João" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>CNPJ / CPF</label>
            <input type="text" value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)} style={inp} placeholder="00.000.000/0000-00" />
          </div>
          <button
            onClick={handleProfileSave}
            disabled={profileLoading}
            style={{
              width: "100%", padding: "11px", borderRadius: 10,
              background: "linear-gradient(135deg,#C62828,#B71C1C)",
              color: "#fff", border: "none", fontWeight: 800,
              fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              opacity: profileLoading ? 0.7 : 1,
            }}
          >
            <Save size={15} /> {profileLoading ? "Salvando..." : "Salvar Dados da Loja"}
          </button>
        </div>
      </div>

      {/* ── Alterar Senha ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={18} color="#6A1B9A" />
          <span style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.92rem" }}>Alterar Senha</span>
        </div>
        <div style={{ padding: "1.25rem" }}>
          {passSuccess && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#16A34A", padding: "10px 14px", borderRadius: 10, marginBottom: "1rem", fontWeight: 700, fontSize: "0.88rem" }}>
              <CheckCircle size={16} /> Senha atualizada com sucesso!
            </div>
          )}
          {passError && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 10, marginBottom: "1rem", fontWeight: 700, fontSize: "0.88rem" }}>
              ⚠️ {passError}
            </div>
          )}
          <form onSubmit={handlePasswordSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>Nova Senha</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  required
                  style={{ ...inp, paddingRight: 42 }}
                />
                <button type="button" onClick={() => setShowPass(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: 0 }}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: 5 }}>Confirmar Nova Senha</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repita a senha"
                  required
                  style={{ ...inp, paddingRight: 42, borderColor: confirmPassword && confirmPassword !== password ? "#EF4444" : undefined }}
                />
                <button type="button" onClick={() => setShowConfirm(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: 0 }}>
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "#EF4444", fontWeight: 600 }}>As senhas não coincidem</p>
              )}
            </div>
            <button
              type="submit"
              disabled={passLoading}
              style={{
                width: "100%", padding: "11px", borderRadius: 10,
                background: "linear-gradient(135deg,#6A1B9A,#4A148C)",
                color: "#fff", border: "none", fontWeight: 800,
                fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                opacity: passLoading ? 0.7 : 1,
              }}
            >
              <Lock size={15} /> {passLoading ? "Salvando..." : "Atualizar Senha"}
            </button>
          </form>
        </div>
      </div>
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
