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
 * - `pedirCodigo99Food`: no 99Food NÃO há aviso por pedido — o guia oficial
 *   trata o código de 4 dígitos como parte de TODA entrega feita pela loja
 *   ("caso o procedimento não seja seguido, eventuais prejuízos serão de
 *   responsabilidade do lojista"). Então pede em todo pedido do 99 com
 *   entrega própria; loja cujos pedidos não trazem código desliga aqui.
 */
export type AppMotoboyConfig = {
  lembrarBebidas: boolean;
  pedirCodigoEntrega: boolean;
  pedirCodigo99Food: boolean;
};

export const APP_MOTOBOY_PADRAO: AppMotoboyConfig = {
  lembrarBebidas: true,
  pedirCodigoEntrega: true,
  pedirCodigo99Food: true,
};

export function lerAppMotoboyConfig(bruto: unknown): AppMotoboyConfig {
  const cfg = { ...APP_MOTOBOY_PADRAO };
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    const o = bruto as Record<string, unknown>;
    if (typeof o.lembrarBebidas === "boolean") cfg.lembrarBebidas = o.lembrarBebidas;
    if (typeof o.pedirCodigoEntrega === "boolean") cfg.pedirCodigoEntrega = o.pedirCodigoEntrega;
    if (typeof o.pedirCodigo99Food === "boolean") cfg.pedirCodigo99Food = o.pedirCodigo99Food;
  }
  return cfg;
}

/** Só as chaves conhecidas entram no banco, e só como booleano. */
export function limparAppMotoboyConfig(bruto: unknown): AppMotoboyConfig | null {
  if (bruto === null) return null;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  return lerAppMotoboyConfig(bruto);
}
