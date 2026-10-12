"use client";
import { useState } from "react";
import MotoboyManager from "./MotoboyManager";
import RegraDoPagamentoDoApp from "./RegraDoPagamentoDoApp";
import MotoboyReport from "./MotoboyReport";
import type { OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import LancheDaEquipePainel from "@/components/lanche/LancheDaEquipePainel";

export default function MotoboyDashboard({ initialMotoboys, storeTimezone, deliveryConfig, operador, lanche = null }: {
  initialMotoboys: any[], storeTimezone?: string, deliveryConfig?: unknown, operador: OperadorDaEdicao,
  /** O lanche dos motoboys (lib/lanche-da-equipe.ts): só nas lojas que têm a tela. */
  lanche?: { slug: string; loja: string } | null,
}) {
  const [tab, setTab] = useState<"cadastro" | "relatorio" | "lanche">("cadastro");
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
        {lanche && (
          <button style={TAB_STYLE(tab === "lanche")} onClick={() => setTab("lanche")}>
            🍔 Lanche dos motoboys
          </button>
        )}
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
        <MotoboyReport motoboys={motoboys} storeTimezone={storeTimezone} operador={operador} />
      )}
      {tab === "lanche" && lanche && <LancheDaEquipePainel slug={lanche.slug} loja={lanche.loja} />}
    </div>
  );
}
