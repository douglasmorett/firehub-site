"use client";

import { useState } from "react";
import { createFranchisee, deleteFranchisee, updateFranchiseeCity } from "@/app/actions/franchisee";
import { signIn } from "next-auth/react";

export default function FranchiseeForm({ availableCities }: { availableCities: string[] }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    city: availableCities.length > 0 ? availableCities[0] : "",
    password: "",
    cpfCnpj: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createFranchisee(formData);
      setFormData({ name: "", email: "", city: availableCities.length > 0 ? availableCities[0] : "", password: "", cpfCnpj: "" });
      alert("Lojista cadastrado com sucesso!");
    } catch (err) {
      alert("Erro ao cadastrar lojista");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card mb-8" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 className="font-bold text-lg">Cadastrar Novo Lojista</h2>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Nome da Franquia</label>
          <input 
            required 
            type="text" 
            className="input" 
            placeholder="Ex: Pizzaria do João"
            value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>E-mail (Login)</label>
          <input 
            required 
            type="email" 
            className="input" 
            placeholder="contato@email.com"
            value={formData.email}
            onChange={e => setFormData({...formData, email: e.target.value})}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>CPF ou CNPJ (Obrigatório Asaas)</label>
          <input 
            required 
            type="text" 
            className="input" 
            placeholder="Apenas números"
            value={formData.cpfCnpj}
            onChange={e => setFormData({...formData, cpfCnpj: e.target.value.replace(/\D/g, '')})}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Senha de Acesso</label>
          <input 
            required 
            type="text" 
            className="input" 
            placeholder="Senha segura"
            value={formData.password}
            onChange={e => setFormData({...formData, password: e.target.value})}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Cidade / Rota</label>
          <select 
            className="input" 
            value={formData.city}
            onChange={e => setFormData({...formData, city: e.target.value})}
          >
            {availableCities.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={loading} style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}>
        {loading ? "Cadastrando..." : "Cadastrar Lojista"}
      </button>
    </form>
  );
}

export function DeleteFranchiseeButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Tem certeza que deseja excluir este lojista? O acesso dele será revogado.")) return;
    setLoading(true);
    try {
      await deleteFranchisee(id);
    } catch (e) {
      alert("Erro ao excluir lojista. Ele pode ter pedidos atrelados.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleDelete} className="btn" disabled={loading} style={{ color: "var(--danger)", padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}>
      Excluir
    </button>
  );
}

export function EditFranchiseeCity({ id, currentCity, availableCities }: { id: string, currentCity: string, availableCities: string[] }) {
  const [loading, setLoading] = useState(false);
  const [city, setCity] = useState(currentCity);

  const handleUpdate = async () => {
    if (city === currentCity) return;
    setLoading(true);
    try {
      await updateFranchiseeCity(id, city);
      alert("Rota/Cidade atualizada com sucesso!");
    } catch (e) {
      alert("Erro ao atualizar rota.");
      setCity(currentCity);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <select 
        className="input" 
        value={city} 
        onChange={e => setCity(e.target.value)}
        style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem", height: "auto" }}
      >
        {availableCities.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {city !== currentCity && (
        <button onClick={handleUpdate} className="btn btn-primary" disabled={loading} style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}>
          Salvar
        </button>
      )}
    </div>
  );
}

export function ImpersonateButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  const handleImpersonate = async () => {
    if (!confirm("Isso fará você entrar na conta deste lojista e ver o portal como ele. Você precisará relogar como Admin depois. Continuar?")) return;
    setLoading(true);
    await signIn("credentials", {
      impersonateId: id,
      callbackUrl: "/store"
    });
  };

  return (
    <button onClick={handleImpersonate} className="btn" disabled={loading} style={{ color: "var(--primary)", padding: "0.25rem 0.5rem", fontSize: "0.85rem", fontWeight: "bold", border: "1px solid var(--primary)" }}>
      {loading ? "Acessando..." : "Acessar Conta"}
    </button>
  );
}
