/**
 * /src/lib/conta-da-mesa.ts
 *
 * A conta da mesa, rateada por pessoa — e o cupom dela para a impressora.
 *
 * Nasceu da rota GET /api/store/table-sessions/[id]/conta, que fazia essa
 * conta inline. Virou biblioteca porque a impressão da conta (rota
 * imprimir-conta) precisa do MESMO número que a tela mostra: se cada um
 * somasse do seu jeito, o papel diria um total e o fechamento exigiria outro.
 *
 * Como o rateio funciona:
 *   - item com dono  → vai inteiro para a conta daquela pessoa;
 *   - item sem dono  → é da mesa (couvert, entrada para dividir) e é rateado
 *                      igualmente entre as pessoas cadastradas;
 *   - taxa e gorjeta → rateadas na proporção do que cada um consumiu, porque
 *                      cobrar 10% igual de quem tomou água e de quem tomou
 *                      vinho é o tipo de coisa que gera discussão na mesa.
 *
 * O resto em centavos da divisão é jogado na primeira pessoa. Sem isso, três
 * pessoas dividindo R$ 100 dariam R$ 33,33 cada e a mesa fecharia devendo um
 * centavo para sempre.
 */

import { parseComboSelections } from "./parse-combo";
import { valorDoDesconto, type DescontoManual } from "./desconto-manual";

const emCentavos = (v: number) => Math.round((Number(v) || 0) * 100);
const emReais = (c: number) => Math.round(c) / 100;

export type ItemDaMesaParaConta = {
  quantity: number;
  price: number;
  productName?: string | null;
  tableGuestId?: string | null;
  menuProduct?: { name?: string | null } | null;
  /** As escolhas do combo, no formato que estiver gravado. */
  comboSelections?: unknown;
};

/**
 * Nome da linha com as escolhas do combo. Na Pastel da Paulista o sabor e o
 * tamanho do pastel moram nas OPÇÕES, com quantidade na opção: "2 pastéis
 * tradicionais" é UM item de quantidade 1 com "Tradicional ×2" dentro. A
 * conta impressa mostrava só "1x Carne moida com Catupiry R$ 71,60", e o
 * cliente lia um pastel onde havia dois. A comanda da cozinha já imprime as
 * opções com "2x"; a conta precisa dizer a mesma coisa.
 */
function nomeDaLinha(item: ItemDaMesaParaConta): string {
  const base = item.productName || item.menuProduct?.name || "Item";
  const escolhas = parseComboSelections(item.comboSelections, 1);
  if (escolhas.length === 0) return base;
  const detalhe = escolhas
    .map((e) => (e.quantity > 1 ? `${e.quantity}x ${e.name}` : e.name))
    .join(", ");
  return `${base} (${detalhe})`;
}

export type PedidoDaMesaParaConta = {
  status: string;
  totalAmount: number | null;
  dailyOrderNumber: number | null;
  items: ItemDaMesaParaConta[];
};

export type MesaParaConta = {
  table: { number: number; label: string | null };
  orders: PedidoDaMesaParaConta[];
  waiterTip: number | null;
};

export type PessoaDaMesa = { id: string; name: string };

export type LinhaDaConta = { nome: string; quantidade: number; valor: number };

export type ContaDaMesa = {
  mesa: { numero: number; nome: string | null };
  consumo: number;
  /** Desconto dado na mesa, já em reais. Zero quando não houve. */
  desconto: { valor: number; motivo: string };
  taxaServico: { percentual: number; valor: number };
  gorjeta: number;
  total: number;
  itensDaMesa: { valor: number; itens: LinhaDaConta[] };
  pessoas: {
    id: string;
    nome: string;
    consumo: number;
    parteDaMesa: number;
    taxaEGorjeta: number;
    aPagar: number;
    itens: LinhaDaConta[];
  }[];
  /** Divisão por igual, para quando a mesa prefere rachar sem separar consumo. */
  porIgual: number;
};

/**
 * Calcula a conta. `taxaPct` já saneada (0 a 100). `gorjetaReais` nulo usa a
 * gorjeta gravada na sessão — é o que a tela de fechamento manda quando o
 * garçom ainda não mexeu no campo.
 */
