/**
 * /src/lib/ifood-pedido.ts
 *
 * As ações do módulo Order (confirm, dispatch, conclude, cancel…) feitas com a
 * credencial do DONO DO PEDIDO.
 *
 * Até 05/09/2026 o painel de status, o despacho de rota, o KDS e o app do
 * motoboy chamavam o iFood com `getIfoodToken()` — o client_credentials do app
 * CENTRALIZADO. Esse token só alcança a loja que sempre viveu nele (Hakim
 * Centro). Para a Pastel da Paulista, a Ragnar e a Brasa o iFood respondia
 * `403 ForbiddenOrderAccess` a cada dispatch, conclude e cancel, e o
 * `console.log` engolia: o pedido ficava "Saiu para entrega" no FireHub e
 * parado no iFood. Foi o relato dos lojistas ("despacha no sistema e não
 * despacha no iFood"). Provado com GET no pedido usando o token central:
 * Hakim 200, as outras três 403.
 *
 * O aceite nunca sofreu disso porque o polling confirma com o token da loja.
 * Aqui o restante das ações passa a fazer o mesmo: `contextoDoPedido` monta a
 * cascata de credenciais do franqueado (integração → usuário → central) e
 * `chamarComContexto` troca de credencial diante de 401/403.
 *
 * Nada aqui lança: quem chama está no meio de uma transição de status e não
 * pode travar o painel porque o iFood recusou. A recusa volta como resposta
 * com `ok=false`, e é logada com o corpo — não só o número.
 */
import { chamarComContexto, type RespostaIfood } from "./ifood-http";
import { contextoDoPedido, type OrigemToken } from "./ifood-token";

const ORDER = "/order/v1.0/orders";

export type PedidoIfood = {
  ifoodOrderId?: string | null;
  franchiseeId: string;
  ifoodStoreMerchant?: string | null;
};

export type AcaoPedido =
  | "confirm"
  | "startPreparation"
  | "readyToPickup"
  | "dispatch"
  | "conclude"
  | "requestCancellation"
  | "cancel"
  | "deny"
  | "acceptCancellation"
  | "denyCancellation"
  | "updateEta";

export type RespostaPedido = RespostaIfood & { origem: OrigemToken | null };

const falha = (texto: string): RespostaPedido => ({
  ok: false, status: 0, data: null, texto, tentativas: 0, origem: null,
});

/**
 * Qualquer chamada ao iFood em nome do pedido (GET de tracking, motivos de
 * cancelamento, disputas…). `rotulo` identifica o chamador no log.
 */
export async function chamarPeloPedido<T = any>(
  pedido: PedidoIfood,
  path: string,
  init: RequestInit & { tentativasMax?: number; idempotente?: boolean } = {},
  rotulo = "iFood",
): Promise<RespostaIfood<T> & { origem: OrigemToken | null }> {
  let r: RespostaIfood<T> & { origem: OrigemToken | null };
  try {
    const ctx = await contextoDoPedido(pedido);
    r = await chamarComContexto<T>(ctx, path, init);
  } catch (e: any) {
    r = falha(e?.message ?? "sem credencial do iFood") as any;
  }
  const metodo = (init.method ?? "GET").toUpperCase();
  if (r.ok) {
    console.log(`[${rotulo}] ${metodo} ${path}: ${r.status} (${r.origem})`);
  } else {
    console.warn(`[${rotulo}] ${metodo} ${path}: ${r.status} (${r.origem ?? "sem token"}) ${r.texto.slice(0, 200)}`);
  }
  return r;
}

/** POST /order/v1.0/orders/{id}/{acao}. */
export async function acaoNoPedidoIfood(
  pedido: PedidoIfood,
  acao: AcaoPedido,
  opts: { body?: unknown; rotulo?: string } = {},
): Promise<RespostaPedido> {
  if (!pedido.ifoodOrderId) return falha("pedido sem ifoodOrderId");
  return chamarPeloPedido(
    pedido,
    `${ORDER}/${pedido.ifoodOrderId}/${acao}`,
    {
      method: "POST",
      // `conclude` recusa POST sem corpo; os outros ignoram um `{}`.
      body: JSON.stringify(opts.body ?? {}),
    },
    opts.rotulo ?? "iFood Sync",
  );
}

/**
 * Saiu para entrega, na ordem que o iFood cobra.
 *
 * O iFood não aceita `dispatch` de um pedido que ainda está em "confirmado":
 * o pedido precisa ter passado por preparo. Quem despacha direto do "Aceito"
 * (rota, WhatsApp do motoboy) precisa dos passos anteriores antes.
 * `readyToPickup` é ignorado quando recusado — em entrega própria ele não se
 * aplica, e o iFood devolve 400 sem prejuízo para o dispatch.
 */
export async function despacharNoIfood(
  pedido: PedidoIfood & { status?: string | null },
  rotulo = "iFood Sync",
): Promise<RespostaPedido> {
  if (!pedido.ifoodOrderId) return falha("pedido sem ifoodOrderId");
  if (pedido.status === "ACEITO" || pedido.status === "NOVO" || pedido.status === "CONFIRMADO") {
    await acaoNoPedidoIfood(pedido, "startPreparation", { rotulo });
  }
  await acaoNoPedidoIfood(pedido, "readyToPickup", { rotulo });
  return acaoNoPedidoIfood(pedido, "dispatch", { rotulo });
}
