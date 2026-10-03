"use client";

/**
 * A aba "Faltou item" do modal Ver pedido — em qualquer pedido não cancelado.
 *
 * O cliente ligou: "a esfiha de Nevada não veio". O atendente marca o que
 * faltou (o item inteiro ou só a opção de dentro do combo), e sai um pedido de
 * reposição: comanda própria com endereço e contato, "JÁ PAGO - SÓ ENTREGAR",
 * no topo do KDS. Valor zero — o dinheiro já entrou no pedido original.
 * Regras em lib/reposicao.ts; quem grava é /api/store/orders/[id]/reposicao.
 */

import { useMemo, useState } from "react";
import { opcoesDoItem, type MotivoDaReposicao } from "@/lib/reposicao";

type ItemDoPedido = {
  id: string;
  productName?: string | null;
  quantity: number;
  notes?: string | null;
  comboSelections?: unknown;
};

type Linha = { chave: string; itemId: string; nome: string; maximo: number; opcao?: string; deQuem?: string };

export default function ReposicaoPainel({
  pedido,
  aoFechar,
  aoSalvar,
}: {
  pedido: { id: string; customerName?: string | null; customerAddress?: string | null; customerPhone?: string | null; deliveryType?: string | null; items?: ItemDoPedido[] };
  aoFechar: () => void;
  aoSalvar: (r: { id: string; numero: number | null; descricao: string }) => void | Promise<void>;
}) {
  const [motivo, setMotivo] = useState<MotivoDaReposicao>("FALTOU");
  const [prioridade, setPrioridade] = useState(true);
  const [observacao, setObservacao] = useState("");
  const [quantos, setQuantos] = useState<Record<string, number>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  // Cada item vira uma linha; as escolhas de dentro dele (o sabor do combo)
  // viram linhas próprias logo abaixo — é o caso mais comum de "faltou".
  const linhas = useMemo<Linha[]>(() => {
    const saida: Linha[] = [];
    for (const it of pedido.items || []) {
      const nome = it.productName || "Item";
      saida.push({ chave: it.id, itemId: it.id, nome, maximo: it.quantity });
      for (const op of opcoesDoItem(it)) {
        saida.push({ chave: `${it.id}::${op.nome}`, itemId: it.id, nome: op.nome, maximo: op.quantidade, opcao: op.nome, deQuem: nome });
      }
    }
    return saida;
  }, [pedido.items]);

  const marcadas = linhas.filter((l) => (quantos[l.chave] || 0) > 0);
  const mudar = (l: Linha, delta: number) =>
    setQuantos((q) => ({ ...q, [l.chave]: Math.max(0, Math.min(l.maximo, (q[l.chave] || 0) + delta)) }));

  async function enviar() {
    setErro("");
    if (marcadas.length === 0) return setErro("Marque o que faltou.");
    setEnviando(true);
    try {
      const r = await fetch(`/api/store/orders/${pedido.id}/reposicao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motivo,
          prioridade,
          observacao,
          itens: marcadas.map((l) => ({ itemId: l.itemId, quantity: quantos[l.chave], ...(l.opcao ? { opcao: { nome: l.opcao } } : {}) })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(j?.error || "Não deu para lançar a reposição.");
      await aoSalvar(j.reposicao);
    } finally {
      setEnviando(false);
    }
  }

  const botaoMotivo = (m: MotivoDaReposicao, rotulo: string) => (
    <button
      type="button"
      onClick={() => setMotivo(m)}
      style={{
        flex: 1, padding: "8px 10px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 800,
        border: `1.5px solid ${motivo === m ? "#6D28D9" : "#E2E8F0"}`,
        background: motivo === m ? "#EDE9FE" : "#FFF",
        color: motivo === m ? "#5B21B6" : "#64748B",
      }}
    >
      {rotulo}
    </button>
  );

  return (
    <div>
      <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.45, marginBottom: 10 }}>
        Marque o que <b>faltou</b> (ou foi errado): sai uma <b>comanda nova, já paga</b>, com o endereço do
        cliente, e a cozinha faz primeiro.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {botaoMotivo("FALTOU", "📦 Faltou item")}
        {botaoMotivo("TROCA", "🔁 Veio errado (troca)")}
      </div>

      <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
        {linhas.map((l) => {
          const q = quantos[l.chave] || 0;
          return (
            <div
              key={l.chave}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: l.opcao ? "6px 10px 6px 28px" : "9px 10px",
                borderTop: "1px solid #F1F5F9", background: q > 0 ? "#F5F3FF" : l.opcao ? "#FAFAFA" : "#FFF",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: l.opcao ? "0.78rem" : "0.85rem", fontWeight: l.opcao ? 600 : 800, color: "#1E293B" }}>
                  {l.opcao ? "↳ " : ""}{l.nome}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#94A3B8" }}>
                  {l.opcao ? `dentro do ${l.deQuem} · ` : ""}no pedido: {l.maximo}x
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button type="button" aria-label={`Menos ${l.nome}`} onClick={() => mudar(l, -1)} disabled={q === 0} style={passo(q === 0)}>−</button>
                <span style={{ minWidth: 22, textAlign: "center", fontWeight: 900, color: q > 0 ? "#5B21B6" : "#CBD5E1" }}>{q}</span>
                <button type="button" aria-label={`Mais ${l.nome}`} onClick={() => mudar(l, 1)} disabled={q >= l.maximo} style={passo(q >= l.maximo)}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, cursor: "pointer", fontSize: "0.82rem", color: "#1E293B" }}>
        <input type="checkbox" checked={prioridade} onChange={(e) => setPrioridade(e.target.checked)} style={{ marginTop: 2, accentColor: "#6D28D9" }} />
        <span>
          <b>⚡ Prioridade na cozinha</b>
          <span style={{ display: "block", fontSize: "0.72rem", color: "#64748B" }}>Entra no topo do KDS, na frente dos outros pedidos.</span>
        </span>
      </label>

      <input
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Observação para a cozinha/motoboy (opcional)"
        maxLength={300}
        style={{ width: "100%", marginTop: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: "0.82rem", fontFamily: "inherit", boxSizing: "border-box" }}
      />

      {/* O que vai sair no papel, antes de clicar. */}
      {marcadas.length > 0 && (
        <div style={{ marginTop: 12, background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 10, padding: "10px 12px", fontSize: "0.78rem", color: "#334155", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 900, color: "#5B21B6" }}>
            {motivo === "TROCA" ? "TROCA" : "ITEM FALTANTE"} · JÁ PAGO · SÓ ENTREGAR
          </div>
          {marcadas.map((l) => (
            <div key={l.chave}>{quantos[l.chave]}x {l.nome}</div>
          ))}
          <div style={{ marginTop: 4, color: "#64748B" }}>
            {pedido.customerName}{pedido.deliveryType === "DELIVERY" && pedido.customerAddress ? ` · ${pedido.customerAddress}` : ""}
          </div>
          <div style={{ color: "#64748B" }}>Valor: R$ 0,00 — nada a cobrar do cliente</div>
        </div>
      )}

      {erro && <div style={{ marginTop: 10, color: "#B91C1C", fontSize: "0.8rem", fontWeight: 700 }}>{erro}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" onClick={aoFechar} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E2E8F0", background: "#FFF", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          Voltar
        </button>
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || marcadas.length === 0}
          style={{
            flex: 2, padding: "10px", borderRadius: 10, border: "none", fontWeight: 900, fontFamily: "inherit",
            background: marcadas.length === 0 ? "#CBD5E1" : "#6D28D9", color: "#FFF", cursor: marcadas.length === 0 ? "default" : "pointer",
          }}
        >
          {enviando ? "Enviando..." : "Enviar para a cozinha"}
        </button>
      </div>
    </div>
  );
}

function passo(desligado: boolean): React.CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 8, border: "1px solid #E2E8F0", background: desligado ? "#F8FAFC" : "#FFF",
    color: desligado ? "#CBD5E1" : "#5B21B6", fontWeight: 900, cursor: desligado ? "default" : "pointer", fontFamily: "inherit",
  };
}
