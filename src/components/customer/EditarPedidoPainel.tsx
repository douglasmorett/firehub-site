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
 *   • Item com pergunta (sabor, borda, adicional, refri do combo) ganha
 *     "Editar escolhas": a MESMA janela do cardápio (ComboModal), aberta com o
 *     que estava marcado, e o item é trocado pelo remontado — sem motivo,
 *     porque não é tirar item (lib/escolhas-na-edicao.ts). A busca também
 *     acha pelo nome do adicional. Lapastine, 17/10/2026: o adicional não
 *     aparecia na busca, e o desvio (pizza nova + baixar a antiga) travava
 *     no motivo com o botão cinza; o lojista refez o pedido e duplicou.
 *   • Rodada de MESA aberta (lápis do card de mesa, 09/10/2026): tira item e
 *     muda quantidade, pela regra da tela de Mesas (lib/edicao-na-mesa.ts) —
 *     a conta da mesa soma as rodadas e acompanha. Sem "Acrescentar" (item
 *     novo é rodada nova, lançada na mesa) e sem desconto (o da mesa é da
 *     conta, no fechamento).
 *
 * Quem decide o que pode é lib/edicao-de-pedido.ts — a MESMA função que a API
 * consulta. Esta tela não tem régua própria de status nem de canal: se ela
 * decidisse sozinha, existiria botão que o servidor recusa.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { avaliarEdicaoNoPainel, contaDoDescontoDaEdicao, descontoNaEdicao, type ModoDeEdicao } from "@/lib/edicao-de-pedido";
import { valorDoAcrescimoGravado } from "@/lib/acrescimo-no-credito";
import { MOTIVOS_COMUNS, type DescontoManual, type TipoDeDesconto } from "@/lib/desconto-manual";
import { precoMinimoDoProduto, precoVariaPorEscolha, precoUnitarioDoItem, pisoDoPreco } from "@/lib/preco-combo";
import { escolhasParaReabrir, escolhasEmTexto, opcaoQueCasa, normalizarBusca } from "@/lib/escolhas-na-edicao";
import ComboModal from "@/components/customer/ComboModal";
import MotivoDoCancelamento from "@/components/MotivoDoCancelamento";
import { motivoValido } from "@/lib/motivo-do-cancelamento";

type ItemDoPedido = {
  id: string;
  productName?: string | null;
  quantity: number;
  price: number;
  notes?: string | null;
  menuProductId?: string | null;
  menuProduct?: { id?: string | null } | null;
  comboSelections?: unknown;
};

/**
 * Item do pedido REMONTADO no rascunho ("Editar escolhas"): as escolhas novas
 * e quantas unidades as ganham. Menos que a quantidade do item = as outras
 * ficam como estavam (o servidor separa em duas linhas).
 */
type TrocaDoRascunho = {
  quantity: number;
  precoUnitario: number;
  comboSelections?: Record<string, Record<string, number>>;
  notes?: string;
};

const idDoProduto = (i: ItemDoPedido) => i.menuProductId || i.menuProduct?.id || null;

/** O preço do item com as escolhas — a mesma conta do servidor (precoUnitarioDoItem + piso). */
function precoComEscolhas(p: { price: number; comboGroups?: any[] }, escolhas: Record<string, Record<string, number>> | undefined): number {
  const produto = { price: Number(p.price) || 0, comboGroups: (p.comboGroups || []) as any };
  return Math.round(Math.max(precoUnitarioDoItem(produto, escolhas || null), pisoDoPreco(produto)) * 100) / 100;
}

/** O que o ComboModal devolve, sem as opções zeradas. */
function limparEscolhas(selections: unknown): Record<string, Record<string, number>> | undefined {
  const escolhas: Record<string, Record<string, number>> = {};
  for (const [grupo, itens] of Object.entries((selections || {}) as Record<string, Record<string, number>>)) {
    for (const [nome, q] of Object.entries(itens || {})) {
      if (Number(q) > 0) (escolhas[grupo] ||= {})[nome] = Number(q);
    }
  }
  return Object.keys(escolhas).length > 0 ? escolhas : undefined;
}

