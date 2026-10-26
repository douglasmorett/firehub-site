/**
 * /src/lib/evopdv/rota.ts
 *
 * O que toda rota /api/integracoes/evopdv/* faz igual: a estrutura no banco
 * (garantida no boot; aqui por precaução, com cache), a chave Bearer da loja e
 * a tradução dos erros conhecidos — sem nunca devolver segredo nem o que
 * chegou no corpo.
 */
import { NextResponse } from "next/server";
import { ErroDaChaveFiscal, MENSAGEM_SEM_CHAVE_FISCAL } from "@/lib/fiscal-credenciais";
import { ConflitoNaGravacao, LojaNaoEncontrada } from "@/lib/nfce/gravar-config-fiscal";
import { contaDaChave, type ContaEvopdv, type Resposta } from "./conta";
import { garantirEstruturaDoEvopdv } from "./estrutura-no-banco";
import type { Documento } from "./notas";

export async function responder(feito: Resposta | Documento): Promise<Response> {
  if (typeof feito.corpo === "string") {
    return new NextResponse(feito.corpo, { status: feito.status, headers: (feito as Documento).cabecalhos });
  }
  const r = NextResponse.json(feito.corpo, { status: feito.status });
  r.headers.set("Cache-Control", "no-store");
  if (feito.status === 503) r.headers.set("Retry-After", "120");
  return r;
}

export function traduzirErro(origem: string, e: any): Response {
  if (e instanceof ErroDaChaveFiscal) {
    console.error(`[EvoPDV ${origem}]`, e.message);
    return NextResponse.json({ error: "chave_fiscal", mensagem: MENSAGEM_SEM_CHAVE_FISCAL }, { status: 503 });
  }
  if (e instanceof LojaNaoEncontrada) return NextResponse.json({ error: "conta_nao_encontrada" }, { status: 404 });
  if (e instanceof ConflitoNaGravacao) return NextResponse.json({ error: "conflito", mensagem: e.message }, { status: 409 });
  // Só o nome e a mensagem, com base64 longo cortado (o .pfx pode ecoar num erro).
  console.error(`[EvoPDV ${origem}]`, e?.name, String(e?.message ?? e).replace(/[A-Za-z0-9+/=]{40,}/g, "[…]").slice(0, 300));
  return NextResponse.json({ error: "erro_interno", mensagem: "Erro interno no FireHub. Tente de novo." }, { status: 500 });
}

/** A rota com a conta da chave Bearer (401 sem ela). */
export async function comConta(req: Request, origem: string, fazer: (conta: ContaEvopdv) => Promise<Resposta | Documento>): Promise<Response> {
  try {
    await garantirEstruturaDoEvopdv();
    const conta = await contaDaChave(req.headers.get("authorization"));
    if (!conta) return NextResponse.json({ error: "chave_invalida", mensagem: "Chave da loja inválida ou revogada." }, { status: 401 });
    return await responder(await fazer(conta));
  } catch (e: any) {
    return traduzirErro(origem, e);
  }
}

/** O corpo JSON, ou null se não for JSON. */
export async function corpoJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
