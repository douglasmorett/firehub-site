/**
 * lib/open-delivery-saida/acesso.ts — o Bearer da logística nas rotas /api/opendelivery/v1/*.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lerToken, tokenConfere } from "./credenciais";
import { integracaoPorId, type Integracao } from "./eventos";

function chaveDoToken(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar o token do Open Delivery.");
  return s;
}

export { chaveDoToken };

/** Erro no formato da spec (application/problem+json com title e status). */
export function problema(status: number, title: string): NextResponse {
  return NextResponse.json({ title, status }, { status, headers: { "Content-Type": "application/problem+json" } });
}

/** A integração do token, ou null (token ausente, forjado, vencido, segredo trocado ou integração desligada). */
export async function autenticarLogistica(req: Request): Promise<Integracao | null> {
  const m = /^Bearer\s+(\S+)/i.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const lido = lerToken(m[1]);
  if (!lido) return null;
  const integ = await integracaoPorId(lido.integracaoId);
  if (!integ || !integ.ativo) return null;
  if (!tokenConfere(chaveDoToken(), m[1], integ.clientSecretCifrado)) return null;
  // Uso, no máximo uma gravação por minuto — a tela mostra "último acesso".
  const ultimo = integ.ultimoUsoEm ? new Date(integ.ultimoUsoEm).getTime() : 0;
  if (Date.now() - ultimo > 60_000) {
    prisma.$executeRawUnsafe(`UPDATE "OpenDeliverySaida" SET "ultimoUsoEm" = now() WHERE "id" = $1`, integ.id).catch(() => {});
  }
  return integ;
}

export const NAO_AUTORIZADO = () => problema(401, "Unauthorized: token ausente, inválido ou vencido.");
