/**
 * GET /api/store/clientes/pedido?id=<id do pedido>
 *   → itens, entrega, descontos e pagamento de UM pedido do cliente, para a
 *     ficha em /store/clientes abrir o pedido ali mesmo.
 */
import { NextResponse } from "next/server";
import { pedidoDoCliente, sessaoDosClientes } from "@/lib/clientes-da-loja";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessao = await sessaoDosClientes();
  if (!sessao) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") || "";
  try {
    const pedido = await pedidoDoCliente(sessao, id);
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado nesta loja." }, { status: 404 });
    return NextResponse.json(pedido, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("[clientes] pedido falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível abrir o pedido agora." }, { status: 500 });
  }
}
