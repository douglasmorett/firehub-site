/**
 * lib/wabiz-traducao.ts — pedido da Wabiz → dados do CustomerOrder, sem banco.
 *
 * Separado de processWabizOrder para ser testado com os exemplos da doc:
 *   npx tsx scripts/teste-traducao-wabiz.ts
 */
import { observacaoDasPartes } from "@/lib/observacao-do-item";
import { dataHoraDaLoja } from "@/lib/fuso";
import { coordenadasDoParceiro } from "./coordenadas-do-parceiro";
import { isBeverageName } from "@/lib/beverage";
import type { WabizPedido, WabizParte, WabizPagamento } from "@/lib/wabiz-api";

export const dinheiro = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
export const texto = (v: unknown) => (v == null ? "" : String(v).trim());

/**
 * "2026-09-12 19:30:00" no relógio da loja → instante real.
 * O offset é medido no próprio fuso, então horário de verão não engana.
 */
export function horaLocalParaInstante(valor: string | null | undefined, timeZone: string): Date | null {
  const m = texto(valor).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, a, mes, d, h, min, s] = m;
  const comoUtc = Date.UTC(+a, +mes - 1, +d, +h, +min, +(s || 0));
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(comoUtc));
  const p = (t: string) => Number(partes.find((x) => x.type === t)?.value || 0);
  const vistoNoFuso = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  return new Date(comoUtc - (vistoNoFuso - comoUtc));
}

/** Nome da forma de pagamento + se já chegou pago. Tipos da doc: 1 Dinheiro … 7 Pix. */
export function traduzirPagamento(pag: WabizPagamento | null | undefined, total: number) {
  const tipo = Number(pag?.type) || 0;
  const nomeDaWabiz = texto(pag?.name);
  const base =
    tipo === 1 ? "Dinheiro"
    : tipo === 2 ? "Cheque"
    : tipo === 3 ? `Cartão${texto(pag?.cardFlag) ? ` ${texto(pag?.cardFlag)}` : ""}`
    : tipo === 4 ? "Pagamento Online (Wabiz)"
    : tipo === 5 ? "Boleto"
    : tipo === 6 ? "Transferência Bancária"
    : tipo === 7 ? "Pix"
    : nomeDaWabiz || "A combinar";

  // Só o pagamento online (4) chega pago. Pix (7) e transferência (6) na Wabiz
  // são combinados com a loja — sem confirmação na API, cobrar é o seguro:
  // comanda "Pago" em pedido que ninguém pagou é prejuízo; o contrário é uma
  // pergunta do motoboy.
  const pago = tipo === 4;

  // `value` é quanto o cliente vai entregar; troco só faz sentido em dinheiro.
  const valor = dinheiro(pag?.value);
  const changeAmount = tipo === 1 && valor > total + 0.009 ? valor : null;

  return {
    paymentMethod: `${base} (${pago ? "Pago Online" : "Cobrar na Entrega"})`,
    changeAmount,
  };
}

/**
 * De ONDE veio o desconto, para a comanda não dizer só "Desconto".
 *
 * A v2 do `orders/pending` traz `fidelity` (troca por pontos) e
 * `discountCoupon` (cupom) — informativos, sem entrar em conta nenhuma. O
 * formato não foi declarado pela Wabiz, então a leitura é tolerante: serve
 * qualquer objeto, e o código do cupom sai junto quando estiver em algum dos
 * nomes prováveis.
 *
 * Sem os campos — Assistente da v1, ou pedido sem nenhum dos dois — volta a
 * ser o "Desconto" de sempre, que é o certo: melhor genérico que errado.
 */
export function motivoDoDesconto(pedido: WabizPedido): string {
  const cupom = pedido?.discountCoupon as any;
  if (cupom) {
    const codigo = texto(cupom?.code ?? cupom?.coupon ?? cupom?.name ?? (typeof cupom === "string" ? cupom : ""));
    return codigo ? `Cupom ${codigo}` : "Cupom";
  }
  if (pedido?.fidelity) return "Troca de fidelidade";
  return "Desconto";
}