export function calcularContaDaMesa(
  mesa: MesaParaConta,
  pessoas: PessoaDaMesa[],
  taxaPct: number,
  gorjetaReais: number | null,
  /** Desconto da mesa. A taxa de serviço incide sobre o consumo JÁ descontado. */
  desconto?: DescontoManual | null,
): ContaDaMesa {
  const porPessoa = new Map<string, { nome: string; centavos: number; itens: LinhaDaConta[] }>();
  pessoas.forEach((p) => porPessoa.set(p.id, { nome: p.name, centavos: 0, itens: [] }));

  let daMesaCentavos = 0;
  const itensDaMesa: LinhaDaConta[] = [];

  for (const pedido of mesa.orders) {
    // Pedido cancelado não entra na conta de ninguém.
    if (pedido.status === "CANCELADO") continue;

    let somaDosItens = 0;

    for (const item of pedido.items) {
      const valor = emCentavos((item.price || 0) * (item.quantity || 1));
      somaDosItens += valor;

      const linha: LinhaDaConta = {
        nome: nomeDaLinha(item),
        quantidade: item.quantity,
        valor: emReais(valor),
      };

      const dono = item.tableGuestId ? porPessoa.get(item.tableGuestId) : null;
      if (dono) {
        dono.centavos += valor;
        dono.itens.push(linha);
      } else {
        daMesaCentavos += valor;
        itensDaMesa.push(linha);
      }
    }

    // O fechamento valida contra `order.totalAmount`; a tela soma item a
    // item. Normalmente dá no mesmo, mas um desconto no pedido, uma taxa ou
    // um arredondamento fazem os dois divergirem — e aí o garçom recebe
    // exatamente o que a tela pediu e o sistema recusa fechar por diferença
    // de centavos. A diferença entra como ajuste da mesa para os dois números
    // serem sempre o mesmo.
    const diferenca = emCentavos(pedido.totalAmount || 0) - somaDosItens;
    if (diferenca !== 0) {
      daMesaCentavos += diferenca;
      itensDaMesa.push({
        nome: `Ajuste do pedido #${pedido.dailyOrderNumber ?? "—"}`,
        quantidade: 1,
        valor: emReais(diferenca),
      });
    }
  }

  const consumoTotal = [...porPessoa.values()].reduce((s, p) => s + p.centavos, 0) + daMesaCentavos;

  // O desconto sai do consumo ANTES da taxa: a taxa de serviço é sobre o que
  // a mesa realmente vai pagar pelos itens, não sobre o que foi abatido.
  const descontoCentavos = emCentavos(valorDoDesconto(desconto, emReais(consumoTotal)));
  const consumoCobrado = Math.max(0, consumoTotal - descontoCentavos);

  const taxaCentavos = taxaPct > 0 ? Math.round((consumoCobrado * taxaPct) / 100) : 0;
  const gorjetaCentavos =
    gorjetaReais !== null ? Math.max(0, emCentavos(gorjetaReais)) : emCentavos(mesa.waiterTip || 0);
  const totalCentavos = consumoCobrado + taxaCentavos + gorjetaCentavos;

  // Rateio do que é da mesa e dos acréscimos
  const quantas = pessoas.length;
  const divisao = pessoas.map((p) => {
    const dados = porPessoa.get(p.id)!;

    // Parte igual do que é da mesa
    const parteDaMesa = quantas > 0 ? Math.floor(daMesaCentavos / quantas) : 0;

    // Taxa, gorjeta e DESCONTO proporcionais ao consumo próprio: quem comeu
    // mais paga mais taxa e ganha mais desconto, que é como a mesa entende
    // "10% pra gente".
    const base = consumoTotal > 0 ? dados.centavos / consumoTotal : 0;
    const parteExtra = Math.floor((taxaCentavos + gorjetaCentavos) * base);
    const parteDoDesconto = Math.floor(descontoCentavos * base);

    return {
      id: p.id,
      nome: dados.nome,
      consumo: emReais(dados.centavos),
      parteDaMesa: emReais(parteDaMesa),
      taxaEGorjeta: emReais(parteExtra),
      totalCentavos: dados.centavos + parteDaMesa + parteExtra - parteDoDesconto,
      itens: dados.itens,
    };
  });

  // O que sobrou do arredondamento vai para a primeira pessoa, senão a soma das
  // partes nunca fecha com o total e a mesa não fecha.
  const somaDasPartes = divisao.reduce((s, d) => s + d.totalCentavos, 0);
  const sobra = totalCentavos - somaDasPartes;
  if (divisao.length > 0 && sobra !== 0) divisao[0].totalCentavos += sobra;

  return {
    mesa: { numero: mesa.table.number, nome: mesa.table.label },
    consumo: emReais(consumoTotal),
    desconto: { valor: emReais(descontoCentavos), motivo: String(desconto?.motivo || "") },
    taxaServico: { percentual: taxaPct, valor: emReais(taxaCentavos) },
    gorjeta: emReais(gorjetaCentavos),
    total: emReais(totalCentavos),
    itensDaMesa: { valor: emReais(daMesaCentavos), itens: itensDaMesa },
    pessoas: divisao.map((d) => ({
      id: d.id,
      nome: d.nome,
      consumo: d.consumo,
      parteDaMesa: d.parteDaMesa,
      taxaEGorjeta: d.taxaEGorjeta,
      aPagar: emReais(d.totalCentavos),
      itens: d.itens,
    })),
    porIgual: quantas > 0 ? emReais(Math.floor(totalCentavos / quantas)) : emReais(totalCentavos),
  };
}

