"use client";

/**
 * A aba "Editar itens" de dentro do modal Ver pedido.
 *
 * O que o atendente faz aqui: o cliente ligou pedindo para tirar a batata, ou
 * para mandar mais uma Coca. Antes disso só havia cancelar o pedido inteiro.
 *
 * ── A tela tem que se explicar sozinha ──────────────────────────────────────
 *
 * Quem usa é o atendente no meio do movimento, com o cliente no telefone. Então:
 *
 *   • O total novo aparece ANTES de salvar, do lado do antigo. Ninguém deveria
 *     ter que confiar que a conta foi feita — ela fica na tela, com a taxa de
 *     entrega e o desconto na frente, que são justamente as duas linhas que a
 *     pessoa esquece que existem.
 *   • Nada é gravado enquanto o botão Salvar não for clicado. A edição inteira
 *     vive no rascunho aqui, então dá para errar e voltar atrás.
 *   • Pedido de marketplace não mostra botão de tirar item: mostra o recado de
 *     que aquilo se resolve no app do parceiro, e a caixa de acrescentar.
 *
 * Quem decide o que pode é lib/edicao-de-pedido.ts — a MESMA função que a API
 * consulta. Esta tela não tem régua própria de status nem de canal: se ela
 * decidisse sozinha, existiria botão que o servidor recusa.
 */

import { useState, useMemo, useEffect } from "react";
import { avaliarEdicao, type ModoDeEdicao } from "@/lib/edicao-de-pedido";

type ItemDoPedido = {
  id: string;
  productName?: string | null;
  quantity: number;
  price: number;
  notes?: string | null;
};

type ProdutoDoCardapio = {
  id: string;
  name: string;
  price: number;
  category?: string | null;
};

const FORMAS_DE_PAGAMENTO = ["Dinheiro", "Pix", "Débito", "Crédito"];

const fmt = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

