/**
 * O relatório "Cupons e descontos" — quanto de desconto foi dado, QUEM pagou
 * e de onde ele veio (cupom, campanha da plataforma, desconto no balcão, conta
 * da mesa).
 *
 * ── A pergunta que a Saipos não responde ───────────────────────────────────
 *
 * O relatório de descontos deles soma tudo num número só. Para o dono de
 * pizzaria no iFood isso é quase inútil: na NIK, semana de 17 a 23/09/2026,
 * foram R$ 2.919,53 de desconto no iFood, e R$ 1.210,98 disso o iFood pagou do
 * bolso dele — a loja recebe esse dinheiro no repasse. Somar os dois e chamar
 * de "desconto que você deu" faz o dono cortar a promoção errada. Aqui cada
 * real de desconto é de alguém: LOJA, PLATAFORMA (iFood, 99Food…) ou NÃO
 * IDENTIFICADO (o pedido não diz, e o relatório não inventa).
 *
 * ── Quem pagou, canal por canal ────────────────────────────────────────────
 *
 * - iFood: `discountMerchant` (loja) e `discountIfood` (iFood), gravados pela
 *   integração a partir do `sponsorshipValues` de cada benefício.
 * - 99Food: desde 18/09/2026 as mesmas duas colunas (a parte do 99 vai em
 *   `discountIfood`, nome histórico). Os pedidos anteriores (128 em produção)
 *   não têm as colunas, mas guardam `discountDetails.promocoes`; a conta é a
 *   de lib/desconto-99food.ts (`repartirDesconto99`), a mesma do recibo e da
 *   comanda. NÃO se usa `cupomDoMarketplace` (lib/cupom-do-parceiro.ts) aqui:
 *   ele soma `discountIfood` + promoções, e no pedido novo do 99 as duas
 *   coisas são o MESMO dinheiro — o cupom do 99 sairia em dobro.
 *   Sem colunas e sem promoções (app antigo do 99), o recibo joga tudo na
 *   loja; o relatório diz "não identificado", porque não sabe.
 * - Canal próprio (site, balcão, mesa, totem, Wabiz, robô): só a loja pode ter
 *   dado o desconto — é o app/o caixa dela. A Wabiz é o app com a MARCA do
 *   restaurante (lib/wabiz-traducao.ts): cupom e fidelidade de lá são da loja.
 * - O que sobra entre o total do desconto e loja + plataforma é "não
 *   identificado", nunca é empurrado para um dos lados.
 *
 * ── De onde veio: as "fatias" do desconto ──────────────────────────────────
 *
 * Um pedido pode ter mais de um desconto (no iFood é comum: R$ 5 no item pago
 * pela loja + a entrega paga pelo iFood). Cada um vira uma FATIA com nome,
 * alvo (itens, entrega, pedido) e quem pagou:
 *
 * - CUPOM com código: o do site grava `[Cupom: CODIGO]` na observação
 *   (api/customer-order — o mesmo rastro que lib/cupons-no-banco.ts conta para
 *   o limite por cliente); o da Wabiz chega como "🏷️ Cupom BEMVINDO15: -R$…"
 *   (lib/wabiz-traducao.ts, motivoDoDesconto). Os do site são cruzados com o
 *   cadastro (User.storeCoupons + o cupom da campanha da comanda) para dizer o
 *   tipo, o valor e se ainda está ativo.
 * - CUPOM da Brendi e da Jotajá: vem no `discountDetails` (mesmo formato do
 *   iFood) como "Cupom BEMVINDO (-12%)" ou, sem código no payload, "Cupom
 *   Brendi (-15%)". O percentual é calculado em CADA pedido (desconto ÷
 *   itens) e cai fora: na Frangoso - Trindade (26/07 a 23/09/2026) o mesmo
 *   cupom de R$ 8 saía em 14 linhas de "campanha", de "(-8%)" a "(-19%)", e o
 *   dono não via quanto o cupom rendeu. É cupom, entra no ranking de cupons.
 * - CAMPANHA da plataforma: cada benefício do iFood (`discountDetails[]`, com
 *   `description` = nome da campanha e `target` = ITEM/DELIVERY_FEE/CART) e
 *   cada promoção do 99Food (`promocoes[]`, com `shop_subside_price` = parte
 *   da loja).
 * - MANUAL: o desconto que o atendente deu no PDV (balcão, ou mesa lançada no
 *   caixa), "[Desconto: 10% (R$ 2,83) — Cliente fiel]" (lib/desconto-manual.ts,
 *   notaDoDesconto).
 * - MESA: ver abaixo.
 * - FIDELIDADE: a Trilha Premiada do site (`trilhaPremio.valorAplicado`, quando
 *   o prêmio é desconto ou frete) e a "Troca de fidelidade" da Wabiz.
 * - O que o pedido não explica vira "Sem detalhe" — a diferença aparece.
 *
 * ── A MESA ─────────────────────────────────────────────────────────────────
 *
 * O desconto dado na conta da mesa NÃO fica gravado como desconto: nem em
 * coluna da TableSession, nem nos pedidos (em produção, zero pedidos de mesa
 * têm `discountTotal`). Ele existiu de dois jeitos:
 *
 * 1. TAXA DE SERVIÇO NEGATIVA, até o fechamento passar a recusar taxa fora de
 *    0–100% (commit 55e33088, 04/09/2026). A Mesa 23 da Pastel da Paulista,
 *    fechada na noite de 04/09/2026, teve taxa de −R$ 48,91 sobre R$ 125,40
 *    de consumo. A taxa negativa está GRAVADA: é desconto em qualquer data —
 *    a mesma leitura de lib/relatorios/vendas.ts ("desconto no fechamento").
 * 2. O DESCONTO DO FECHAMENTO, desde 13/09/2026 (commit 85ef5c3f), que só
 *    abate do que se cobra. O fechamento (api/store/table-sessions/[id]/close)
 *    só aceita a conta quando o que foi pago cobre consumo − desconto + taxa
 *    + gorjeta — com tolerância de 1 centavo e aceitando SOBRA. Então:
 *
 *        desconto da mesa = consumo − (pago − taxa de serviço − gorjeta)
 *
 *    quando der mais que 1 centavo. É um PISO: se o cliente pagou a mais
 *    (troco deixado na mesa), a sobra esconde parte do desconto. Antes de
 *    13/09 essa diferença não vale: fora a taxa negativa do item 1, ela era
 *    conta mal fechada (antes de 24/08 a mesa fechava com qualquer valor).
 *
 * A fórmula é UMA só para todo relatório: `descontoNoFechamento`, da régua
 * única (lib/relatorios/regua-da-venda.ts, regra 4). `descontoDaMesa`, aqui,
 * só a chama — até 24/09/2026 eram duas fórmulas com a mesma palavra.
 *
 * O desconto da mesa entra NO DIA E NA HORA EM QUE A MESA FECHOU, pelas mesas
 * FECHADAS no período (`mesasFechadasDoPeriodo`, lib/relatorios/mesas-do-periodo.ts,
 * com os mesmos filtros de tipo, canal, marca e horário, aplicados no
 * fechamento). É a regra 4 da régua, a mesma do Vendas por período e do
 * Faturamento por dia. E NÃO é abatido do valor vendido: o pedido de mesa
 * entra pelo `totalAmount` lançado, como em todo relatório.
 *
 * Até 24/09/2026 este relatório fazia diferente: dividia o desconto da mesa
 * entre os pedidos dela que estavam no período (no dia e na hora de cada um) e
 * o abatia do "vendas". Tinha razão local — com a faixa das 22h às 02h, a mesa
 * pedida às 20h e fechada às 22h30 trazia o desconto sem a venda, e o "vendas"
 * dele, que abatia, saía negativo —, mas dava outro número para a mesma
 * semana: Pastel da Paulista, 09 a 16/09/2026, R$ 34.535,14 de vendas aqui
 * contra R$ 34.660,54 do Vendas por período, do Faturamento por dia, do Dia e
 * hora e do Formas de pagamento (a diferença é a Mesa 55, lançada em 11/09 e
 * fechada em 13/09 sem nada pago); e, por dia, R$ 125,40 de desconto no dia 11
 * aqui e no dia 13 lá. Com a régua, "vendas" nunca fica negativo (nada é
 * abatido dele) e o desconto da Mesa 55 cai no dia 13 nos dois relatórios.
 * O preço disso: num recorte em que a mesa fecha e os lançamentos dela ficam
 * de fora (a faixa de horário, a virada do período), aparece o desconto sem a
 * venda que o gerou, e o percentual pode passar de 100%. É a verdade daquele
 * recorte — o desconto foi dado ali.
 *
 * Na lista a mesa é UMA linha ("Mesa 5", ou o nome que a loja deu à mesa),
 * bancada pela loja, na hora do fechamento; nas contagens ela é UMA conta
 * ("pedidos com desconto" soma os pedidos com desconto e as contas de mesa com
 * desconto — as linhas da lista). Se um dia o fechamento passar a gravar o
 * desconto nos pedidos, a diferença da mesa com pedido já descontado é pulada,
 * para não contar duas vezes.
 *
 * O "% dos pedidos com desconto" é SÓ de pedidos: pedidos com desconto ÷
 * lançamentos. A conta de mesa não é lançamento — dividir contas de mesa por
 * lançamentos misturava duas unidades. Pastel da Paulista, 13/09/2026, Mesa,
 * das 18h40 às 18h50: três rodadas lançadas, nenhuma com desconto, e a Mesa 55
 * fechada ali com R$ 125,40 de desconto — a tela dizia "33,33% dos 3 pedidos",
 * e nenhum dos três teve desconto. Das 18h43 às 18h44 (só o fechamento, sem
 * lançamento): "0,00% dos 0 pedidos".
 *
 * ── A base do percentual ───────────────────────────────────────────────────
 *
 * "% sobre as vendas" é desconto ÷ VALOR VENDIDO da régua única: Σ
 * `totalAmount` dos pedidos de venda do período, pela data do pedido, a mesa
 * inclusive — o MESMO "Valor vendido" do Vendas por período, no mesmo filtro,
 * centavo a centavo (scripts/conferir-relatorios-batem.mjs confere). Até
 * 24/09/2026 a base era o "preço cheio" (pago + desconto), um terceiro número
 * que nenhum outro relatório mostra: o lojista que dividia o desconto pelo
 * valor vendido do Vendas por período achava outro percentual (Pastel da
 * Paulista, 09 a 16/09/2026: 3,05% aqui × 3,13% na conta dele). O valor
 * vendido já é líquido do desconto dos pedidos (o `totalAmount` é o que o
 * cliente pagou); o da mesa, não (regra 4 da régua). Sem venda no recorte, o
 * percentual é zero e a tela mostra "—".
 *
 * O PREÇO dessa base, que o dono aceitou: o valor vendido sai líquido de TODO
 * desconto, inclusive o que a plataforma bancou — o numerador soma o desconto
 * do iFood e o denominador não tem esse dinheiro. Pedido 100% subsidiado
 * (total R$ 0) põe desconto sem pôr base. Na loja de iFood o percentual sobe
 * bem mais que na de mesa: NIK, 09 a 16/09/2026, 20,6% sobre o preço cheio
 * (3.458,64 ÷ 16.768,09) × 26,0% sobre o valor vendido (÷ 13.309,45); o iFood
 * de 24,5% para 32,4%; "do bolso da loja" de 11,8% para 14,8%. A Pastel, com
 * pouco desconto, só vai de 3,05% para 3,13%. Quem compara com a Saipos ou
 * com um print antigo vê o desconto "subir" sem mudança real — a tela diz
 * sobre o que é o percentual.
 *
 * ── O que NÃO entra no total de desconto ───────────────────────────────────
 *
 * - Pedido cancelado, do totem esperando pagamento e rascunho do robô (a régua
 *   única, `entraNaVenda`): o cliente não levou o desconto. Nem o pedido de
 *   valor impossível (R$ 1 milhão ou mais, VALOR_IMPOSSIVEL da régua), que
 *   também fica fora do valor vendido. Aqui só o total decide (a rota não traz
 *   os itens); em 24/09/2026 o único caso em produção é cancelado.
 * - Cashback (`cashbackEarned`/`cashbackUsed`): mostrado À PARTE. O checkout
 *   do site não grava o cashback usado no desconto do pedido; somar os dois
 *   misturaria dinheiro de campanhas diferentes. (Em 24/09/2026 nenhum pedido
 *   em produção tinha cashback gravado.)
 * - Entrega grátis por regra da loja ("pedido acima de R$ 60"): `entregaGratis`
 *   sem desconto — mostrada à parte, porque a taxa zerada nunca entrou no
 *   total do pedido. A entrega grátis de CUPOM já está no desconto (o checkout
 *   soma a taxa no `discountTotal`).
 * - Brinde da Trilha Premiada (produto grátis): entra como item a R$ 0, não é
 *   desconto no pedido.
 *
 * Puro: sem banco. Recebe os pedidos já filtrados por lib/relatorios/servidor.ts.
 * Testado em scripts/teste-descontos.ts.
 */
