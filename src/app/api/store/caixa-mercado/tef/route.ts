/**
 * TEF (pinpad PayGo pelo Assistente) no computador do caixa — o MESMO motor do
 * totem (lib/tef-do-totem.ts): a licença é `caixa:<terminalId>`.
 * POST   — liga (ou religa) no computador deste cookie; devolve UMA vez a chave e o
 *          segredo local, que a tela entrega ao Assistente daqui (/tef/parear).
 * DELETE — desliga.
 * Só o dono (como o TEF do totem).
 */
import { NextRequest, NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { licencaTefDoTerminal } from "@/lib/caixa-mercado/terminal";
import { desligarTef, ligarTef } from "@/lib/tef-do-totem";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  if (!ctx.quem.dono) return NextResponse.json({ error: "Só o dono da loja liga o TEF do caixa." }, { status: 403 });
  const licencaId = licencaTefDoTerminal(ctx.terminal!.id);
  const { chave, segredoLocal } = await ligarTef({ licencaId, franchiseeId: ctx.quem.lojaId, por: ctx.quem.email });
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "firehubfood.com.br";
  const protocolo = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return NextResponse.json({ licencaId, chave, segredoLocal, nuvem: `${protocolo}://${host}` });
}

export async function DELETE() {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  if (!ctx.quem.dono) return NextResponse.json({ error: "Só o dono da loja desliga o TEF do caixa." }, { status: 403 });
  await desligarTef(licencaTefDoTerminal(ctx.terminal!.id), ctx.quem.lojaId);
  return NextResponse.json({ ok: true });
}
