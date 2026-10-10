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
 *   • Pedido de marketplace TAMBÉM tira item (o cliente liga na loja, não no
 *     app) — o que ele ganha é um aviso do que acontece com o dinheiro: pago
 *     no parceiro, o total fica em pé de propósito; pago na entrega, o total
 *     cai e é o novo valor que o entregador cobra. O acréscimo lá continua
 *     virando um pedido colado, com forma de pagamento própria.
 *   • Dá para dar DESCONTO na mesma edição (% ou R$, com motivo — o mesmo do
 *     balcão), desde que o cliente ainda vá pagar: pago online ou no parceiro,
 *     o botão diz por que não (`descontoNaEdicao`).
 *
 * Quem decide o que pode é lib/edicao-de-pedido.ts — a MESMA função que a API
 * consulta. Esta tela não tem régua própria de status nem de canal: se ela
 * decidisse sozinha, existiria botão que o servidor recusa.
 */

import { useState, useMemo, useEffect } from "react";
import { avaliarEdicao, contaDoDescontoDaEdicao, descontoNaEdicao, type ModoDeEdicao } from "@/lib/edicao-de-pedido";
import { MOTIVOS_COMUNS, type DescontoManual, type TipoDeDesconto } from "@/lib/desconto-manual";
import { precoMinimoDoProduto, precoVariaPorEscolha } from "@/lib/preco-combo";
import ComboModal from "@/components/customer/ComboModal";
import MotivoDoCancelamento from "@/components/MotivoDoCancelamento";
import { motivoValido } from "@/lib/motivo-do-cancelamento";

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
  description?: string | null;
  imageUrl?: string | null;
  /** As perguntas (sabor, tamanho, borda). Produto com elas abre a mesma janela do cardápio. */
  comboGroups?: any[];
};

/** Um acréscimo do rascunho. `precoUnitario` já tem as escolhas; o servidor recalcula do zero. */
type AcrescimoDoRascunho = {
  produto: ProdutoDoCardapio;
  quantity: number;
  precoUnitario: number;
  comboSelections?: Record<string, Record<string, number>>;
  notes?: string;
};

/** "Calabresa, Frango c/ Requeijão" — as escolhas como a comanda vai imprimir. */
function resumoDasEscolhas(sel?: Record<string, Record<string, number>>): string {
  if (!sel) return "";
  return Object.values(sel)
    .flatMap((g) => Object.entries(g || {}).filter(([, q]) => Number(q) > 0).map(([nome, q]) => (Number(q) > 1 ? `${nome} x${q}` : nome)))
    .join(", ");
}

/** Categorias de espelho de integração: não se vende pelo balcão (mesma lista da mesa). */
const CATEGORIAS_ESCONDIDAS = new Set(["IFOOD", "JOTAJA", "JOTAJÁ", "99FOOD", "ONLINE", "OCULTO"]);

const FORMAS_DE_PAGAMENTO = ["Dinheiro", "Pix", "Débito", "Crédito"];

const fmt = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