import { lerCupons, descreverBeneficio, cupomVenceu, type Cupom } from "@/lib/cupons";
import { repartirDesconto99 } from "@/lib/desconto-99food";
import { lerEntregaGratis } from "@/lib/entrega-gratis";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import {
  ROTULO_DO_TIPO, c2, canalDoRelatorio, diasNoPeriodo, fmtDia, fmtPct, naLoja, somarDias, tipoDeVenda,
  type TipoDeVenda,
} from "@/lib/relatorios/base";
import { cent, descontoNoFechamento, entraNaVenda, reais } from "@/lib/relatorios/regua-da-venda";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type PedidoParaDescontos = {
  id: string;
  franchiseeId?: string | null;
  createdAt: Date | string;
  status?: string | null;
  totalAmount: number | null;
  // Os campos que decidem canal e tipo de venda (lib/relatorios/base.ts).
  deliveryType?: string | null;
  source?: string | null;
  tableSessionId?: string | null;
  totemLicenseId?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryReference?: string | null;
  dailyOrderNumber?: number | null;
  // O desconto.
  discountTotal?: number | null;
  discountMerchant?: number | null;
  discountIfood?: number | null;
  discountDetails?: unknown;
  notes?: string | null;
  trilhaPremio?: unknown;
  entregaGratis?: unknown;
  cashbackEarned?: number | null;
  cashbackUsed?: number | null;
};

/**
 * Uma conta de mesa FECHADA no período, já com os filtros do relatório
 * (lib/relatorios/mesas-do-periodo.ts, `mesasFechadasDoPeriodo`), com TODOS os
 * pedidos dela, de qualquer dia: o desconto do fechamento é sobre o consumo
 * inteiro. `mesa` (Table.number) e `nome` (Table.label) só servem para o
 * rótulo da lista — ver `rotuloDaMesa`.
 */