type ProdutoDoCardapio = {
  id: string;
  name: string;
  price: number;
  category?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  /** As perguntas (sabor, tamanho, borda). Produto com elas abre a mesma janela do cardápio. */
  comboGroups?: any[];
  isCombo?: boolean | null;
  _ativo?: boolean;
  _soOpcao?: boolean;
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

/**
 * O cardápio da edição, guardado por loja e canal enquanto o painel está
 * aberto no navegador.
 *
 * Hakim Centro, 17/10/2026, sábado à noite: "Carregando cardápio..." por
 * vários segundos a cada edição — 448 KB com os combos, 1,5 a 3 s no pico.
 * A busca só começava quando o atendente abria a caixa e já digitava. Agora
 * começa ao abrir a aba, e a segunda edição em seguida usa a mesma lista.
 * Item que esgotou nesse meio-tempo o servidor recusa ao gravar, como já
 * fazia.
 */
const CARDAPIO_VALE_MS = 3 * 60_000;
const cardapioGuardado = new Map<string, { em: number; lista: Promise<ProdutoDoCardapio[]> }>();

function buscarCardapio(loja: string, canal: string): Promise<ProdutoDoCardapio[]> {
  const chave = `${loja}|${canal}`;
  const guardado = cardapioGuardado.get(chave);
  if (guardado && Date.now() - guardado.em < CARDAPIO_VALE_MS) return guardado.lista;
  const lista = (async () => {
    // `storeId`: a loja DO PEDIDO. O suporte (ADMIN) com "Todas as lojas"
    // recebia sem ele o cardápio da rede inteira. Para a loja, o servidor
    // ignora o parâmetro e usa a sessão.
    const res = await fetch(`/api/admin/menu-products?canal=${canal}${loja ? `&storeId=${encodeURIComponent(loja)}` : ""}`);
    // Resposta de erro ({ error }) virava lista vazia, e a tela ficava em
    // "Carregando cardápio..." para sempre.
    if (!res.ok) throw new Error(`cardápio respondeu ${res.status}`);
    const data = await res.json();
    // A lista INTEIRA, com inativo e opção solta marcados: o "Editar escolhas"
    // reabre item que tem pergunta pelo produto, mesmo o que não se vende solto.
    // O recorte da busca (sem opção solta, sem inativo, sem espelho) é da tela.
    return (Array.isArray(data) ? data : data?.products || [])
      .filter((p: any) => p?.id && p?.name)
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        category: p.category,
        description: p.description ?? null,
        imageUrl: p.imageUrl ?? null,
        comboGroups: Array.isArray(p.comboGroups) ? p.comboGroups : [],
        isCombo: p.isCombo,
        _ativo: p.active !== false,
        _soOpcao: p.apenasOpcaoDeCombo === true,
      }));
  })();
  cardapioGuardado.set(chave, { em: Date.now(), lista });
  // Falha não fica guardada: o "Tentar de novo" pergunta outra vez.
  lista.catch(() => {
    if (cardapioGuardado.get(chave)?.lista === lista) cardapioGuardado.delete(chave);
  });
  return lista;
}

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
  aoCancelarPedido,
}: {
  pedido: any;
  operador: { role?: string | null; permissions?: string | null };
  aoFechar: () => void;
  /** Chamada depois que o servidor confirmou. Recarrega a lista e reimprime. */
  aoSalvar: (resultado: { cancelado?: boolean; acrescimo?: any; totalAmount?: number; soDesconto?: boolean; desconto?: number }) => void;
  /** Abre a janela de cancelamento de sempre (motivo, trava do finalizado).
   *  No celular o Cancelar do card ficava fora de alcance (Holy Top, 19/10/2026). */
  aoCancelarPedido?: () => void;
}) {
  const avaliacao = useMemo(() => avaliarEdicaoNoPainel(pedido, operador), [pedido, operador]);
  const modo: ModoDeEdicao = avaliacao.modo;
  /** Marketplace e pedido próprio editam itens do mesmo jeito. O que muda é o dinheiro. */
  const ehMarketplace = modo === "MARKETPLACE";
  /** Rodada de mesa: só tira e muda quantidade; a conta da mesa acompanha. */
  const ehMesa = modo === "MESA";
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
  // Item do pedido sendo remontado ("Editar escolhas") e as trocas do rascunho.
  const [itemRemontando, setItemRemontando] = useState<ItemDoPedido | null>(null);
  const [trocas, setTrocas] = useState<Record<string, TrocaDoRascunho>>({});
  const [pagamento, setPagamento] = useState("Dinheiro");
  const caixaDoMotivo = useRef<HTMLDivElement | null>(null);

  const [cardapio, setCardapio] = useState<ProdutoDoCardapio[]>([]);
  // O cardápio inteiro por id (inclusive categoria escondida): é dele que sai
  // a pergunta do item que JÁ está no pedido, para o "Editar escolhas".
  const [produtoPorId, setProdutoPorId] = useState<Map<string, ProdutoDoCardapio>>(new Map());
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

  // O cardápio é buscado ao abrir a aba (buscarCardapio, guardado 3 min), não
  // ao abrir a caixa de acrescentar: quando o atendente termina de digitar, a
  // lista já chegou — e é dela que sai o "Editar escolhas" dos itens que têm
  // pergunta (sabor, borda, adicional). Rodada de mesa não usa, então não busca.
  const lojaDoPedido = String(pedido?.franchiseeId || "");
  const [cardapioFalhou, setCardapioFalhou] = useState(false);
  const [tentativaDoCardapio, setTentativaDoCardapio] = useState(0);
  useEffect(() => {
    if (ehMesa) return;
    let vivo = true;
    setCardapioFalhou(false);
    buscarCardapio(lojaDoPedido, canalDePreco)
      .then((todos) => {
        if (!vivo) return;
        setProdutoPorId(new Map(todos.map((p) => [p.id, p])));
        // O mesmo recorte da mesa: sem sabor/adicional solto (o servidor marca
        // `apenasOpcaoDeCombo`), sem inativo e sem espelho de integração. Os
        // sabores apareciam como item de R$ 0,00 no meio da busca. O adicional
        // continua achável: pela busca, no produto que o tem como escolha.
        setCardapio(
          todos
            .filter((p) => p._ativo && !p._soOpcao)
            .filter((p) => !CATEGORIAS_ESCONDIDAS.has(String(p.category || "").toUpperCase().trim()))
        );
      })
      .catch(() => {
        if (vivo) setCardapioFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [ehMesa, lojaDoPedido, canalDePreco, tentativaDoCardapio]);

  /** O produto do cardápio de um item do pedido, quando ele tem pergunta para reabrir. */
  const produtoComPerguntas = (i: ItemDoPedido): ProdutoDoCardapio | null => {
    const id = idDoProduto(i);
    const p = id ? produtoPorId.get(id) : undefined;
    return p && (p.comboGroups || []).length > 0 ? p : null;
  };

  const itensOriginais: ItemDoPedido[] = pedido.items || [];
  const taxa = Number(pedido.deliveryFee) || 0;
  const desconto = Number(pedido.discountTotal) || 0;
  // O acréscimo no crédito do cardápio fica de pé em reais, como no servidor
  // (recalcularTotal com `acrescimo`).
  const acrescimoNoCredito = valorDoAcrescimoGravado(pedido as any);

  // As linhas que FICAM no pedido, com as trocas de escolha aplicadas: o item
  // remontado inteiro vai pelo preço novo; remontado em parte, o resto fica
  // pelo preço antigo e a parte remontada pelo novo (o servidor separa igual).
  const linhasQueFicam = useMemo(() => {
    const linhas: { price: number; quantity: number }[] = [];
    for (const i of itensOriginais) {
      if (removidos.has(i.id)) continue;
      const t = trocas[i.id];
      if (!t) { linhas.push({ price: i.price, quantity: quantidades[i.id] ?? i.quantity }); continue; }
      if (t.quantity >= i.quantity) { linhas.push({ price: t.precoUnitario, quantity: t.quantity }); continue; }
      linhas.push({ price: i.price, quantity: i.quantity - t.quantity }, { price: t.precoUnitario, quantity: t.quantity });
    }
    return linhas;
  }, [itensOriginais, removidos, quantidades, trocas]);

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
    const novos = modo === "MARKETPLACE" ? [] : acrescimos.map((a) => ({ price: a.precoUnitario, quantity: a.quantity }));
    return contaDoDescontoDaEdicao({ itens: [...linhasQueFicam, ...novos], discountTotal: desconto, deliveryFee: taxa, acrescimo: acrescimoNoCredito, desconto: descontoNovo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descontoNovo?.tipo, descontoNovo?.valor, descontoNovo?.motivo, linhasQueFicam, acrescimos, desconto, taxa, modo, acrescimoNoCredito]);
  const descontoValido = !!contaDoDesconto && !contaDoDesconto.problema && contaDoDesconto.valor > 0;

  // O mesmo `itens - desconto + taxa` do servidor. Repetido aqui de propósito e
  // só para PREVER o número na tela; quem grava é a API, que recalcula do zero.
  const totalPrevisto = useMemo(() => {
    const somaOriginais = linhasQueFicam.reduce((s, i) => s + i.price * i.quantity, 0);
    const somaNovos = acrescimos.reduce((s, a) => s + a.precoUnitario * a.quantity, 0);
    if (modo === "MARKETPLACE") {
      // O acréscimo do marketplace nunca entra no pedido do parceiro: ele vira
      // pedido colado, e é esse valor que o cliente paga por fora.
      return Math.round(somaNovos * 100) / 100;
    }
    if (descontoValido) return contaDoDesconto!.total;
    return Math.round((Math.max(0, somaOriginais + somaNovos - desconto + taxa) + acrescimoNoCredito) * 100) / 100;
  }, [linhasQueFicam, acrescimos, desconto, taxa, modo, descontoValido, contaDoDesconto, acrescimoNoCredito]);

  /** O total do PEDIDO depois de tirar item — só existe quando ele acompanha. */
  const totalDoPedidoPrevisto = useMemo(() => {
    const soma = linhasQueFicam.reduce((s, i) => s + i.price * i.quantity, 0);
    if (descontoValido) return contaDoDesconto!.total;
    return Math.round((Math.max(0, soma - desconto + taxa) + acrescimoNoCredito) * 100) / 100;
  }, [linhasQueFicam, desconto, taxa, descontoValido, contaDoDesconto, acrescimoNoCredito]);

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
  const temTroca = Object.keys(trocas).length > 0;
  const mudouOsItens = acrescimos.length > 0 || mexeuNosOriginais || temTroca;
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
      // O botão ficava cinza e mudo aqui: o lojista da Lapastine (17/10/2026)
      // baixou a quantidade da pizza antiga, não viu o campo e refez o pedido
      // do zero. Agora o clique diz o motivo e leva até o campo.
      setErro(
        "Falta o motivo de tirar o item (pelo menos 3 letras) — ele aparece no fechamento do caixa. " +
          "Se era só para pôr um adicional ou trocar o sabor, use “Editar escolhas” no item: aí não precisa de motivo."
      );
      caixaDoMotivo.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      (caixaDoMotivo.current?.querySelector("textarea, input") as HTMLElement | null)?.focus();
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
    if (ehMesa && !sobrouAlgum) {
      const ok = confirm(
        "Você tirou todos os itens.\n\nIsso CANCELA esta rodada inteira: ela sai da conta da mesa e o estoque baixado volta. Confirma?"
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
      // Itens remontados ("Editar escolhas"): o servidor recalcula o preço.
      if (temTroca) {
        corpo.trocar = Object.entries(trocas).map(([itemId, t]) => ({
          itemId,
          quantity: t.quantity,
          ...(t.comboSelections ? { comboSelections: t.comboSelections } : {}),
          notes: t.notes || "",
        }));
      }
      corpo.itens = itensOriginais
        .filter((i) => !removidos.has(i.id) && !trocas[i.id] && (quantidades[i.id] ?? i.quantity) !== i.quantity)
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

  // A busca acha pelo nome do produto E pelas escolhas dele: "bacon", "borda",
  // "coca" trazem a pizza/o lanche que tem aquilo como adicional. O adicional
  // não se vende sozinho (apenasOpcaoDeCombo) e a busca respondia "Nenhum item
  // com esse nome" — Lapastine, 17/10/2026.
  const termoDaBusca = normalizarBusca(buscaProduto);
  const produtosFiltrados: { p: ProdutoDoCardapio; opcao: string | null }[] = termoDaBusca
    ? [
        ...cardapio.filter((p) => normalizarBusca(p.name).includes(termoDaBusca)).map((p) => ({ p, opcao: null as string | null })),
        ...cardapio
          .filter((p) => !normalizarBusca(p.name).includes(termoDaBusca))
          .map((p) => ({ p, opcao: opcaoQueCasa(p, buscaProduto) }))
          .filter((x) => !!x.opcao),
      ].slice(0, 25)
    : cardapio.slice(0, 25).map((p) => ({ p, opcao: null }));
  // O adicional procurado está num produto que JÁ está no pedido? Então o
  // caminho é o "Editar escolhas" daquele item, não uma pizza nova.
  const itensQueTemAOpcao = termoDaBusca
    ? itensOriginais.filter((i) => !removidos.has(i.id) && !trocas[i.id] && (quantidades[i.id] ?? i.quantity) === i.quantity && modo === "COMPLETO" && !!opcaoQueCasa(produtoComPerguntas(i), buscaProduto))
    : [];

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

      {/* A rodada é da CONTA da mesa: o atendente precisa saber, antes de
          mexer, que o total da mesa muda junto e que a mesa só fecha pela
          tela de Mesas. O estoque é a regra de lá: tirar item não devolve. */}
      {ehMesa && (
        <div
          style={{
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            borderRadius: "10px",
            padding: "10px 12px",
            fontSize: "0.82rem",
            color: "#1E3A8A",
            lineHeight: 1.5,
            marginBottom: "12px",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: "4px" }}>{avaliacao.motivo}</div>
          <div>
            Tirar item ou diminuir não devolve o estoque sozinho — só cancelar a rodada inteira devolve. Para
            acrescentar, lance uma rodada nova na tela de Mesas.
          </div>
        </div>
      )}

      {/* ── Itens do pedido ───────────────────────────────────────────── */}
      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: "6px" }}>
        {ehMarketplace ? `Itens do pedido (só aqui — o ${avaliacao.canal || "parceiro"} não muda)` : ehMesa ? "Itens da rodada" : "Itens do pedido"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
        {itensOriginais.map((item) => {
          const fora = removidos.has(item.id);
          const qtd = quantidades[item.id] ?? item.quantity;
          const troca = trocas[item.id];
          const escolhasDeHoje = escolhasEmTexto(item.comboSelections as any);
          // "Editar escolhas": só no pedido próprio, com o produto ainda no
          // cardápio e com pergunta, e sem quantidade mexida no rascunho.
          const podeRemontar = modo === "COMPLETO" && !fora && !troca && qtd === item.quantity && !!produtoComPerguntas(item);
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
                {escolhasDeHoje && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: troca ? "#94A3B8" : "#475569",
                      textDecoration: troca && troca.quantity >= item.quantity ? "line-through" : "none",
                      lineHeight: 1.35,
                    }}
                  >
                    ↳ {escolhasDeHoje}
                  </div>
                )}
                {item.notes && !troca && <div style={{ fontSize: "0.74rem", color: "#B45309", fontWeight: 600 }}>📝 {item.notes}</div>}
                <div style={{ fontSize: "0.75rem", color: "#64748B" }}>{fmt(item.price)} cada</div>
                {troca && (
                  <div style={{ marginTop: "4px", padding: "6px 8px", borderRadius: "6px", background: "#F0FDFA", border: "1px solid #99F6E4", color: "#134E4A", fontSize: "0.76rem", lineHeight: 1.4 }}>
                    <div style={{ fontWeight: 800 }}>
                      ✏️ {troca.quantity >= item.quantity ? `Remontado (${troca.quantity}x)` : `${troca.quantity} de ${item.quantity} remontado${troca.quantity > 1 ? "s" : ""}`}
                    </div>
                    <div style={{ fontWeight: 600 }}>↳ {resumoDasEscolhas(troca.comboSelections) || "sem escolhas"}</div>
                    {troca.notes && <div style={{ color: "#B45309", fontWeight: 600 }}>📝 {troca.notes}</div>}
                    <div>
                      {fmt(troca.precoUnitario)} cada
                      {troca.quantity < item.quantity && ` · ${item.quantity - troca.quantity}x fica${item.quantity - troca.quantity > 1 ? "m" : ""} como estava`}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTrocas((t) => { const { [item.id]: _fora, ...resto } = t; return resto; })}
                      style={{ marginTop: "2px", border: "none", background: "none", padding: 0, color: "#0F766E", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}
                    >
                      Desfazer
                    </button>
                  </div>
                )}
                {podeRemontar && (
                  <button
                    type="button"
                    onClick={() => setItemRemontando(item)}
                    title="Abrir as escolhas do item (sabor, borda, adicional) e trocar"
                    style={{ marginTop: "4px", padding: "4px 10px", borderRadius: "6px", border: "1px solid #99F6E4", background: "#F0FDFA", color: "#0F766E", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ✏️ Editar escolhas / adicionais
                  </button>
                )}
              </div>

              {!fora && !troca && (
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

              {!troca && <button
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
              </button>}
            </div>
          );
        })}
      </div>

      {/* ── Acrescentar ───────────────────────────────────────────────── */}
      {!ehMesa && (<>
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
            {cardapio.length === 0 && !cardapioFalhou && <div style={{ padding: "10px", color: "#64748B", fontSize: "0.82rem" }}>Carregando cardápio...</div>}
            {cardapio.length === 0 && cardapioFalhou && (
              <div style={{ padding: "10px", color: "#B91C1C", fontSize: "0.82rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                Não consegui carregar o cardápio.
                <button type="button" onClick={() => setTentativaDoCardapio((n) => n + 1)} style={{ ...botaoSecundario, width: "auto", margin: 0, padding: "4px 10px" }}>
                  Tentar de novo
                </button>
              </div>
            )}
            {itensQueTemAOpcao.length > 0 && (
              <div style={{ padding: "8px 9px", borderRadius: "6px", background: "#F0FDFA", border: "1px solid #99F6E4", color: "#134E4A", fontSize: "0.78rem", lineHeight: 1.4 }}>
                <strong>“{opcaoQueCasa(produtoComPerguntas(itensQueTemAOpcao[0]), buscaProduto)}”</strong> é escolha de um item que já está no pedido.
                Para pôr nele, use “Editar escolhas”:
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                  {itensQueTemAOpcao.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => { setItemRemontando(i); setBuscaProduto(""); setAbrindoBusca(false); }}
                      style={{ padding: "4px 9px", borderRadius: "6px", border: "1px solid #0F766E", background: "#FFF", color: "#0F766E", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      ✏️ {i.productName || "Item"} ({i.quantity}x)
                    </button>
                  ))}
                </div>
              </div>
            )}
            {produtosFiltrados.map(({ p, opcao }) => (
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
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1E293B" }}>
                  {p.name}
                  {opcao && <span style={{ display: "block", fontSize: "0.72rem", color: "#0F766E", fontWeight: 600 }}>tem “{opcao}” nas escolhas</span>}
                </span>
                {/* O preço do cardápio: "a partir de" quando depende da escolha. */}
                <span style={{ fontWeight: 700, color: "#0F766E", whiteSpace: "nowrap" }}>
                  {precoVariaPorEscolha(p as any) ? `a partir de ${fmt(precoMinimoDoProduto(p as any))}` : fmt(precoMinimoDoProduto(p as any))}
                </span>
              </button>
            ))}
            {cardapio.length > 0 && produtosFiltrados.length === 0 && itensQueTemAOpcao.length === 0 && (
              <div style={{ padding: "10px", color: "#64748B", fontSize: "0.82rem" }}>Nenhum item com esse nome.</div>
            )}
          </div>
          <button type="button" onClick={() => setAbrindoBusca(false)} style={{ ...botaoSecundario, marginTop: 6 }}>
            Fechar busca
          </button>
        </div>
      )}
      </>)}

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
        ) : ehMesa ? (
          <>
            {desconto > 0 && <Linha rotulo="Desconto da rodada (mantido)" valor={`− ${fmt(desconto)}`} />}
            <Linha rotulo="Rodada hoje" valor={fmt(totalAtual)} />
            <Linha
              rotulo={!sobrouAlgum ? "Rodada será CANCELADA (sai da conta)" : "Nova rodada"}
              valor={!sobrouAlgum ? "—" : fmt(totalPrevisto)}
              destaque
            />
            {sobrouAlgum && mexeuNosOriginais && (
              <div style={{ marginTop: "4px", fontSize: "0.76rem", color: "#64748B" }}>
                A conta da mesa {totalPrevisto < totalAtual ? "cai" : "sobe"} {fmt(Math.abs(totalPrevisto - totalAtual))}.
              </div>
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
        <div ref={caixaDoMotivo} style={{ marginTop: "12px" }}>
          <MotivoDoCancelamento
            valor={motivo}
            aoMudar={setMotivo}
            rotulo={!sobrouAlgum && acrescimos.length === 0 ? "Motivo do cancelamento do pedido" : "Motivo de tirar o item"}
          />
        </div>
      )}

      {faltaMotivo && !erro && (
        <div style={{ marginTop: "10px", background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: "8px", padding: "8px 10px", fontSize: "0.8rem", lineHeight: 1.4 }}>
          Para salvar, escreva acima o <strong>motivo de tirar o item</strong>. Só queria pôr um adicional ou trocar o
          sabor? Desfaça a quantidade e use <strong>“Editar escolhas”</strong> no item — aí não pede motivo.
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
          // Falta de motivo NÃO desabilita: o clique diz o que falta e leva
          // até o campo. Botão cinza sem explicação foi o "não consigo
          // finalizar" da Lapastine (17/10/2026).
          disabled={salvando || !mudouAlgo}
          style={{
            flex: 2,
            padding: "10px",
            borderRadius: "10px",
            border: "none",
            background: !mudouAlgo ? "#CBD5E1" : faltaMotivo ? "#E07A5F" : "#C92E09",
            color: "#FFF",
            fontWeight: 800,
            fontSize: "0.88rem",
            cursor: !mudouAlgo || salvando ? "default" : "pointer",
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

      {aoCancelarPedido && !ehMesa && (
        <button
          type="button"
          onClick={aoCancelarPedido}
          disabled={salvando}
          style={{
            width: "100%",
            marginTop: "12px",
            padding: "10px",
            borderRadius: "10px",
            border: "1.5px solid #FCA5A5",
            background: "#FEF2F2",
            color: "#B91C1C",
            fontWeight: 800,
            fontSize: "0.85rem",
            cursor: salvando ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancelar pedido
        </button>
      )}

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
          onConfirm={(selections, _extraSum, qty, notes) => {
            const p = produtoComOpcoes;
            const escolhas = limparEscolhas(selections);
            setAcrescimos((lista) => [
              ...lista,
              {
                produto: p,
                quantity: Math.max(1, Math.min(99, Number(qty) || 1)),
                // A conta do servidor (precoUnitarioDoItem + piso), não a soma do modal.
                precoUnitario: precoComEscolhas(p, escolhas),
                comboSelections: escolhas,
                notes: notes && notes.trim() ? notes.trim() : undefined,
              },
            ]);
            setProdutoComOpcoes(null);
            setBuscaProduto("");
            setAbrindoBusca(false);
          }}
        />
      )}

      {/* "Editar escolhas" de um item que JÁ está no pedido: a mesma janela,
          aberta com o que estava marcado. Confirmar troca o item pelo
          remontado — não é tirar item, então não pede motivo. Quantidade
          menor que a do item remonta só essa parte (a outra fica como estava). */}
      {itemRemontando && (() => {
        const p = produtoComPerguntas(itemRemontando);
        if (!p) return null;
        const item = itemRemontando;
        return (
          <ComboModal
            product={{
              id: p.id,
              name: p.name,
              description: p.description ?? null,
              price: p.price,
              imageUrl: p.imageUrl ?? null,
              comboGroups: (p.comboGroups || []) as any,
              isCombo: p.isCombo,
            }}
            inicial={{
              selections: escolhasParaReabrir(p as any, item.comboSelections as any),
              qty: item.quantity,
              notes: item.notes || "",
            }}
            rotuloDoBotao={item.quantity > 1 ? "Trocar estas unidades" : "Trocar o item"}
            onClose={() => setItemRemontando(null)}
            onConfirm={(selections, _extraSum, qty, notes) => {
              const escolhas = limparEscolhas(selections);
              setTrocas((t) => ({
                ...t,
                [item.id]: {
                  quantity: Math.max(1, Math.min(99, Number(qty) || 1)),
                  precoUnitario: precoComEscolhas(p, escolhas),
                  comboSelections: escolhas,
                  notes: notes && notes.trim() ? notes.trim() : undefined,
                },
              }));
              setItemRemontando(null);
            }}
          />
        );
      })()}
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