/** Percentual de taxa saneado: número entre 0 e 100, senão o padrão. */
export function sanearTaxa(valor: unknown, padrao: number): number {
  if (valor === null || valor === undefined || valor === "") return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.max(0, Math.min(100, n));
}

const fmtReais = (v: number) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

/**
 * O cupom da conta, no formato de "pedido" que o cupom da comanda entende.
 *
 * O Assistente instalado nas lojas só sabe imprimir pedido (cabeçalho,
 * cliente, itens, subtotal, total, forma de pagamento). Em vez de esperar um
 * instalador novo em cada loja, a conta viaja como um pedido sintético:
 *
 *   - itens agrupados por produto e preço unitário (a mesa repete "Coca"
 *     em três rodadas; na conta é uma linha "3x Coca");
 *   - a taxa de serviço e a gorjeta entram como LINHAS, porque é a soma dos
 *     itens que o cupom usa como subtotal — e assim subtotal e total batem;
 *   - a divisão por pessoa vai no nome do cliente (o único texto livre que
 *     o cupom de hoje imprime fora da entrega) e também em `rateio`, que o
 *     Assistente novo imprime como bloco próprio;
 *   - `paymentMethod` com "Pendente" cai no ramo "a cobrar" do cupom, que é
 *     o certo: a conta é exatamente o que ainda vai ser pago.
 *
 * `id` é único por impressão: o Assistente deduplica por id, então imprimir
 * a conta de novo (depois de mais uma rodada) gera outro id e sai de novo.
 */