export type ContaDeMesa = {
  id: string;
  franchiseeId?: string | null;
  fechadaEm: Date | string;
  mesa: number | null;
  nome?: string | null;
  pago: number | null;
  taxaServico: number | null;
  gorjeta: number | null;
  pedidos: { totalAmount: number | null; status: string | null; discountTotal?: number | null }[];
};

/** Um cupom do cadastro do site (User.storeCoupons), com a loja dona. */
export type CupomCadastrado = Cupom & { lojaId: string };

export type ConfigDosDescontos = {
  /** Fuso da loja: o dia e a hora de cada linha. */
  tz: string;
  /** O período (dia operacional), para a série por dia. */
  de: string;
  ate: string;
  /** "Hoje" da loja — para saber se o cupom já venceu. */
  hoje: string;
  /** O cadastro de cupons das lojas do relatório. */
  cupons: CupomCadastrado[];
  /** Listar os cupons cadastrados que ninguém usou (só faz sentido quando o canal Online está no filtro). */
  mostrarCuponsSemUso: boolean;
  /** Filtros e ordem da LISTA de pedidos (não mexem nos totais). */
  lista?: { origem?: string; quem?: QuemBancou | ""; ordem?: "recentes" | "maior" };
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type QuemBancou = "LOJA" | "PLATAFORMA" | "NAO_IDENTIFICADO";

export const ROTULO_DE_QUEM: Record<QuemBancou, string> = {
  LOJA: "Loja",
  PLATAFORMA: "Plataforma",
  NAO_IDENTIFICADO: "Não identificado",
};

export type TipoDaFatia = "cupom" | "campanha" | "manual" | "mesa" | "fidelidade" | "outro";

export const ROTULO_DA_FATIA: Record<TipoDaFatia, string> = {
  cupom: "Cupom",
  campanha: "Campanha da plataforma",
  manual: "Desconto manual",
  mesa: "Desconto na conta da mesa",
  fidelidade: "Fidelidade",
  outro: "Sem detalhe",
};

/** Onde o desconto caiu: nos itens, na taxa de entrega ou no pedido todo. */
export type AlvoDoDesconto = "ITENS" | "ENTREGA" | "PEDIDO";

export const ROTULO_DO_ALVO: Record<AlvoDoDesconto | "NAO_INFORMADO", string> = {
  ITENS: "Nos itens",
  ENTREGA: "Na entrega",
  PEDIDO: "No pedido todo",
  NAO_INFORMADO: "Não informado",
};

export type FatiaDoDesconto = {
  /** Chave que agrupa a mesma origem em todos os pedidos (cupom:SITE:HAKIM10). */
  chave: string;
  tipo: TipoDaFatia;
  /** Nome para o lojista: o código do cupom, o nome da campanha, o motivo. */
  nome: string;
  /** Só no cupom: o código, em maiúsculas. */
  codigo?: string;
  alvo: AlvoDoDesconto | null;
  valor: number;
  loja: number;
  plataforma: number;
  naoIdentificado: number;
  /** Quantas vezes a mesma origem apareceu no pedido (o iFood manda um benefício por item). */
  vezes?: number;
};

export type DescontoDoPedido = {
  total: number;
  loja: number;
  plataforma: number;
  naoIdentificado: number;
  fatias: FatiaDoDesconto[];
};

export type LinhaDaLista = {
  id: string;
  /** "mesa" quando a linha é a conta de uma mesa, não um pedido. */
  tipoDeLinha: "pedido" | "mesa";
  instante: string;
  dia: string;
  hora: string;
  /** "#47" (número do dia) ou "Mesa 5". */
  numero: string;
  /** O número no parceiro ("iFood #8119"), quando houver. */
  referencia: string | null;
  canal: string;
  canalNome: string;
  tipo: string;
  /** Cupom/campanha/motivo, em texto. */
  origem: string;
  origens: string[];
  quem: string;
  loja: number;
  plataforma: number;
  naoIdentificado: number;
  desconto: number;
  /** O que o cliente pagou (depois do desconto). */
  total: number;
};

export type LinhaDeCupom = {
  chave: string;
  codigo: string;
  /** Onde o cupom foi cadastrado: SITE (o do FireHub), WABIZ, BRENDI ou JOTAJA. */
  canal: string;
  canalNome: string;
  usos: number;
  desconto: number;
  /** O que os clientes pagaram nos pedidos com o cupom. */
  faturamento: number;
  ticketMedio: number;
  descontoMedio: number;
  /** Participação no total de desconto do período, 0 a 100. */
  pctDoDesconto: number;
  cadastro: null | {
    beneficio: string;
    situacao: string;
    ativo: boolean;
    regras: string[];
  };
};

export type LinhaDeOrigem = {
  chave: string;
  tipo: TipoDaFatia;
  canal: string;
  canalNome: string;
  nome: string;
  alvo: string;
  usos: number;
  valor: number;
  loja: number;
  plataforma: number;
  naoIdentificado: number;
  pctDoDesconto: number;
};

export type LinhaDeCanal = {
  canal: string;
  canalNome: string;
  /** Lançamentos (pedidos de venda) do canal no período. */
  pedidos: number;
  /** Pedidos com desconto + contas de mesa com desconto no fechamento. */
  pedidosComDesconto: number;
  /** O valor vendido do canal (régua única) — a base do percentual. */
  vendas: number;
  desconto: number;
  loja: number;
  plataforma: number;
  naoIdentificado: number;
  pctSobreVendas: number;
};

export type ResultadoDosDescontos = {
  resumo: {
    /** Lançamentos: os pedidos de venda do período (cada rodada de mesa é um). */
    pedidos: number;
    /**
     * VALOR VENDIDO da régua única: Σ totalAmount dos pedidos de venda, pela
     * data do pedido, a mesa inclusive. O mesmo do Vendas por período.
     */
    vendas: number;
    desconto: number;
    /** desconto ÷ valor vendido, 0 a 100 (pode passar de 100 — ver "A MESA"). */
    pctSobreVendas: number;
    /** Pedidos com desconto + contas de mesa com desconto no fechamento (as linhas da lista). */
    pedidosComDesconto: number;
    /**
     * % dos LANÇAMENTOS que tiveram desconto, 0 a 100 — só pedidos, SEM as
     * contas de mesa (que não são lançamento: ver "Pedidos com desconto" no topo).
     */
    pctDosPedidos: number;
    descontoMedio: number;
    loja: number;
    plataforma: number;
    naoIdentificado: number;
    pctLojaSobreVendas: number;
    /** Contas de mesa com desconto (já dentro de pedidosComDesconto). */
    mesasComDesconto: number;
  };
  quemBancou: { chave: QuemBancou; rotulo: string; valor: number; pct: number; pedidos: number }[];
  porCanal: LinhaDeCanal[];
  porAlvo: { chave: AlvoDoDesconto | "NAO_INFORMADO"; rotulo: string; valor: number; pct: number }[];
  porDia: { dia: string; desconto: number; loja: number; plataforma: number; naoIdentificado: number; pedidos: number }[];
  cupons: LinhaDeCupom[];
  origens: LinhaDeOrigem[];
  cashback: { gerado: number; usado: number; pedidosQueGeraram: number; pedidosQueUsaram: number };
  entregaGratisForaDoDesconto: { valor: number; pedidos: number };
  lista: LinhaDaLista[];
};

// ── LEITURA DE CADA PEDIDO ──────────────────────────────────────────────────

const NOME_DO_CANAL = new Map<string, string>(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
export const nomeDoCanal = (chave: string) => NOME_DO_CANAL.get(chave) || chave;

/**
 * Canais em que só a LOJA pode ter dado o desconto: o caixa, a mesa, o totem,
 * o site, o robô e a Wabiz (app com a marca do restaurante).
 */
const CANAIS_PROPRIOS = new Set(["SITE", "PDV", "MESA", "TOTEM", "WHATSAPP_IA", "WABIZ"]);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const positivo = (v: unknown): number => Math.max(0, num(v));
const tem = (v: unknown) => v !== null && v !== undefined;

const RE_CUPOM_SITE = /\[Cupom:\s*([^\]]+?)\s*\]/i;
// "🏷️ Cupom BEMVINDO15: -R$25.32" (Wabiz). Exige espaço depois de "Cupom", o
// que deixa de fora a marca do site ("[Cupom: X]").
const RE_CUPOM_WABIZ = /Cupom\s+([^:\n]+?)\s*:\s*-\s*R\$/i;
const RE_FIDELIDADE_WABIZ = /Troca de fidelidade/i;
const RE_DESCONTO_MANUAL = /\[Desconto:\s*([^\]]*)\]/i;

