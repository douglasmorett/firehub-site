"use client";

import React, { useState, useEffect } from "react";
import { Clock, AlertTriangle, Info, Settings, Plus, Trash2, X, Check } from "lucide-react";

interface AntecipacaoClientProps {
  userName: string;
  storeName: string;
}

interface Shift {
  id: string;
  name: string;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
}

const BASE_FLAVOR_LABELS: Record<string, string> = {
  carne: "Carne",
  calabresa: "Calabresa",
  queijo: "Queijo",
  "queijo temperado": "Queijo Temperado",
  "quatro queijos": "Quatro Queijos",
  "massa vazia": "Massa Vazia (Doces)",
};

const BASE_FLAVOR_EMOJIS: Record<string, string> = {
  carne: "🥩",
  calabresa: "🍕",
  queijo: "🧀",
  "queijo temperado": "🍃",
  "quatro queijos": "🧀🧀",
  "massa vazia": "🍫",
};

const BASE_FLAVOR_DESCS: Record<string, string> = {
  carne: "Base de carne moída temperada",
  calabresa: "Base de calabresa moída/fatiada",
  queijo: "Base de queijo muçarela",
  "queijo temperado": "Base de queijo com ervas/temperos",
  "quatro queijos": "Mescla especial de 4 queijos",
  "massa vazia": "Massa aberta (para chocolate, ninho, etc.)",
};

const DAYS_OF_WEEK = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado"
];

const DEFAULT_SHIFTS: Shift[] = [
  { id: "1", name: "Almoço", startTime: "11:00", endTime: "15:00" },
  { id: "2", name: "Jantar", startTime: "18:00", endTime: "22:00" },
  { id: "3", name: "Madrugada", startTime: "22:00", endTime: "02:00" }
];

