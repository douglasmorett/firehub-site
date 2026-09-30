/**
 * O relatório "Vendas por período" — o relatório principal da Saipos, que o
 * lojista que vem de lá abre primeiro: um resumo do período no topo e a lista
 * de TODOS os pedidos embaixo, com busca e detalhe.
 *
 * Puro (sem banco): a rota api/store/relatorios/vendas busca os pedidos com a
 * régua de lib/relatorios/servidor.ts e entrega aqui. Testado em
 * scripts/teste-vendas.ts.
 *
 * ── O que é venda, o que é cancelado e o que não é nenhum dos dois ──────────
 *
 * Três situações, nunca duas:
 *
 * - VENDA: tudo que não está em STATUS_FORA_DA_VENDA (lib/relatorios/base.ts).
 * - CANCELADO: CANCELADO/CANCELLED/CANCELED — foi pedido e deixou de ser.
 * - NÃO CONCLUÍDO: CRIANDO_IA (o rascunho que o robô do WhatsApp monta
 *   ENQUANTO conversa, antes de o cliente confirmar) e AGUARDANDO_PAGAMENTO (o
 *   pedido do totem antes do cartão passar, o Pix do site antes de cair).
 *   Nenhum dos dois chegou a ser pedido, então também não foi cancelado:
 *   ninguém desistiu de uma venda, ela simplesmente não aconteceu. Contá-los
 *   como cancelados inflaria o número que o dono usa para cobrar a cozinha e o
 *   atendimento — num dia de totem são vários, todos "cancelados" sem que
 *   ninguém tenha cancelado nada. Ficam fora da lista e voltam só como uma
 *   contagem informativa ("não concluídos"), para não sumirem sem explicação.
 *
 * ── A conta que fecha ───────────────────────────────────────────────────────
 *
 * A Saipos mostra total dos itens, taxas, descontos e total lado a lado, e o
 * lojista que soma de cabeça não chega no total — ninguém diz de onde vem a
 * diferença. Aqui a conta é mostrada como conta:
 *
 *     total dos itens + taxas de entrega + outras taxas e ajustes − descontos
 *     = total dos pedidos
 *
 * "Outras taxas e ajustes" é o que sobra, pedido a pedido. Quase sempre é a
 * taxa de serviço que o APP cobra do cliente, e ela NÃO é fixa: na NIK, de 17
 * a 23/09/2026, 167 dos 168 pedidos do iFood tinham sobra, só 63 deles de
 * R$ 0,99; 144 seguiam "2% dos itens menos o desconto no item, mínimo
 * R$ 0,99, teto R$ 2,49" (o #62, de R$ 102,00, sobrou R$ 2,04), e dois
 * sobraram mais do que o pedido gravado explica (R$ 5,68 e R$ 9,53). No 99Food
 * a taxa de serviço deles deu de R$ 1,80 a R$ 4,87. Por isso a tela diz "taxa
 * de serviço do app, que varia", nunca um valor — o dono que multiplica
 * 172 × 0,99 e não chega no total desconfia do relatório inteiro. Também cai
 * aqui o item tirado de um pedido pago online, cujo total não muda porque tem
 * de bater com o repasse (lib/edicao-de-pedido.ts).
 *
 * "Total dos itens" é a MESMA soma do Itens vendidos (preço × quantidade de
 * cada item, sem pedido cancelado): os dois relatórios, no mesmo filtro, dão o
 * mesmo número — o lojista que confere um contra o outro não acha diferença.
 *
 * ── Vendas, lançamentos e a mesa: a régua única ─────────────────────────────
 *
 * O valor, as vendas e o ticket seguem lib/relatorios/regua-da-venda.ts, a
 * MESMA régua do Faturamento por dia, do Dia e hora e do Formas de pagamento.
 * O pedido de mesa entra como qualquer pedido, pelo `totalAmount` dele (o
 * consumo lançado): é o que tem itens, e só assim o total dos itens bate com o
 * Itens vendidos. Mas VENDA é o atendimento: a mesa de três rodadas são três
 * lançamentos e UMA venda, no primeiro lançamento. Até 24/09/2026 o cartão
 * principal dizia "Pedidos" e contava lançamento: na Pastel da Paulista, de 09
 * a 16/09, eram 635 "pedidos" aqui contra 495 vendas no Faturamento por dia e
 * 494 no Dia e hora — três números para a mesma semana. Agora o cartão é
 * "Vendas" (atendimentos), o ticket é valor ÷ vendas, e os lançamentos ficam
 * no detalhe e na lista (que continua sendo de pedidos).
 *
 * A taxa de serviço e a gorjeta NÃO moram no pedido: moram na sessão da mesa,
 * gravadas no fechamento. Entram numa linha própria, das mesas FECHADAS no
 * período, depois do total dos pedidos — é do garçom. O desconto dado ao
 * FECHAR a mesa também só se deduz da sessão (consumo − (pago − serviço −
 * gorjeta), a mesma fórmula do relatório Descontos) e sai na mesma linha, à
 * parte, no período em que a mesa FECHOU: NÃO é abatido do valor vendido. O
 * Descontos usa a mesma regra (mesas fechadas no período), então os totais
 * de desconto dos dois batem (ver "Quem segue a régua" em
 * regua-da-venda.ts). Caso real: Pastel da Paulista, mesa
 * fechada em 13/09/2026 com R$ 125,40 de consumo e nada pago (cortesia) — o
 * valor vendido continua com os R$ 125,40 (foram lançados), e o "Total com
 * serviço e gorjeta", que é o que entrou, desconta. É um piso: troco deixado
 * na mesa esconde parte do desconto.
 *
 * ── Valor impossível ────────────────────────────────────────────────────────
 *
 * Pedido de R$ 1 milhão ou mais não é venda, é erro de cadastro ou teste. Há
 * um de verdade: o #112 do site da Pastel da Paulista (12/09/2026, cancelado),
 * com item de R$ 100.000.000.000.000.000. Somado, o cartão "Cancelados" da
 * semana virava 17 dígitos — e em centavos ele passa do maior inteiro exato do
 * JavaScript, então os outros cancelados sumiam da soma. Fica FORA de todas as
 * somas e contagens, é CONTADO à parte (`valoresImpossiveis`) e continua na
 * lista, marcado, para o dono achar e corrigir. A régua (VALOR_IMPOSSIVEL) é a
 * do Faturamento por dia (lib/relatorios/faturamento-por-dia.ts) — os dois
 * relatórios, no mesmo período, dão o mesmo valor cancelado. Uma VENDA com
 * valor impossível sairia daqui e não do Itens vendidos, que não tem a trava;
 * em 24/09/2026 o único caso em produção é cancelado, que lá já não conta.
 */
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { repartirDesconto99 } from "@/lib/desconto-99food";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { parseComboSelections } from "@/lib/parse-combo";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import {
  canalDoRelatorio, fmtReais, naLoja, ROTULO_DO_TIPO, TIPOS_DE_VENDA, tipoDeVenda,
  type TipoDeVenda,
} from "@/lib/relatorios/base";
import {
  atendimentosDaVenda, cent, quantidadeDeItens, reais, servicoDasMesas, situacaoDoPedido, temValorImpossivel, ticketMedio, totalDosItens,
  type MesaFechada, type ServicoDasMesas, type Situacao,
} from "@/lib/relatorios/regua-da-venda";