/** O código do cupom que o pedido registrou, se houver — e de qual sistema. */
export function cupomDasNotas(notes: string | null | undefined, canal: string): { codigo: string; sistema: "SITE" | "WABIZ" } | null {
  const texto = String(notes || "");
  const site = RE_CUPOM_SITE.exec(texto);
  if (site && site[1].trim()) return { codigo: site[1].trim().toUpperCase(), sistema: "SITE" };
  if (canal === "WABIZ") {
    const w = RE_CUPOM_WABIZ.exec(texto);
    if (w && w[1].trim()) return { codigo: w[1].trim().toUpperCase(), sistema: "WABIZ" };
  }
  return null;
}

/** O motivo do desconto manual do balcão ("Cliente fiel"), ou "" quando não foi dado. */
export function motivoDoDescontoManual(notes: string | null | undefined): string | null {
  const m = RE_DESCONTO_MANUAL.exec(String(notes || ""));
  if (!m) return null;
  // descreverDesconto: "10% (R$ 2,83) — Cliente fiel". O motivo vem depois do travessão.
  const partes = m[1].split(/\s+[—–]\s+/);
  return partes.length > 1 ? partes.slice(1).join(" — ").trim() : "";
}

/** O que o ranking mostra no lugar do código quando o app não mandou o código. */
export const SEM_CODIGO = "(sem código)";

// Os apps cujo cupom a integração grava no `discountDetails` como "Cupom …"
// (lib/processBrendiEvent.ts e lib/processJotajaEvent.ts).
const APPS_COM_CUPOM_NO_DETALHE = new Set(["BRENDI", "JOTAJA"]);
// "Cupom BEMVINDO (-12%)", "Cupom Brendi (-15%)", "Cupom JotaJá", "Cupom X".
const RE_CUPOM_DO_APP = /^Cupom\s+(.+?)(?:\s*\(\s*-?\s*\d+(?:[.,]\d+)?\s*%\s*\))?$/;
// Sem código no payload, a integração escreve o NOME do app, com minúsculas.
// O código vem sempre em maiúsculas: um cupom de verdade chamado "BRENDI" é código.
const NOME_DO_APP_NO_CUPOM = new Set(["brendi", "jotaja"]);

/**
 * O cupom da Brendi/Jotajá na descrição do desconto, sem o percentual que a
 * integração calcula em cada pedido. `codigo` null = o app não mandou o código.
 */
export function cupomDoApp(descricao: unknown, canal: string): { codigo: string | null } | null {
  if (!APPS_COM_CUPOM_NO_DETALHE.has(canal)) return null;
  const m = RE_CUPOM_DO_APP.exec(String(descricao || "").trim());
  if (!m) return null;
  const nome = m[1].trim();
  if (!nome) return null;
  if (nome !== nome.toUpperCase() && NOME_DO_APP_NO_CUPOM.has(normalizar(nome))) return { codigo: null };
  return { codigo: nome.toUpperCase() };
}

