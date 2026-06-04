"use client";

import React, { useState, useEffect, useTransition } from "react";
import { Clock, Play, RotateCcw, Sparkles, AlertTriangle, Calendar, Info, CheckCircle2 } from "lucide-react";

interface AntecipacaoClientProps {
  userName: string;
  storeName: string;
}

const BASE_FLAVOR_LABELS: Record<string, string> = {
  carne: "Carne",
  calabresa: "Calabresa",
  queijo: "Queijo",
  "queijo temperado": "Queijo Temperado",
  "quatro queijos": "Quatro Queijos",
  "massa vazia": "Massa Vazia (Doces)",
  outros: "Outros"
};

const BASE_FLAVOR_EMOJIS: Record<string, string> = {
  carne: "🥩",
  calabresa: "🍕",
  queijo: "🧀",
  "queijo temperado": "🍃",
  "quatro queijos": "🧀🧀",
  "massa vazia": "🍫",
  outros: "📦"
};

const BASE_FLAVOR_DESCS: Record<string, string> = {
  carne: "Base de carne moída temperada",
  calabresa: "Base de calabresa moída/fatiada",
  queijo: "Base de queijo muçarela",
  "queijo temperado": "Base de queijo com ervas/temperos",
  "quatro queijos": "Mescla especial de 4 queijos",
  "massa vazia": "Massa aberta (para chocolate, ninho, etc.)",
  outros: "Demais produtos não categorizados"
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

export default function AntecipacaoClient({ userName, storeName }: AntecipacaoClientProps) {
  // Pegar a hora atual local para o padrão
  const getLocalTimeHM = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const getLocalDayOfWeek = () => {
    return new Date().getDay();
  };

  const [hours, setHours] = useState<number>(1);
  const [referenceTime, setReferenceTime] = useState<string>(getLocalTimeHM());
  const [dayOfWeek, setDayOfWeek] = useState<number>(getLocalDayOfWeek());
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Estados de feedback do simulador
  const [simulating, setSimulating] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"day1" | "day2">("day1");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/store/antecipacao?hours=${hours}&referenceTime=${referenceTime}&dayOfWeek=${dayOfWeek}`
      );
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
  }, [hours, referenceTime, dayOfWeek]);

  const handleSimulate = async () => {
    if (simulating) return;
    setSimulating(true);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/store/antecipacao/simulate", {
        method: "POST"
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Erro ao simular dados.");
      }
      setSuccessMsg(json.message);
      // Recarregar os dados
      fetchData();
      // Ocultar a mensagem após 5 segundos
      setTimeout(() => {
        setSuccessMsg(null);
      }, 7000);
    } catch (err: any) {
      alert("Erro ao simular: " + err.message);
    } finally {
      setSimulating(false);
    }
  };

  const getPredictionTimeRange = () => {
    if (!referenceTime) return "";
    const [h, m] = referenceTime.split(":").map(Number);
    const start = new Date();
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(start.getHours())}:${pad(start.getMinutes())} às ${pad(end.getHours())}:${pad(end.getMinutes())}`;
  };

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
              Previsão inteligente para <strong>{storeName}</strong> baseado nos hábitos dos clientes nas últimas duas semanas.
            </p>
          </div>
          <div className="header-action">
            <button
              onClick={handleSimulate}
              disabled={simulating}
              className={`btn-simulate ${simulating ? "loading" : ""}`}
            >
              <Sparkles size={16} />
              {simulating ? "Simulando..." : "Simular Dados de Teste"}
            </button>
          </div>
        </div>
      </div>

      {/* FEEDBACK ALERTS */}
      {successMsg && (
        <div className="alert-success">
          <CheckCircle2 size={20} className="icon-success" />
          <div className="alert-text">
            <strong>Sucesso!</strong> {successMsg}
          </div>
        </div>
      )}

      {/* CONTROL BAR */}
      <div className="control-card">
        <h2><Clock size={18} /> Configurar Parâmetros de Análise</h2>
        <div className="control-grid">
          <div className="control-field">
            <label>Dia da Semana</label>
            <div className="select-wrapper">
              <select
                value={dayOfWeek}
                onChange={e => setDayOfWeek(Number(e.target.value))}
              >
                {DAYS_OF_WEEK.map((day, idx) => (
                  <option key={idx} value={idx}>
                    {idx === new Date().getDay() ? `Hoje (${day})` : day}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="control-field">
            <label>Horário de Referência (Início)</label>
            <input
              type="time"
              value={referenceTime}
              onChange={e => setReferenceTime(e.target.value)}
            />
          </div>

          <div className="control-field">
            <label>Tempo de Antecipação (Janela)</label>
            <div className="number-input-group">
              <input
                type="number"
                min="1"
                max="12"
                value={hours}
                onChange={e => setHours(Math.max(1, Number(e.target.value)))}
              />
              <span className="unit">{hours === 1 ? "hora" : "horas"}</span>
            </div>
          </div>
        </div>
        <div className="control-helper">
          <Info size={14} />
          <span>
            Análise focada na janela das <strong>{getPredictionTimeRange()}</strong> nas últimas duas <strong>{DAYS_OF_WEEK[dayOfWeek]}s</strong>.
          </span>
        </div>
      </div>

      {/* LOADING & ERROR STATES */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Analisando histórico de vendas e calculando médias...</p>
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
          {/* PREDICTION CARDS */}
          <div className="section-title">
            <h2>Média Calculada & Sugestão de Preparo</h2>
            <span className="subtitle">Valores sugeridos arredondados para cima</span>
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

      {/* INLINE CSS FOR AESTHETICS */}
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

        .btn-simulate {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: linear-gradient(135deg, #c62828, #b71c1c);
          color: white;
          font-weight: 700;
          font-size: 0.88rem;
          padding: 0.75rem 1.25rem;
          border: none;
          border-radius: 0.75rem;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(198, 40, 40, 0.35);
        }

        .btn-simulate:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(198, 40, 40, 0.45);
          filter: brightness(1.1);
        }

        .btn-simulate:disabled {
          opacity: 0.6;
          cursor: not-allowed;
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

        .control-card h2 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.1rem;
          font-weight: 800;
          margin: 0 0 1.25rem 0;
          color: #0f172a;
        }

        .control-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1.25rem;
          margin-bottom: 1rem;
        }

        .control-field {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .control-field label {
          font-size: 0.78rem;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .control-field select,
        .control-field input {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 0.65rem;
          border: 1.5px solid #cbd5e1;
          font-size: 0.92rem;
          font-weight: 600;
          font-family: inherit;
          color: #0f172a;
          background: #f8fafc;
          transition: all 0.2s ease;
        }

        .control-field select:focus,
        .control-field input:focus {
          outline: none;
          border-color: #c62828;
          background: white;
          box-shadow: 0 0 0 3px rgba(198, 40, 40, 0.15);
        }

        .select-wrapper {
          position: relative;
        }

        .number-input-group {
          position: relative;
          display: flex;
          align-items: center;
        }

        .number-input-group input {
          padding-right: 4rem;
        }

        .number-input-group .unit {
          position: absolute;
          right: 1rem;
          font-size: 0.8rem;
          font-weight: 700;
          color: #64748b;
          pointer-events: none;
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
        }

        /* ALERT ALERTS */
        .alert-success {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #15803d;
          padding: 1rem 1.25rem;
          border-radius: 0.85rem;
          margin-bottom: 1.5rem;
          animation: slideDown 0.3s ease-out;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .alert-text {
          font-size: 0.88rem;
          line-height: 1.4;
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

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

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

        @media (max-width: 768px) {
          .header-content {
            flex-direction: column;
            align-items: flex-start;
          }
          .header-action {
            width: 100%;
          }
          .btn-simulate {
            width: 100%;
            justify-content: center;
          }
          .history-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .tabs {
            width: 100%;
          }
          .tab-btn {
            flex: 1;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}