// O que mudou de casa para a régua única continua saindo daqui: a rota, a
// tela e os testes importavam de "vendas" antes dela.
export {
  DESCONTO_NA_MESA_DESDE, VALOR_IMPOSSIVEL, descontoNoFechamento, quantidadeDeItens, situacaoDoPedido, temValorImpossivel, totalDosItens,
} from "@/lib/relatorios/regua-da-venda";
export type { MesaFechada, Situacao } from "@/lib/relatorios/regua-da-venda";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type ItemParaVendas = { quantity: number; price: number };

export type PedidoParaVendas = {
  id: string;
  franchiseeId: string;
  createdAt: Date | string;
  status: string;
  totalAmount: number;
  deliveryFee?: number | null;
  discountTotal?: number | null;
  discountMerchant?: number | null;
  /** A parte da PLATAFORMA (iFood ou 99Food — nome histórico, ver api/99food/webhook). */
  discountIfood?: number | null;
  /**
   * Só quando as colunas acima não dizem quem pagou (ver
   * `precisaDoDetalheDoDesconto`): o 99Food antigo guarda `promocoes` aqui.
   */
  discountDetails?: unknown;
  deliveryType?: string | null;
  source?: string | null;
  tableSessionId?: string | null;
  /** O acréscimo (a Coca a mais no pedido do iFood): não é venda nova quando o pai está no recorte. */
  parentOrderId?: string | null;
  totemLicenseId?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryReference?: string | null;
  dailyOrderNumber?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMethod?: string | null;
  /** Pagamento dividido do balcão: [{ method, amount }] (lib/pagamento-dividido.ts). */
  paymentMethods?: unknown;
  /** Só preço e quantidade: é o que o resumo e a lista usam. */
  items?: ItemParaVendas[];
};

/** A sessão da mesa de um pedido da lista — de onde sai o pagamento da mesa. */
export type SessaoDoPedido = { id: string; status?: string | null; paymentMethods?: unknown; mesa?: string | null };

/**
 * Canais em que só a LOJA pode ter dado o desconto: o caixa, a mesa, o totem,
 * o site, o robô e a Wabiz — que é o app com a MARCA do restaurante
 * (lib/wabiz-traducao.ts): cupom e fidelidade de lá saem do bolso da loja.
 * A mesma lista do relatório Descontos (lib/relatorios/descontos.ts).
 */
