import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/cron/99food-poll
 *
 * ── Esta rota NÃO recupera pedido, e não tem como recuperar ─────────────────
 *
 * Ela nasceu prometendo ser para o 99Food o que o `ifood-poll` é para o iFood:
 * uma rede embaixo do webhook, que busca de tempos em tempos o que não foi
 * entregue. O corpo dela nunca fez isso — listava as lojas conectadas, escrevia
 * no log e devolvia `created: 0`, sem falar com o 99Food uma única vez.
 *
 * E não é questão de terminar a implementação: **a API do 99Food não tem
 * endpoint de listar pedidos**. Conferido endpoint por endpoint no swagger
 * oficial (`.99food-docs/swagger.yaml`): de pedido existem apenas
 * `order/detail` (por id), `confirm`, `cancel`, `ready`, `delivered` e os dois
 * `apply/*`. Buscar "os pedidos novos da loja" não é uma pergunta que a API
 * deles responda.
 *
 * Consequência, e é o ponto todo desta anotação: **o webhook é o único caminho
 * de entrada**. Se o 99Food não chamar `/api/99food/webhook`, o pedido não
 * chega — e nada aqui dentro conserta isso, porque o Callback address é
 * configuração no portal de desenvolvedor deles e não tem API.
 *
 * O que existe de resgate é um a um, pelo id de 19 dígitos:
 * `POST /api/99food/importar-pedido { orderId }`, que usa o `order/detail`.
 *
 * A rota fica de pé (em vez de ser apagada) porque devolver 404 para um
 * agendador que ninguém lembra de ter criado troca um diagnóstico honesto por
 * um alarme falso. Ela não está no `scripts/cron-runner.js`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lojas = await prisma.user.count({
    where: { food99Connected: true, role: "FRANCHISEE" },
  });

  return NextResponse.json({
    ok: true,
    polling: false,
    lojasConectadas: lojas,
    created: 0,
    motivo:
      "O 99Food não expõe endpoint de listagem de pedidos — só order/detail por id. " +
      "Não há como varrer pedidos novos, então esta rota não substitui o webhook.",
    entradaDePedido: "https://firehubfood.com.br/api/99food/webhook (Callback address no portal do 99Food)",
    resgateManual: "POST /api/99food/importar-pedido { orderId } — id de 19 dígitos",
    diagnostico: "GET /api/99food/diagnostico (logado como a loja) diz em qual ponta o pedido parou",
  });
}