function alvoDoTarget(target: unknown): AlvoDoDesconto | null {
  const t = String(target || "").toUpperCase();
  if (t === "ITEM" || t === "ITEMS" || t === "ITENS") return "ITENS";
  if (t === "DELIVERY_FEE" || t === "DELIVERY" || t === "ENTREGA") return "ENTREGA";
  if (t === "CART" || t === "PEDIDO" || t === "MESA" || t === "ORDER") return "PEDIDO";
  return null;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function fatia(tipo: TipoDaFatia, canal: string, nome: string, alvo: AlvoDoDesconto | null, valor: number, extra: Partial<FatiaDoDesconto> = {}): FatiaDoDesconto {
  const chave = extra.chave || `${tipo}:${canal}:${normalizar(nome)}:${alvo || ""}`;
  return { chave, tipo, nome, alvo, valor, loja: 0, plataforma: 0, naoIdentificado: 0, ...extra };
}

/**
 * Quem pagou o desconto do pedido e de onde ele veio. `canal` é a chave de
 * lib/canal-do-pedido.ts (via canalDoRelatorio).
 */
export function descontoDoPedido(p: PedidoParaDescontos, canal: string = canalDoRelatorio(p as any)): DescontoDoPedido {
  const detalhes = p.discountDetails;
  const listaDeDetalhes = Array.isArray(detalhes) ? (detalhes as any[]) : [];
  const objDeDetalhes = detalhes && typeof detalhes === "object" && !Array.isArray(detalhes) ? (detalhes as Record<string, any>) : {};
  const promocoes99 = Array.isArray(objDeDetalhes.promocoes) ? (objDeDetalhes.promocoes as any[]) : [];

  // ── Quanto, e quem pagou (o pedido inteiro) ──
  let total = positivo(p.discountTotal);
  let loja = 0, plataforma = 0;
  const colunas = tem(p.discountMerchant) || tem(p.discountIfood);

  if (canal === "99FOOD") {
    if (!total) total = positivo(objDeDetalhes.total);
    if (colunas) {
      loja = positivo(p.discountMerchant);
      plataforma = positivo(p.discountIfood);
    } else if (promocoes99.length && total > 0) {
      // O pedido do 99 anterior a 18/09/2026: a régua do recibo e da comanda.
      const r = repartirDesconto99({ descontoTotal: total, promocoes: promocoes99, taxaServico: 0, totalPago: 0 });
      loja = r.loja;
      plataforma = r.plataforma;
    }
  } else if (colunas) {
    loja = positivo(p.discountMerchant);
    plataforma = positivo(p.discountIfood);
  } else if (total > 0) {
    // Sem as colunas: o detalhe gravado diz, senão o canal próprio só pode ser a loja.
    const doDetalhe = listaDeDetalhes.reduce(
      (s, d) => ({ loja: s.loja + positivo(d?.merchant), plataforma: s.plataforma + positivo(d?.ifood ?? d?.platform) }),
      { loja: 0, plataforma: 0 },
    );
    if (doDetalhe.loja + doDetalhe.plataforma > 0) {
      loja = doDetalhe.loja;
      plataforma = doDetalhe.plataforma;
    } else if (CANAIS_PROPRIOS.has(canal)) {
      loja = total;
    }
  }
  total = Math.max(total, loja + plataforma);
  const naoIdentificado = Math.max(0, total - loja - plataforma);

  const resultado: DescontoDoPedido = { total: c2(total), loja: c2(loja), plataforma: c2(plataforma), naoIdentificado: c2(naoIdentificado), fatias: [] };
  if (total <= 0.004) return { total: 0, loja: 0, plataforma: 0, naoIdentificado: 0, fatias: [] };

  // ── De onde veio (as fatias) ──
  const fatias: FatiaDoDesconto[] = [];
  const comSplit = new Set<FatiaDoDesconto>();

  if (canal === "99FOOD" && promocoes99.length) {
    for (const pr of promocoes99) {
      const valor = positivo(pr?.promo_discount) / 100;
      if (valor <= 0) continue;
      const daLoja = Math.min(valor, positivo(pr?.shop_subside_price) / 100);
      const tipo99 = pr?.promo_type != null ? String(pr.promo_type) : "?";
      const f = fatia("campanha", canal, `Promoção 99Food (tipo ${tipo99})`, null, valor, { loja: daLoja, plataforma: valor - daLoja });
      fatias.push(f);
      comSplit.add(f);
    }
  } else if (listaDeDetalhes.some((d) => positivo(d?.value) > 0)) {
    // iFood, Brendi, Jotajá: um benefício por item de `discountDetails`.
    for (const d of listaDeDetalhes) {
      const valor = positivo(d?.value);
      if (valor <= 0) continue;
      const alvo = alvoDoTarget(d?.target);
      const nome = String(d?.description || "").trim()
        || (alvo === "ENTREGA" ? "Desconto na entrega (sem nome)" : alvo === "ITENS" ? "Desconto nos itens (sem nome)" : "Desconto (sem nome)");
      const ehDaLoja = String(d?.sponsor || "").toUpperCase() === "MERCHANT";
      const manual = CANAIS_PROPRIOS.has(canal);
      // O cupom da Brendi/Jotajá agrupa pelo código (ou "sem código"), nunca
      // pela descrição com o percentual do pedido — ver o topo.
      const doApp = cupomDoApp(d?.description, canal);
      const f = doApp
        ? fatia("cupom", canal, doApp.codigo || `${nomeDoCanal(canal)} ${SEM_CODIGO}`, alvo, valor, {
          chave: `cupom:${canal}:${doApp.codigo || "-"}`, codigo: doApp.codigo || SEM_CODIGO,
        })
        : fatia(manual ? "manual" : "campanha", canal, nome, alvo, valor);
      if (tem(d?.merchant) || tem(d?.ifood) || tem(d?.platform)) {
        f.loja = positivo(d?.merchant);
        f.plataforma = positivo(d?.ifood ?? d?.platform);
        comSplit.add(f);
      } else if (ehDaLoja || manual) {
        f.loja = valor;
        comSplit.add(f);
      }
      fatias.push(f);
    }
  } else {
    // Canal próprio: o que a observação do pedido diz.
    const premio = p.trilhaPremio && typeof p.trilhaPremio === "object" ? (p.trilhaPremio as Record<string, any>) : null;
    let restante = total;
    if (premio && (premio.tipo === "frete" || premio.tipo === "desconto")) {
      const valor = Math.min(restante, positivo(premio.valorAplicado));
      if (valor > 0) {
        fatias.push(fatia("fidelidade", canal, `Trilha Premiada${premio.descricao ? `: ${premio.descricao}` : ""}`, premio.tipo === "frete" ? "ENTREGA" : "PEDIDO", valor, { chave: `fidelidade:${canal}:trilha` }));
        restante -= valor;
      }
    }
    if (restante > 0.004) {
      const cupom = cupomDasNotas(p.notes, canal);
      const manual = motivoDoDescontoManual(p.notes);
      if (cupom) {
        const entrega = lerEntregaGratis(p.entregaGratis);
        const alvo: AlvoDoDesconto = entrega && normalizar(entrega.motivo) === normalizar(`Cupom ${cupom.codigo}`) ? "ENTREGA" : "PEDIDO";
        fatias.push(fatia("cupom", canal, cupom.codigo, alvo, restante, { chave: `cupom:${cupom.sistema}:${cupom.codigo}`, codigo: cupom.codigo }));
      } else if (manual !== null) {
        const motivo = manual || "Sem motivo informado";
        fatias.push(fatia("manual", canal, motivo, "PEDIDO", restante));
      } else if (canal === "WABIZ" && RE_FIDELIDADE_WABIZ.test(String(p.notes || ""))) {
        fatias.push(fatia("fidelidade", canal, "Troca de fidelidade (Wabiz)", "PEDIDO", restante));
      } else if (canal === "99FOOD") {
        // 99 sem promoções: pelo menos o que o 99 separou em itens/entrega/cupom.
        const partes: [AlvoDoDesconto, number][] = [["ITENS", positivo(objDeDetalhes.itens)], ["ENTREGA", positivo(objDeDetalhes.entrega)], ["PEDIDO", positivo(objDeDetalhes.cupom)]];
        for (const [alvo, valor] of partes) if (valor > 0) fatias.push(fatia("campanha", canal, "Desconto 99Food (sem detalhe)", alvo, valor));
      }
    }
  }

  // O que as fatias não explicam aparece como "Sem detalhe" — nunca some.
  const explicado = fatias.reduce((s, f) => s + f.valor, 0);
  if (total - explicado > 0.01) fatias.push(fatia("outro", canal, "Sem detalhe", null, total - explicado));

  // Fatia sem dono próprio herda a divisão do pedido, na proporção do valor
  // que sobrou depois das fatias que têm dono (a campanha do iFood tem; o
  // cupom do site não precisa — é canal próprio).
  const semSplit = fatias.filter((f) => !comSplit.has(f));
  if (semSplit.length) {
    const jaLoja = fatias.filter((f) => comSplit.has(f)).reduce((s, f) => s + f.loja, 0);
    const jaPlat = fatias.filter((f) => comSplit.has(f)).reduce((s, f) => s + f.plataforma, 0);
    const sobraLoja = Math.max(0, loja - jaLoja);
    const sobraPlat = Math.max(0, plataforma - jaPlat);
    const sobraNao = Math.max(0, total - loja - plataforma);
    const base = sobraLoja + sobraPlat + sobraNao;
    for (const f of semSplit) {
      if (base <= 0) { f.naoIdentificado = f.valor; continue; }
      f.loja = (f.valor * sobraLoja) / base;
      f.plataforma = (f.valor * sobraPlat) / base;
      f.naoIdentificado = (f.valor * sobraNao) / base;
    }
  }
  // A mesma campanha repetida no pedido vira uma fatia só: o iFood manda um
  // benefício POR ITEM, e o pedido #4 da NIK (18/09/2026) saía como
  // "FD_DESITEM_21AA7 + FD_DESITEM_21AA7 + FD_DESITEM_21AA7".
  const juntas = new Map<string, FatiaDoDesconto>();
  for (const f of fatias) {
    const j = juntas.get(f.chave);
    if (!j) { juntas.set(f.chave, { ...f, vezes: 1 }); continue; }
    j.valor += f.valor; j.loja += f.loja; j.plataforma += f.plataforma; j.naoIdentificado += f.naoIdentificado;
    j.vezes = (j.vezes || 1) + 1;
  }
  resultado.fatias = [...juntas.values()].map((f) => ({ ...f, valor: c2(f.valor), loja: c2(f.loja), plataforma: c2(f.plataforma), naoIdentificado: c2(f.naoIdentificado) }));
  return resultado;
}

// A data de corte do desconto no fechamento mora na régua única; continua
// saindo daqui porque scripts/teste-vendas.ts confere que as duas são a mesma.
export { DESCONTO_NA_MESA_DESDE } from "@/lib/relatorios/regua-da-venda";

/** O consumo da mesa: os pedidos de venda da conta (a régua `entraNaVenda`), pelo valor lançado. */
export function consumoDaMesa(conta: ContaDeMesa): number {
  return reais(conta.pedidos.filter(entraNaVenda).reduce((s, o) => s + cent(o.totalAmount), 0));
}

/**
 * O desconto da conta da mesa — ver "A MESA" no topo: a taxa de serviço
 * negativa (em qualquer data) ou, desde 13/09/2026, o que faltou pagar do
 * consumo. É `descontoNoFechamento` da régua única, com os nomes deste
 * relatório; até 24/09/2026 esta função tinha a fórmula dela, e as duas só
 * diferiam com o pago não gravado (aqui virava desconto de 100%; lá, e agora
 * aqui, sem o pago não há o que deduzir).
 */
export function descontoDaMesa(conta: ContaDeMesa): number {
  return descontoNoFechamento({
    id: conta.id, fechadaEm: conta.fechadaEm, pago: conta.pago,
    serviceFee: conta.taxaServico, waiterTip: conta.gorjeta, pedidos: conta.pedidos,
  });
}

/**
 * O nome da mesa na lista: o `label` que a loja deu (Table.label, como está —
 * "Varanda", "Mesa 7"), senão "Mesa <número>". A MESMA regra do Vendas por
 * período (api/store/relatorios/vendas, sessoesDosPedidos), para a mesma conta
 * ter o mesmo nome nos dois. Até 24/09/2026 aqui se prefixava "Mesa " ao
 * label, e a mesa "Mesa 7" saía "Mesa Mesa 7" (latente: nenhuma mesa em
 * produção tinha label nessa data).
 */
export function rotuloDaMesa(m: { mesa: number | null; nome?: string | null }): string {
  const nome = String(m.nome || "").trim();
  if (nome) return nome;
  return m.mesa != null ? `Mesa ${m.mesa}` : "Mesa";
}

// ── O RELATÓRIO ─────────────────────────────────────────────────────────────

function rotuloDoAlvo(a: AlvoDoDesconto | null): string {
  return a === "ITENS" ? "itens" : a === "ENTREGA" ? "entrega" : a === "PEDIDO" ? "pedido" : "";
}

function rotuloDaFatia(f: FatiaDoDesconto): string {
  if (f.tipo === "cupom") return `Cupom ${f.nome}`;
  // "Manual", não "Balcão": na NIK o PDV lança pedido de MESA (deliveryType MESA)
  // com o mesmo desconto — 11 pedidos com 10% em 16/09/2026 —, e "Balcão" numa
  // linha de tipo Mesa parecia erro.
  if (f.tipo === "manual") return `Desconto manual: ${f.nome}`;
  if (f.tipo === "mesa") return "Desconto na conta da mesa";
  const detalhe = [rotuloDoAlvo(f.alvo), (f.vezes || 1) > 1 ? `${f.vezes}×` : ""].filter(Boolean).join(", ");
  return detalhe ? `${f.nome} (${detalhe})` : f.nome;
}

function rotuloDeQuem(d: { loja: number; plataforma: number; naoIdentificado: number }, canal: string): string {
  const partes: string[] = [];
  if (d.loja > 0) partes.push("Loja");
  if (d.plataforma > 0) partes.push(nomeDoCanal(canal));
  if (d.naoIdentificado > 0) partes.push("Não identificado");
  return partes.join(" + ") || "—";
}

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100000) / 1000 : 0);
const hhmm = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