const CANAIS_PROPRIOS = new Set(["SITE", "PDV", "MESA", "TOTEM", "WHATSAPP_IA", "WABIZ"]);

export type DescontoDoPedido = { total: number; loja: number; plataforma: number; naoIdentificado: number };

/**
 * O pedido precisa de `discountDetails` para dizer quem pagou o desconto?
 * Só quando tem desconto e nenhuma das duas colunas de dono — hoje, o 99Food
 * anterior a 18/09/2026. A rota busca o detalhe SÓ desses (o do 99 carrega o
 * payload de preço inteiro), em vez de trazer a coluna para o período todo.
 */
export function precisaDoDetalheDoDesconto(p: Pick<PedidoParaVendas, "discountTotal" | "discountMerchant" | "discountIfood">): boolean {
  return p.discountMerchant == null && p.discountIfood == null && cent(p.discountTotal) > 0;
}

/**
 * O desconto do pedido e quem o bancou — a MESMA régua do relatório Descontos
 * (lib/relatorios/descontos.ts, descontoDoPedido), do recibo e da comanda:
 *
 * - Com as colunas (`discountMerchant` = loja, `discountIfood` = plataforma;
 *   o 99Food usa o mesmo campo desde 18/09/2026): valem as colunas.
 * - 99Food antigo, sem as colunas: as promoções gravadas em
 *   `discountDetails.promocoes` dizem quanto a loja bancou
 *   (`shop_subside_price`) — lib/desconto-99food.ts, `repartirDesconto99`.
 *   Era aqui que o relatório errava: jogava o desconto inteiro na plataforma.
 *   Frangoso - Trindade, 99Food de 11 a 18/09/2026: dizia loja R$ 0,00 e 99
 *   R$ 1.517,29, quando a loja bancou R$ 1.229,18 — o dono lia que o 99 tinha
 *   pago um desconto que saiu do bolso dele. Em produção, 112 dos 223 pedidos
 *   do 99 com desconto saíam errados.
 * - Canal próprio sem as colunas: só pode ter sido a loja.
 * - O resto não se inventa: vira "não identificado" (0 casos em 24/09/2026).
 *
 * `cupomDoMarketplace` (lib/cupom-do-parceiro.ts) não serve aqui: ele soma o
 * `discountIfood` com a conta das promoções do 99, e o 99 novo grava a parte
 * dele no `discountIfood` — contaria duas vezes.
 */
export function descontoDoPedido(p: PedidoParaVendas): DescontoDoPedido {
  const canal = canalDoRelatorio(p as any);
  let total = Math.max(0, cent(p.discountTotal));
  let loja = 0, plataforma = 0;
  if (p.discountMerchant != null || p.discountIfood != null) {
    loja = Math.max(0, cent(p.discountMerchant));
    plataforma = Math.max(0, cent(p.discountIfood));
  } else if (total > 0) {
    const dd = p.discountDetails;
    if (canal === "99FOOD") {
      const promocoes = dd && typeof dd === "object" && !Array.isArray(dd) ? (dd as Record<string, unknown>).promocoes : null;
      if (Array.isArray(promocoes) && promocoes.length) {
        const r = repartirDesconto99({ descontoTotal: reais(total), promocoes, taxaServico: 0, totalPago: 0 });
        loja = cent(r.loja);
        plataforma = cent(r.plataforma);
      }
    } else {
      // Brendi/Jotajá antigos: cada benefício diz o quanto é da loja e do app.
      let l = 0, pl = 0;
      for (const d of Array.isArray(dd) ? (dd as any[]) : []) {
        l += Math.max(0, Number(d?.merchant) || 0);
        pl += Math.max(0, Number(d?.ifood ?? d?.platform) || 0);
      }
      if (l + pl > 0) { loja = cent(l); plataforma = cent(pl); }
      else if (CANAIS_PROPRIOS.has(canal)) loja = total;
    }
  }
  total = Math.max(total, loja + plataforma);
  return { total: reais(total), loja: reais(loja), plataforma: reais(plataforma), naoIdentificado: reais(total - loja - plataforma) };
}

/** O que sobra da conta do pedido: total − (itens + entrega − desconto). Taxa do app, ajuste. */
export function outrasTaxasDoPedido(p: PedidoParaVendas): number {
  return reais(cent(p.totalAmount) - (cent(totalDosItens(p)) + cent(p.deliveryFee) - cent(descontoDoPedido(p).total)));
}

// ── O RESUMO ────────────────────────────────────────────────────────────────

/**
 * Uma linha de tipo de venda ou de canal. `vendas` são atendimentos (a mesa
 * conta uma vez, lib/relatorios/regua-da-venda.ts); `pedidos` são os
 * lançamentos. O ticket é valor ÷ vendas: por lançamento, a mesa de três
 * rodadas saía com um ticket de um terço da conta.
 */
