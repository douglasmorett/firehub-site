"use client";
import { useState } from "react";
import MotoboyManager from "./MotoboyManager";
import RegraDoPagamentoDoApp from "./RegraDoPagamentoDoApp";
import MotoboyReport from "./MotoboyReport";

export default function MotoboyDashboard({ initialMotoboys, storeTimezone, deliveryConfig }: { initialMotoboys: any[], storeTimezone?: string, deliveryConfig?: unknown }) {
  const [tab, setTab] = useState<"cadastro" | "relatorio">("cadastro");
  const [motoboys, setMotoboys] = useState(initialMotoboys);

  const TAB_STYLE = (active: boolean) => ({
    padding: "10px 20px", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500,
    fontSize: "0.9rem", fontFamily: "inherit", background: "transparent",
    color: active ? "#C92E09" : "#64748B",
    borderBottom: active ? "3px solid #C92E09" : "3px solid transparent",
    transition: "all 0.15s",
  });

  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid #E2E8F0", marginBottom: 20 }}>
        <button style={TAB_STYLE(tab === "cadastro")} onClick={() => setTab("cadastro")}>
          🏍️ Cadastro de Motoboys
        </button>
        <button style={TAB_STYLE(tab === "relatorio")} onClick={() => setTab("relatorio")}>
          📊 Relatório de Pagamentos
        </button>
      </div>

      {tab === "cadastro" && (
        <>
          {/* Decisão da LOJA, não de um entregador: o mesmo pedido de app não
              pode valer um número para um e outro para outro. */}
          <RegraDoPagamentoDoApp deliveryConfig={deliveryConfig} />
          <MotoboyManager initialMotoboys={motoboys} />
        </>
      )}
      {tab === "relatorio" && (
        <MotoboyReport motoboys={motoboys} storeTimezone={storeTimezone} />
      )}
    </div>
  );
}