type OpcaoDaParte = {
  id: string;
  /** Como sai na comanda, sem quantidade: "Borda Cheddar", "Esfiha Carne". */
  nome: string;
  quantidade: number;
  preco: number;
  /**
   * A opção pertence à METADE (bacon só na metade Portuguesa) ou à pizza
   * inteira (a borda, a Coca grátis do combo)? A Wabiz diz em `acceptPartition`.
   * Sem o campo — os exemplos antigos da doc — vale "da metade", que era o
   * comportamento anterior.
   */
  daMetade: boolean;
};

/**
 * Quantas unidades desta opção o cliente escolheu.
 *
 * ── O combo que chegou pela metade ──────────────────────────────────────────
 *
 * Combo 4 da NIK: 12 esfihas obrigatórias (5 tradicionais, 5 especiais, 2
 * doces). O pedido #3683 (22/09/2026) gravou OITO opções, todas com
 * quantidade 1 — e a cozinha recebeu a comanda com oito linhas para doze
 * esfihas. O lojista escreveu "+1" à caneta em quatro delas para conseguir
 * produzir. No mesmo pedido, "6 Esfihas Tradicionais + Guaraná" trouxe UMA
 * esfiha.
 *
 * Este leitor assumia que a quantidade só existia por REPETIÇÃO — três
 * "Esfiha Muçarela" chegando como três opções iguais, que era o formato
 * medido em setembro. Quando a quantidade vem como campo, ela era ignorada e
 * virava 1.
 *
 * Agora vale o campo quando ele existe, e a repetição continua valendo quando
 * não existe. Os dois caminhos somam no mesmo lugar, então um sabor que venha
 * repetido E com quantidade fecha a conta certa.
 */