export default function AntecipacaoClient({ userName, storeName }: AntecipacaoClientProps) {
  // Modo de antecipação: "hours" (Antecipar N Horas) ou "shift" (Turnos predefinidos)
  const [antecipacaoMode, setAntecipacaoMode] = useState<"hours" | "shift">("hours");
  const [startHour, setStartHour] = useState<string>("18:00");
  const [durationHours, setDurationHours] = useState<number>(2);

  // Sub-aba de visualização: "products" (Produtos do Cardápio) ou "bases" (Insumos Base)
  const [viewTab, setViewTab] = useState<"products" | "bases">("products");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Relógio do computador & hora inicial padrão
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setDeviceTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
      setDeviceDayName(DAYS_OF_WEEK[now.getDay()]);
      setDeviceDayOfWeek(now.getDay());
    };
    updateTime();

    // Define hora inicial padrão arredondada para a hora atual
    const currentH = new Date().getHours();
    setStartHour(`${String(currentH).padStart(2, "0")}:00`);

    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  // Carregar turnos do localStorage
  useEffect(() => {
    const stored = localStorage.getItem("firehub_antecipacao_shifts");
    let loadedShifts = DEFAULT_SHIFTS;
    if (stored) {
      try {
        loadedShifts = JSON.parse(stored);
      } catch (e) {
        console.error("Erro ao carregar turnos do localStorage:", e);
      }
    }
    setShifts(loadedShifts);

    const now = new Date();
    const currentHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    
    const active = loadedShifts.find(s => {
      const { startTime, endTime } = s;
      if (startTime <= endTime) {
        return currentHM >= startTime && currentHM <= endTime;
      } else {
        return currentHM >= startTime || currentHM <= endTime;
      }
    });

    setSelectedShift(active || loadedShifts[0] || null);
  }, []);

  // Buscar dados de cálculo do backend
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const clientDateStr = `${year}-${month}-${day}`;

      const d1 = new Date(now);
      d1.setDate(now.getDate() - 7);
      
      const d2 = new Date(now);
      d2.setDate(now.getDate() - 14);

      let startHM = "18:00";
      let endHM = "20:00";

      if (antecipacaoMode === "hours") {
        startHM = startHour || "18:00";
        const [h, m] = startHM.split(":").map(Number);
        const endH = (h + Number(durationHours)) % 24;
        endHM = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      } else if (selectedShift) {
        startHM = selectedShift.startTime;
        endHM = selectedShift.endTime;
      }

      const [startH, startM] = startHM.split(":").map(Number);
      const [endH, endM] = endHM.split(":").map(Number);

      const start1 = new Date(d1);
      start1.setHours(startH, startM, 0, 0);
      const end1 = new Date(d1);
      end1.setHours(endH, endM, 0, 0);
      if (end1 < start1) {
        end1.setDate(end1.getDate() + 1);
      }

      const start2 = new Date(d2);
      start2.setHours(startH, startM, 0, 0);
      const end2 = new Date(d2);
      end2.setHours(endH, endM, 0, 0);
      if (end2 < start2) {
        end2.setDate(end2.getDate() + 1);
      }

      const params = new URLSearchParams({
        start1: start1.toISOString(),
        end1: end1.toISOString(),
        start2: start2.toISOString(),
        end2: end2.toISOString(),
        clientDate: clientDateStr
      });

      const res = await fetch(`/api/store/antecipacao?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Erro ao carregar os dados.");
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [antecipacaoMode, startHour, durationHours, selectedShift, deviceDayOfWeek]);

  // Cadastrar Turno
  const handleAddShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShiftName || !newShiftStart || !newShiftEnd) return;

    const newShift: Shift = {
      id: Date.now().toString(),
      name: newShiftName,
      startTime: newShiftStart,
      endTime: newShiftEnd
    };

    const updated = [...shifts, newShift].sort((a, b) => a.startTime.localeCompare(b.startTime));
    setShifts(updated);
    localStorage.setItem("firehub_antecipacao_shifts", JSON.stringify(updated));

    setNewShiftName("");
    setNewShiftStart("18:00");
    setNewShiftEnd("22:00");
  };

  // Excluir Turno
  const handleDeleteShift = (id: string) => {
    const updated = shifts.filter(s => s.id !== id);
    setShifts(updated);
    localStorage.setItem("firehub_antecipacao_shifts", JSON.stringify(updated));
    
    if (selectedShift?.id === id) {
      setSelectedShift(updated[0] || null);
    }
  };

  // Calcular o horário de fim da antecipação por horas
  const calcEndHourString = () => {
    if (!startHour) return "20:00";
    const [h, m] = startHour.split(":").map(Number);
    const endH = (h + Number(durationHours)) % 24;
    return `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  // Filtrar produtos por termo de busca
  const filteredProducts = (data?.productAverages || []).filter((p: any) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="antecipacao-container">
      {/* HEADER SECTION */}
      <div className="header-card">
        <div className="header-glow"></div>
        <div className="header-content">
          <div className="header-info">
            <span className="badge">🔮 MÓDULO EXCLUSIVO</span>
            <h1>Antecipação de Produção</h1>
            <p>
              Previsão Inteligente de Demandas para <strong>{storeName}</strong> baseado no histórico das últimas duas semanas.
            </p>
          </div>
          <div className="header-device-time">
            <Clock size={16} />
            <span>Dispositivo: <strong>{deviceDayName}</strong>, <strong>{deviceTime}</strong></span>
          </div>
        </div>
      </div>

      {/* EXPLANATORY BANNER REQUESTED BY USER */}
      <div style={{ background: "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)", border: "1.5px solid #93C5FD", borderRadius: "1rem", padding: "1.25rem 1.5rem", marginBottom: "1.5rem", color: "#1E3A8A", boxShadow: "0 4px 12px rgba(37, 99, 235, 0.08)" }}>
        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
          <Info size={24} style={{ color: "#2563EB", flexShrink: 0, marginTop: "2px" }} />
          <div>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "1rem", fontWeight: 850, color: "#1E40AF" }}>💡 Como funciona a Antecipação de Produção:</h3>
            <p style={{ margin: "0 0 8px 0", fontSize: "0.93rem", lineHeight: 1.55, color: "#1E3A8A" }}>
              Este módulo é feito para que você possa <strong>preparar o lanche do seu cliente antes mesmo dele ser pedido</strong>. Fazemos uma média das últimas duas semanas (no mesmo dia da semana e no horário configurado) e te damos, no horário definido, quanto sai de cada produto do seu cardápio, <strong>ordenado do mais vendido para o menos vendido</strong>, seguindo o padrão dos seus clientes.
            </p>
            <span style={{ fontSize: "0.83rem", color: "#3B82F6", fontStyle: "italic", display: "block" }}>
              ⚠️ <em>Lembrando que é uma média explicativa para auxiliar na previsibilidade da sua cozinha: a demanda real pode variar conforme o dia da semana, feriado, clima e comportamento do cliente. É uma ferramenta de apoio.</em>
            </span>
          </div>
        </div>
      </div>

      {/* ANTECIPATION CONFIGURATION & TIME CONTROLS */}
      <div className="control-card">
        <div className="control-header" style={{ marginBottom: "1rem" }}>
          <h2><Clock size={18} /> Configurar Tempo de Antecipação</h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setAntecipacaoMode("hours")}
              style={{ padding: "8px 14px", borderRadius: "8px", border: antecipacaoMode === "hours" ? "2px solid #FF4D00" : "1px solid #CBD5E1", background: antecipacaoMode === "hours" ? "#FFF2EC" : "#FFF", color: antecipacaoMode === "hours" ? "#FF4D00" : "#475569", fontWeight: 800, cursor: "pointer", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              ⏱️ Por Horas (Personalizado)
            </button>
            <button
              onClick={() => setAntecipacaoMode("shift")}
              style={{ padding: "8px 14px", borderRadius: "8px", border: antecipacaoMode === "shift" ? "2px solid #FF4D00" : "1px solid #CBD5E1", background: antecipacaoMode === "shift" ? "#FFF2EC" : "#FFF", color: antecipacaoMode === "shift" ? "#FF4D00" : "#475569", fontWeight: 800, cursor: "pointer", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              📅 Por Turno de Trabalho
            </button>
          </div>
        </div>

        {antecipacaoMode === "hours" ? (
          <div style={{ background: "#F8FAFC", padding: "1.25rem", borderRadius: "0.85rem", border: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "center" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#475569", marginBottom: "6px" }}>Horário de Início</label>
                <input
                  type="time"
                  value={startHour}
                  onChange={e => setStartHour(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 700, background: "#FFF" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#475569", marginBottom: "6px" }}>Quantas Horas Deseja Antecipar?</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {[1, 2, 3, 4].map(h => (
                    <button
                      key={h}
                      onClick={() => setDurationHours(h)}
                      style={{ padding: "8px 16px", borderRadius: "8px", border: durationHours === h ? "2px solid #FF4D00" : "1px solid #CBD5E1", background: durationHours === h ? "#FF4D00" : "#FFF", color: durationHours === h ? "#FFF" : "#0F172A", fontWeight: 800, cursor: "pointer", fontSize: "0.85rem" }}
                    >
                      {h} {h === 1 ? "Hora" : "Horas"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginLeft: "auto", background: "#FFF", padding: "10px 16px", borderRadius: "10px", border: "1.5px solid #FF4D00", textAlign: "right" }}>
                <span style={{ display: "block", fontSize: "0.75rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Janela de Produção Calculada</span>
                <strong style={{ fontSize: "1.1rem", color: "#FF4D00" }}>{startHour} às {calcEndHourString()}</strong>
                <span style={{ display: "block", fontSize: "0.75rem", color: "#475569" }}>({durationHours} {durationHours === 1 ? "hora" : "horas"} de antecipação)</span>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <span style={{ fontSize: "0.85rem", color: "#64748B" }}>Escolha o turno desejado para analisar o volume total de vendas:</span>
              <button className="btn-config-shifts" onClick={() => setShowConfigModal(true)}>
                <Settings size={15} /> Cadastrar / Editar Turnos
              </button>
            </div>

            {shifts.length === 0 ? (
              <div className="no-shifts-alert">
                <Info size={16} />
                <span>Nenhum turno cadastrado. Clique em "Cadastrar Turnos" para configurar.</span>
              </div>
            ) : (
              <div className="shifts-list-grid">
                {shifts.map(shift => {
                  const active = selectedShift?.id === shift.id;
                  return (
                    <button
                      key={shift.id}
                      onClick={() => setSelectedShift(shift)}
                      className={`shift-badge-btn ${active ? "active" : ""}`}
                    >
                      <span className="shift-name">{shift.name}</span>
                      <span className="shift-hours">{shift.startTime} às {shift.endTime}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="control-helper" style={{ marginTop: "1rem" }}>
          <Info size={14} />
          <span>
            Analisando vendas do período <strong>{antecipacaoMode === "hours" ? `${startHour} às ${calcEndHourString()}` : selectedShift ? `${selectedShift.name} (${selectedShift.startTime} às ${selectedShift.endTime})` : ""}</strong> nas últimas duas <strong>{deviceDayName}s</strong>.
          </span>
        </div>
      </div>

      {/* LOADING & ERROR STATES */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Analisando histórico real de pedidos e calculando a estimativa de antecipação...</p>
        </div>
      ) : error ? (
        <div className="error-state">
          <AlertTriangle size={36} />
          <h3>Erro ao carregar dados</h3>
          <p>{error}</p>
          <button onClick={fetchData} className="btn-retry">
            Tentar Novamente
          </button>
        </div>
      ) : (
        <>
          {data?.isHoliday && (
            <div className="holiday-alert-banner">
              <AlertTriangle size={18} />
              <span>
                <strong>Dia de Feriado ({data.holidayName}):</strong> A meta de antecipação foi aumentada automaticamente em <strong>30%</strong> devido ao feriado.
              </span>
            </div>
          )}

          {/* SUB-TABS & SEARCH FILTER */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.25rem" }}>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setViewTab("products")}
                style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: viewTab === "products" ? "#FF4D00" : "#E2E8F0", color: viewTab === "products" ? "#FFF" : "#475569", fontWeight: 800, cursor: "pointer", fontSize: "0.9rem" }}
              >
                🍔 Produtos do Cardápio ({data?.productAverages?.length || 0})
              </button>
              <button
                onClick={() => setViewTab("bases")}
                style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: viewTab === "bases" ? "#FF4D00" : "#E2E8F0", color: viewTab === "bases" ? "#FFF" : "#475569", fontWeight: 800, cursor: "pointer", fontSize: "0.9rem" }}
              >
                🥩 Insumos & Massas ({data?.averages?.length || 0})
              </button>
            </div>

            {viewTab === "products" && (
              <input
                type="text"
                placeholder="🔍 Buscar produto (ex: X-Bacon, Esfirra)..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ padding: "8px 14px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.9rem", minWidth: "260px" }}
              />
            )}
          </div>

          {/* VIEW TAB 1: PRODUCTS RANKING (DESCENTE: MAIS VENDIDO PARA O MENOS VENDIDO) */}
          {viewTab === "products" && (
            <>
              <div className="section-title">
                <h2>Previsão por Produto do Cardápio</h2>
                <span className="subtitle">Produtos ordenados do maior para o menor volume de vendas</span>
              </div>

              {filteredProducts.length === 0 ? (
                <div className="empty-history" style={{ padding: "2rem", background: "#FFF", borderRadius: "1rem", border: "1px solid #E2E8F0", textAlign: "center" }}>
                  <Info size={32} style={{ color: "#94A3B8", marginBottom: "8px" }} />
                  <p style={{ margin: 0, fontWeight: 700, color: "#64748B" }}>Nenhum produto com vendas registradas nesta janela de horário.</p>
                  <span style={{ fontSize: "0.85rem", color: "#94A3B8" }}>Tente aumentar a quantidade de horas ou selecionar outro horário.</span>
                </div>
              ) : (
                <div className="cards-grid">
                  {filteredProducts.map((item: any, index: number) => {
                    const hasDemand = item.suggested > 0;
                    return (
                      <div key={item.name} className={`prediction-card ${hasDemand ? "active-demand" : ""}`}>
                        <div className="card-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ background: index === 0 ? "linear-gradient(135deg, #F59E0B, #D97706)" : index === 1 ? "linear-gradient(135deg, #94A3B8, #64748B)" : index === 2 ? "linear-gradient(135deg, #B45309, #78350F)" : "#334155", color: "#FFF", padding: "2px 8px", borderRadius: "6px", fontWeight: 900, fontSize: "0.75rem" }}>
                              #{index + 1}
                            </span>
                            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, margin: 0, color: "#0F172A", lineHeight: 1.3 }}>{item.name}</h3>
                          </div>
                        </div>

                        <div className="card-body" style={{ marginTop: "12px" }}>
                          <div className="suggested-box">
                            <span className="suggested-number">{item.suggested}</span>
                            <span className="suggested-label">deixar pronto</span>
                          </div>

                          <div className="details-box">
                            <div className="detail-row">
                              <span>7 dias atrás:</span>
                              <strong>{item.qtyDay1} un.</strong>
                            </div>
                            <div className="detail-row">
                              <span>14 dias atrás:</span>
                              <strong>{item.qtyDay2} un.</strong>
                            </div>
                            <div className="detail-row divider">
                              <span>Média real:</span>
                              <span>{item.average.toFixed(1)} un.</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* VIEW TAB 2: INSUMOS BASE */}
          {viewTab === "bases" && (
            <>
              <div className="section-title">
                <h2>Previsão por Insumos & Massas Base</h2>
                <span className="subtitle">Volume acumulado de ingredientes de preparo</span>
              </div>

              <div className="cards-grid">
                {data?.averages?.map((item: any) => {
                  const hasDemand = item.suggested > 0;
                  return (
                    <div key={item.base} className={`prediction-card ${hasDemand ? "active-demand" : ""}`}>
                      <div className="card-header">
                        <span className="card-emoji">{BASE_FLAVOR_EMOJIS[item.base] || "🥟"}</span>
                        <div>
                          <h3>{BASE_FLAVOR_LABELS[item.base] || item.base}</h3>
                          <p className="card-desc">{BASE_FLAVOR_DESCS[item.base] || ""}</p>
                        </div>
                      </div>

                      <div className="card-body">
                        <div className="suggested-box">
                          <span className="suggested-number">{item.suggested}</span>
                          <span className="suggested-label">deixar pronto</span>
                        </div>

                        <div className="details-box">
                          <div className="detail-row">
                            <span>7 dias atrás:</span>
                            <strong>{item.qtyDay1} un.</strong>
                          </div>
                          <div className="detail-row">
                            <span>14 dias atrás:</span>
                            <strong>{item.qtyDay2} un.</strong>
                          </div>
                          <div className="detail-row divider">
                            <span>Média real:</span>
                            <span>{item.average.toFixed(1)} un.</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* DETAILED HISTORICAL SALES */}
          <div className="history-section">
            <div className="history-header">
              <h2>Histórico de Pedidos Utilizados no Cálculo</h2>
              <div className="tabs">
                <button
                  className={`tab-btn ${activeTab === "day1" ? "active" : ""}`}
                  onClick={() => setActiveTab("day1")}
                >
                  Há 7 dias ({data?.labelDay1.split(" ")[0]})
                  <span className="tab-badge">{data?.ordersDay1?.length || 0}</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === "day2" ? "active" : ""}`}
                  onClick={() => setActiveTab("day2")}
                >
                  Há 14 dias ({data?.labelDay2.split(" ")[0]})
                  <span className="tab-badge">{data?.ordersDay2?.length || 0}</span>
                </button>
              </div>
            </div>

            <div className="tab-content">
              {activeTab === "day1" ? (
                data?.ordersDay1?.length === 0 ? (
                  <div className="empty-history">
                    <Info size={28} />
                    <p>Nenhum pedido registrado nesta janela de horário há 7 dias ({data?.labelDay1}).</p>
                  </div>
                ) : (
                  <div className="orders-table-wrapper">
                    <table className="orders-table">
                      <thead>
                        <tr>
                          <th>Horário</th>
                          <th>Cliente</th>
                          <th>Itens Vendidos</th>
                          <th>Total</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ordersDay1.map((order: any) => (
                          <tr key={order.id}>
                            <td className="time-col">
                              {new Date(order.createdAt).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </td>
                            <td className="client-col">{order.customerName}</td>
                            <td className="items-col">
                              {order.items.map((it: any, idx: number) => (
                                <span key={idx} className="item-pill">
                                  {it.quantity}x {it.name}
                                </span>
                              ))}
                            </td>
                            <td className="price-col">R$ {order.totalAmount.toFixed(2).replace(".", ",")}</td>
                            <td>
                              <span className={`status-pill status-${order.status.toLowerCase()}`}>
                                {order.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : data?.ordersDay2?.length === 0 ? (
                <div className="empty-history">
                  <Info size={28} />
                  <p>Nenhum pedido registrado nesta janela de horário há 14 dias ({data?.labelDay2}).</p>
                </div>
              ) : (
                <div className="orders-table-wrapper">
                  <table className="orders-table">
                    <thead>
                      <tr>
                        <th>Horário</th>
                        <th>Cliente</th>
                        <th>Itens Vendidos</th>
                        <th>Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ordersDay2.map((order: any) => (
                        <tr key={order.id}>
                          <td className="time-col">
                            {new Date(order.createdAt).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </td>
                          <td className="client-col">{order.customerName}</td>
                          <td className="items-col">
                            {order.items.map((it: any, idx: number) => (
                              <span key={idx} className="item-pill">
                                {it.quantity}x {it.name}
                              </span>
                            ))}
                          </td>
                          <td className="price-col">R$ {order.totalAmount.toFixed(2).replace(".", ",")}</td>
                          <td>
                            <span className={`status-pill status-${order.status.toLowerCase()}`}>
                              {order.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* MODAL: CADASTRO DE TURNOS */}
      {showConfigModal && (
        <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div className="modal-card modal-large" onClick={e => e.stopPropagation()}>
            <button className="btn-close" onClick={() => setShowConfigModal(false)}><X size={20} /></button>
            <h2>Gerenciamento de Turnos</h2>
            <p className="modal-subtitle">Configure seus turnos de produção. Eles ficam salvos no seu navegador.</p>

            <div className="modal-shifts-layout">
              {/* Formulário Novo Turno */}
              <form onSubmit={handleAddShift} className="new-shift-form">
                <h3>Adicionar Novo Turno</h3>
                <div className="form-group">
                  <label>Nome do Turno</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Almoço, Jantar de Sexta"
                    value={newShiftName}
                    onChange={e => setNewShiftName(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Início (Hora)</label>
                    <input
                      type="time"
                      required
                      value={newShiftStart}
                      onChange={e => setNewShiftStart(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Fim (Hora)</label>
                    <input
                      type="time"
                      required
                      value={newShiftEnd}
                      onChange={e => setNewShiftEnd(e.target.value)}
                    />
                  </div>
                </div>
                <button type="submit" className="btn-submit-shift">
                  <Plus size={15} /> Adicionar Turno
                </button>
              </form>

              {/* Lista de Turnos */}
              <div className="modal-shifts-list-side">
                <h3>Turnos Configurados</h3>
                {shifts.length === 0 ? (
                  <p className="no-shifts-inside">Nenhum turno cadastrado ainda.</p>
                ) : (
                  <div className="modal-shifts-scroll">
                    {shifts.map(shift => (
                      <div key={shift.id} className="modal-shift-row">
                        <div className="modal-shift-info">
                          <strong>{shift.name}</strong>
                          <span>{shift.startTime} às {shift.endTime}</span>
                        </div>
                        <button
                          type="button"
                          className="btn-delete-shift"
                          onClick={() => handleDeleteShift(shift.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowConfigModal(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMPONENT STYLING */}
      <style jsx global>{`
        .antecipacao-container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 1.5rem;
          font-family: Inter, system-ui, sans-serif;
          color: #1e293b;
          animation: fadeIn 0.4s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* HEADER */
        .header-card {
          position: relative;
          background: linear-gradient(135deg, #1e293b, #0f172a);
          border-radius: 1.25rem;
          padding: 2.25rem;
          color: white;
          overflow: hidden;
          margin-bottom: 1.5rem;
          box-shadow: 0 10px 30px -10px rgba(15, 23, 42, 0.3);
        }

        .header-glow {
          position: absolute;
          top: -20%;
          right: -10%;
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(198, 40, 40, 0.45) 0%, rgba(0,0,0,0) 70%);
          pointer-events: none;
        }

        .header-content {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1.5rem;
        }

        .header-info h1 {
          font-size: 2rem;
          font-weight: 850;
          margin: 0.5rem 0;
          letter-spacing: -0.025em;
        }

        .header-info p {
          color: #94a3b8;
          font-size: 0.95rem;
          margin: 0;
        }

        .header-device-time {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 0.5rem 1rem;
          border-radius: 0.75rem;
          font-size: 0.85rem;
        }

        .badge {
          display: inline-block;
          background: rgba(198, 40, 40, 0.2);
          border: 1px solid rgba(198, 40, 40, 0.4);
          color: #f87171;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.25rem 0.65rem;
          border-radius: 9999px;
          letter-spacing: 0.05em;
        }

        /* CONTROL CARD */
        .control-card {
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          margin-bottom: 1.75rem;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        }

        .control-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.25rem;
        }

        .control-header h2 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.1rem;
          font-weight: 800;
          margin: 0;
          color: #0f172a;
        }

        .btn-config-shifts {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #475569;
          font-weight: 700;
          font-size: 0.78rem;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-config-shifts:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .no-shifts-alert {
          background: #fef3c7;
          border: 1px solid #fde68a;
          color: #b45309;
          border-radius: 0.75rem;
          padding: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .holiday-alert-banner {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: #fff5f5;
          border: 1px solid rgba(198, 40, 40, 0.2);
          color: #c62828;
          border-radius: 0.85rem;
          padding: 1rem 1.25rem;
          margin-bottom: 1.5rem;
          font-size: 0.88rem;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(198, 40, 40, 0.05);
          animation: slideDown 0.3s ease-out;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .shifts-list-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .shift-badge-btn {
          flex: 1;
          min-width: 160px;
          max-width: 250px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0.85rem 1rem;
          border-radius: 0.75rem;
          border: 2px solid #e2e8f0;
          background: #f8fafc;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .shift-badge-btn:hover {
          border-color: #cbd5e1;
          background: #f1f5f9;
        }

        .shift-badge-btn.active {
          border-color: #c62828;
          background: #fff5f5;
          box-shadow: 0 4px 12px rgba(198, 40, 40, 0.12);
        }

        .shift-badge-btn.active .shift-name {
          color: #c62828;
        }

        .shift-name {
          font-size: 0.95rem;
          font-weight: 850;
          color: #334155;
        }

        .shift-hours {
          font-size: 0.72rem;
          font-weight: 650;
          color: #64748b;
          margin-top: 0.15rem;
        }

        .control-helper {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.8rem;
          color: #475569;
          background: #f1f5f9;
          padding: 0.65rem 1rem;
          border-radius: 0.5rem;
          margin-top: 0.75rem;
        }

        /* SECTIONS */
        .section-title {
          margin: 2rem 0 1rem;
        }

        .section-title h2 {
          font-size: 1.35rem;
          font-weight: 900;
          color: #0f172a;
          margin: 0;
        }

        .subtitle {
          font-size: 0.82rem;
          color: #64748b;
          font-weight: 500;
        }

        /* CARDS GRID */
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.25rem;
          margin-bottom: 2.5rem;
        }

        .prediction-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 1.25rem;
          padding: 1.5rem;
          transition: all 0.3s ease;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          overflow: hidden;
        }

        .prediction-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.08);
          border-color: #cbd5e1;
        }

        .prediction-card.active-demand {
          border-color: rgba(198, 40, 40, 0.2);
          background: linear-gradient(to bottom, #fff5f5, #ffffff 60%);
        }

        .prediction-card.active-demand::before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(to right, #c62828, #ef4444);
        }

        .card-header {
          display: flex;
          gap: 0.85rem;
          align-items: flex-start;
          margin-bottom: 1.25rem;
        }

        .card-emoji {
          font-size: 2rem;
          line-height: 1;
        }

        .card-header h3 {
          font-size: 1.05rem;
          font-weight: 800;
          margin: 0;
          color: #0f172a;
        }

        .card-desc {
          font-size: 0.72rem;
          color: #64748b;
          margin: 0.15rem 0 0 0;
        }

        .card-body {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .suggested-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #f8fafc;
          border-radius: 0.85rem;
          padding: 0.75rem;
          width: 85px;
          height: 85px;
          flex-shrink: 0;
          border: 1px solid #e2e8f0;
          transition: all 0.2s ease;
        }

        .active-demand .suggested-box {
          background: linear-gradient(135deg, #c62828, #e53935);
          color: white;
          border: none;
          box-shadow: 0 4px 10px rgba(198, 40, 40, 0.25);
        }

        .suggested-number {
          font-size: 2.2rem;
          font-weight: 900;
          line-height: 1;
        }

        .suggested-label {
          font-size: 0.58rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: center;
          margin-top: 0.15rem;
          opacity: 0.95;
        }

        .details-box {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.78rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          color: #475569;
        }

        .detail-row strong {
          color: #0f172a;
        }

        .detail-row.divider {
          border-top: 1px dashed #e2e8f0;
          padding-top: 0.35rem;
          margin-top: 0.15rem;
          font-weight: 700;
          color: #0f172a;
        }

        /* LOADING & ERROR STATES */
        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 5rem 2rem;
          background: white;
          border-radius: 1rem;
          border: 1px solid #e2e8f0;
          text-align: center;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3.5px solid #f1f5f9;
          border-top-color: #c62828;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-bottom: 1.25rem;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .loading-state p {
          font-size: 0.95rem;
          color: #64748b;
          font-weight: 600;
        }

        .error-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4rem 2rem;
          background: #fff5f5;
          border: 1px dashed #fca5a5;
          border-radius: 1rem;
          text-align: center;
          color: #c53030;
        }

        .error-state h3 {
          margin: 0.75rem 0 0.25rem 0;
          font-weight: 800;
        }

        .error-state p {
          font-size: 0.88rem;
          margin-bottom: 1.25rem;
          color: #742a2a;
        }

        .btn-retry {
          background: #c53030;
          color: white;
          border: none;
          padding: 0.6rem 1.25rem;
          border-radius: 0.5rem;
          font-weight: 700;
          cursor: pointer;
        }

        /* HISTORY SECTION */
        .history-section {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 1.25rem;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
        }

        .history-header {
          padding: 1.5rem;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .history-header h2 {
          font-size: 1.15rem;
          font-weight: 850;
          color: #0f172a;
          margin: 0;
        }

        .tabs {
          display: flex;
          background: #f1f5f9;
          padding: 0.25rem;
          border-radius: 0.75rem;
          gap: 0.15rem;
        }

        .tab-btn {
          border: none;
          background: none;
          padding: 0.5rem 1rem;
          border-radius: 0.6rem;
          font-size: 0.82rem;
          font-weight: 700;
          color: #475569;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .tab-btn.active {
          background: white;
          color: #c62828;
          box-shadow: 0 2px 4px rgba(0,0,0,0.06);
        }

        .tab-badge {
          background: #e2e8f0;
          color: #475569;
          font-size: 0.7rem;
          font-weight: 800;
          padding: 0.1rem 0.4rem;
          border-radius: 9999px;
        }

        .tab-btn.active .tab-badge {
          background: rgba(198, 40, 40, 0.1);
          color: #c62828;
        }

        .tab-content {
          padding: 1rem;
        }

        .empty-history {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4rem 2rem;
          color: #64748b;
          text-align: center;
          gap: 0.5rem;
        }

        .empty-history p {
          font-size: 0.88rem;
          margin: 0;
          font-weight: 550;
        }

        .orders-table-wrapper {
          overflow-x: auto;
        }

        .orders-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.85rem;
        }

        .orders-table th {
          background: #f8fafc;
          padding: 0.85rem 1rem;
          font-weight: 700;
          color: #475569;
          border-bottom: 2px solid #e2e8f0;
        }

        .orders-table td {
          padding: 1rem;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .orders-table tr:last-child td {
          border-bottom: none;
        }

        .time-col {
          font-weight: 800;
          color: #c62828;
        }

        .client-col {
          font-weight: 700;
          color: #0f172a;
        }

        .items-col {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }

        .item-pill {
          background: #f1f5f9;
          color: #334155;
          padding: 0.25rem 0.55rem;
          border-radius: 0.38rem;
          font-weight: 600;
          font-size: 0.78rem;
          border: 1px solid #e2e8f0;
        }

        .price-col {
          font-weight: 700;
          color: #0f172a;
        }

        .status-pill {
          display: inline-block;
          font-size: 0.7rem;
          font-weight: 800;
          padding: 0.2rem 0.5rem;
          border-radius: 9999px;
          letter-spacing: 0.025em;
          text-transform: uppercase;
        }

        .status-encerrado, .status-entregue, .status-concluido {
          background: #dcfce7;
          color: #15803d;
        }

        .status-novo {
          background: #eff6ff;
          color: #1d4ed8;
        }

        /* MODALS */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }

        .modal-card {
          background: white;
          border-radius: 1.25rem;
          width: 100%;
          max-width: 480px;
          padding: 1.75rem;
          position: relative;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          animation: slideUp 0.3s ease-out;
        }

        .modal-card.modal-large {
          max-width: 720px;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .btn-close {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          cursor: pointer;
          color: #64748b;
          padding: 0.25rem;
          border-radius: 0.25rem;
        }

        .btn-close:hover {
          background: #f1f5f9;
        }

        .modal-card h2 {
          font-size: 1.25rem;
          font-weight: 900;
          color: #0f172a;
          margin: 0 0 0.5rem 0;
        }

        .modal-subtitle {
          font-size: 0.85rem;
          color: #64748b;
          margin-bottom: 1.5rem;
        }

        .modal-shifts-layout {
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          gap: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .new-shift-form {
          border-right: 1px solid #e2e8f0;
          padding-right: 1.5rem;
        }

        .new-shift-form h3,
        .modal-shifts-list-side h3 {
          font-size: 0.95rem;
          font-weight: 800;
          color: #334155;
          margin: 0 0 1rem 0;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          margin-bottom: 1rem;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .form-group label {
          font-size: 0.75rem;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
        }

        .form-group input {
          padding: 0.65rem 0.8rem;
          border-radius: 0.5rem;
          border: 1.5px solid #cbd5e1;
          font-size: 0.88rem;
          font-weight: 600;
          outline: none;
          background: #f8fafc;
        }

        .form-group input:focus {
          border-color: #c62828;
          background: white;
        }

        .btn-submit-shift {
          width: 100%;
          padding: 0.75rem;
          background: linear-gradient(135deg, #c62828, #b71c1c);
          color: white;
          font-weight: 800;
          font-size: 0.88rem;
          border: none;
          border-radius: 0.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          box-shadow: 0 4px 10px rgba(198, 40, 40, 0.2);
          transition: all 0.2s;
        }

        .btn-submit-shift:hover {
          filter: brightness(1.08);
        }

        .modal-shifts-list-side {
          display: flex;
          flex-direction: column;
        }

        .no-shifts-inside {
          font-size: 0.85rem;
          color: #94a3b8;
          font-style: italic;
        }

        .modal-shifts-scroll {
          max-height: 250px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding-right: 0.5rem;
        }

        .modal-shift-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 0.65rem 0.85rem;
          border-radius: 0.65rem;
        }

        .modal-shift-info {
          display: flex;
          flex-direction: column;
        }

        .modal-shift-info strong {
          font-size: 0.88rem;
          color: #1e293b;
        }

        .modal-shift-info span {
          font-size: 0.72rem;
          color: #64748b;
          font-weight: 600;
        }

        .btn-delete-shift {
          background: none;
          border: none;
          color: #ef4444;
          cursor: pointer;
          padding: 0.35rem;
          border-radius: 0.35rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-delete-shift:hover {
          background: #fee2e2;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          border-top: 1px solid #e2e8f0;
          padding-top: 1rem;
        }

        .btn-secondary {
          background: #f1f5f9;
          color: #475569;
          border: none;
          padding: 0.6rem 1.25rem;
          border-radius: 0.5rem;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
        }

        .btn-secondary:hover {
          background: #e2e8f0;
        }

        @media (max-width: 768px) {
          .header-content {
            flex-direction: column;
            align-items: flex-start;
          }
          .header-device-time {
            width: 100%;
            justify-content: center;
          }
          .modal-shifts-layout {
            grid-template-columns: 1fr;
          }
          .new-shift-form {
            border-right: none;
            border-bottom: 1px solid #e2e8f0;
            padding-right: 0;
            padding-bottom: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
}
