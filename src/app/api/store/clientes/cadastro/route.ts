/**
 * POST /api/store/clientes/cadastro — o "Editar cadastro" da ficha do cliente.
 *   { telefone, nome?, aniversario?, endereco?, observacao? } → { ok, cadastro }
 *
 * Grava a correção DESTA loja (lib/cadastro-do-cliente.ts): o StoreCustomer é
 * global e não é tocado. Campo vazio volta a valer o que os pedidos dizem;
 * tudo vazio apaga a correção. Só para telefone que já é cliente da loja.
 *
 * `telefoneNovo` (opcional): troca o número — pedidos, saldo e correção desta
 * loja passam para ele (trocarTelefoneDoCliente). Se o novo já é cliente da
 * loja, responde 409 { jaExiste } e só junta com `juntar: true`.
 */
import { NextResponse } from "next/server";
import { detalheDoCliente, sessaoDosClientes, trocarTelefoneDoCliente } from "@/lib/clientes-da-loja";
import { lerCadastro, lerTrocaDeTelefone, salvarCadastro } from "@/lib/cadastro-do-cliente";

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
    const troca = lerTrocaDeTelefone(detalhe.telefone, body?.telefoneNovo);
    if (!troca.ok) return NextResponse.json({ error: troca.erro }, { status: 400 });
    if (!troca.novo) {
      const cadastro = await salvarCadastro(sessao.lojaId, detalhe.telefone, lido.campos, sessao.quem);
      return NextResponse.json({ ok: true, cadastro });
    }
    if (!troca.mesmaPessoa && !body?.juntar) {
      const outro = await detalheDoCliente(sessao, troca.novo);
      if (outro?.encontrado) {
        return NextResponse.json({
          error: `O número ${troca.novo} já é cliente da loja${outro.nome ? ` (${outro.nome})` : ""}.`,
          jaExiste: true, nome: outro.nome,
        }, { status: 409 });
      }
    }
    const movidos = await trocarTelefoneDoCliente(sessao.lojaId, detalhe.telefone, troca.novo);
    const cadastro = await salvarCadastro(sessao.lojaId, troca.novo, lido.campos, sessao.quem, detalhe.telefone);
    console.log(`[clientes] telefone trocado na loja ${sessao.lojaId} por ${sessao.quem}: ${detalhe.telefone} → ${troca.novo} (${movidos.pedidos} pedidos, ${movidos.lancamentos} lançamentos)`);
    return NextResponse.json({ ok: true, cadastro, telefone: troca.novo });
  } catch (err: any) {
    console.error("[clientes] cadastro falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível salvar o cadastro agora. Tente de novo." }, { status: 500 });
  }
}
