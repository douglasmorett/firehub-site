"use client";

import { useState } from "react";
import { createCityRoute, deleteCityRoute } from "@/app/actions/routes";

const DIAS_SEMANA = [
  { id: 0, label: "Domingo" },
  { id: 1, label: "Segunda-feira" },
  { id: 2, label: "Terça-feira" },
  { id: 3, label: "Quarta-feira" },
  { id: 4, label: "Quinta-feira" },
  { id: 5, label: "Sexta-feira" },
  { id: 6, label: "Sábado" }
];

export default function RouteForm() {
  const [loading, setLoading] = useState(false);
  const [cityName, setCityName] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  const toggleDay = (day: number) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter(d => d !== day));
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDays.length === 0) {
      alert("Selecione pelo menos um dia de entrega.");
      return;
    }
    setLoading(true);
    try {
      await createCityRoute({ cityName, deliveryDays: selectedDays });
      setCityName("");
      setSelectedDays([]);
      alert("Rota/Cidade cadastrada com sucesso!");
    } catch (err) {
      alert("Erro ao cadastrar rota");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card mb-8" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 className="font-bold text-lg">Cadastrar Nova Cidade/Rota</h2>
      
      <div>
        <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Nome da Cidade</label>
        <input 
          required 
          type="text" 
          className="input" 
          placeholder="Ex: Búzios"
          value={cityName}
          onChange={e => setCityName(e.target.value)}
        />
      </div>

      <div>
        <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Dias de Entrega na Semana</label>
        <p className="text-muted mb-4" style={{ fontSize: "0.85rem" }}>
          (O limite de pedido será calculado automaticamente como 2 dias ANTES da entrega, às 16:00).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem" }}>
          {DIAS_SEMANA.map(day => (
            <label key={day.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
              <input 
                type="checkbox" 
                checked={selectedDays.includes(day.id)}
                onChange={() => toggleDay(day.id)}
              />
              {day.label}
            </label>
          ))}
        </div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={loading} style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}>
        {loading ? "Salvando..." : "Salvar Rota"}
      </button>
    </form>
  );
}

export function DeleteRouteButton({ cityName }: { cityName: string }) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Tem certeza que deseja excluir TODAS as rotas de ${cityName}?`)) return;
    setLoading(true);
    try {
      await deleteCityRoute(cityName);
    } catch (e) {
      alert("Erro ao excluir rota.");
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