function situacaoDoCupom(c: Cupom, hoje: string): { situacao: string; ativo: boolean } {
  if (!c.active) return { situacao: "Desativado", ativo: false };
  if (cupomVenceu(c, hoje)) return { situacao: `Venceu em ${fmtDia(c.validade!)}`, ativo: false };
  return { situacao: c.validade ? `Ativo até ${fmtDia(c.validade)}` : "Ativo", ativo: true };
}

function regrasDoCupom(c: Cupom): string[] {
  const r: string[] = [];
  if (c.minOrderValue > 0) r.push(`pedido a partir de R$ ${c.minOrderValue.toFixed(2).replace(".", ",")}`);
  if (c.primeiroPedido) r.push("só no 1º pedido pelo site");
  if (c.usosPorCliente > 0) r.push(c.usosPorCliente === 1 ? "1 uso por cliente" : `${c.usosPorCliente} usos por cliente`);
  if (c.origem === "converter") r.push("prêmio da comanda");
  if (c.isPublic) r.push("o robô pode anunciar");
  return r;
}

export function cadastroDoCupom(c: Cupom, hoje: string): NonNullable<LinhaDeCupom["cadastro"]> {
  return { beneficio: descreverBeneficio(c), ...situacaoDoCupom(c, hoje), regras: regrasDoCupom(c) };
}

/**
 * O relatório inteiro. `pedidos` já vêm filtrados (período, tipo, canal,
 * marca, horário) por lib/relatorios/servidor.ts; `mesas` são as contas
 * FECHADAS no período, já com os mesmos filtros aplicados no fechamento
 * (lib/relatorios/mesas-do-periodo.ts) — o desconto de cada uma entra na hora
 * em que ela fechou, esteja ou não algum pedido dela em `pedidos` (ver "A MESA").
 */
