/**
 * POST /api/store/clientes/cadastro — o "Editar cadastro" da ficha do cliente.
 *   { telefone, nome?, aniversario?, endereco?, observacao? } → { ok, cadastro }
 *
 * Grava a correção DESTA loja (lib/cadastro-do-cliente.ts): o StoreCustomer é
 * global e não é tocado. Campo vazio volta a valer o que os pedidos dizem;
 * tudo vazio apaga a correção. Só para telefone que já é cliente da loja.
 */
import { NextResponse } from "next/server";
import { detalheDoCliente, sessaoDosClientes } from "@/lib/clientes-da-loja";
import { lerCadastro, salvarCadastro } from "@/lib/cadastro-do-cliente";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sessao = await sessaoDosClientes();
  if (!sessao) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const lido = lerCadastro(body || {});
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });

  try {
    const detalhe = await detalheDoCliente(sessao, String(body?.telefone || ""));
    if (!detalhe) return NextResponse.json({ error: "Telefone inválido — use DDD + número." }, { status: 400 });
    if (!detalhe.encontrado) return NextResponse.json({ error: "Este telefone ainda não é cliente da loja." }, { status: 404 });
    const cadastro = await salvarCadastro(sessao.lojaId, detalhe.telefone, lido.campos, sessao.quem);
    return NextResponse.json({ ok: true, cadastro });
  } catch (err: any) {
    console.error("[clientes] cadastro falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível salvar o cadastro agora. Tente de novo." }, { status: 500 });
  }
}