/** "5,90", "R$ 10", "15%" → número. Texto, não type="number": o Chrome pt-BR lê "1.200,00" como 1,2. */
function lerValor(texto: string): number {
  let t = String(texto || "").replace(/r\$|%/gi, "").replace(/\s+/g, "");
  if (!t) return 0;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

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
  aoSalvar: (resultado: { cancelado?: boolean; acrescimo?: any; totalAmount?: number; soDesconto?: boolean; desconto?: number }) => void;
}) {
  const avaliacao = useMemo(() => avaliarEdicao(pedido, operador), [pedido, operador]);
  const modo: ModoDeEdicao = avaliacao.modo;
  /** Marketplace e pedido próprio editam itens do mesmo jeito. O que muda é o dinheiro. */
  const ehMarketplace = modo === "MARKETPLACE";
  /** No marketplace pago na plataforma o total NÃO acompanha o item que saiu. */
  const totalAcompanha = avaliacao.totalMuda !== false;

  // Rascunho: quantidade por item e o que foi marcado para remover. Nada disso
  // toca o servidor antes do Salvar.
  const [quantidades, setQuantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries((pedido.items || []).map((i: ItemDoPedido) => [i.id, i.quantity]))
  );
  const [removidos, setRemovidos] = useState<Set<string>>(new Set());
  const [acrescimos, setAcrescimos] = useState<AcrescimoDoRascunho[]>([]);
  // Produto com perguntas esperando a escolha dos sabores/opções.
  const [produtoComOpcoes, setProdutoComOpcoes] = useState<ProdutoDoCardapio | null>(null);
  const [pagamento, setPagamento] = useState("Dinheiro");

  const [cardapio, setCardapio] = useState<ProdutoDoCardapio[]>([]);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [abrindoBusca, setAbrindoBusca] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  // ── AJUSTAR O DESCONTO QUE O PEDIDO JÁ TEM ─────────────────────────────
  // "Dar desconto" só soma; quem deu a mais não voltava (Divinos, 09/10/2026).
  // Aqui o desconto TOTAL vira o valor digitado, até zero (rota /desconto).
  const [ajusteAberto, setAjusteAberto] = useState(false);
  const [ajusteTexto, setAjusteTexto] = useState("");
  const [ajustando, setAjustando] = useState(false);
  const ajustarDesconto = async () => {
    setAjustando(true);
    setErro("");
    try {
      const res = await fetch(`/api/store/orders/${encodeURIComponent(pedido.id)}/desconto`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novo: Number(String(ajusteTexto).replace(",", ".").trim() || "0") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não consegui ajustar o desconto."); return; }
      setAjusteAberto(false);
      aoSalvar({ soDesconto: true, totalAmount: data.totalAmount, desconto: data.discountTotal });
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setAjustando(false);
    }
  };
  // Tirar item ou diminuir quantidade pede o motivo (lib/motivo-do-cancelamento.ts):
  // é o que o dono lê no fechamento do caixa.
  const [motivo, setMotivo] = useState("");

  // Desconto da edição. Fechado por padrão: a maioria das edições é só item.
  const [descontoAberto, setDescontoAberto] = useState(false);
  const [tipoDoDesconto, setTipoDoDesconto] = useState<TipoDeDesconto>("percent");
  const [valorDoDescontoTexto, setValorDoDescontoTexto] = useState("");
  const [motivoDoDesconto, setMotivoDoDesconto] = useState("");
  const podeDesconto = useMemo(() => descontoNaEdicao(pedido, avaliacao), [pedido, avaliacao]);

  // O canal de preço DESTE pedido. Precisa ir na busca do cardápio: sem
  // `?canal=`, /api/admin/menu-products devolve o `price` cru, e nas lojas que
  // cobram diferente no delivery a tela mostraria R$ 8,00 enquanto o servidor
  // grava R$ 9,00 — que é a mesma régua (lib/preco-por-canal.ts) vista do outro
  // lado. O atendente leria um total na tela e o pedido fecharia noutro.
  const canalDePreco = String(pedido?.deliveryType || "").toUpperCase() === "DELIVERY" ? "delivery" : "salao";

  // O cardápio só é buscado quando o atendente abre a caixa de acrescentar:
  // é uma lista grande e a maioria das edições é só tirar item.
  useEffect(() => {
    if (!abrindoBusca || cardapio.length > 0) return;
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/menu-products?canal=${canalDePreco}`);
        const data = await res.json().catch(() => []);
        if (!vivo) return;
        // O mesmo recorte da mesa: sem sabor/adicional solto (o servidor marca
        // `apenasOpcaoDeCombo`), sem inativo e sem espelho de integração. Os
        // sabores apareciam como item de R$ 0,00 no meio da busca.
        const lista = (Array.isArray(data) ? data : data?.products || [])
          .filter((p: any) => p?.id && p?.name)
          .filter((p: any) => p.active !== false && p.apenasOpcaoDeCombo !== true)
          .filter((p: any) => !CATEGORIAS_ESCONDIDAS.has(String(p.category || "").toUpperCase().trim()))
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price) || 0,
            category: p.category,
            description: p.description ?? null,
            imageUrl: p.imageUrl ?? null,
            comboGroups: Array.isArray(p.comboGroups) ? p.comboGroups : [],
          }));
        setCardapio(lista);
      } catch {
        if (vivo) setErro("Não consegui carregar o cardápio. Tente de novo.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [abrindoBusca, cardapio.length, canalDePreco]);

  const itensOriginais: ItemDoPedido[] = pedido.items || [];
  const taxa = Number(pedido.deliveryFee) || 0;
  const desconto = Number(pedido.discountTotal) || 0;

  // A conta do desconto novo é a do servidor (contaDoDescontoDaEdicao), sobre
  // os itens que FICAM no pedido. No marketplace o acréscimo vira pedido
  // colado, então não entra na base.
  const valorDigitado = lerValor(valorDoDescontoTexto);
  const descontoNovo: DescontoManual | null =
    descontoAberto && podeDesconto.pode && valorDoDescontoTexto.trim()
      ? { tipo: tipoDoDesconto, valor: Number.isFinite(valorDigitado) ? valorDigitado : 0, motivo: motivoDoDesconto.trim() }
      : null;
  const contaDoDesconto = useMemo(() => {
    if (!descontoNovo) return null;
    const ficam = itensOriginais
      .filter((i) => !removidos.has(i.id))
      .map((i) => ({ price: i.price, quantity: quantidades[i.id] ?? i.quantity }));
    const novos = modo === "MARKETPLACE" ? [] : acrescimos.map((a) => ({ price: a.precoUnitario, quantity: a.quantity }));
    return contaDoDescontoDaEdicao({ itens: [...ficam, ...novos], discountTotal: desconto, deliveryFee: taxa, desconto: descontoNovo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descontoNovo?.tipo, descontoNovo?.valor, descontoNovo?.motivo, itensOriginais, removidos, quantidades, acrescimos, desconto, taxa, modo]);
  const descontoValido = !!contaDoDesconto && !contaDoDesconto.problema && contaDoDesconto.valor > 0;

  // O mesmo `itens - desconto + taxa` do servidor. Repetido aqui de propósito e
  // só para PREVER o número na tela; quem grava é a API, que recalcula do zero.
  const totalPrevisto = useMemo(() => {
    const somaOriginais = itensOriginais
      .filter((i) => !removidos.has(i.id))
      .reduce((s, i) => s + i.price * (quantidades[i.id] ?? i.quantity), 0);
    const somaNovos = acrescimos.reduce((s, a) => s + a.precoUnitario * a.quantity, 0);
    if (modo === "MARKETPLACE") {
      // O acréscimo do marketplace nunca entra no pedido do parceiro: ele vira
      // pedido colado, e é esse valor que o cliente paga por fora.
      return Math.round(somaNovos * 100) / 100;
    }
    if (descontoValido) return contaDoDesconto!.total;
    return Math.round(Math.max(0, somaOriginais + somaNovos - desconto + taxa) * 100) / 100;
  }, [itensOriginais, removidos, quantidades, acrescimos, desconto, taxa, modo, descontoValido, contaDoDesconto]);

  /** O total do PEDIDO depois de tirar item — só existe quando ele acompanha. */
  const totalDoPedidoPrevisto = useMemo(() => {
    const soma = itensOriginais
      .filter((i) => !removidos.has(i.id))
      .reduce((s, i) => s + i.price * (quantidades[i.id] ?? i.quantity), 0);
    if (descontoValido) return contaDoDesconto!.total;
    return Math.round(Math.max(0, soma - desconto + taxa) * 100) / 100;
  }, [itensOriginais, removidos, quantidades, desconto, taxa, descontoValido, contaDoDesconto]);

  const totalAtual = Number(pedido.totalAmount) || 0;
  const sobrouAlgum = itensOriginais.some((i) => !removidos.has(i.id));
  const mexeuNosOriginais =
    removidos.size > 0 ||
    itensOriginais.some((i) => (quantidades[i.id] ?? i.quantity) !== i.quantity);
  /** A edição TIRA alguma coisa (item ou quantidade)? Então pede motivo. */
  const tiraAlgo =
    removidos.size > 0 ||
    itensOriginais.some((i) => !removidos.has(i.id) && (quantidades[i.id] ?? i.quantity) < i.quantity);
  const faltaMotivo = tiraAlgo && !motivoValido(motivo);
  const mudouOsItens = acrescimos.length > 0 || mexeuNosOriginais;
  const mudouAlgo = mudouOsItens || descontoValido;
  /** Só o desconto: a cozinha não tem o que refazer, a comanda não sai de novo. */
  const soDesconto = descontoValido && !mudouOsItens;

  if (modo === "BLOQUEADO") {
    return (
      <div style={{ padding: "18px", textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🔒</div>
        <div style={{ fontWeight: 700, color: "#B71C1C", fontSize: "0.95rem", marginBottom: "6px" }}>
          Este pedido não pode ser editado
        </div>
        <div style={{ color: "#475569", fontSize: "0.86rem", lineHeight: 1.5 }}>{avaliacao.motivo}</div>
        <button onClick={aoFechar} style={botaoSecundario}>Fechar</button>
      </div>
    );
  }

  async function salvar() {
    if (salvando) return;
    // Desconto digitado com problema ("maior que o pedido"): não salva o resto
    // calado — o atendente acharia que deu o desconto.
    if (descontoNovo && contaDoDesconto?.problema) {
      setErro(contaDoDesconto.problema);
      return;
    }
    if (!mudouAlgo) return;
    if (faltaMotivo) {
      setErro("Escreva o motivo de tirar o item (pelo menos 3 letras). Ele aparece no fechamento do caixa.");
      return;
    }

    // Tirar tudo = cancelar. Vale um aviso separado, porque a consequência é
    // outra: o pedido sai do painel e o estoque volta.
    if (modo === "COMPLETO" && !sobrouAlgum && acrescimos.length === 0) {
      const ok = confirm(
        "Você tirou todos os itens.\n\nIsso CANCELA o pedido inteiro e devolve o estoque. Confirma?"
      );
      if (!ok) return;
    }

    // No marketplace tirar tudo NÃO cancela: cancelar pedido de parceiro é pelo
    // botão que avisa o parceiro. O servidor recusa; a tela diz antes, para o
    // atendente não descobrir isso com o cliente no telefone.
    if (ehMarketplace && !sobrouAlgum) {
      setErro(
        `Para cancelar o pedido inteiro, use o botão Cancelar do painel — é ele que avisa o ${avaliacao.canal || "parceiro"}.`
      );
      return;
    }

    // Tirar item de pedido JÁ PAGO na plataforma não devolve dinheiro a
    // ninguém. Confirmar aqui é o que separa "o atendente entendeu" de "o
    // atendente prometeu estorno ao cliente no telefone".
    if (ehMarketplace && !totalAcompanha && mexeuNosOriginais) {
      const ok = confirm(`${avaliacao.avisoDoDinheiro}\n\nConfirma a alteração?`);
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
          ...(a.comboSelections ? { comboSelections: a.comboSelections } : {}),
          ...(a.notes ? { notes: a.notes } : {}),
        }));
        if (ehMarketplace) corpo.pagamento = pagamento;
      }
      // Tirar item e mudar quantidade valem nos dois modos. No marketplace o
      // servidor grava os itens e decide sozinho se o total acompanha.
      corpo.removerItemIds = Array.from(removidos);
      corpo.itens = itensOriginais
        .filter((i) => !removidos.has(i.id) && (quantidades[i.id] ?? i.quantity) !== i.quantity)
        .map((i) => ({ itemId: i.id, quantity: quantidades[i.id] }));
      // O servidor recalcula o desconto do zero: vai o pedido (tipo, valor,
      // motivo), nunca os reais prontos.
      if (descontoValido && descontoNovo) corpo.desconto = descontoNovo;
      if (tiraAlgo) corpo.motivo = motivo.trim();

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
      {/* O recado do marketplace vem ANTES de tudo: o atendente está com o
          cliente no telefone e precisa saber, antes de mexer, o que acontece
          com o dinheiro — porque a resposta não é a intuitiva. */}
      {ehMarketplace && (
        <div
          style={{
            background: totalAcompanha ? "#FFF7E6" : "#FEF2F2",
            border: `1px solid ${totalAcompanha ? "#FDE68A" : "#FECACA"}`,
            borderRadius: "10px",
            padding: "10px 12px",
            fontSize: "0.82rem",
            color: totalAcompanha ? "#92400E" : "#B71C1C",
            lineHeight: 1.5,
            marginBottom: "12px",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: "4px" }}>{avaliacao.motivo}</div>
          <div>{avaliacao.avisoDoDinheiro}</div>
        </div>
      )}

      {/* ── Itens do pedido ───────────────────────────────────────────── */}
      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: "6px" }}>
        {ehMarketplace ? `Itens do pedido (só aqui — o ${avaliacao.canal || "parceiro"} não muda)` : "Itens do pedido"}
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

              {!fora && (
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
                    background: fora ? "#F0FDFA" : "#FEE2E2",
                    color: fora ? "#0F766E" : "#B71C1C",
                    borderRadius: "6px",
                    width: 30,
                    height: 30,
                    cursor: "pointer",
                    fontSize: "0.9rem",
                  }}
                >
                  {fora ? "↩" : "🗑️"}
              </button>
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
                border: "1px solid #99F6E4",
                background: "#F0FDFA",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.86rem", color: "#134E4A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.produto.name}
                </div>
                {a.comboSelections && (
                  <div style={{ fontSize: "0.75rem", color: "#134E4A", fontWeight: 600, lineHeight: 1.35 }}>↳ {resumoDasEscolhas(a.comboSelections)}</div>
                )}
                {a.notes && <div style={{ fontSize: "0.74rem", color: "#B45309", fontWeight: 600 }}>📝 {a.notes}</div>}
                <div style={{ fontSize: "0.75rem", color: "#0F766E" }}>{fmt(a.precoUnitario)} cada</div>
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
                style={{ border: "none", background: "#FEE2E2", color: "#B71C1C", borderRadius: "6px", width: 30, height: 30, cursor: "pointer" }}
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
                  // Pizza, combo, lanche com ponto: a mesma janela do cardápio,
                  // que pergunta sabor e opções e já cobra pela regra. Entrava
                  // direto pelo preço base — R$ 0,00 na pizza da Divinos.
                  if ((p.comboGroups || []).length > 0) {
                    setProdutoComOpcoes(p);
                    return;
                  }
                  setAcrescimos((lista) => {
                    const ja = lista.findIndex((x) => x.produto.id === p.id && !x.comboSelections && !x.notes);
                    if (ja >= 0) return lista.map((x, i) => (i === ja ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x));
                    return [...lista, { produto: p, quantity: 1, precoUnitario: p.price }];
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
                {/* O preço do cardápio: "a partir de" quando depende da escolha. */}
                <span style={{ fontWeight: 700, color: "#0F766E", whiteSpace: "nowrap" }}>
                  {precoVariaPorEscolha(p as any) ? `a partir de ${fmt(precoMinimoDoProduto(p as any))}` : fmt(precoMinimoDoProduto(p as any))}
                </span>
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
      {ehMarketplace && acrescimos.length > 0 && (
        <div style={{ marginTop: "12px", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: "10px", padding: "10px 12px" }}>
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

      {/* ── Desconto ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: "12px" }}>
        {!podeDesconto.pode ? (
          <div style={{ fontSize: "0.78rem", color: "#64748B", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "8px 10px", lineHeight: 1.4 }}>
            🏷️ <strong style={{ color: "#475569" }}>Sem desconto aqui:</strong> {podeDesconto.motivo}
          </div>
        ) : !descontoAberto ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <button type="button" onClick={() => setDescontoAberto(true)} style={{ ...botaoSecundario, marginBottom: 0 }}>
              🏷️ Dar desconto
            </button>
            {desconto > 0 && (!ajusteAberto ? (
              <button
                type="button"
                onClick={() => { setAjusteAberto(true); setAjusteTexto(desconto.toFixed(2).replace(".", ",")); }}
                style={{ ...botaoSecundario, marginBottom: 0 }}
              >
                ✏️ Ajustar o desconto do pedido ({fmt(desconto)}) — diminuir ou tirar
              </button>
            ) : (
              <div style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: "10px", padding: "10px 12px" }}>
                <div style={{ fontWeight: 800, fontSize: "0.84rem", color: "#92400E", marginBottom: "6px" }}>✏️ Desconto total do pedido</div>
                <div style={{ fontSize: "0.76rem", color: "#78350F", marginBottom: "8px" }}>
                  Hoje: {fmt(desconto)}. Digite quanto deve ficar (0 tira o desconto). O total muda junto e fica no histórico do pedido.
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: "#92400E" }}>R$</span>
                  <input
                    value={ajusteTexto}
                    onChange={(e) => setAjusteTexto(e.target.value)}
                    inputMode="decimal"
                    style={{ width: 110, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #FCD34D", fontSize: "0.9rem", fontFamily: "inherit" }}
                  />
                  <button
                    type="button"
                    disabled={ajustando}
                    onClick={() => void ajustarDesconto()}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: "#B45309", color: "#fff", fontWeight: 800, fontSize: "0.8rem", cursor: ajustando ? "wait" : "pointer", fontFamily: "inherit" }}
                  >
                    {ajustando ? "Salvando…" : "Salvar desconto"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAjusteAberto(false)}
                    style={{ border: "none", background: "none", color: "#92400E", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontWeight: 800, fontSize: "0.84rem", color: "#92400E" }}>🏷️ Desconto</span>
              <button
                type="button"
                onClick={() => { setDescontoAberto(false); setValorDoDescontoTexto(""); setMotivoDoDesconto(""); setErro(""); }}
                style={{ border: "none", background: "none", color: "#92400E", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}
              >
                Sem desconto
              </button>
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
              <div style={{ display: "inline-flex", background: "#FEF3C7", borderRadius: "8px", padding: "2px" }}>
                {(["percent", "valor"] as TipoDeDesconto[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipoDoDesconto(t)}
                    aria-pressed={tipoDoDesconto === t}
                    style={{
                      border: "none",
                      borderRadius: "6px",
                      padding: "6px 12px",
                      fontWeight: 800,
                      fontSize: "0.84rem",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      background: tipoDoDesconto === t ? "#FFF" : "transparent",
                      color: "#92400E",
                      boxShadow: tipoDoDesconto === t ? "0 1px 2px rgba(146,64,14,.2)" : "none",
                    }}
                  >
                    {t === "percent" ? "%" : "R$"}
                  </button>
                ))}
              </div>
              <input
                autoFocus
                inputMode="decimal"
                value={valorDoDescontoTexto}
                onChange={(e) => { setValorDoDescontoTexto(e.target.value); setErro(""); }}
                placeholder={tipoDoDesconto === "percent" ? "Ex.: 10" : "Ex.: 5,00"}
                aria-label={tipoDoDesconto === "percent" ? "Desconto em porcentagem" : "Desconto em reais"}
                style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: "8px", border: "1px solid #FCD34D", fontSize: "0.9rem", fontWeight: 700, fontFamily: "inherit", background: "#FFF" }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>
              {MOTIVOS_COMUNS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotivoDoDesconto((atual) => (atual === m ? "" : m))}
                  style={{
                    padding: "4px 9px",
                    borderRadius: "999px",
                    border: `1px solid ${motivoDoDesconto === m ? "#B45309" : "#FDE68A"}`,
                    background: motivoDoDesconto === m ? "#FDE68A" : "#FFF",
                    color: "#92400E",
                    fontWeight: 700,
                    fontSize: "0.74rem",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              value={motivoDoDesconto}
              onChange={(e) => setMotivoDoDesconto(e.target.value.slice(0, 60))}
              placeholder="Motivo (sai na comanda e no relatório)"
              style={{ width: "100%", marginTop: "6px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #FDE68A", fontSize: "0.8rem", fontFamily: "inherit", background: "#FFF", boxSizing: "border-box" }}
            />
            {contaDoDesconto && (
              <div style={{ marginTop: "8px", fontSize: "0.8rem", color: contaDoDesconto.problema ? "#B71C1C" : "#92400E", fontWeight: 700 }}>
                {contaDoDesconto.problema
                  ? contaDoDesconto.problema
                  : `− ${fmt(contaDoDesconto.valor)} sobre ${fmt(contaDoDesconto.base)} de itens${taxa > 0 ? " (a taxa de entrega fica fora)" : ""}`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── A conta, na cara ──────────────────────────────────────────── */}
      <div style={{ marginTop: "14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px 12px", fontSize: "0.84rem" }}>
        {ehMarketplace ? (
          <>
            {/* A conta do marketplace tem DUAS linhas de total por um motivo:
                o que o parceiro vai depositar e o que entra no caixa por fora
                nunca se misturam. Quando o cliente paga na entrega, o primeiro
                número muda junto com os itens; quando já pagou lá, não muda —
                e a tela diz isso na própria linha, não numa nota de rodapé. */}
            <Linha
              rotulo={totalAcompanha ? `Total do pedido (cobrar na entrega)` : `Pedido do ${avaliacao.canal || "parceiro"} (já pago lá)`}
              valor={fmt(totalAtual)}
            />
            {descontoValido && (
              <Linha rotulo={`Desconto novo${motivoDoDesconto.trim() ? ` (${motivoDoDesconto.trim()})` : ""}`} valor={`− ${fmt(contaDoDesconto!.valor)}`} />
            )}
            {totalAcompanha && (mexeuNosOriginais || descontoValido) && (
              <Linha rotulo="Novo total a cobrar" valor={fmt(totalDoPedidoPrevisto)} destaque />
            )}
            {!totalAcompanha && mexeuNosOriginais && (
              <Linha rotulo="Total depois da alteração" valor={`${fmt(totalAtual)} (não muda)`} />
            )}
            {acrescimos.length > 0 && (
              <Linha rotulo="Acréscimo a cobrar do cliente" valor={fmt(totalPrevisto)} destaque />
            )}
          </>
        ) : (
          <>
            {taxa > 0 && <Linha rotulo="Taxa de entrega (mantida)" valor={fmt(taxa)} />}
            {desconto > 0 && <Linha rotulo="Desconto do pedido (mantido)" valor={`− ${fmt(desconto)}`} />}
            {descontoValido && (
              <Linha rotulo={`Desconto novo${motivoDoDesconto.trim() ? ` (${motivoDoDesconto.trim()})` : ""}`} valor={`− ${fmt(contaDoDesconto!.valor)}`} />
            )}
            <Linha rotulo="Total hoje" valor={fmt(totalAtual)} />
            <Linha
              rotulo={!sobrouAlgum && acrescimos.length === 0 ? "Pedido será CANCELADO" : "Novo total"}
              valor={!sobrouAlgum && acrescimos.length === 0 ? "—" : fmt(totalPrevisto)}
              destaque
            />
          </>
        )}
      </div>

      {tiraAlgo && (
        <div style={{ marginTop: "12px" }}>
          <MotivoDoCancelamento
            valor={motivo}
            aoMudar={setMotivo}
            rotulo={!sobrouAlgum && acrescimos.length === 0 ? "Motivo do cancelamento do pedido" : "Motivo de tirar o item"}
          />
        </div>
      )}

      {erro && (
        <div style={{ marginTop: "10px", background: "#FEF2F2", border: "1px solid #FECACA", color: "#B71C1C", borderRadius: "8px", padding: "8px 10px", fontSize: "0.82rem" }}>
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
          disabled={salvando || !mudouAlgo || faltaMotivo}
          style={{
            flex: 2,
            padding: "10px",
            borderRadius: "10px",
            border: "none",
            background: !mudouAlgo || faltaMotivo ? "#CBD5E1" : "#C92E09",
            color: "#FFF",
            fontWeight: 800,
            fontSize: "0.88rem",
            cursor: !mudouAlgo || faltaMotivo || salvando ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {salvando ? "Salvando..." : soDesconto ? "Salvar desconto" : "Salvar e reimprimir comanda"}
        </button>
      </div>

      <div style={{ marginTop: "8px", fontSize: "0.73rem", color: "#64748B", textAlign: "center", lineHeight: 1.4 }}>
        {soDesconto
          ? "Só o desconto: a cozinha não muda, então a comanda não sai de novo. Reimprima pela aba Comanda se o entregador precisar do valor novo."
          : "A comanda sai de novo marcada como 2ª via, para a cozinha descartar a anterior."}
      </div>

      {/* A mesma janela do cardápio e da mesa: pergunta os sabores, aplica a
          regra da pizza (média, a mais cara) e devolve o preço com as
          escolhas. Fica dentro do modal do pedido de propósito — em portal ela
          cairia atrás dele, que está numa camada acima. */}
      {produtoComOpcoes && (
        <ComboModal
          product={{
            id: produtoComOpcoes.id,
            name: produtoComOpcoes.name,
            description: produtoComOpcoes.description ?? null,
            price: produtoComOpcoes.price,
            imageUrl: produtoComOpcoes.imageUrl ?? null,
            comboGroups: (produtoComOpcoes.comboGroups || []) as any,
            isCombo: (produtoComOpcoes as any).isCombo,
          }}
          onClose={() => setProdutoComOpcoes(null)}
          onConfirm={(selections, extraSum, qty, notes) => {
            const p = produtoComOpcoes;
            const escolhas: Record<string, Record<string, number>> = {};
            for (const [grupo, itens] of Object.entries((selections || {}) as Record<string, Record<string, number>>)) {
              for (const [nome, q] of Object.entries(itens || {})) {
                if (Number(q) > 0) (escolhas[grupo] ||= {})[nome] = Number(q);
              }
            }
            setAcrescimos((lista) => [
              ...lista,
              {
                produto: p,
                quantity: Math.max(1, Math.min(99, Number(qty) || 1)),
                precoUnitario: Math.round(((Number(p.price) || 0) + (Number(extraSum) || 0)) * 100) / 100,
                comboSelections: Object.keys(escolhas).length > 0 ? escolhas : undefined,
                notes: notes && notes.trim() ? notes.trim() : undefined,
              },
            ]);
            setProdutoComOpcoes(null);
            setBuscaProduto("");
            setAbrindoBusca(false);
          }}
        />
      )}
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
      <span style={{ color: destaque ? "#C92E09" : "#475569", fontWeight: destaque ? 900 : 600, whiteSpace: "nowrap" }}>{valor}</span>
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