function quantidadeDaOpcao(o: { qty?: unknown; quantity?: unknown; amount?: unknown; qtd?: unknown }): number {
  for (const bruto of [o?.qty, o?.quantity, o?.amount, o?.qtd]) {
    if (bruto === null || bruto === undefined || bruto === "") continue;
    const n = Math.floor(Number(bruto));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

/** Borda, adicionais e "outros" (sabores do combo, bebida grátis) de UMA parte. */
function opcoesDaParte(parte: WabizParte): OpcaoDaParte[] {
  const c = parte.customization;
  const saida: OpcaoDaParte[] = [];
  const juntar = (
    rotulo: string | null,
    ops: Array<{
      externalCode?: string | null;
      name?: string | null;
      price?: number | null;
      acceptPartition?: boolean;
      qty?: unknown;
      quantity?: unknown;
      amount?: unknown;
      qtd?: unknown;
    }> | null | undefined
  ) => {
    for (const o of ops || []) {
      const nome = texto(o?.name);
      if (!nome) continue;
      const exibido = rotulo ? `${rotulo} ${nome}` : nome;
      const quantas = quantidadeDaOpcao(o);
      // ── Sabor repetido vem REPETIDO, ou com quantidade ───────────────────
      // Medido no pedido real nº 4 (Combo 3 e "6 Esfihas"): 3 Esfihas Muçarela
      // chegam como três opções iguais. Sem agrupar, a comanda listava o mesmo
      // sabor três vezes e a cozinha tinha de contar. Somar `quantas` (e não
      // 1) faz os dois formatos caírem no mesmo total — ver quantidadeDaOpcao.
      const igual = saida.find((s) => s.nome === exibido);
      if (igual) {
        igual.quantidade += quantas;
        continue;
      }
      saida.push({
        id: texto(o?.externalCode) || nome,
        nome: exibido,
        quantidade: quantas,
        preco: dinheiro(o?.price),
        daMetade: o?.acceptPartition !== false,
      });
    }
  };
  if (c?.edge) juntar("Borda", c.edge.options);
  // No pedido real da sandbox (12/09/2026) a borda NÃO veio em `edge`, como a
  // doc mostra: veio em `others` com o grupo chamado "Bordas". Sem o rótulo a
  // comanda dizia só "Catupiry Original", que a cozinha lê como recheio.
  for (const g of c?.others || []) juntar(/borda/i.test(texto(g?.name)) ? "Borda" : null, g?.options);
  for (const g of c?.additionals || []) juntar(null, g?.options);
  return saida;
}

const comQuantidade = (o: OpcaoDaParte) => (o.quantidade > 1 ? `${o.quantidade}x ${o.nome}` : o.nome);

/**
 * A tradução pura: pedido da Wabiz → dados do CustomerOrder, sem tocar no banco.
 * Separada para ser testável com os exemplos da doc (scripts/teste-traducao-wabiz.ts).
 */
export function traduzirPedidoWabiz(
  pedido: WabizPedido,
  ctx: { lojaId: string; fuso: string; autoAcceptOrders: boolean }
) {
  const internalKey = texto(pedido?.internalKey);
  const orderNumber = texto(pedido?.orderNumber);
  const franchiseeId = ctx.lojaId;
  const fuso = ctx.fuso;
  const loja = { id: ctx.lojaId, autoAcceptOrders: ctx.autoAcceptOrders };
  const servico = pedido.service || {};
  const tipoServico = texto(servico.type);
  const tipo = tipoServico.toLowerCase();

  // ── Itens ────────────────────────────────────────────────────────────────
  const notasDeItem: string[] = [];
  const items: any[] = [];
  for (const grupo of pedido.items || []) {
    for (const prod of grupo?.products || []) {
      const partes = (prod?.parts || []).filter(Boolean);
      const qtd = Math.max(1, Number(prod?.qty) || 1);
      const frac = partes.length;

      const nomesDasPartes = partes.map((p) => texto(p.name) || "Item");
      const nomeBase = frac > 1 ? nomesDasPartes.map((n) => `1/${frac} ${n}`).join(" + ") : nomesDasPartes[0] || texto(grupo?.groupName) || "Item";
      const unidade = texto(prod?.unity);
      const nomeComTamanho = unidade && unidade.toLowerCase() !== "un" ? `${nomeBase} (${unidade})` : nomeBase;

      const opcoes: string[] = [];
      const selecoes: Array<{ id: string; name: string; quantity: number; price: number }> = [];
      partes.forEach((p, i) => {
        for (const o of opcoesDaParte(p)) {
          // Meio-a-meio: diz de qual metade é o adicional, senão a cozinha erra.
          // Borda e bebida grátis são da pizza inteira (acceptPartition false):
          // "Caipira: Coca Cola Zero" — como saía no pedido real nº 5 — mandava
          // procurar uma Coca na metade da pizza.
          const prefixo = frac > 1 && o.daMetade ? `${nomesDasPartes[i]}: ` : "";
          opcoes.push(prefixo + comQuantidade(o));
          selecoes.push({ id: o.id, name: prefixo + o.nome, quantity: o.quantidade, price: o.preco });
        }
        if (texto(p.obs)) notasDeItem.push(`${frac > 1 ? nomesDasPartes[i] : nomeComTamanho}: ${texto(p.obs)}`);
      });

      const nomeCompleto = [nomeComTamanho, ...opcoes].join(" | ");
      const precoUnit = dinheiro(prod?.price ?? partes.reduce((s, p) => s + (Number(p.price) || 0), 0));

      // Código do produto no espelho: o externalCode da Wabiz é o código "do
      // sistema local" e pode repetir entre lojas ("111"), então o id carrega a
      // loja. Sem código, cai no nome — o espelho continua um por produto.
      //
      // Cada parte entra no id — com o código dela ou, sem código, o nome. No
      // pedido real nº 2 a metade Muçarela veio com `externalCode: ""`; filtrar
      // as vazias deixava o meio-a-meio com o id da Portuguesa inteira, e o
      // espelho de um virava o do outro.
      const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
      const codigo = partes
        .map((p, i) => texto(p.externalCode) || slug(nomesDasPartes[i]))
        .join("+")
        .slice(0, 120) || slug(nomeComTamanho).slice(0, 60);
      const idEspelho = `wabiz-${franchiseeId}-${codigo}`;

      items.push({
        price: precoUnit,
        quantity: qtd,
        productName: nomeCompleto,
        // A observação de cada METADE, na coluna que a comanda imprime. Eram
        // 0 de 15 itens: `p.obs` só ia para o rodapé do pedido, e numa pizza
        // meio a meio o rodapé não diz de qual lado é — ver
        // lib/observacao-do-item.ts.
        notes: observacaoDasPartes(
          partes.map((p, i) => ({ rotulo: frac > 1 ? nomesDasPartes[i] : nomeComTamanho, observacao: texto(p.obs) }))
        ),
        comboSelections: selecoes.length > 0 ? JSON.stringify(selecoes) : null,
        menuProduct: {
          connectOrCreate: {
            where: { id: idEspelho },
            create: {
              id: idEspelho,
              franchiseeId: loja.id,
              name: nomeComTamanho,
              description: "",
              price: precoUnit,
              category: texto(grupo?.groupName) || "Wabiz",
              isBeverage: isBeverageName(nomeComTamanho) || isBeverageName(texto(grupo?.groupName)),
              active: false,
            },
          },
        },
      });
    }
  }

  // ── Entrega / retirada ───────────────────────────────────────────────────
  const entrega = servico.delivery;
  const interna = servico.internalDelivery;
  const ehEntrega = !!entrega || tipo.includes("delivery") && !tipo.includes("internal");
  const ehEntregaInterna = !!interna || tipo.includes("internal");
  // ── MESA É MESA ──────────────────────────────────────────────────────────
  // O pedido feito pelo app na mesa (`service.type = "table"`) caía em
  // RETIRADA: só havia dois destinos. Aí o "pronto" da cozinha marcava SAIU_
  // ENTREGA, o cliente sentado recebia "seu pedido está pronto para retirar"
  // no WhatsApp, e o fechamento contava a mesa como balcão. O FireHub tem o
  // tipo MESA desde o balcão e o painel de mesas; é ele que vale aqui.
  const ehMesa = tipo === "table" || !!texto(servico.tableCode);
  const deliveryType = ehEntrega || ehEntregaInterna ? "DELIVERY" : ehMesa ? "MESA" : "RETIRADA";

  const customerAddress = (() => {
    if (entrega) {
      const rua = [texto(entrega.address), texto(entrega.number)].filter(Boolean).join(", ");
      const partes = [
        rua + (texto(entrega.compl) ? ` - ${texto(entrega.compl)}` : ""),
        texto(entrega.region),
        [texto(entrega.city), texto(entrega.state)].filter(Boolean).join("/"),
        texto(entrega.postalCode) ? `CEP ${texto(entrega.postalCode)}` : "",
      ].filter(Boolean);
      return partes.join(" - ");
    }
    if (interna) return texto(interna.info);
    return "";
  })();

  const deliveryFee = dinheiro(entrega?.tax);
  const total = dinheiro(pedido.total);
  const desconto = dinheiro(pedido.discounts);

  const pagamento = entrega?.payment || interna?.payment || servico.payment || null;
  const { paymentMethod, changeAmount } = traduzirPagamento(pagamento, total);

  // ── Prazo ────────────────────────────────────────────────────────────────
  const criadoEm = horaLocalParaInstante(pedido.dateTime, fuso) || new Date();
  const agendadoPara = horaLocalParaInstante(servico.scheduleDatetime || servico.datetime, fuso);
  const scheduledDatetime =
    agendadoPara ?? new Date(criadoEm.getTime() + (deliveryType === "DELIVERY" ? 50 : 40) * 60_000);

  // ── Cliente e observações ────────────────────────────────────────────────
  const cliente = pedido.customer || {};
  const customerName = texto(cliente.name) || "Cliente Wabiz";
  const customerPhone = `${texto(cliente.phoneCode)}${texto(cliente.phoneNumber)}`.replace(/\D/g, "");

  const rotuloServico: Record<string, string> = {
    table: `🍽️ MESA ${texto(servico.tableCode)}${texto(servico.tablePassword) ? ` (senha ${texto(servico.tablePassword)})` : ""}`,
    schedule: "📅 Reserva de horário no salão",
    internaldelivery: "🏢 Entrega local",
    internal_delivery: "🏢 Entrega local",
  };

  const notes = [
    `Pedido Wabiz #${orderNumber}`,
    rotuloServico[tipo] || null,
    agendadoPara ? `📅 AGENDADO para ${dataHoraDaLoja(agendadoPara, fuso)}` : null,
    texto(entrega?.referencePoint) ? `📍 Referência: ${texto(entrega?.referencePoint)}` : null,
    desconto > 0 ? `🏷️ ${motivoDoDesconto(pedido)}: -R$${desconto.toFixed(2)}` : null,
    texto(pedido.obs) ? `📝 OBS: ${texto(pedido.obs)}` : null,
    ...notasDeItem.map((n) => `📝 ${n}`),
  ]
    .filter(Boolean)
    .join("\n");

  // Aceite automático da loja decide o status no FireHub. Na Wabiz o pedido é
  // confirmado de qualquer forma quando grava — é o "recebi" deles, que tira o
  // pedido da fila e acalma o cliente.
  const status = loja.autoAcceptOrders ? "ACEITO" : "NOVO";

  const dados: any = {
    franchiseeId: loja.id,
    kdsStage: "PRODUCTION",
    kdsProductionAt: new Date(),
    openDeliveryOrderId: internalKey,
    openDeliveryReference: orderNumber,
    openDeliveryChannel: "WABIZ",
    source: "WABIZ",
    scheduledDatetime,
    changeAmount,
    customerCpfCnpj: texto(cliente.document) || null,
    deliveryBy: "MERCHANT",
    // ── O DESCONTO É TODO DA LOJA ────────────────────────────────────────
    //
    // A Wabiz é o app com a MARCA do restaurante: fidelidade e cupom saem do
    // bolso dele, não de um marketplace. Por isso o mesmo valor vai em
    // `discountMerchant` — é o que faz a comanda imprimir "Desconto (Cupom -
    // Loja)" em vez de uma linha sem dono.
    //
    // `total` já vem líquido e `discounts` já inclui o `discount` de dentro de
    // cada produto (confirmado por escrito pela Wabiz em 15/09/2026), então o
    // bruto da mensalidade — totalAmount + discountTotal, lib/billing.ts —
    // fecha sozinho. Somar o desconto do produto aqui contaria duas vezes.
    discountTotal: desconto > 0 ? desconto : null,
    discountMerchant: desconto > 0 ? desconto : null,
    customerName,
    customerPhone,
    customerAddress,
    // Idem Brendi e 99Food: o ponto do parceiro, quando vem.
    // O contrato da Wabiz nao declara coordenada (wabiz-api.ts so tem texto:
    // rua, numero, regiao, CEP), mas payload real costuma trazer campo que a
    // doc nao lista. O leitor tolerante aceita se vier e ignora se nao vier:
    // nao custa nada hoje e para de custar geocodificacao no dia em que vier.
    customerLatLng: coordenadasDoParceiro(pedido?.service?.delivery, pedido),
    deliveryType,
    paymentMethod,
    totalAmount: total,
    deliveryFee,
    status,
    notes: notes || undefined,
    createdAt: new Date(),
    items: { create: items },
  };
  return { dados, items };
}

