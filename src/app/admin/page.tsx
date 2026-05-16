"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function AdminPanel() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newStore, setNewStore] = useState({ name: "", email: "", password: "", phone: "", storeName: "", cnpj: "", city: "" });

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated") {
      if ((session?.user as any)?.role !== "ADMIN") {
        router.push("/store");
      } else {
        fetchUsers();
      }
    }
  }, [status, session]);

  const fetchUsers = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
    }
    setLoading(false);
  };

  const handleCreate = async (e: any) => {
    e.preventDefault();
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newStore)
    });
    if (res.ok) {
      alert("Loja criada com sucesso!");
      setShowModal(false);
      setNewStore({ name: "", email: "", password: "", phone: "", storeName: "", cnpj: "", city: "" });
      fetchUsers();
    } else {
      const error = await res.json();
      alert(error.error || "Erro ao criar loja.");
    }
  };

  if (loading || status === "loading") {
    return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#f3f4f6" }}>Carregando Painel Admin...</div>;
  }

  const today = new Date();

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .admin-header { background: #111827; color: white; padding: 20px 40px; display: flex; justify-content: space-between; alignItems: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .admin-content { padding: 40px; max-width: 1200px; margin: 0 auto; }
        .admin-card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1); margin-bottom: 24px; }
        .admin-btn { background: #DC2626; color: white; padding: 10px 20px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
        .admin-btn:hover { background: #B91C1C; }
        .admin-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .admin-table th, .admin-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #E5E7EB; font-size: 0.9rem; }
        .admin-table th { background: #F3F4F6; color: #374151; font-weight: 600; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
        .admin-table tr:hover { background: #F9FAFB; }
        .status-badge { padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; display: inline-block; }
        .status-active { background: #DEF7EC; color: #03543F; }
        .status-expired { background: #FDE8E8; color: #9B1C1C; }
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; alignItems: center; z-index: 50; }
        .modal-content { background: white; padding: 32px; border-radius: 16px; width: 100%; max-width: 500px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); }
        .modal-input { width: 100%; padding: 10px 12px; border: 1px solid #D1D5DB; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
        .modal-label { display: block; font-size: 0.85rem; font-weight: 600; color: #374151; margin-bottom: 6px; }
      `}</style>

      <div className="admin-header">
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>🔥 FireHub Admin</h1>
          <p style={{ fontSize: "0.85rem", color: "#9CA3AF", margin: "4px 0 0 0" }}>Gestão de Lojas e Acessos</p>
        </div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <span style={{ fontSize: "0.9rem", color: "#D1D5DB" }}>Olá, Admin</span>
          <button className="admin-btn" onClick={() => router.push("/store")} style={{ background: "#374151" }}>Voltar ao App</button>
        </div>
      </div>

      <div className="admin-content">
        <div className="admin-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: "0 0 8px 0", color: "#111827" }}>Lojas Cadastradas ({users.length})</h2>
            <p style={{ margin: 0, color: "#6B7280", fontSize: "0.9rem" }}>Acompanhe o período de teste grátis de 15 dias de todas as contas.</p>
          </div>
          <button className="admin-btn" onClick={() => setShowModal(true)}>+ Cadastrar Loja Manualmente</button>
        </div>

        <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="admin-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Restaurante / Dono</th>
                <th>Contato</th>
                <th>Cadastro</th>
                <th>Teste Grátis (15 dias)</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const createdDate = new Date(user.createdAt);
                const endDate = new Date(createdDate.getTime() + 15 * 24 * 60 * 60 * 1000);
                const diffTime = endDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const isExpired = diffDays <= 0;

                return (
                  <tr key={user.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: "#111827" }}>{user.storeName || user.name}</div>
                      <div style={{ color: "#6B7280", fontSize: "0.8rem" }}>{user.email}</div>
                    </td>
                    <td>
                      <div>{user.storePhone || "-"}</div>
                      <div style={{ color: "#6B7280", fontSize: "0.8rem" }}>{user.city || "-"}</div>
                    </td>
                    <td>{createdDate.toLocaleDateString("pt-BR")}</td>
                    <td>
                      {isExpired ? (
                        <span className="status-badge status-expired">Expirado (Acabou há {Math.abs(diffDays)} dias)</span>
                      ) : (
                        <span className="status-badge status-active">Restam {diffDays} dias</span>
                      )}
                      <div style={{ fontSize: "0.75rem", color: "#9CA3AF", marginTop: "4px" }}>
                        Vence: {endDate.toLocaleDateString("pt-BR")}
                      </div>
                    </td>
                    <td>
                      <button onClick={() => alert("Função em desenvolvimento. Para editar, use o painel interno da loja.")} style={{ padding: "6px 12px", background: "#F3F4F6", border: "1px solid #D1D5DB", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>Gerenciar</button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "40px", color: "#6B7280" }}>Nenhuma loja cadastrada ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem" }}>Novo Cadastro Manual</h3>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#9CA3AF" }}>&times;</button>
            </div>
            
            <form onSubmit={handleCreate}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label className="modal-label">Nome do Dono *</label>
                  <input required className="modal-input" value={newStore.name} onChange={e => setNewStore({...newStore, name: e.target.value})} placeholder="Ex: João Silva" />
                </div>
                <div>
                  <label className="modal-label">Nome da Loja *</label>
                  <input className="modal-input" value={newStore.storeName} onChange={e => setNewStore({...newStore, storeName: e.target.value})} placeholder="Ex: Pizzaria do João" />
                </div>
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label className="modal-label">E-mail *</label>
                  <input required type="email" className="modal-input" value={newStore.email} onChange={e => setNewStore({...newStore, email: e.target.value})} placeholder="joao@email.com" />
                </div>
                <div>
                  <label className="modal-label">Senha *</label>
                  <input required minLength={6} type="password" className="modal-input" value={newStore.password} onChange={e => setNewStore({...newStore, password: e.target.value})} placeholder="Mínimo 6 caracteres" />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label className="modal-label">Telefone / WhatsApp</label>
                  <input className="modal-input" value={newStore.phone} onChange={e => setNewStore({...newStore, phone: e.target.value})} placeholder="(00) 00000-0000" />
                </div>
                <div>
                  <label className="modal-label">CNPJ ou CPF *</label>
                  <input required className="modal-input" value={newStore.cnpj} onChange={e => setNewStore({...newStore, cnpj: e.target.value})} placeholder="Apenas números" />
                </div>
              </div>

              <div>
                <label className="modal-label">Cidade / Estado</label>
                <input className="modal-input" value={newStore.city} onChange={e => setNewStore({...newStore, city: e.target.value})} placeholder="Ex: São Paulo - SP" />
              </div>

              <div style={{ marginTop: "24px", display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid #D1D5DB", background: "white", borderRadius: "8px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
                <button type="submit" className="admin-btn">Criar Conta Agora</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