export function descontosDoPeriodo(pedidos: PedidoParaDescontos[], mesas: ContaDeMesa[], cfg: ConfigDosDescontos): ResultadoDosDescontos {
  // O valor vendido em CENTAVOS, como a régua soma (regua-da-venda.ts, cent):
  // é o que garante o mesmo centavo do Vendas por período — somar reais em
  // float e arredondar no fim pode sair diferente.
  // `comDesconto` = as linhas da lista (pedidos + contas de mesa);
  // `pedidosComDesconto` = só os pedidos, a parte do "% dos pedidos".
  let nPedidos = 0, cVendas = 0, desconto = 0, loja = 0, plataforma = 0, nao = 0, comDesconto = 0, mesasComDesconto = 0, pedidosComDesconto = 0;
  const cVendasDoCanal = new Map<string, number>();
  const pedidosPorQuem: Record<QuemBancou, number> = { LOJA: 0, PLATAFORMA: 0, NAO_IDENTIFICADO: 0 };
  const canais = new Map<string, LinhaDeCanal>();
  const alvos = new Map<string, number>();
  const dias = new Map<string, ResultadoDosDescontos["porDia"][number]>();
  const origens = new Map<string, LinhaDeOrigem & { pedidos: Set<string> }>();
  const cupons = new Map<string, { codigo: string; sistema: string; canal: string; lojaId: string | null; pedidos: Set<string>; desconto: number; faturamento: number }>();
  const cashback = { gerado: 0, usado: 0, pedidosQueGeraram: 0, pedidosQueUsaram: 0 };
  const entregaGratis = { valor: 0, pedidos: 0 };
  const lista: (LinhaDaLista & { _t: number })[] = [];

  for (let d = 0, n = diasNoPeriodo(cfg.de, cfg.ate); d < n && n <= 400; d++) {
    const dia = somarDias(cfg.de, d);
    dias.set(dia, { dia, desconto: 0, loja: 0, plataforma: 0, naoIdentificado: 0, pedidos: 0 });
  }

  const linhaDoCanal = (canal: string) => {
    let l = canais.get(canal);
    if (!l) {
      l = { canal, canalNome: nomeDoCanal(canal), pedidos: 0, pedidosComDesconto: 0, vendas: 0, desconto: 0, loja: 0, plataforma: 0, naoIdentificado: 0, pctSobreVendas: 0 };
      canais.set(canal, l);
    }
    return l;
  };

  /**
   * Soma um desconto (de pedido ou de conta de mesa) em todos os cortes. Cada
   * chamada é UMA linha da lista e conta 1 em "pedidos com desconto".
   */
  const registrar = (
    id: string, canal: string, instante: Date, d: DescontoDoPedido,
    linha: Omit<LinhaDaLista, "origem" | "origens" | "quem" | "loja" | "plataforma" | "naoIdentificado" | "desconto" | "dia" | "hora" | "instante" | "canal" | "canalNome">,
    lojaId: string | null, pago: number,
  ) => {
    comDesconto++;
    desconto += d.total; loja += d.loja; plataforma += d.plataforma; nao += d.naoIdentificado;
    if (d.loja > 0) pedidosPorQuem.LOJA++;
    if (d.plataforma > 0) pedidosPorQuem.PLATAFORMA++;
    if (d.naoIdentificado > 0) pedidosPorQuem.NAO_IDENTIFICADO++;
    const c = linhaDoCanal(canal);
    c.pedidosComDesconto++; c.desconto += d.total; c.loja += d.loja; c.plataforma += d.plataforma; c.naoIdentificado += d.naoIdentificado;

    const onde = naLoja(instante, cfg.tz);
    const doDia = dias.get(onde.dia);
    if (doDia) {
      doDia.desconto += d.total; doDia.loja += d.loja; doDia.plataforma += d.plataforma; doDia.naoIdentificado += d.naoIdentificado; doDia.pedidos++;
    }

    for (const f of d.fatias) {
      const alvo = f.alvo || "NAO_INFORMADO";
      alvos.set(alvo, (alvos.get(alvo) || 0) + f.valor);
      let o = origens.get(f.chave);
      if (!o) {
        o = {
          chave: f.chave, tipo: f.tipo, canal, canalNome: nomeDoCanal(canal), nome: f.nome, alvo: ROTULO_DO_ALVO[alvo],
          usos: 0, valor: 0, loja: 0, plataforma: 0, naoIdentificado: 0, pctDoDesconto: 0, pedidos: new Set(),
        };
        origens.set(f.chave, o);
      }
      o.pedidos.add(id);
      o.valor += f.valor; o.loja += f.loja; o.plataforma += f.plataforma; o.naoIdentificado += f.naoIdentificado;

      if (f.tipo === "cupom" && f.codigo) {
        let k = cupons.get(f.chave);
        if (!k) {
          k = { codigo: f.codigo, sistema: f.chave.split(":")[1] || canal, canal, lojaId, pedidos: new Set(), desconto: 0, faturamento: 0 };
          cupons.set(f.chave, k);
        }
        if (!k.pedidos.has(id)) k.faturamento += pago;
        k.pedidos.add(id);
        k.desconto += f.valor;
      }
    }

    lista.push({
      ...linha,
      canal, canalNome: nomeDoCanal(canal),
      instante: instante.toISOString(), dia: onde.dia, hora: hhmm(onde.minutos),
      origem: d.fatias.map(rotuloDaFatia).join(" + "),
      origens: [...new Set(d.fatias.map((f) => f.chave))],
      quem: rotuloDeQuem(d, canal),
      loja: d.loja, plataforma: d.plataforma, naoIdentificado: d.naoIdentificado, desconto: d.total,
      _t: instante.getTime(),
    });
  };

  for (const p of pedidos) {
    // A régua única: nem cancelado, nem intenção, nem valor impossível.
    if (!entraNaVenda(p)) continue;
    const canal = canalDoRelatorio(p as any);
    const tipo = tipoDeVenda(p as any) as TipoDeVenda;
    const instante = new Date(p.createdAt);
    const d = descontoDoPedido(p, canal);
    const pago = num(p.totalAmount);
    // O valor vendido: o `totalAmount` do pedido, a mesa inclusive (o
    // desconto do fechamento NÃO sai dele — ver "A MESA").
    nPedidos++;
    cVendas += cent(p.totalAmount);
    const c = linhaDoCanal(canal);
    c.pedidos++;
    cVendasDoCanal.set(canal, (cVendasDoCanal.get(canal) || 0) + cent(p.totalAmount));

    const cbGerado = positivo(p.cashbackEarned), cbUsado = positivo(p.cashbackUsed);
    if (cbGerado > 0) { cashback.gerado += cbGerado; cashback.pedidosQueGeraram++; }
    if (cbUsado > 0) { cashback.usado += cbUsado; cashback.pedidosQueUsaram++; }

    // Entrega grátis que NÃO passou pelo desconto (regra de valor mínimo, área).
    const eg = lerEntregaGratis(p.entregaGratis);
    if (eg && !d.fatias.some((f) => f.alvo === "ENTREGA")) { entregaGratis.valor += eg.valor; entregaGratis.pedidos++; }

    if (d.total <= 0) continue;
    pedidosComDesconto++;
    const refDoParceiro = p.ifoodReference || p.openDeliveryReference || null;
    registrar(p.id, canal, instante, d, {
      id: p.id,
      tipoDeLinha: "pedido",
      numero: p.dailyOrderNumber != null ? `#${p.dailyOrderNumber}` : "—",
      referencia: refDoParceiro && canal !== "SITE" && canal !== "PDV" ? `${nomeDoCanal(canal)} #${refDoParceiro}` : null,
      tipo: ROTULO_DO_TIPO[tipo] || tipo,
      total: c2(pago),
    }, p.franchiseeId || null, pago);
  }

  // ── A mesa: o desconto dado no fechamento (ver "A MESA" no topo) ──
  // UMA linha por conta, na hora em que ela FECHOU (a régua única, regra 4),
  // bancada pela loja. O "total pago" da linha é o consumo cobrado (consumo −
  // desconto), sem a taxa de serviço e a gorjeta, que são do garçom.
  for (const m of mesas) {
    const valor = descontoDaMesa(m);
    if (valor <= 0) continue;
    mesasComDesconto++;
    const d: DescontoDoPedido = {
      total: valor, loja: valor, plataforma: 0, naoIdentificado: 0,
      fatias: [fatia("mesa", "MESA", "Desconto na conta da mesa", "PEDIDO", valor, { chave: "mesa:MESA:conta", loja: valor })],
    };
    const cobrado = c2(consumoDaMesa(m) - valor);
    registrar(m.id, "MESA", new Date(m.fechadaEm), d, {
      id: m.id,
      tipoDeLinha: "mesa",
      numero: rotuloDaMesa(m),
      // A data da linha é a do fechamento; o lembrete evita procurar a mesa no
      // dia em que ela foi lançada (os lançamentos contam no dia deles).
      referencia: "no fechamento da conta",
      tipo: ROTULO_DO_TIPO.MESA,
      total: cobrado,
    }, m.franchiseeId || null, cobrado);
  }

  // ── Cupons: os usados, cruzados com o cadastro; depois os que ninguém usou ──
  const cadastroPorLoja = new Map<string, CupomCadastrado>();
  const cadastroPorCodigo = new Map<string, CupomCadastrado>();
  for (const c of cfg.cupons) {
    cadastroPorLoja.set(`${c.lojaId}:${c.code}`, c);
    if (!cadastroPorCodigo.has(c.code)) cadastroPorCodigo.set(c.code, c);
  }
  const usadosDoSite = new Set<string>();
  const linhasDeCupom: LinhaDeCupom[] = [...cupons.entries()].map(([chave, k]) => {
    const usos = k.pedidos.size;
    let cadastro: LinhaDeCupom["cadastro"] = null;
    if (k.sistema === "SITE") {
      const c = (k.lojaId && cadastroPorLoja.get(`${k.lojaId}:${k.codigo}`)) || cadastroPorCodigo.get(k.codigo);
      if (c) { cadastro = cadastroDoCupom(c, cfg.hoje); usadosDoSite.add(`${c.lojaId}:${c.code}`); }
      else cadastro = { beneficio: "—", situacao: "Não está mais cadastrado", ativo: false, regras: [] };
    }
    // SITE (o cadastro do FireHub), WABIZ, BRENDI ou JOTAJA — o cadastro destes mora no app.
    return {
      chave, codigo: k.codigo,
      canal: k.sistema,
      canalNome: k.sistema === "SITE" ? "Site" : nomeDoCanal(k.sistema),
      usos, desconto: c2(k.desconto), faturamento: c2(k.faturamento),
      ticketMedio: usos ? c2(k.faturamento / usos) : 0,
      descontoMedio: usos ? c2(k.desconto / usos) : 0,
      pctDoDesconto: pct(k.desconto, desconto),
      cadastro,
    };
  }).sort((a, b) => b.usos - a.usos || b.desconto - a.desconto || a.codigo.localeCompare(b.codigo));

  if (cfg.mostrarCuponsSemUso) {
    for (const c of cfg.cupons) {
      if (usadosDoSite.has(`${c.lojaId}:${c.code}`) || linhasDeCupom.some((l) => l.canal === "SITE" && l.codigo === c.code)) continue;
      linhasDeCupom.push({
        chave: `cupom:SITE:${c.code}`, codigo: c.code, canal: "SITE", canalNome: "Site",
        usos: 0, desconto: 0, faturamento: 0, ticketMedio: 0, descontoMedio: 0, pctDoDesconto: 0,
        cadastro: cadastroDoCupom(c, cfg.hoje),
      });
    }
  }

  // ── Lista de pedidos: filtro e ordem ──
  const fl = cfg.lista || {};
  let linhas = lista;
  if (fl.origem) linhas = linhas.filter((l) => l.origens.includes(fl.origem!));
  if (fl.quem === "LOJA") linhas = linhas.filter((l) => l.loja > 0);
  else if (fl.quem === "PLATAFORMA") linhas = linhas.filter((l) => l.plataforma > 0);
  else if (fl.quem === "NAO_IDENTIFICADO") linhas = linhas.filter((l) => l.naoIdentificado > 0);
  linhas = [...linhas].sort(fl.ordem === "maior" ? (a, b) => b.desconto - a.desconto || b._t - a._t : (a, b) => b._t - a._t);

  // O valor vendido da régua única — a base do percentual (ver o topo).
  const vendas = reais(cVendas);
  return {
    resumo: {
      pedidos: nPedidos,
      vendas,
      desconto: c2(desconto),
      pctSobreVendas: pct(desconto, vendas),
      pedidosComDesconto: comDesconto,
      // Pedidos ÷ pedidos: a conta de mesa fica fora das duas pontas (ver "A MESA").
      pctDosPedidos: pct(pedidosComDesconto, nPedidos),
      descontoMedio: comDesconto ? c2(desconto / comDesconto) : 0,
      loja: c2(loja),
      plataforma: c2(plataforma),
      naoIdentificado: c2(nao),
      pctLojaSobreVendas: pct(loja, vendas),
      mesasComDesconto,
    },
    quemBancou: (["LOJA", "PLATAFORMA", "NAO_IDENTIFICADO"] as QuemBancou[]).map((q) => {
      const valor = q === "LOJA" ? loja : q === "PLATAFORMA" ? plataforma : nao;
      return { chave: q, rotulo: ROTULO_DE_QUEM[q], valor: c2(valor), pct: pct(valor, desconto), pedidos: pedidosPorQuem[q] };
    }),
    porCanal: [...canais.values()]
      .map((c) => {
        const vendasDoCanal = reais(cVendasDoCanal.get(c.canal) || 0);
        return {
          ...c,
          vendas: vendasDoCanal, desconto: c2(c.desconto), loja: c2(c.loja), plataforma: c2(c.plataforma),
          naoIdentificado: c2(c.naoIdentificado), pctSobreVendas: pct(c.desconto, vendasDoCanal),
        };
      })
      .sort((a, b) => b.desconto - a.desconto || b.pedidos - a.pedidos),
    porAlvo: (["ITENS", "ENTREGA", "PEDIDO", "NAO_INFORMADO"] as const)
      .filter((a) => (alvos.get(a) || 0) > 0)
      .map((a) => ({ chave: a, rotulo: ROTULO_DO_ALVO[a], valor: c2(alvos.get(a) || 0), pct: pct(alvos.get(a) || 0, desconto) })),
    porDia: [...dias.values()].map((d) => ({ ...d, desconto: c2(d.desconto), loja: c2(d.loja), plataforma: c2(d.plataforma), naoIdentificado: c2(d.naoIdentificado) })),
    cupons: linhasDeCupom,
    origens: [...origens.values()]
      .map(({ pedidos: ids, ...o }) => ({
        ...o, usos: ids.size, valor: c2(o.valor), loja: c2(o.loja), plataforma: c2(o.plataforma),
        naoIdentificado: c2(o.naoIdentificado), pctDoDesconto: pct(o.valor, desconto),
      }))
      .sort((a, b) => b.valor - a.valor || b.usos - a.usos),
    cashback: { ...cashback, gerado: c2(cashback.gerado), usado: c2(cashback.usado) },
    entregaGratisForaDoDesconto: { valor: c2(entregaGratis.valor), pedidos: entregaGratis.pedidos },
    lista: linhas.map(({ _t, ...l }) => l),
  };
}

