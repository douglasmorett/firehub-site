/**
 * O que o dono configura no botão "App Motoboys" do painel e vale para o
 * celular de todo entregador da loja (User.appMotoboyConfig, Json).
 *
 * Ausente = padrão abaixo. Os dois padrões são "ligado" de propósito:
 *
 * - `lembrarBebidas`: o app já perguntava "você entregou a bebida?" antes de
 *   dar baixa em pedido com bebida. Continua assim; a novidade é poder
 *   desligar.
 * - `pedirCodigoEntrega`: pedido do iFood que exigiu código
 *   (DELIVERY_DROP_CODE_REQUESTED) só é dado como entregue depois que o
 *   entregador digita os 4 dígitos do cliente e o iFood confere. Nunca pede
 *   em pedido que o iFood não pediu — por isso ligado não incomoda ninguém, e
 *   é o que evita o cancelamento por "entrega não confirmada".
 * - `cobrarNaEntrega`: pedido que NÃO está pago online abre um aviso com o
 *   valor a receber e o troco a levar antes da baixa. O cartão do pedido já
 *   mostrava isso, mas na hora de fechar o entregador toca no botão e vai
 *   embora — e a loja só descobre no fechamento do caixa. Quem só trabalha
 *   com pedido pago online nunca vê este aviso, então nasce ligado.
 * - `pedirCodigo99Food`: no 99Food NÃO há aviso por pedido — o guia oficial
 *   trata o código de 4 dígitos como parte de TODA entrega feita pela loja
 *   ("caso o procedimento não seja seguido, eventuais prejuízos serão de
 *   responsabilidade do lojista"). Então pede em todo pedido do 99 com
 *   entrega própria; loja cujos pedidos não trazem código desliga aqui.
 * - `relatorioLiberado` / `relatorioDias`: o "Meu relatório" do entregador
 *   (api/motoboys/relatorio). O Lucas (Frangoso, 03/10/2026) pediu que a loja
 *   decida se o motoboy vê o relatório e até quantos dias para trás ("só dá
 *   para ver o relatório por uma semana"). Padrão: liberado, 45 dias — o que
 *   já valia antes de a opção existir.
 */
export type AppMotoboyConfig = {
  lembrarBebidas: boolean;
  cobrarNaEntrega: boolean;
  pedirCodigoEntrega: boolean;
  pedirCodigo99Food: boolean;
  relatorioLiberado: boolean;
  /** Até quantos dias para trás o entregador consulta (1 a 45). */
  relatorioDias: number;
  /**
   * O botão "O cliente não tem o código" fecha o pedido sem conferir. O dono
   * (04/10/2026) quis a escolha na mão da loja; padrão: liberado (como era).
   */
  permitirSemCodigo: boolean;
};

/** As escolhas que o painel oferece para `relatorioDias`. */
export const DIAS_DO_RELATORIO = [1, 7, 15, 31, 45] as const;

export const APP_MOTOBOY_PADRAO: AppMotoboyConfig = {
  lembrarBebidas: true,
  cobrarNaEntrega: true,
  pedirCodigoEntrega: true,
  pedirCodigo99Food: true,
  relatorioLiberado: true,
  relatorioDias: 45,
  permitirSemCodigo: true,
};

export function lerAppMotoboyConfig(bruto: unknown): AppMotoboyConfig {
  const cfg = { ...APP_MOTOBOY_PADRAO };
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    const o = bruto as Record<string, unknown>;
    if (typeof o.lembrarBebidas === "boolean") cfg.lembrarBebidas = o.lembrarBebidas;
    if (typeof o.cobrarNaEntrega === "boolean") cfg.cobrarNaEntrega = o.cobrarNaEntrega;
    if (typeof o.pedirCodigoEntrega === "boolean") cfg.pedirCodigoEntrega = o.pedirCodigoEntrega;
    if (typeof o.pedirCodigo99Food === "boolean") cfg.pedirCodigo99Food = o.pedirCodigo99Food;
    if (typeof o.relatorioLiberado === "boolean") cfg.relatorioLiberado = o.relatorioLiberado;
    if (typeof o.permitirSemCodigo === "boolean") cfg.permitirSemCodigo = o.permitirSemCodigo;
    const dias = Math.round(Number(o.relatorioDias));
    if (o.relatorioDias != null && Number.isFinite(dias) && dias >= 1) cfg.relatorioDias = Math.min(45, dias);
  }
  return cfg;
}

/** Só as chaves conhecidas entram no banco: os booleanos e os dias do relatório (1 a 45). */
export function limparAppMotoboyConfig(bruto: unknown): AppMotoboyConfig | null {
  if (bruto === null) return null;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  return lerAppMotoboyConfig(bruto);
}
