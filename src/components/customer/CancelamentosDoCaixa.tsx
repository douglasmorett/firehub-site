"use client";

/**
 * Os cancelamentos do turno na TELA do fechamento do caixa — antes eles só
 * saíam no papel, e o item tirado da mesa não saía em lugar nenhum.
 *
 * Pizzaria 17 (Antonio, 09/10/2026): "quando for fechar o caixa, estejam todas
 * as observações que eu preciso ver na conferência do fechamento". Pedido
 * cancelado inteiro e item tirado, cada um com hora, quem, valor e o motivo
 * que a pessoa escreveu (lib/motivo-do-cancelamento.ts). Só informação: nada
 * daqui entra na conferência.
 */
import { useState } from "react";

export type CancelamentosDoTurno = {
  pedidos: {
    qtd: number;
    valor: number;
    lista: { hora: string; numero: string; canal: string; valor: number; motivo: string | null; quem: string | null; operador?: string | null }[];
  };
  itens: { hora: string; numero: string; onde: string; quem: string; item: string; valor: number; motivo: string | null }[];
};

const fmt = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hora = (h: string) => {
  const d = new Date(h);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
};
const quemDoPedido = (c: CancelamentosDoTurno["pedidos"]["lista"][number]) => {
  const base = c.quem === "loja" ? "pela loja" : c.quem === "cliente" ? "pelo cliente" : c.quem ? `pelo ${c.quem}` : "";
  return c.operador ? `${base || "por"} (${c.operador})` : base;
};

export default function CancelamentosDoCaixa({ dados }: { dados: CancelamentosDoTurno | null }) {
  const [aberto, setAberto] = useState(false);
  if (!dados) return null;
  const pedidos = dados.pedidos?.lista || [];
  const itens = dados.itens || [];
  if (pedidos.length === 0 && itens.length === 0) return null;
  const somaItens = Math.round(itens.reduce((t, i) => t + (Number(i.valor) || 0) * 100, 0)) / 100;
  const semMotivo = pedidos.filter((p) => !p.motivo).length + itens.filter((i) => !i.motivo).length;

  const linha = (chave: string, titulo: string, valor: number, nota: string, alerta: boolean) => (
    <div key={chave} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px dashed #E2E8F0", fontSize: "0.8rem" }}>
      <span style={{ color: "#1E293B" }}>
        {titulo}
        <span style={{ display: "block", fontSize: "0.72rem", color: alerta ? "#B45309" : "#64748B", lineHeight: 1.4 }}>{nota}</span>
      </span>
      <strong style={{ color: "#B71C1C", whiteSpace: "nowrap" }}>{fmt(valor)}</strong>
    </div>
  );

  return (
    <div style={{ background: "#FFF7F5", border: "1px solid #FECACA", borderRadius: 12, padding: "10px 12px", marginBottom: "1rem", textAlign: "left" }}>
      <button type="button" onClick={() => setAberto((v) => !v)}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", color: "#9F1239", textTransform: "uppercase" }}>
          Cancelamentos do turno
        </span>
        <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#9F1239" }}>{aberto ? "esconder ▴" : "ver um a um ▾"}</span>
      </button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {pedidos.length > 0 && (
          <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#1E293B", background: "#fff", border: "1px solid #FECACA", borderRadius: 999, padding: "3px 10px" }}>
            Pedidos cancelados ({dados.pedidos.qtd}) <strong>{fmt(dados.pedidos.valor)}</strong>
          </span>
        )}
        {itens.length > 0 && (
          <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#1E293B", background: "#fff", border: "1px solid #FECACA", borderRadius: 999, padding: "3px 10px" }}>
            Itens cancelados ({itens.length}) <strong>{fmt(somaItens)}</strong>
          </span>
        )}
        {semMotivo > 0 && (
          <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#B45309", padding: "3px 4px" }}>
            {semMotivo} sem motivo
          </span>
        )}
      </div>
      {aberto && (
        <div style={{ marginTop: 8 }}>
          {pedidos.map((c, k) =>
            linha(
              `p${k}`,
              `${hora(c.hora)} ${c.numero} ${c.canal} — pedido inteiro`.replace(/\s+/g, " ").trim(),
              c.valor,
              `cancelado ${quemDoPedido(c)}${c.motivo ? `: ${c.motivo}` : " — sem motivo"}`.replace(/\s+/g, " "),
              !c.motivo
            )
          )}
          {itens.map((i, k) =>
            linha(
              `i${k}`,
              `${hora(i.hora)} ${i.numero} ${i.onde} — ${i.item}`.replace(/\s+/g, " ").trim(),
              i.valor,
              `tirado por ${i.quem}${i.motivo ? `: ${i.motivo}` : " — sem motivo"}`,
              !i.motivo
            )
          )}
        </div>
      )}
    </div>
  );
}