/**
 * O detalhe do cartão "Pedidos com desconto". O número grande são as linhas
 * da lista (pedidos + contas de mesa); o percentual é só de pedidos, e a conta
 * de mesa aparece somada à parte — nunca "X% dos N pedidos" com a mesa dentro
 * do X (ver "A MESA" no topo). Sem lançamento no recorte não há percentual.
 */
export function detalheDosPedidosComDesconto(
  r: Pick<ResultadoDosDescontos["resumo"], "pedidos" | "pedidosComDesconto" | "mesasComDesconto" | "pctDosPedidos">,
): string {
  const n = (x: number) => x.toLocaleString("pt-BR");
  const mesas = r.mesasComDesconto
    ? `${n(r.mesasComDesconto)} ${r.mesasComDesconto === 1 ? "conta" : "contas"} de mesa`
    : "";
  if (r.pedidos <= 0) {
    return mesas ? `${mesas}, sem pedido lançado no recorte` : "nenhum pedido no recorte";
  }
  if (!mesas) return `${fmtPct(r.pctDosPedidos)} dos ${n(r.pedidos)} pedidos`;
  const soPedidos = r.pedidosComDesconto - r.mesasComDesconto;
  return `${n(soPedidos)} dos ${n(r.pedidos)} pedidos (${fmtPct(r.pctDosPedidos)}) + ${mesas}`;
}

/** Uma página da lista (a tela mostra 50 por vez; o Excel leva todas). */
export function paginar<T>(lista: T[], pagina: number, porPagina = 50): { itens: T[]; total: number; pagina: number; paginas: number; porPagina: number } {
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas);
  return { itens: lista.slice((p - 1) * porPagina, p * porPagina), total: lista.length, pagina: p, paginas, porPagina };
}

/** Os cupons do cadastro de uma loja (storeCoupons + o da campanha da comanda), já lidos. */
export function cuponsDoCadastro(lojaId: string, lista: unknown): CupomCadastrado[] {
  return lerCupons(lista).map((c) => ({ ...c, lojaId }));
}
