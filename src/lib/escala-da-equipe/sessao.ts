/**
 * Quem está usando a Escala da equipe pelo painel, e de qual loja.
 *
 * A loja é a do login (`ownerId || id`): no multiloja, escolher uma loja no
 * seletor TROCA a conta da sessão (lib/loja-ativa.ts), então isto já é a loja
 * escolhida; em "Todas as lojas" a sessão fica na principal, e a escala é a
 * dela (escala de várias lojas juntas não faz sentido — cada loja tem a sua
 * equipe).
 *
 * Funcionário só passa com a caixinha da tela (lib/permissao-da-tela.ts, a
 * mesma regra do proxy) — a API não pode ser a porta dos fundos da tela.
 * Custo e diária combinada são só do dono (`ehDono`).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { FUSO_PADRAO } from "@/lib/fuso";
import { ErroDaEscala } from "./banco";

export type SessaoDaEscala = { lojaId: string; quem: string; ehDono: boolean; fuso: string };

export async function sessaoDaEscala(): Promise<SessaoDaEscala> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) throw new ErroDaEscala("Entre de novo no painel.", 401);
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, name: true, email: true, role: true, permissions: true, storeTimezone: true } });
  if (!u) throw new ErroDaEscala("Entre de novo no painel.", 401);
  const papel = String(u.role || "").toUpperCase();
  if (papel !== "FRANCHISEE" && papel !== "ADMIN" && papel !== "STAFF") throw new ErroDaEscala("Sem acesso à escala.", 403);
  if (papel === "STAFF" && !funcionarioAbre("/store/escala", u.permissions)) throw new ErroDaEscala("O dono não liberou a Escala da equipe para o seu login.", 403);
  const lojaId = u.ownerId || u.id;
  const fuso = u.ownerId
    ? (await prisma.user.findUnique({ where: { id: lojaId }, select: { storeTimezone: true } }).catch(() => null))?.storeTimezone
    : u.storeTimezone;
  return { lojaId, quem: u.name || u.email, ehDono: papel !== "STAFF", fuso: fuso || FUSO_PADRAO };
}

/** O erro vira resposta com a frase certa; o que não é nosso vira 500 genérico (e log). */
export function respostaDoErro(err: unknown, onde: string): NextResponse {
  if (err instanceof ErroDaEscala) return NextResponse.json({ error: err.message, codigo: err.codigo }, { status: err.status });
  console.error(`[Escala] ${onde}:`, (err as any)?.message || err);
  return NextResponse.json({ error: "Não deu certo agora. Tente de novo." }, { status: 500 });
}

export async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