export type LinhaPorTipo = {
  tipo: TipoDeVenda;
  rotulo: string;
  vendas: number;
  pedidos: number;
  valor: number;
  ticketMedio: number;
  /** Participação no total dos pedidos, 0 a 100. */
  pct: number;
};

export type LinhaPorCanal = { canal: string; nome: string; vendas: number; pedidos: number; valor: number; ticketMedio: number; pct: number };

export type ResumoDeVendas = {
  /** VENDAS (atendimentos): pedido sem mesa + 1 por mesa — o cartão principal. */
  atendimentos: number;
  /** Das vendas, quantas são contas de mesa. */
  mesas: number;
  /** Lançamentos: os pedidos que são venda (cada rodada de mesa é um). A lista é deles. */
  pedidos: number;
  /** O valor vendido: Σ totalAmount dos pedidos que são venda. */
  totalPedidos: number;
  totalItens: number;
  quantidadeDeItens: number;
  taxaEntrega: { valor: number; pedidos: number };
  outrasTaxas: { valor: number; pedidos: number };
  descontos: { total: number; loja: number; plataforma: number; naoIdentificado: number; pedidos: number };
  /**
   * Das mesas FECHADAS no período: taxa, gorjeta e o desconto dado ao fechar a
   * conta (`descontoNoFechamento`, à parte — não sai do valor vendido).
   */
  servico: ServicoDasMesas;
  /** O que entrou: total dos pedidos + serviço + gorjeta − desconto no fechamento. */
  totalComServico: number;
  /** Valor vendido ÷ vendas (atendimentos). */
  ticketMedio: number;
  porTipo: LinhaPorTipo[];
  porCanal: LinhaPorCanal[];
  cancelados: { pedidos: number; valor: number };
  naoConcluidos: { pedidos: number; valor: number };
  /** Pedidos fora de todas as somas e contagens por valor impossível (ver o topo). */
  valoresImpossiveis: number;
};

const CANAIS = new Map(canaisConhecidos().map((c) => [c.chave as string, c]));
/** "🔴 iFood" na tela; sem o emoji na planilha, onde ele atrapalha o filtro do Excel. */
export function nomeDoCanal(chave: string, comEmoji = true): string {
  const c = CANAIS.get(chave);
  if (!c) return chave;
  return comEmoji ? `${c.emoji} ${c.nome}` : c.nome;
}

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100000) / 1000 : 0);

/**
 * O resumo do período. `pedidos` vêm com cancelados e não concluídos (a rota
 * busca com `incluirForaDaVenda`) — cada um cai na sua situação aqui.
 * `mesas` são as sessões FECHADAS no período, já filtradas
 * (lib/relatorios/mesas-do-periodo.ts).
 */
