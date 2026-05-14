"use client";

import { useState } from "react";
import { updatePassword } from "@/app/actions/updatePassword";
import { User, Lock, Save, ArrowLeft, CheckCircle, Edit3, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function ProfileClient({ user }: { user: any }) {
  // Editáveis pelo dono da loja
  const [storeName, setStoreName] = useState(user.storeName || "");
  const [cpfCnpj, setCpfCnpj] = useState(user.cpfCnpj || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleProfileSave = async () => {
    setProfileLoading(true);
    setProfileSuccess(false);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, cpfCnpj })
      });
      if (res.ok) setProfileSuccess(true);
      else alert("Erro ao salvar.");
    } catch { alert("Erro ao salvar."); } finally { setProfileLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Erro ao atualizar senha.");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: "100%", padding: "0.6rem 0.75rem", borderRadius: "8px", border: "1.5px solid #E2E8F0", fontSize: "1rem", fontWeight: 500 as const, outline: "none" };
  const readOnlyStyle = { ...inputStyle, background: "#F8FAFC", color: "#94A3B8", cursor: "not-allowed" as const };

  return (
    <div className="container" style={{ maxWidth: "600px", marginTop: "2rem" }}>
      <div className="flex items-center gap-4 mb-8">
        <Link href="/store" className="btn btn-outline" style={{ padding: "0.5rem", borderRadius: "50%" }}>
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-bold" style={{ fontSize: "2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <User size={32} /> Meu Perfil
        </h1>
      </div>

      {/* DADOS INTERNOS - SOMENTE LEITURA */}
      <div className="card mb-6">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", paddingBottom: "0.5rem", borderBottom: "1px solid var(--border-color)" }}>
          <ShieldCheck size={18} color="#94A3B8" />
          <h2 className="font-bold" style={{ color: "#64748B" }}>Dados Internos</h2>
          <span style={{ marginLeft: "auto", fontSize: "0.7rem", background: "#F1F5F9", color: "#94A3B8", padding: "2px 8px", borderRadius: "6px", fontWeight: 600 }}>Somente Admin</span>
        </div>
        <p style={{ fontSize: "0.75rem", color: "#94A3B8", marginBottom: "0.75rem" }}>Esses dados são gerenciados pela administração. Para alterar, entre em contato.</p>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            <label className="text-muted font-bold" style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>Nome (Responsável)</label>
            <p style={readOnlyStyle}>{user.name}</p>
          </div>
          <div>
            <label className="text-muted font-bold" style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>E-mail (Login)</label>
            <p style={readOnlyStyle}>{user.email}</p>
          </div>
          <div>
            <label className="text-muted font-bold" style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>Cidade / Rota de Entrega</label>
            <p style={readOnlyStyle}>{user.city || "Não definida"}</p>
          </div>
        </div>
      </div>

      {/* DADOS DA LOJA - EDITÁVEL */}
      <div className="card mb-6">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", paddingBottom: "0.5rem", borderBottom: "1px solid var(--border-color)" }}>
          <h2 className="font-bold" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><Edit3 size={18} /> Dados da Minha Loja</h2>
          {profileSuccess && <span style={{ fontSize: "0.8rem", color: "#10B981", fontWeight: 600 }}>✅ Salvo!</span>}
        </div>
        <div style={{ display: "grid", gap: "1rem" }}>
          <div>
            <label className="text-muted font-bold" style={{ fontSize: "0.85rem", display: "block", marginBottom: "4px" }}>Nome da Loja</label>
            <input type="text" value={storeName} onChange={e => setStoreName(e.target.value)} style={inputStyle} placeholder="Ex: Pizzaria do João" />
          </div>
          <div>
            <label className="text-muted font-bold" style={{ fontSize: "0.85rem", display: "block", marginBottom: "4px" }}>CNPJ / CPF</label>
            <input type="text" value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)} style={inputStyle} placeholder="00.000.000/0000-00" />
          </div>
        </div>
        <button onClick={handleProfileSave} disabled={profileLoading} className="btn btn-primary" style={{ width: "100%", marginTop: "1rem", display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", padding: "0.7rem" }}>
          <Save size={16} /> {profileLoading ? "Salvando..." : "Salvar Dados da Loja"}
        </button>
      </div>

      {/* ALTERAR SENHA */}
      <div className="card">
        <h2 className="font-bold mb-4 border-b pb-2" style={{ borderColor: "var(--border-color)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Lock size={20} /> Alterar Senha
        </h2>

        {success && (
          <div style={{ backgroundColor: "rgba(16,185,129,0.1)", color: "#10b981", padding: "1rem", borderRadius: "8px", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontWeight: "bold" }}>
            <CheckCircle size={20} /> Senha atualizada com sucesso!
          </div>
        )}

        {error && (
          <div style={{ backgroundColor: "var(--danger)", color: "white", padding: "1rem", borderRadius: "8px", marginBottom: "1rem", fontWeight: "bold" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold" }}>Nova Senha</label>
            <input type="password" className="input-field w-full" placeholder="Digite a nova senha" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold" }}>Confirmar Nova Senha</label>
            <input type="password" className="input-field w-full" placeholder="Confirme a nova senha" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary mt-2" disabled={loading} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", padding: "0.8rem" }}>
            <Save size={18} /> {loading ? "Salvando..." : "Salvar Nova Senha"}
          </button>
        </form>
      </div>
    </div>
  );
}
