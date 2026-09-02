"use client";
import React, { useState, useEffect } from "react";

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

type CostData = {
  id: string;
  storeName: string;
  email: string;
  city: string | null;
  revenue: { totalSales: number; amountDue: number; amountPaid: number };
  costs: {
    whatsapp: number;
    whatsappMessages: number;
    geminiChat: number;
    geminiTokens: number;
    geminiCalls: number;
    geminiVision: number;
    geminiVisionCalls: number;
    hosting: number;
    orders: number;
    total: number;
  };
  ativa: boolean;
  orders: number;
  profit: number;
  margin: number;
};

type Servico = {
  chave: string;
  nome: string;
  papel: string;
  mensalBRL: number;
  rateio: "pedidos" | "direto" | "receita";
  aConfirmar?: boolean;
  observacao?: string;
};

type CostsResponse = {
  yearMonth: string;
  totals: {
    totalRevenue: number;
    totalCosts: number;
    totalProfit: number;
    avgMargin: number;
    infraMensal: number;
    pedidosNoMes: number;
    lojasAtivas: number;
    lojasCadastradas: number;
  };
  servicos: Servico[];
  lojistas: CostData[];
};

export default function AdminCostsTab() {
  const [data, setData] = useState<CostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [yearMonth, setYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [yearMonth]);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/usage-costs?yearMonth=${yearMonth}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  return (
    <div style={{ padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1E293B" }}>💰 Controle de Custos (P&L)</h2>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#64748B" }}>Mês de Referência:</label>
          <input 
            type="month" 
            value={yearMonth}
            onChange={e => setYearMonth(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontWeight: 700 }}
          />
        </div>
      </div>

      {loading ? (
        <p style={{ color: "#64748B" }}>Carregando dados de custos e receitas...</p>
      ) : data ? (
        <>
          {/* KPIs Globais */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
            <div style={{ background: "#FFF", padding: "16px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: "0.85rem", color: "#64748B", fontWeight: 600 }}>Receita Total (Mensalidades)</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#1E293B", marginTop: 4 }}>{fmt(data.totals.totalRevenue)}</div>
            </div>
            <div style={{ background: "#FFF", padding: "16px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: "0.85rem", color: "#64748B", fontWeight: 600 }}>Custo Total Plataforma</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#EA1D2C", marginTop: 4 }}>{fmt(data.totals.totalCosts)}</div>
              <div style={{ fontSize: "0.75rem", color: "#94A3B8", marginTop: 4 }}>
                {data.totals.lojasAtivas} de {data.totals.lojasCadastradas} lojas operaram · {data.totals.pedidosNoMes} pedidos
              </div>
            </div>
            <div style={{ background: "#FFF", padding: "16px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: "0.85rem", color: "#64748B", fontWeight: 600 }}>Lucro Líquido Estimado</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: data.totals.totalProfit >= 0 ? "#10B981" : "#EA1D2C", marginTop: 4 }}>{fmt(data.totals.totalProfit)}</div>
            </div>
            <div style={{ background: "#FFF", padding: "16px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: "0.85rem", color: "#64748B", fontWeight: 600 }}>Margem Média</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#3B82F6", marginTop: 4 }}>{data.totals.avgMargin.toFixed(1)}%</div>
            </div>
          </div>

          {/* ── DE ONDE SAI O CUSTO ────────────────────────────────────────────
              O total acima não é um número solto: é a soma desta lista. Cada
              serviço que a plataforma paga aparece aqui com o que faz e quanto
              custa, para dar para vigiar quando um deles subir. */}
          <div style={{ background: "#FFF", borderRadius: "12px", border: "1px solid #E2E8F0", padding: "16px", marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 800, color: "#1E293B" }}>🧾 Serviços que a plataforma paga</h3>
              <div style={{ fontSize: "0.8rem", color: "#64748B" }}>
                Infraestrutura fixa: <strong style={{ color: "#EA1D2C" }}>{fmt(data.totals.infraMensal)}/mês</strong>
              </div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {data.servicos.map(s => (
                <div key={s.chave} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: s.mensalBRL > 0 ? "#FAFAFA" : "transparent", border: "1px solid #F1F5F9" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#1E293B", fontSize: "0.9rem" }}>
                      {s.nome}
                      {s.aConfirmar && (
                        <span style={{ marginLeft: 8, background: "#FEF9C3", color: "#854D0E", padding: "1px 6px", borderRadius: 4, fontSize: "0.65rem", fontWeight: 700 }}>
                          confirmar valor
                        </span>
                      )}
                      {s.rateio === "direto" && (
                        <span style={{ marginLeft: 8, background: "#EFF6FF", color: "#2563EB", padding: "1px 6px", borderRadius: 4, fontSize: "0.65rem", fontWeight: 700 }}>
                          medido por loja
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 2 }}>{s.papel}</div>
                    {s.observacao && (
                      <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 3, lineHeight: 1.4 }}>{s.observacao}</div>
                    )}
                  </div>
                  <div style={{ fontWeight: 800, color: s.mensalBRL > 0 ? "#EA1D2C" : "#10B981", fontSize: "0.9rem", whiteSpace: "nowrap" }}>
                    {s.mensalBRL > 0 ? `${fmt(s.mensalBRL)}/mês` : "grátis"}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 12, lineHeight: 1.5 }}>
              A infraestrutura é dividida entre as lojas na proporção dos pedidos que cada uma processou no mês.
              Loja sem pedido não recebe rateio — ela não consumiu banco nem servidor.
              Para mudar um valor, edite <code style={{ background: "#F1F5F9", padding: "1px 4px", borderRadius: 3 }}>src/lib/custos-plataforma.ts</code>.
            </div>
          </div>

          <div style={{ background: "#FFF", borderRadius: "12px", border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                <tr>
                  <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Lojista</th>
                  <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Receita</th>
                  <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Custo Total</th>
                  <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Lucro</th>
                  <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Margem</th>
                  <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.lojistas.map(l => (
                  <React.Fragment key={l.id}>
                    <tr style={{ borderBottom: "1px solid #E2E8F0", background: l.profit < 0 ? "#FEF2F2" : "transparent" }}>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ fontWeight: 700, color: l.ativa ? "#1E293B" : "#94A3B8" }}>
                          {l.storeName}
                          {!l.ativa && (
                            <span style={{ marginLeft: 8, background: "#F1F5F9", color: "#64748B", padding: "2px 8px", borderRadius: 6, fontSize: "0.7rem", fontWeight: 700 }}>
                              sem pedido no mês
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 4 }}>
                          {l.email}
                          {l.ativa && <span style={{ marginLeft: 8, color: "#475569", fontWeight: 600 }}>· {l.orders} pedidos</span>}
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1E293B" }}>
                        {fmt(l.revenue.amountDue)}
                        <div style={{ fontSize: "0.75rem", color: l.revenue.amountPaid >= l.revenue.amountDue && l.revenue.amountDue > 0 ? "#10B981" : "#64748B" }}>
                          Pago: {fmt(l.revenue.amountPaid)}
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 700, color: "#EA1D2C" }}>
                        {fmt(l.costs.total)}
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 700, color: l.profit >= 0 ? "#10B981" : "#EA1D2C" }}>
                        {fmt(l.profit)}
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        <span style={{ 
                          background: l.margin >= 70 ? "#DCFCE7" : l.margin >= 40 ? "#FEF9C3" : "#FEE2E2",
                          color: l.margin >= 70 ? "#166534" : l.margin >= 40 ? "#854D0E" : "#991B1B",
                          padding: "4px 8px", borderRadius: "6px", fontSize: "0.8rem"
                        }}>
                          {l.margin.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <button 
                          onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
                          style={{ background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                        >
                          {expandedId === l.id ? "Ocultar Detalhes" : "Ver Detalhes"}
                        </button>
                      </td>
                    </tr>
                    
                    {/* Detalhes Expandidos */}
                    {expandedId === l.id && (
                      <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                        <td colSpan={6} style={{ padding: "16px" }}>
                          <div style={{ display: "flex", gap: "24px", padding: "12px", background: "#FFF", borderRadius: "8px", border: "1px dashed #CBD5E1" }}>
                            
                            <div style={{ flex: 1 }}>
                              <h4 style={{ fontSize: "0.85rem", fontWeight: 800, color: "#475569", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                ☁️ Hospedagem & Infra
                              </h4>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0", borderBottom: "1px solid #F1F5F9" }}>
                                <span style={{ color: "#64748B" }}>Servidores</span>
                                <strong style={{ color: "#1E293B" }}>Neon · Coolify · Railway</strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0", borderBottom: "1px solid #F1F5F9" }}>
                                <span style={{ color: "#64748B" }}>Pedidos no mês</span>
                                <strong style={{ color: "#1E293B" }}>
                                  {l.orders}
                                  {data.totals.pedidosNoMes > 0 && (
                                    <span style={{ color: "#94A3B8", fontWeight: 600 }}>
                                      {" "}({((l.orders / data.totals.pedidosNoMes) * 100).toFixed(1)}% da carga)
                                    </span>
                                  )}
                                </strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0" }}>
                                <span style={{ color: "#64748B" }}>Rateio da infraestrutura</span>
                                <strong style={{ color: l.costs.hosting > 0 ? "#EA1D2C" : "#10B981" }}>{fmt(l.costs.hosting)}</strong>
                              </div>
                            </div>

                            <div style={{ flex: 1 }}>
                              <h4 style={{ fontSize: "0.85rem", fontWeight: 800, color: "#475569", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                🤖 Chatbot AI (Gemini Flash)
                              </h4>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0", borderBottom: "1px solid #F1F5F9" }}>
                                <span style={{ color: "#64748B" }}>Interações / Tokens</span>
                                <strong style={{ color: "#1E293B" }}>{l.costs.geminiCalls} / {(l.costs.geminiTokens / 1000).toFixed(1)}k</strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0" }}>
                                <span style={{ color: "#64748B" }}>Custo API</span>
                                <strong style={{ color: "#EA1D2C" }}>{fmt(l.costs.geminiChat)}</strong>
                              </div>
                            </div>

                            <div style={{ flex: 1 }}>
                              <h4 style={{ fontSize: "0.85rem", fontWeight: 800, color: "#475569", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                📸 Entrada NF-e IA (Vision)
                              </h4>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0", borderBottom: "1px solid #F1F5F9" }}>
                                <span style={{ color: "#64748B" }}>Notas Lidas</span>
                                <strong style={{ color: "#1E293B" }}>{l.costs.geminiVisionCalls}</strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0" }}>
                                <span style={{ color: "#64748B" }}>Custo API</span>
                                <strong style={{ color: "#EA1D2C" }}>{fmt(l.costs.geminiVision)}</strong>
                              </div>
                            </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
