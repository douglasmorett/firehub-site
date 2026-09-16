/**
 * O pedido do 99Food como ELES mandam — para fechar dúvida de campo sem chutar.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O contrato do 99Food não declara tudo que o `order/detail` devolve. O código
 * de coleta é o exemplo que motivou isto: o entregador deles fala um número no
 * balcão, a loja precisa conferir, e não havia como saber o NOME do campo sem
 * esperar um pedido real e ler o log do container — que some a cada deploy.
 *
 * O registro de eventos (webhook-99food-log) não resolve: ele guarda o aviso do
 * webhook, não o pedido inteiro. E a chamada que traz o pedido inteiro precisa
 * das credenciais do app, que existem no servidor e em nenhum outro lugar.
 *
 * ── O que ele devolve, e o que NÃO devolve ──────────────────────────────────
 *
 * Só pedido DA PRÓPRIA LOJA que pediu — a busca é ancorada no `franchiseeId` de
 * quem está logado, então não há como pedir o pedido do vizinho.
 *
 * E devolve o MAPA dos campos, não os valores: nome do campo, tipo e tamanho.
 * O nome do cliente, o telefone e o endereço do pedido não têm por que passear
 * por um diagnóstico. A exceção são os campos com cara de código de coleta, que
 * saem com valor — são o motivo disto existir, são curtos e não identificam
 * ninguém.
 */

import { prisma } from "@/lib/prisma";
import { detalheDoPedido } from "@/lib/food99-api";
import { tokenDeUmId } from "@/lib/food99-status";
import { codigoDeColetaDoParceiro } from "@/lib/codigo-de-coleta";

/** Campos cujo NOME sugere código de coleta — estes saem com valor. */
const CARA_DE_CODIGO = /code|pickup|coleta|verif|pin|otp|fetch|collect|take/i;

type Campo = { campo: string; tipo: string; tamanho?: number; valor?: unknown };

function mapear(obj: unknown, caminho: string, nivel: number, saida: Campo[]) {
  if (!obj || typeof obj !== "object" || nivel > 6 || saida.length > 400) return;

  if (Array.isArray(obj)) {
    // Uma amostra basta: vinte itens iguais não ensinam mais que um.
    if (obj[0] !== undefined) mapear(obj[0], `${caminho}[0]`, nivel + 1, saida);
    return;
  }

  for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
    const p = caminho ? `${caminho}.${chave}` : chave;
    if (valor && typeof valor === "object") {
      mapear(valor, p, nivel + 1, saida);
      continue;
    }
    const campo: Campo = { campo: p, tipo: valor === null ? "null" : typeof valor };
    const s = String(valor ?? "");
    campo.tamanho = s.length;
    // Valor só para o que interessa ao diagnóstico, e só se for curto.
    if (CARA_DE_CODIGO.test(chave) && s.length <= 24) campo.valor = valor;
    saida.push(campo);
  }
}

export async function diagnosticoDePedido99(lojaId: string, orderId?: string) {
  const pedido = await prisma.customerOrder.findFirst({
    where: {
      franchiseeId: lojaId,
      source: "99FOOD",
      ...(orderId ? { openDeliveryOrderId: orderId } : { deliveryType: "DELIVERY" }),
    },
    orderBy: { createdAt: "desc" },
    select: {
      openDeliveryOrderId: true, openDeliveryReference: true,
      deliveryBy: true, createdAt: true, food99AppShopId: true,
    },
  });
  if (!pedido?.openDeliveryOrderId) {
    return { ok: false, motivo: "esta loja não tem pedido do 99Food para diagnosticar" };
  }

  const appShopId =
    pedido.food99AppShopId ||
    (await prisma.$queryRaw<{ appShopId: string }[]>`
      SELECT "appShopId" FROM "Food99Store" WHERE "userId" = ${lojaId} AND "connected" = true LIMIT 1`
    )?.[0]?.appShopId;
  if (!appShopId) return { ok: false, motivo: "loja sem vínculo ativo no 99Food" };

  const tk = await tokenDeUmId(String(appShopId));
  if (!tk?.auth_token) return { ok: false, motivo: "não foi possível obter o token da loja no 99Food" };

  const r: any = await detalheDoPedido(tk.auth_token, String(pedido.openDeliveryOrderId));
  if (r?.errno !== 0 || !r?.data) {
    return { ok: false, motivo: `order/detail recusou: ${r?.errno} ${r?.errmsg || ""}`.trim() };
  }

  const cru = r.data?.order || r.data;
  const campos: Campo[] = [];
  mapear(cru, "", 0, campos);

  return {
    ok: true,
    pedido: {
      referencia: pedido.openDeliveryReference,
      entregaPor: pedido.deliveryBy,
      criadoEm: pedido.createdAt,
    },
    // O que o leitor de hoje encontraria neste pedido — nulo é a resposta que
    // manda procurar na lista de campos abaixo.
    codigoQueOLeitorAcha: codigoDeColetaDoParceiro(cru, cru?.delivery, cru?.rider, cru?.logistics),
    camposComCaraDeCodigo: campos.filter((c) => CARA_DE_CODIGO.test(c.campo)),
    todosOsCampos: campos,
  };
}
