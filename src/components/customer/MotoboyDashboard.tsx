"use client";
import { useState } from "react";
import MotoboyManager from "./MotoboyManager";
import MotoboyReport from "./MotoboyReport";
import type { OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import LancheDaEquipePainel from "@/components/lanche/LancheDaEquipePainel";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";

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
        // O quadro "Pedido de iFood, 99Food e outros apps" que ficava aqui
        // em cima saiu em 17/10/2026 ("está confuso, ninguém usa nem
        // entende" — o dono): a escolha agora é no cadastro de cada
        // entregador. A regra antiga da loja vai junto só para a tela mostrar
        // o que vale para quem nunca escolheu.
        <MotoboyManager initialMotoboys={motoboys} regraDaLoja={lerRegraDeRepasse(deliveryConfig)} />
      )}
      {tab === "relatorio" && (
        <MotoboyReport motoboys={motoboys} storeTimezone={storeTimezone} operador={operador} deliveryConfig={deliveryConfig} />
      )}
      {tab === "lanche" && lanche && <LancheDaEquipePainel slug={lanche.slug} loja={lanche.loja} />}
    </div>
  );
}
