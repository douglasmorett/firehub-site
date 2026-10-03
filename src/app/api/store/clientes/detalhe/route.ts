/**
 * GET /api/store/clientes/detalhe?telefone=22999991234
 *   → pedidos, endereços, números e o extrato de cashback do cliente NESTA loja.
 *
 * Telefone que não é cliente da loja volta com `encontrado: false` e só o
 * saldo zerado — é o caminho do "Lançar saldo" para quem ainda não pediu.
 */
import { NextResponse } from "next/server";
import { detalheDoCliente, sessaoDosClientes } from "@/lib/clientes-da-loja";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessao = await sessaoDosClientes();
  if (!sessao) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const telefone = new URL(req.url).searchParams.get("telefone") || "";
  try {
    const detalhe = await detalheDoCliente(sessao, telefone);
    if (!detalhe) return NextResponse.json({ error: "Telefone inválido — use DDD + número." }, { status: 400 });
    return NextResponse.json(detalhe, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("[clientes] detalhe falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível abrir o cliente agora." }, { status: 500 });
  }
}