export function resumoDeVendas(pedidos: PedidoParaVendas[], mesas: MesaFechada[] = []): ResumoDeVendas {
  let nVendas = 0, cTotal = 0, cItens = 0, qItens = 0;
  let cTaxa = 0, nTaxa = 0, cOutras = 0, nOutras = 0;
  let cDesc = 0, cDescLoja = 0, cDescPlat = 0, cDescNao = 0, nDesc = 0;
  let nCanc = 0, cCanc = 0, nNao = 0, cNao = 0, nImpossiveis = 0;
  const porTipo = new Map<TipoDeVenda, { vendas: number; pedidos: number; c: number }>();
  const porCanal = new Map<string, { vendas: number; pedidos: number; c: number }>();
  // Quem abre uma venda: o pedido comum, o 1º lançamento de cada mesa (regua-da-venda.ts).
  const at = atendimentosDaVenda(pedidos);

  for (const p of pedidos) {
    // Antes de tudo: nem venda, nem cancelado — um número de 17 dígitos não
    // pode entrar em soma nenhuma (ver "Valor impossível" no topo).
    if (temValorImpossivel(p)) { nImpossiveis++; continue; }
    const situacao = situacaoDoPedido(p.status);
    if (situacao === "cancelado") { nCanc++; cCanc += cent(p.totalAmount); continue; }
    if (situacao === "naoConcluido") { nNao++; cNao += cent(p.totalAmount); continue; }

    nVendas++;
    const total = cent(p.totalAmount);
    cTotal += total;
    cItens += cent(totalDosItens(p));
    qItens += quantidadeDeItens(p);
    const taxa = cent(p.deliveryFee);
    if (taxa > 0) { cTaxa += taxa; nTaxa++; }
    const d = descontoDoPedido(p);
    if (d.total > 0) { cDesc += cent(d.total); cDescLoja += cent(d.loja); cDescPlat += cent(d.plataforma); cDescNao += cent(d.naoIdentificado); nDesc++; }
    const outras = cent(outrasTaxasDoPedido(p));
    if (outras !== 0) { cOutras += outras; nOutras++; }

    const abre = at.abre.has(p.id) ? 1 : 0;
    const tipo = tipoDeVenda(p as any);
    const t = porTipo.get(tipo) || { vendas: 0, pedidos: 0, c: 0 };
    t.vendas += abre;
    t.pedidos++;
    t.c += total;
    porTipo.set(tipo, t);

    const canal = canalDoRelatorio(p as any);
    const c = porCanal.get(canal) || { vendas: 0, pedidos: 0, c: 0 };
    c.vendas += abre;
    c.pedidos++;
    c.c += total;
    porCanal.set(canal, c);
  }

  // Serviço, gorjeta e desconto no fechamento: das mesas fechadas, à parte
  // (servicoDasMesas explica por que a taxa soma crua e a negativa é desconto).
  const servico = servicoDasMesas(mesas);

  const totalPedidos = reais(cTotal);
  return {
    atendimentos: at.vendas,
    mesas: at.mesas,
    pedidos: nVendas,
    totalPedidos,
    totalItens: reais(cItens),
    quantidadeDeItens: Math.round(qItens * 1000) / 1000,
    taxaEntrega: { valor: reais(cTaxa), pedidos: nTaxa },
    outrasTaxas: { valor: reais(cOutras), pedidos: nOutras },
    descontos: { total: reais(cDesc), loja: reais(cDescLoja), plataforma: reais(cDescPlat), naoIdentificado: reais(cDescNao), pedidos: nDesc },
    servico,
    totalComServico: reais(cTotal + cent(servico.taxa) + cent(servico.gorjeta) - cent(servico.descontoNaMesa)),
    ticketMedio: ticketMedio(totalPedidos, at.vendas),
    porTipo: TIPOS_DE_VENDA.filter((t) => porTipo.has(t)).map((tipo) => {
      const t = porTipo.get(tipo)!;
      const valor = reais(t.c);
      return { tipo, rotulo: ROTULO_DO_TIPO[tipo], vendas: t.vendas, pedidos: t.pedidos, valor, ticketMedio: ticketMedio(valor, t.vendas), pct: pct(t.c, cTotal) };
    }),
    porCanal: [...porCanal.entries()]
      .map(([canal, c]) => ({ canal, nome: nomeDoCanal(canal), vendas: c.vendas, pedidos: c.pedidos, valor: reais(c.c), ticketMedio: ticketMedio(reais(c.c), c.vendas), pct: pct(c.c, cTotal) }))
      .sort((a, b) => b.valor - a.valor || b.vendas - a.vendas),
    cancelados: { pedidos: nCanc, valor: reais(cCanc) },
    naoConcluidos: { pedidos: nNao, valor: reais(cNao) },
    valoresImpossiveis: nImpossiveis,
  };
}

// ── A LISTA ─────────────────────────────────────────────────────────────────

/** "" = todas (vendas e canceladas), "vendas" = não canceladas, "canceladas" = só canceladas. */
export type FiltroDeStatus = "" | "vendas" | "canceladas";

export function lerFiltroDeStatus(v: string | null | undefined): FiltroDeStatus {
  return v === "vendas" || v === "canceladas" ? v : "";
}

export const ROTULO_DO_FILTRO_DE_STATUS: Record<FiltroDeStatus, string> = {
  "": "Todas",
  vendas: "Não canceladas",
  canceladas: "Só canceladas",
};

/**
 * A query sem os filtros de ITEM (categorias, produtos). Este relatório é de
 * PEDIDO — um pedido tem esfiha e refrigerante, não "é" da categoria Bebidas —
 * e a rota não os aplica. Mas a URL os carregava: o link "Vendas por período"
 * do Itens vendidos leva a query de lá, e o "confere com Itens vendidos" daqui
 * os levava de volta. Com Bebidas filtrado lá, o lojista chegava aqui com um
 * filtro invisível (a barra daqui não mostra categoria) e impossível de tirar,
 * e o "confere" abria R$ 1.414,50 contra os R$ 24.931,10 daqui (NIK, 17 a
 * 23/09/2026). A página tira os dois na entrada.
 */
