"use client";
import { useState } from "react";
import { podeEditarPedidos, type OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import {
  FORMAS_DO_ENTREGUE_DEPOIS_DE_CANCELADO,
  podeMarcarEntregueDepoisDeCancelado,
  type FormaDoEntregueDepoisDeCancelado,
} from "@/lib/entregue-depois-de-cancelado";

/**
 * "Entregue mesmo depois de cancelado", no painel — o detalhe do pedido
 * cancelado e a linha do cancelado na Conferência do motoboy, onde o Allan
 * (Delícias de Casa, 17/10/2026) mostrou o pedido que o cliente cancelou,
 * recebeu e pagou. O botão só aparece quando a MESMA regra que a API consulta
 * deixa (lib/entregue-depois-de-cancelado.ts): pedido da própria loja, e quem
 * pode editar pedidos. Pedido de iFood/99/Keeta… não mostra nada.
 */
export default function EntregueDepoisDeCancelado({
  pedido,
  operador,
  aoSalvar,
  compacto = false,
  pode,
}: {
  pedido: any;
  operador: OperadorDaEdicao;
  aoSalvar: (r: { forma: FormaDoEntregueDepoisDeCancelado | null; jaEstava: boolean }) => void | Promise<void>;
  /** Na linha da Conferência: só o botão, a escolha abre embaixo. */
  compacto?: boolean;
  /**
   * A decisão que o servidor já tomou com o pedido inteiro (a linha da
   * Conferência não leva os ids de parceiro). Sem ela, a regra roda aqui.
   */
  pode?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [forma, setForma] = useState<FormaDoEntregueDepoisDeCancelado | null>(null);
  const [trocoPara, setTrocoPara] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!podeEditarPedidos(operador) || !(pode ?? podeMarcarEntregueDepoisDeCancelado(pedido).pode)) return null;

  const total = Number(pedido?.totalAmount || 0);
  const dinheiro = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
  const botao: React.CSSProperties = {
    padding: compacto ? "3px 8px" : "6px 12px", borderRadius: 8, fontSize: compacto ? "0.7rem" : "0.8rem", fontWeight: 800,
    border: "1.5px solid #16A34A", background: "#F0FDF4", color: "#14532D", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  };

  if (!aberto) {
    return (
      <button type="button" onClick={() => { setAberto(true); setErro(null); }} style={botao}
        title="O cliente recebeu e pagou mesmo com o pedido cancelado: o pedido volta a contar como entregue (caixa, faturamento e acerto do motoboy)">
        ✅ Entregue mesmo depois de cancelado
      </button>
    );
  }

  async function salvar() {
    if (!forma || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/store/orders/${pedido.id}/entregue-depois-de-cancelado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forma, trocoPara: forma === "Dinheiro" && trocoPara ? trocoPara : null }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data.success) {
        setErro(data.error || "Não consegui marcar. Tente de novo.");
        return;
      }
      setAberto(false);
      await aoSalvar({ forma: data.forma ?? forma, jaEstava: Boolean(data.jaEstava) });
    } catch {
      setErro("Sem conexão — nada foi gravado. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ marginTop: 8, background: "#F0FDF4", border: "1.5px solid #86EFAC", borderRadius: 10, padding: "10px 12px", fontFamily: "system-ui, sans-serif", textAlign: "left" }}>
      <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#14532D" }}>
        Entregue mesmo depois de cancelado — {dinheiro(total)}
      </div>
      <div style={{ fontSize: "0.74rem", color: "#166534", margin: "2px 0 8px" }}>
        O pedido passa a contar como entregue: entra no caixa, no faturamento e no acerto do motoboy. O histórico guarda que ele foi cancelado antes e quem marcou.
      </div>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        Como o cliente pagou
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {FORMAS_DO_ENTREGUE_DEPOIS_DE_CANCELADO.map((f) => {
          const ativa = forma === f;
          return (
            <button key={f} type="button" onClick={() => setForma(f)}
              style={{
                padding: "6px 10px", borderRadius: 8, fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                border: `2px solid ${ativa ? "#16A34A" : "#E2E8F0"}`, background: ativa ? "#DCFCE7" : "#FFFFFF", color: ativa ? "#14532D" : "#334155",
              }}>
              {f}
            </button>
          );
        })}
      </div>
      {forma === "Dinheiro" && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: "0.76rem", color: "#334155", fontWeight: 600 }}>
          Troco para (opcional)
          <input
            value={trocoPara}
            onChange={(e) => setTrocoPara(e.target.value.replace(/[^\d,.]/g, ""))}
            inputMode="decimal"
            placeholder="ex.: 50"
            style={{ width: 90, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #CBD5E1", fontFamily: "inherit", fontSize: "0.8rem" }}
          />
        </label>
      )}
      {erro && <div style={{ marginTop: 8, fontSize: "0.76rem", fontWeight: 700, color: "#B91C1C" }}>{erro}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="button" disabled={salvando} onClick={() => setAberto(false)}
          style={{ padding: "6px 12px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, border: "1.5px solid #E2E8F0", background: "#FFF", color: "#64748B", cursor: "pointer", fontFamily: "inherit" }}>
          Voltar
        </button>
        <button type="button" disabled={!forma || salvando} onClick={salvar}
          style={{
            padding: "6px 14px", borderRadius: 8, fontSize: "0.8rem", fontWeight: 900, border: "none", fontFamily: "inherit",
            background: forma ? "#16A34A" : "#CBD5E1", color: "#FFF", cursor: forma && !salvando ? "pointer" : "default",
          }}>
          {salvando ? "Gravando…" : "Confirmar entregue"}
        </button>
      </div>
    </div>
  );
}
