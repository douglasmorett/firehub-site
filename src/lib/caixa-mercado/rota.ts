/**
 * O começo comum das rotas do caixa: quem pede, a loja, o módulo ligado e o
 * computador (cookie). Devolve o contexto ou a resposta de recusa pronta.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { quemUsaOCaixa, type QuemUsaOCaixa } from "./sessao";
import { caixaEstaLigado } from "./assinatura";
import { COOKIE_DO_CAIXA, terminalDoCookie, type TerminalDoCaixa } from "./terminal";

export type ContextoDoCaixa = { quem: QuemUsaOCaixa; terminal: TerminalDoCaixa | null };

export async function contextoDoCaixa(opcoes: { exigirTerminal?: boolean; tela?: string } = {}): Promise<ContextoDoCaixa | NextResponse> {
  const quem = await quemUsaOCaixa(opcoes.tela);
  if (!quem) return NextResponse.json({ error: "Seu acesso não abre o Caixa de mercado. Peça ao dono da loja." }, { status: 403 });
  if (!(await caixaEstaLigado(quem.lojaId))) {
    return NextResponse.json({ error: "O Caixa de mercado está desligado nesta loja. O dono ativa em Caixa de mercado.", codigo: "MODULO_DESLIGADO" }, { status: 409 });
  }
  const token = (await cookies()).get(COOKIE_DO_CAIXA)?.value;
  const terminal = await terminalDoCookie(token, quem.lojaId);
  if (opcoes.exigirTerminal && !terminal) {
    return NextResponse.json({ error: "Este computador não está registrado como caixa. O dono registra em Caixa de mercado.", codigo: "SEM_TERMINAL" }, { status: 409 });
  }
  return { quem, terminal };
}

export const ehResposta = (x: unknown): x is NextResponse => x instanceof NextResponse;