export function semFiltrosDeItem(query: string): string {
  const sp = new URLSearchParams(query);
  sp.delete("categorias");
  sp.delete("produtos");
  return sp.toString();
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const soDigitos = (s: string) => s.replace(/\D/g, "");

/**
 * O pedido casa com a busca? Número do pedido (#12 ou 12, exato), número no
 * app (iFood/99/Brendi — contém), nome do cliente (sem acento, contém) ou
 * telefone (4 dígitos ou mais, contém: o lojista costuma lembrar do final).
 */
export function casaComBusca(p: PedidoParaVendas, termo: string): boolean {
  const t = semAcento(termo);
  if (!t) return true;
  const semCerquilha = t.replace(/^#\s*/, "");
  if (p.dailyOrderNumber != null && /^\d+$/.test(semCerquilha) && Number(semCerquilha) === p.dailyOrderNumber) return true;
  for (const ref of [p.ifoodReference, p.openDeliveryReference]) {
    if (!ref) continue;
    const r = semAcento(String(ref)).replace(/^#/, "");
    if (semCerquilha.length >= 3 ? r.includes(semCerquilha) : r === semCerquilha) return true;
  }
  if (/\p{L}/u.test(t) && semAcento(p.customerName || "").includes(t)) return true;
  const digitos = soDigitos(t);
  if (digitos.length >= 4 && digitos.length === t.replace(/[\s()+.\-]/g, "").length && soDigitos(telefoneDoCliente(p.customerPhone)).includes(digitos)) return true;
  return false;
}

/**
 * Os pedidos da LISTA, do mais recente para o mais antigo. Não concluídos
 * nunca entram (nem em "todas", nem em "só canceladas" — ver o topo).
 */
export function pedidosDaLista<P extends PedidoParaVendas>(pedidos: P[], status: FiltroDeStatus, busca: string): P[] {
  return pedidos
    .filter((p) => {
      const s = situacaoDoPedido(p.status);
      if (s === "naoConcluido") return false;
      if (status === "vendas" && s !== "venda") return false;
      if (status === "canceladas" && s !== "cancelado") return false;
      return casaComBusca(p, busca);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.id.localeCompare(b.id));
}

export const POR_PAGINA = 50;

/** A página pedida, sempre dentro do que existe (página 9 de 3 vira a 3). */
export function paginar<T>(lista: T[], pagina: number, porPagina = POR_PAGINA): { pagina: number; paginas: number; total: number; itens: T[] } {
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const p = Math.min(paginas, Math.max(1, Math.floor(Number(pagina) || 1)));
  return { pagina: p, paginas, total: lista.length, itens: lista.slice((p - 1) * porPagina, p * porPagina) };
}

// ── UMA LINHA DA LISTA ──────────────────────────────────────────────────────

const formatadores = new Map<string, Intl.DateTimeFormat>();
/** "dd/mm/aaaa" e "HH:MM" no relógio da loja — o do calendário, não o dia operacional. */
export function dataEHoraNaLoja(instante: Date | string, tz: string | null | undefined): { data: string; hora: string } {
  const fuso = tz || "America/Sao_Paulo";
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    formatadores.set(fuso, f);
  }
  const p: Record<string, string> = {};
  for (const parte of f.formatToParts(typeof instante === "string" ? new Date(instante) : instante)) p[parte.type] = parte.value;
  return { data: `${p.day}/${p.month}/${p.year}`, hora: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}` };
}

const ROTULO_DO_STATUS: Record<string, string> = {
  NOVO: "Novo", RECEBIDO: "Recebido", PENDENTE: "Pendente", CONFIRMADO: "Confirmado", ACEITO: "Aceito",
  PREPARANDO: "Em preparo", EM_PREPARO: "Em preparo", EM_ANDAMENTO: "Em preparo", PRONTO: "Pronto",
  SAIU_ENTREGA: "Saiu para entrega", SAIU_PARA_ENTREGA: "Saiu para entrega", EM_ROTA: "Saiu para entrega",
  ENTREGUE: "Entregue", ENCERRADO: "Encerrado", CONCLUIDO: "Concluído",
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento", CRIANDO_IA: "Rascunho do robô",
};

/**
 * O status como o lojista fala. "Saiu para entrega" numa RETIRADA é o pedido
 * pronto no balcão (lib/status-para-o-cliente.ts), e "Entregue" nela é
 * "Retirado"; na mesa, entregue é a conta fechada.
 */
export function rotuloDoStatus(status: string | null | undefined, tipo: TipoDeVenda): string {
  const s = String(status || "").toUpperCase();
  if ((STATUS_CANCELADOS as readonly string[]).includes(s)) return "Cancelado";
  const finalizado = s === "ENTREGUE" || s === "ENCERRADO" || s === "CONCLUIDO";
  if (tipo === "RETIRADA" || tipo === "BALCAO" || tipo === "TOTEM") {
    if (finalizado) return tipo === "RETIRADA" ? "Retirado" : "Entregue";
    if (s === "SAIU_ENTREGA" || s === "SAIU_PARA_ENTREGA" || s === "EM_ROTA") return "Pronto para retirar";
  }
  if (tipo === "MESA" && finalizado) return "Conta fechada";
  return ROTULO_DO_STATUS[s] || (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "—");
}

/**
 * Como o pedido foi pago, em texto. Pagamento dividido sai das PARTES (a
 * verdade do caixa, lib/pagamento-dividido.ts), não do texto do pedido; o de
 * mesa sai das baixas da sessão — o pedido de mesa nasce "N/A" e nunca
 * recebe a forma real (ver lib/esperado-do-turno.ts).
 */
export function pagamentoDoPedido(p: PedidoParaVendas, sessao?: SessaoDoPedido | null): string {
  const partes = lerPagamentos(p.paymentMethods);
  if (partes.length >= 2) return `Dividido: ${partes.map((x) => `${x.method} ${fmtReais(x.amount)}`).join(" + ")}`;
  if (p.tableSessionId) {
    if (sessao) {
      const fechada = String(sessao.status || "").toUpperCase() === "CLOSED";
      if (!fechada) return "Mesa ainda aberta";
      const formas = [...new Set(lerPagamentos(sessao.paymentMethods).map((x) => x.method))];
      return formas.length ? `Conta da mesa: ${formas.join(" + ")}` : "Conta da mesa";
    }
    return "Conta da mesa";
  }
  if (partes.length === 1) return partes[0].method;
  const pm = String(p.paymentMethod || "").trim();
  return pm && pm.toUpperCase() !== "N/A" ? pm : "—";
}

/** O número que o lojista procura: "#12" do dia e, no marketplace, o do app. */
export function numeroDoPedido(p: PedidoParaVendas): { numero: string; noApp: string | null } {
  const ref = p.ifoodReference || p.openDeliveryReference || null;
  return {
    numero: p.dailyOrderNumber != null ? `#${p.dailyOrderNumber}` : "—",
    noApp: ref ? String(ref).replace(/^#/, "") : null,
  };
}

/**
 * O telefone que vale mostrar. O balcão grava "00000000000" quando o cliente
 * não deu telefone (NIK, 23/09/2026: todo pedido de balcão); isso não é
 * telefone de ninguém.
 */
export function telefoneDoCliente(tel: string | null | undefined): string {
  const t = String(tel || "").trim();
  return /^0*$/.test(soDigitos(t)) ? "" : t;
}

/**
 * O final do telefone para a PLANILHA: "…4321". O arquivo sai da loja
 * (e-mail, contador, pendrive); o telefone inteiro fica na tela, que é onde o
 * atendente precisa dele. O final basta para achar o cliente.
 */
export function finalDoTelefone(tel: string | null | undefined): string {
  const d = soDigitos(telefoneDoCliente(tel));
  return d.length >= 4 ? `…${d.slice(-4)}` : "";
}

export type LinhaDePedido = {
  id: string;
  quando: string;
  data: string;
  hora: string;
  /** O dia do expediente (vira às 5h) — difere da data na madrugada. */
  diaOperacional: string;
  numero: string;
  noApp: string | null;
  cliente: string;
  telefone: string;
  canal: string;
  canalNome: string;
  tipo: TipoDeVenda;
  tipoRotulo: string;
  mesa: string | null;
  pagamento: string;
  status: string;
  statusRotulo: string;
  situacao: Situacao;
  itens: number;
  totalItens: number;
  taxaEntrega: number;
  outrasTaxas: number;
  desconto: number;
  descontoLoja: number;
  descontoPlataforma: number;
  /** A parte do desconto que o pedido não diz de quem é (ver descontoDoPedido). */
  descontoSemDono: number;
  total: number;
  /** R$ 1 milhão ou mais: aparece na lista, marcado, e fica fora de toda soma. */
  valorImpossivel: boolean;
};

export function linhaDoPedido(p: PedidoParaVendas, tz: string | null | undefined, sessao?: SessaoDoPedido | null): LinhaDePedido {
  const { data, hora } = dataEHoraNaLoja(p.createdAt, tz);
  const tipo = tipoDeVenda(p as any);
  const canal = canalDoRelatorio(p as any);
  const d = descontoDoPedido(p);
  const { numero, noApp } = numeroDoPedido(p);
  return {
    id: p.id,
    quando: new Date(p.createdAt).toISOString(),
    data,
    hora,
    diaOperacional: naLoja(p.createdAt, tz).dia,
    numero,
    noApp,
    cliente: String(p.customerName || "").trim() || "—",
    telefone: telefoneDoCliente(p.customerPhone),
    canal,
    canalNome: nomeDoCanal(canal),
    tipo,
    tipoRotulo: ROTULO_DO_TIPO[tipo],
    mesa: sessao?.mesa || null,
    pagamento: pagamentoDoPedido(p, sessao),
    status: String(p.status || ""),
    statusRotulo: rotuloDoStatus(p.status, tipo),
    situacao: situacaoDoPedido(p.status),
    itens: quantidadeDeItens(p),
    totalItens: totalDosItens(p),
    taxaEntrega: reais(cent(p.deliveryFee)),
    outrasTaxas: outrasTaxasDoPedido(p),
    desconto: d.total,
    descontoLoja: d.loja,
    descontoPlataforma: d.plataforma,
    descontoSemDono: d.naoIdentificado,
    total: reais(cent(p.totalAmount)),
    valorImpossivel: temValorImpossivel(p),
  };
}

export type SomaDasLinhas = {
  pedidos: number; cancelados: number; valorCancelado: number; totalItens: number; taxaEntrega: number; outrasTaxas: number;
  desconto: number; descontoLoja: number; descontoPlataforma: number; descontoSemDono: number; total: number;
  /** Linhas deixadas fora da soma por valor impossível — a mesma régua do resumo. */
  valoresImpossiveis: number;
};

/** A soma das linhas da lista que são VENDA — o rodapé da tabela e da planilha. */
export function somaDasLinhas(linhas: LinhaDePedido[]): SomaDasLinhas {
  const s = { pedidos: 0, cancelados: 0, valorCancelado: 0, totalItens: 0, taxaEntrega: 0, outrasTaxas: 0, desconto: 0, descontoLoja: 0, descontoPlataforma: 0, descontoSemDono: 0, total: 0, valoresImpossiveis: 0 };
  for (const l of linhas) {
    if (l.valorImpossivel) { s.valoresImpossiveis++; continue; }
    if (l.situacao !== "venda") { if (l.situacao === "cancelado") { s.cancelados++; s.valorCancelado += cent(l.total); } continue; }
    s.pedidos++;
    s.totalItens += cent(l.totalItens); s.taxaEntrega += cent(l.taxaEntrega); s.outrasTaxas += cent(l.outrasTaxas);
    s.desconto += cent(l.desconto); s.descontoLoja += cent(l.descontoLoja); s.descontoPlataforma += cent(l.descontoPlataforma); s.descontoSemDono += cent(l.descontoSemDono);
    s.total += cent(l.total);
  }
  return {
    pedidos: s.pedidos, cancelados: s.cancelados, valorCancelado: reais(s.valorCancelado), totalItens: reais(s.totalItens), taxaEntrega: reais(s.taxaEntrega), outrasTaxas: reais(s.outrasTaxas),
    desconto: reais(s.desconto), descontoLoja: reais(s.descontoLoja), descontoPlataforma: reais(s.descontoPlataforma), descontoSemDono: reais(s.descontoSemDono), total: reais(s.total),
    valoresImpossiveis: s.valoresImpossiveis,
  };
}

// ── O DETALHE DE UM PEDIDO ──────────────────────────────────────────────────

const QUEM_CANCELOU: Record<string, string> = {
  LOJA: "pela loja", RESTAURANT: "pela loja", MERCHANT: "pela loja",
  CUSTOMER: "pelo cliente", CLIENTE: "pelo cliente",
  IFOOD: "pelo iFood", "99FOOD": "pelo 99Food", BRENDI: "pela Brendi", JOTAJA: "pelo Jotajá", WABIZ: "pela Wabiz",
  SYSTEM_INACTIVITY: "pelo sistema (pedido parado sem resposta)",
};

/** "pela loja", "pelo iFood" — o `cancelledBy` gravado é código (LOJA, IFOOD, CUSTOMER…), não frase. */
export function quemCancelou(cancelledBy: string | null | undefined): string | null {
  const c = String(cancelledBy || "").trim().toUpperCase();
  if (!c) return null;
  return QUEM_CANCELOU[c] || `por ${c.toLowerCase().replace(/_/g, " ")}`;
}

export type ItemDoDetalhe = {
  quantity: number;
  price: number;
  productName?: string | null;
  comboSelections?: unknown;
  notes?: string | null;
  menuProduct?: { name?: string | null } | null;
};

export type ItemDetalhado = {
  nome: string;
  quantidade: number;
  unitario: number;
  total: number;
  /** As escolhas por UNIDADE do item (sabor, borda, adicional), com o preço quando o canal mandou. */
  opcoes: { nome: string; quantidade: number; preco: number | null }[];
  observacao: string | null;
};

/**
 * Os itens do pedido com as opções, pela leitura única de comboSelections
 * (lib/parse-combo.ts — a mesma da comanda e do KDS: o que o lojista vê aqui é
 * o que a cozinha viu).
 */
export function itensDoDetalhe(itens: ItemDoDetalhe[]): ItemDetalhado[] {
  return itens.map((i) => {
    const opcoes = parseComboSelections(i.comboSelections, 1).map((o) => ({
      nome: o.name,
      quantidade: o.quantity,
      preco: o.price !== undefined && Number.isFinite(o.price) && o.price > 0 ? o.price : null,
    }));
    const gravado = String(i.productName || "").trim();
    // Com as opções listadas, o "Pizza | Borda X" do nome gravado repetiria a borda.
    const nome = (opcoes.length && gravado.includes(" | ") ? gravado.split(" | ")[0] : gravado) || i.menuProduct?.name || "Produto removido";
    const q = Number(i.quantity) || 0;
    const unitario = Number(i.price) || 0;
    return { nome: nome.trim(), quantidade: q, unitario, total: reais(Math.round(unitario * q * 100)), opcoes, observacao: String(i.notes || "").trim() || null };
  });
}