export default function EditarPedidoPainel({
  pedido,
  operador,
  aoFechar,
  aoSalvar,
}: {
  pedido: any;
  operador: { role?: string | null; permissions?: string | null };
  aoFechar: () => void;
  /** Chamada depois que o servidor confirmou. Recarrega a lista e reimprime. */
  aoSalvar: (resultado: { cancelado?: boolean; acrescimo?: any; totalAmount?: number }) => void;
}) {
  const avaliacao = useMemo(() => avaliarEdicao(pedido, operador), [pedido, operador]);
  const modo: ModoDeEdicao = avaliacao.modo;

  // Rascunho: quantidade por item e o que foi marcado para remover. Nada disso
  // toca o servidor antes do Salvar.
  const [quantidades, setQuantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries((pedido.items || []).map((i: ItemDoPedido) => [i.id, i.quantity]))
  );
  const [removidos, setRemovidos] = useState<Set<string>>(new Set());
  const [acrescimos, setAcrescimos] = useState<{ produto: ProdutoDoCardapio; quantity: number }[]>([]);
  const [pagamento, setPagamento] = useState("Dinheiro");

  const [cardapio, setCardapio] = useState<ProdutoDoCardapio[]>([]);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [abrindoBusca, setAbrindoBusca] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // O cardápio só é buscado quando o atendente abre a caixa de acrescentar:
  // é uma lista grande e a maioria das edições é só tirar item.
  useEffect(() => {
    if (!abrindoBusca || cardapio.length > 0) return;
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/menu-products");
        const data = await res.json().catch(() => []);
        if (!vivo) return;
        const lista = (Array.isArray(data) ? data : data?.products || [])
          .filter((p: any) => p?.id && p?.name)
          .map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price) || 0, category: p.category }));
        setCardapio(lista);
      } catch {
        if (vivo) setErro("Não consegui carregar o cardápio. Tente de novo.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [abrindoBusca, cardapio.length]);

  const itensOriginais: ItemDoPedido[] = pedido.items || [];
  const taxa = Number(pedido.deliveryFee) || 0;
  const desconto = Number(pedido.discountTotal) || 0;

  // O mesmo `itens - desconto + taxa` do servidor. Repetido aqui de propósito e
  // só para PREVER o número na tela; quem grava é a API, que recalcula do zero.
  const totalPrevisto = useMemo(() => {
    const somaOriginais = itensOriginais
      .filter((i) => !removidos.has(i.id))
      .reduce((s, i) => s + i.price * (quantidades[i.id] ?? i.quantity), 0);
    const somaNovos = acrescimos.reduce((s, a) => s + a.produto.price * a.quantity, 0);
    if (modo === "SO_ACRESCIMO") {
      // No marketplace o pedido original não muda: o que a tela prevê é o valor
      // a cobrar do cliente por fora.
      return Math.round(somaNovos * 100) / 100;
    }
    return Math.round(Math.max(0, somaOriginais + somaNovos - desconto + taxa) * 100) / 100;
  }, [itensOriginais, removidos, quantidades, acrescimos, desconto, taxa, modo]);

  const totalAtual = Number(pedido.totalAmount) || 0;
  const sobrouAlgum = itensOriginais.some((i) => !removidos.has(i.id));
  const mudouAlgo =
    acrescimos.length > 0 ||
    removidos.size > 0 ||
    itensOriginais.some((i) => (quantidades[i.id] ?? i.quantity) !== i.quantity);

  if (modo === "BLOQUEADO") {
    return (
      <div style={{ padding: "18px", textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🔒</div>
        <div style={{ fontWeight: 700, color: "#B91C1C", fontSize: "0.95rem", marginBottom: "6px" }}>
          Este pedido não pode ser editado
        </div>
        <div style={{ color: "#475569", fontSize: "0.86rem", lineHeight: 1.5 }}>{avaliacao.motivo}</div>
        <button onClick={aoFechar} style={botaoSecundario}>Fechar</button>
      </div>
    );
  }

  async function salvar() {
    if (salvando || !mudouAlgo) return;

    // Tirar tudo = cancelar. Vale um aviso separado, porque a consequência é
    // outra: o pedido sai do painel e o estoque volta.
    if (modo === "COMPLETO" && !sobrouAlgum && acrescimos.length === 0) {
      const ok = confirm(
        "Você tirou todos os itens.\n\nIsso CANCELA o pedido inteiro e devolve o estoque. Confirma?"
      );
      if (!ok) return;
    }

    setSalvando(true);
    setErro("");
    try {
      // Tudo numa chamada só. Antes isto era um if/else e a remoção ia junto
      // com um acréscimo era descartada: quem tirasse a Coca e pedisse um
      // pastel via a tela prever um total e o pedido fechar noutro.
      const corpo: any = {};
      if (acrescimos.length > 0) {
        corpo.acrescentar = acrescimos.map((a) => ({
          menuProductId: a.produto.id,
          quantity: a.quantity,
        }));
        if (modo === "SO_ACRESCIMO") corpo.pagamento = pagamento;
      }
      if (modo === "COMPLETO") {
        corpo.removerItemIds = Array.from(removidos);
        corpo.itens = itensOriginais
          .filter((i) => !removidos.has(i.id) && (quantidades[i.id] ?? i.quantity) !== i.quantity)
          .map((i) => ({ itemId: i.id, quantity: quantidades[i.id] }));
      }

      const res = await fetch(`/api/store/orders/${pedido.id}/itens`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const data = await res.json().catch(() => ({}) as any);
      if (!res.ok) {
        setErro(data?.error || "Não consegui salvar a alteração.");
        return;
      }
      aoSalvar(data);
    } catch {
      setErro("Sem conexão — nada foi alterado.");
    } finally {
      setSalvando(false);
    }
  }

  const produtosFiltrados = buscaProduto.trim()
    ? cardapio
        .filter((p) => p.name.toLowerCase().includes(buscaProduto.trim().toLowerCase()))
        .slice(0, 25)
    : cardapio.slice(0, 25);

  return (
    <div style={{ padding: "4px 2px" }}>
      {/* O recado do marketplace vem ANTES de tudo: é a primeira coisa que
          explica por que não há botão de lixeira nos itens. */}
      {modo === "SO_ACRESCIMO" && (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "10px",
            padding: "10px 12px",
            fontSize: "0.82rem",
            color: "#7F1D1D",
            lineHeight: 1.5,
            marginBottom: "12px",
          }}
        >
          {avaliacao.motivo}
        </div>
      )}

      {/* ── Itens do pedido ───────────────────────────────────────────── */}
      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: "6px" }}>
        {modo === "SO_ACRESCIMO" ? "Itens do pedido (não editáveis aqui)" : "Itens do pedido"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
        {itensOriginais.map((item) => {
          const fora = removidos.has(item.id);
          const qtd = quantidades[item.id] ?? item.quantity;
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 10px",
                borderRadius: "8px",
                border: `1px solid ${fora ? "#FCA5A5" : "#E2E8F0"}`,
                background: fora ? "#FEF2F2" : "#FFF",
                opacity: fora ? 0.6 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.86rem",
                    color: "#1E293B",
                    textDecoration: fora ? "line-through" : "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.productName || "Item"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748B" }}>{fmt(item.price)} cada</div>
              </div>

              {modo === "COMPLETO" && !fora && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={() => setQuantidades((q) => ({ ...q, [item.id]: Math.max(1, (q[item.id] ?? item.quantity) - 1) }))}
                    disabled={qtd <= 1}
                    style={{ ...botaoQtd, opacity: qtd <= 1 ? 0.4 : 1 }}
                    aria-label="Diminuir quantidade"
                  >
                    −
                  </button>
                  <span style={{ minWidth: 22, textAlign: "center", fontWeight: 800, fontSize: "0.9rem" }}>{qtd}</span>
                  <button
                    type="button"
                    onClick={() => setQuantidades((q) => ({ ...q, [item.id]: Math.min(99, (q[item.id] ?? item.quantity) + 1) }))}
                    style={botaoQtd}
                    aria-label="Aumentar quantidade"
                  >
                    +
                  </button>
                </div>
              )}

              {modo === "SO_ACRESCIMO" && (
                <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "#475569" }}>{qtd}x</span>
              )}

              {modo === "COMPLETO" && (
                <button
                  type="button"
                  onClick={() =>
                    setRemovidos((s) => {
                      const novo = new Set(s);
                      if (novo.has(item.id)) novo.delete(item.id);
                      else novo.add(item.id);
                      return novo;
                    })
                  }
                  title={fora ? "Voltar item ao pedido" : "Tirar item do pedido"}
                  style={{
                    border: "none",
                    background: fora ? "#DCFCE7" : "#FEE2E2",
                    color: fora ? "#15803D" : "#B91C1C",
                    borderRadius: "6px",
                    width: 30,
                    height: 30,
                    cursor: "pointer",
                    fontSize: "0.9rem",
                  }}
                >
                  {fora ? "↩" : "🗑️"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Acrescentar ───────────────────────────────────────────────── */}
      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: "6px" }}>
        Acrescentar item
      </div>

      {acrescimos.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
          {acrescimos.map((a, idx) => (
            <div
              key={`${a.produto.id}-${idx}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 10px",
                borderRadius: "8px",
                border: "1px solid #BBF7D0",
                background: "#F0FDF4",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.86rem", color: "#14532D", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.produto.name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#15803D" }}>{fmt(a.produto.price)} cada</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <button
                  type="button"
                  onClick={() =>
                    setAcrescimos((lista) =>
                      lista.map((x, i) => (i === idx ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))
                    )
                  }
                  style={botaoQtd}
                  aria-label="Diminuir quantidade"
                >
                  −
                </button>
                <span style={{ minWidth: 22, textAlign: "center", fontWeight: 800, fontSize: "0.9rem" }}>{a.quantity}</span>
                <button
                  type="button"
                  onClick={() =>
                    setAcrescimos((lista) =>
                      lista.map((x, i) => (i === idx ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x))
                    )
                  }
                  style={botaoQtd}
                  aria-label="Aumentar quantidade"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={() => setAcrescimos((lista) => lista.filter((_, i) => i !== idx))}
                style={{ border: "none", background: "#FEE2E2", color: "#B91C1C", borderRadius: "6px", width: 30, height: 30, cursor: "pointer" }}
                aria-label="Tirar este acréscimo"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      {!abrindoBusca ? (
        <button type="button" onClick={() => setAbrindoBusca(true)} style={botaoSecundario}>
          + Escolher item do cardápio
        </button>
      ) : (
        <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "8px", marginBottom: "10px" }}>
          <input
            autoFocus
            value={buscaProduto}
            onChange={(e) => setBuscaProduto(e.target.value)}
            placeholder="Buscar no cardápio..."
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #CBD5E1",
              fontSize: "0.86rem",
              fontFamily: "inherit",
              marginBottom: "6px",
            }}
          />
          <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: "3px" }}>
            {cardapio.length === 0 && <div style={{ padding: "10px", color: "#64748B", fontSize: "0.82rem" }}>Carregando cardápio...</div>}
            {produtosFiltrados.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setAcrescimos((lista) => {
                    const ja = lista.findIndex((x) => x.produto.id === p.id);
                    if (ja >= 0) return lista.map((x, i) => (i === ja ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x));
                    return [...lista, { produto: p, quantity: 1 }];
                  });
                  setBuscaProduto("");
                  setAbrindoBusca(false);
                }}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "7px 9px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#F8FAFC",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  fontSize: "0.84rem",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1E293B" }}>{p.name}</span>
                <span style={{ fontWeight: 700, color: "#15803D" }}>{fmt(p.price)}</span>
              </button>
            ))}
            {cardapio.length > 0 && produtosFiltrados.length === 0 && (
              <div style={{ padding: "10px", color: "#64748B", fontSize: "0.82rem" }}>Nenhum item com esse nome.</div>
            )}
          </div>
          <button type="button" onClick={() => setAbrindoBusca(false)} style={{ ...botaoSecundario, marginTop: 6 }}>
            Fechar busca
          </button>
        </div>
      )}

      {/* ── Como o cliente paga o acréscimo (só marketplace) ───────────── */}
      {modo === "SO_ACRESCIMO" && acrescimos.length > 0 && (
        <div style={{ marginTop: "12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "10px", padding: "10px 12px" }}>
          <div style={{ fontWeight: 800, fontSize: "0.84rem", color: "#92400E", marginBottom: "2px" }}>
            Como o cliente vai pagar os {fmt(totalPrevisto)}?
          </div>
          <div style={{ fontSize: "0.76rem", color: "#B45309", marginBottom: "8px", lineHeight: 1.4 }}>
            Esse valor não vem do marketplace — entra no seu caixa por fora.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {FORMAS_DE_PAGAMENTO.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setPagamento(f)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: `1.5px solid ${pagamento === f ? "#B45309" : "#FDE68A"}`,
                  background: pagamento === f ? "#FDE68A" : "#FFF",
                  color: "#92400E",
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── A conta, na cara ──────────────────────────────────────────── */}
      <div style={{ marginTop: "14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px 12px", fontSize: "0.84rem" }}>
        {modo === "SO_ACRESCIMO" ? (
          <>
            <Linha rotulo={`Pedido do marketplace (já pago lá)`} valor={fmt(totalAtual)} />
            <Linha rotulo="Acréscimo a cobrar do cliente" valor={fmt(totalPrevisto)} destaque />
          </>
        ) : (
          <>
            {taxa > 0 && <Linha rotulo="Taxa de entrega (mantida)" valor={fmt(taxa)} />}
            {desconto > 0 && <Linha rotulo="Desconto do pedido (mantido)" valor={`− ${fmt(desconto)}`} />}
            <Linha rotulo="Total hoje" valor={fmt(totalAtual)} />
            <Linha
              rotulo={!sobrouAlgum && acrescimos.length === 0 ? "Pedido será CANCELADO" : "Novo total"}
              valor={!sobrouAlgum && acrescimos.length === 0 ? "—" : fmt(totalPrevisto)}
              destaque
            />
          </>
        )}
      </div>

      {erro && (
        <div style={{ marginTop: "10px", background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: "8px", padding: "8px 10px", fontSize: "0.82rem" }}>
          {erro}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
        <button type="button" onClick={aoFechar} disabled={salvando} style={{ ...botaoSecundario, flex: 1, marginBottom: 0 }}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !mudouAlgo}
          style={{
            flex: 2,
            padding: "10px",
            borderRadius: "10px",
            border: "none",
            background: !mudouAlgo ? "#CBD5E1" : "#C62828",
            color: "#FFF",
            fontWeight: 800,
            fontSize: "0.88rem",
            cursor: !mudouAlgo || salvando ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {salvando ? "Salvando..." : "Salvar e reimprimir comanda"}
        </button>
      </div>

      <div style={{ marginTop: "8px", fontSize: "0.73rem", color: "#64748B", textAlign: "center", lineHeight: 1.4 }}>
        A comanda sai de novo marcada como 2ª via, para a cozinha descartar a anterior.
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "10px",
        padding: destaque ? "6px 0 0" : "2px 0",
        marginTop: destaque ? "4px" : 0,
        borderTop: destaque ? "1px dashed #CBD5E1" : "none",
      }}
    >
      <span style={{ color: destaque ? "#1E293B" : "#64748B", fontWeight: destaque ? 800 : 500 }}>{rotulo}</span>
      <span style={{ color: destaque ? "#C62828" : "#475569", fontWeight: destaque ? 900 : 600, whiteSpace: "nowrap" }}>{valor}</span>
    </div>
  );
}

const botaoQtd: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "6px",
  border: "1px solid #CBD5E1",
  background: "#FFF",
  color: "#1E293B",
  fontWeight: 800,
  fontSize: "1rem",
  cursor: "pointer",
  lineHeight: 1,
  fontFamily: "inherit",
};

const botaoSecundario: React.CSSProperties = {
  width: "100%",
  padding: "9px",
  borderRadius: "10px",
  border: "1px dashed #CBD5E1",
  background: "#FFF",
  color: "#475569",
  fontWeight: 700,
  fontSize: "0.84rem",
  cursor: "pointer",
  fontFamily: "inherit",
  marginBottom: "10px",
};
