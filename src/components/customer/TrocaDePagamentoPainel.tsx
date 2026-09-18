"use client";
import { useState } from "react";
import { podeEditarPedidos, type OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import { FORMAS_DE_PAGAMENTO_NA_ENTREGA, formaCanonica, podeTrocarPagamento } from "@/lib/pagamento-na-entrega";

/**
 * Trocar a forma de pagamento de um pedido, pelo painel.
 *
 * Mora no modal da comanda, FORA das abas de edição de propósito: a edição de
 * itens tem as regras dela (canal, modo), e esta troca vale em qualquer status
 * que não seja cancelado — inclusive finalizado — e em pedido de app. O que
 * decide se o botão aparece é a MESMA função que a API consulta
 * (`podeTrocarPagamento`), senão existiria botão que o servidor recusa.
 *
 * Quem vê: quem pode editar pedidos (lib/edicao-de-pedido.ts). Para os demais
 * a linha mostra só a forma atual.
 */
export default function TrocaDePagamentoPainel({
  pedido,
  operador,
  aoSalvar,
}: {
  pedido: any;
  operador: OperadorDaEdicao;
  aoSalvar: (resultado: { paymentMethod: string; changeAmount: number | null }) => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [forma, setForma] = useState<string>(formaCanonica(pedido?.paymentMethod) || "Dinheiro");
  const [trocoPara, setTrocoPara] = useState<string>(pedido?.changeAmount ? String(pedido.changeAmount) : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atual = pedido?.paymentMethod || "não informado";
  const trocoAtual = Number(pedido?.changeAmount || 0);
  const caixa: React.CSSProperties = {
    marginBottom: 12, background: "#F9FAFB", padding: "8px 12px", borderRadius: 10, border: "1px solid #E5E7EB",
  };

  if (!podeEditarPedidos(operador)) {
    return (
      <div style={{ ...caixa, fontSize: "0.8rem", color: "#374151" }}>
        💳 <b>Pagamento:</b> {atual}
      </div>
    );
  }

  const avaliacao = podeTrocarPagamento(pedido);

  if (!aberto) {
    return (
      <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "#374151" }}>
          💳 <b>Pagamento:</b> {atual}
          {trocoAtual > 0 ? ` · troco para R$ ${trocoAtual.toFixed(2).replace(".", ",")}` : ""}
        </span>
        {avaliacao.pode ? (
          <button
            type="button"
            onClick={() => setAberto(true)}
            style={{ padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E5E7EB", background: "#FFF", color: "#374151", cursor: "pointer", fontFamily: "inherit" }}
          >
            Trocar
          </button>
        ) : (
          <span style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>{avaliacao.motivo}</span>
        )}
      </div>
    );
  }

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const troco = forma === "Dinheiro" && trocoPara.trim() ? Number(trocoPara.replace(",", ".")) : null;
      const res = await fetch(`/api/store/orders/${pedido.id}/pagamento`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: forma, changeAmount: troco }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.error || "Não consegui trocar a forma de pagamento.");
        return;
      }
      setAberto(false);
      await aoSalvar({ paymentMethod: forma, changeAmount: data.changeAmount ?? null });
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ ...caixa, background: "#FFFBEB", border: "1.5px solid #FDE68A" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#92400E", marginBottom: 6 }}>
        💳 Como o cliente pagou de verdade? <span style={{ fontWeight: 600, color: "#B45309" }}>(o pedido dizia: {atual})</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {FORMAS_DE_PAGAMENTO_NA_ENTREGA.map((f) => {
          const ativa = forma === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setForma(f)}
              style={{
                padding: "6px 10px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                border: `1.5px solid ${ativa ? "#B45309" : "#E5E7EB"}`, background: ativa ? "#FEF3C7" : "#FFF", color: ativa ? "#78350F" : "#374151",
              }}
            >
              {f}
            </button>
          );
        })}
      </div>
      {forma === "Dinheiro" && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.76rem", color: "#78350F", marginBottom: 8 }}>
          Troco para R$
          <input
            type="text"
            inputMode="decimal"
            value={trocoPara}
            onChange={(e) => setTrocoPara(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="opcional"
            style={{ width: 90, padding: "4px 8px", borderRadius: 6, border: "1px solid #FDE68A", fontFamily: "inherit", fontSize: "0.78rem" }}
          />
        </label>
      )}
      {erro && <div style={{ fontSize: "0.76rem", color: "#B91C1C", fontWeight: 700, marginBottom: 8 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => { setAberto(false); setErro(null); }}
          style={{ padding: "6px 12px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, border: "1.5px solid #E5E7EB", background: "#FFF", color: "#6B7280", cursor: "pointer", fontFamily: "inherit" }}
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={salvando}
          onClick={salvar}
          style={{ padding: "6px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 800, border: "none", background: salvando ? "#9CA3AF" : "#B45309", color: "#FFF", cursor: salvando ? "default" : "pointer", fontFamily: "inherit" }}
        >
          {salvando ? "Salvando…" : "Salvar pagamento"}
        </button>
      </div>
    </div>
  );
}
