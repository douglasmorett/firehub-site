/**
 * POST — confere a senha do gerente para CANCELAR ITEM no caixa (header
 * x-senha-do-gerente, o mesmo `comSenhaDoGerente` das outras telas). Loja sem
 * senha cadastrada: livre. O nome de quem estava no caixa volta para a venda
 * gravar o item cancelado.
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { resumoDaSenha, senhaAtualConfere } from "@/lib/senha-do-gerente";
import { CABECALHO_DA_SENHA, CODIGO_SENHA_PEDIDA, senhaDoCabecalho } from "@/lib/senha-do-gerente-regras";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  const { temSenha } = await resumoDaSenha(ctx.quem.lojaId);
  if (!temSenha) return NextResponse.json({ ok: true, livre: true, quem: ctx.quem.nome });
  const senha = senhaDoCabecalho(req.headers.get(CABECALHO_DA_SENHA));
  if (!senha) {
    return NextResponse.json({ error: "Cancelar item pede a senha do gerente.", codigo: CODIGO_SENHA_PEDIDA, acao: "cancelarPedido" }, { status: 403 });
  }
  const r = await senhaAtualConfere(ctx.quem.lojaId, senha);
  if (!r.ok) return NextResponse.json({ error: r.error, codigo: r.codigo, restam: r.restam }, { status: r.status });
  return NextResponse.json({ ok: true, livre: false, quem: ctx.quem.nome });
}
