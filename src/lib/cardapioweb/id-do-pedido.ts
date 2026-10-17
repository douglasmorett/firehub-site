/**
 * lib/cardapioweb/id-do-pedido.ts — o id do pedido do CardápioWeb no banco, e a loja que ele carrega.
 *
 * ── Por que a loja vai DENTRO do id ─────────────────────────────────────────
 *
 * Multimarca no CardápioWeb é uma loja (company) por marca, e várias delas
 * caem na MESMA conta do FireHub (o Lucas tem Frangoso, Salzburg e Braseou).
 * Saber de qual marca veio o pedido decide três coisas: com o token de qual
 * instalação o "pronto" volta para lá, qual impressora recebe a comanda e de
 * qual marca é a venda no relatório. Sem coluna nova no CustomerOrder (o
 * `prisma generate` na worktree estraga o cliente das outras sessões), o
 * lugar é o `openDeliveryOrderId`, que já é único no banco inteiro:
 *
 *   cardapioweb_<companyId>_<orderId>            produção
 *   cardapioweb_sandbox-<companyId>_<orderId>    sandbox
 *
 * O sandbox ganha o prefixo porque os dois ambientes do CardápioWeb são
 * bancos separados: o company 123 e o pedido 456 de um podem existir no outro,
 * e o app de sandbox volta para o MESMO FireHub de produção (a Redirect URI
 * cadastrada é a de firehubfood.com.br). Sem o prefixo, o pedido de teste
 * colidiria com um pedido de verdade no índice único.
 *
 * Quem lê o id (status de volta, fila de ações, loja de origem) não precisa
 * de banco para saber a loja — e o "senão é JotaJá" das cinco rotas nunca vê
 * esse id, porque o canal decide antes (lib/cardapioweb/status.ts).
 *
 * Arquivo SEM import de propósito: o navegador (lib/loja-de-origem.ts →
 * print.ts) usa o mesmo leitor que o servidor.
 */

export type AmbienteCW = "producao" | "sandbox";

export const PREFIXO_DO_PEDIDO_CW = "cardapioweb";

/** Ids do CardápioWeb são números, mas a doc manda comparar como texto: aceita letra e hífen, nunca "_". */
const PEDACO = /^[0-9A-Za-z-]{1,40}$/;

function pedaco(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return PEDACO.test(t) ? t : null;
}

/** A loja do CardápioWeb como o FireHub a nomeia: "3268" ou "sandbox-3268". */
export function chaveDaLojaCW(ambiente: AmbienteCW, companyId: string | number): string {
  const id = pedaco(companyId);
  if (!id) throw new Error(`id de loja do CardápioWeb inválido: ${JSON.stringify(companyId)}`);
  return ambiente === "sandbox" ? `sandbox-${id}` : id;
}

/** O `openDeliveryOrderId` do pedido. Lança com id torto: gravar lixo no índice único é pior que não gravar. */
export function idDoPedidoCW(ambiente: AmbienteCW, companyId: string | number, orderId: string | number): string {
  const pedido = pedaco(orderId);
  if (!pedido) throw new Error(`id de pedido do CardápioWeb inválido: ${JSON.stringify(orderId)}`);
  return `${PREFIXO_DO_PEDIDO_CW}_${chaveDaLojaCW(ambiente, companyId)}_${pedido}`;
}

export type IdDoPedidoCW = { ambiente: AmbienteCW; companyId: string; orderId: string; chaveDaLoja: string };

/**
 * O caminho de volta. `_recovered` no fim é tolerado (é o sufixo do resgate
 * manual dos outros canais) — o CardápioWeb não o usa hoje, mas um resgate
 * feito com a mesma ferramenta não pode virar "id ilegível".
 */
export function lerIdDoPedidoCW(id: string | null | undefined): IdDoPedidoCW | null {
  const m = String(id ?? "").trim().match(/^cardapioweb_(sandbox-)?([0-9A-Za-z-]{1,40})_([0-9A-Za-z-]{1,40}?)(?:_recovered)?$/);
  if (!m) return null;
  const ambiente: AmbienteCW = m[1] ? "sandbox" : "producao";
  return { ambiente, companyId: m[2], orderId: m[3], chaveDaLoja: ambiente === "sandbox" ? `sandbox-${m[2]}` : m[2] };
}

/** A chave de loja de origem (lib/loja-de-origem.ts): "cardapioweb:3268". */
export function chaveDeOrigemCW(chaveDaLoja: string): string {
  return `cardapioweb:${String(chaveDaLoja).trim().toLowerCase()}`;
}