export function montarCupomDaConta(
  conta: ContaDaMesa,
  opcoes: {
    sessionId: string;
    garcom?: string | null;
    cliente?: string | null;
    agora?: Date;
    /**
     * O Assistente desta loja imprime taxa e gorjeta em LINHAS PRÓPRIAS
     * (>= VERSAO_ASSISTENTE_COM_TAXA_SEPARADA).
     *
     * Falso — Assistente antigo — mantém o jeito velho: taxa e gorjeta entram
     * como itens, porque lá o subtotal é a soma dos itens e sem elas o papel
     * sairia com um buraco entre o subtotal e o total. Feio, mas fechando;
     * era assim para todo mundo até 15/09/2026.
     */
    taxaSeparada?: boolean;
  }
) {
  const taxaSeparada = opcoes.taxaSeparada === true;
  const agora = opcoes.agora ?? new Date();
  const rotuloDaMesa = `Mesa ${conta.mesa.numero}${conta.mesa.nome ? ` - ${conta.mesa.nome}` : ""}`;

  // Agrupa por (nome, preço unitário) somando as quantidades.
  const agrupados = new Map<string, { name: string; qty: number; price: number }>();
  const todasAsLinhas: LinhaDaConta[] = [
    ...conta.itensDaMesa.itens,
    ...conta.pessoas.flatMap((p) => p.itens),
  ];
  for (const l of todasAsLinhas) {
    const qtd = Number(l.quantidade) || 1;
    const unitario = qtd > 0 ? Math.round((l.valor / qtd) * 100) / 100 : l.valor;
    const chave = `${l.nome}::${unitario}`;
    const atual = agrupados.get(chave);
    if (atual) atual.qty += qtd;
    else agrupados.set(chave, { name: l.nome, qty: qtd, price: unitario });
  }
  const items: { name: string; qty: number; price: number }[] = [...agrupados.values()];

  // ── TAXA E GORJETA: LINHA PRÓPRIA, NÃO ITEM ──────────────────────────────
  //
  // Como item, elas saíam no meio dos pratos — "1x Taxa de servico 10% ...
  // R$ 12,90" — e o cliente lia como se a mesa tivesse pedido mais alguma
  // coisa; o subtotal também já vinha com os 10% dentro. Deu reclamação de
  // cliente em 15/09/2026. Agora viajam em campo próprio e o Assistente
  // imprime consumo, taxa, gorjeta e total, nessa ordem.
  if (!taxaSeparada) {
    if (conta.taxaServico.valor > 0) {
      items.push({
        name: `Taxa de servico ${conta.taxaServico.percentual}%${opcoes.garcom ? ` (garcom ${opcoes.garcom})` : ""}`,
        qty: 1,
        price: conta.taxaServico.valor,
      });
    }
    if (conta.gorjeta > 0) {
      items.push({ name: "Gorjeta", qty: 1, price: conta.gorjeta });
    }
  }

  // O cupom soma unitário × quantidade para montar o subtotal e imprime
  // `totalAmount` como total. O unitário aqui é derivado por divisão, então um
  // item com preço de mais de duas casas faria os dois números divergirem por
  // centavos no papel — e "Subtotal 99,99 / Total 100,00" numa conta que o
  // cliente confere é discussão na mesa. A diferença entra como linha própria.
  //
  // Com a taxa em linha própria, o alvo é o CONSUMO — é ele que o papel
  // imprime logo abaixo dos itens, e desconto, taxa e gorjeta vêm depois, cada
  // um na sua linha. Sem ela, o alvo é o total, porque taxa e gorjeta estão
  // dentro da lista de itens.
  const alvoDosItens = taxaSeparada ? conta.consumo : conta.total;
  const somaImpressa = items.reduce((soma, i) => soma + Math.round(i.price * i.qty * 100), 0);
  const diferenca = Math.round(alvoDosItens * 100) - somaImpressa;
  if (diferenca !== 0) {
    items.push({ name: "Ajuste de centavos", qty: 1, price: Math.round(diferenca) / 100 });
  }

  const rateio = conta.pessoas.map((p) => ({ nome: p.nome, valor: p.aPagar }));
  const resumoDoRateio =
    rateio.length > 0 ? ` | ${rateio.map((r) => `${r.nome} ${fmtReais(r.valor)}`).join(" | ")}` : "";

  const customerName =
    `${rotuloDaMesa}${opcoes.cliente ? ` (${opcoes.cliente})` : ""}` +
    (rateio.length > 0 ? ` - ${rateio.length} pessoas${resumoDoRateio}` : "");

  return {
    id: `conta_${opcoes.sessionId}_${agora.getTime()}`,
    kind: "CONTA_DA_MESA",
    dailyOrderNumber: `CONTA ${rotuloDaMesa.toUpperCase()}`,
    customerName,
    customerAddress: rotuloDaMesa,
    deliveryType: "MESA",
    source: "MESA",
    paymentMethod: "Pendente - pagar no caixa ou na mesa",
    isPrepaid: false,
    items,
    totalAmount: conta.total,
    deliveryFee: 0,
    notes: "",
    tableSessionId: opcoes.sessionId,
    rateio,
    consumo: conta.consumo,
    taxaServico: conta.taxaServico,
    gorjeta: conta.gorjeta,
    // ── QUEM MANDA É ESTA FLAG, NÃO A DEDUÇÃO ────────────────────────────
    //
    // O Assistente novo precisa saber se a taxa está NA LISTA de itens ou
    // fora dela — e não dá para adivinhar: `consumo` já viajava no cupom
    // antes desta mudança, então um payload ANTIGO reimpresso (eles ficam
    // gravados em PrintRequest) num Assistente novo imprimiria o rodapé
    // sobre uma lista que ainda tem a taxa dentro. A flag diz o que foi
    // feito na hora de montar; Assistente antigo ignora o campo.
    taxaSeparada,
    // O desconto da mesa como LINHA da conta — só faz sentido no Assistente
    // que imprime o rodapé próprio; o antigo ignora campo que não conhece.
    ...(conta.desconto.valor > 0 ? { descontoDaConta: conta.desconto } : {}),
    createdAt: agora.toISOString(),
  };
}

export type CupomDaConta = ReturnType<typeof montarCupomDaConta>;
