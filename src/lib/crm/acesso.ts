import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Quem está usando o CRM: o admin do FireHub ou um vendedor da equipe.
 *
 * O vendedor entra com o login do portal do embaixador (role AMBASSADOR, id =
 * Ambassador.id) e só vale enquanto está na equipe e ativo — tirar alguém da
 * equipe corta o acesso às conversas na hora, sem esperar a sessão vencer.
 *
 * O /admin aceita STAFF no layout, mas o CRM não: são as conversas do número
 * do FireHub e os dados de todos os leads.
 */
export type QuemEsta =
  | { tipo: "ADMIN"; id: string; nome: string }
  | { tipo: "VENDEDOR"; id: string; nome: string };

export async function quemEsta(): Promise<QuemEsta | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as any;
  if (!u) return null;
  if (u.role === "ADMIN") return { tipo: "ADMIN", id: String(u.id || ""), nome: String(u.name || "Admin") };
  if (u.role === "AMBASSADOR" && u.id) {
    const v = await prisma.ambassador.findUnique({
      where: { id: String(u.id) },
      select: { id: true, name: true, isVendedor: true, active: true },
    });
    if (v?.isVendedor && v.active) return { tipo: "VENDEDOR", id: v.id, nome: v.name };
  }
  return null;
}

/** O vendedor só enxerga o contato que está com ele; o admin, todos. */
export function podeVerContato(quem: QuemEsta, contato: { vendedorId: string | null }): boolean {
  return quem.tipo === "ADMIN" || contato.vendedorId === quem.id;
}

/** O filtro de banco equivalente a `podeVerContato`. */
export function filtroDeContatos(quem: QuemEsta): { vendedorId?: string } {
  return quem.tipo === "ADMIN" ? {} : { vendedorId: quem.id };
}

export const NAO_AUTORIZADO = { error: "Não autorizado" } as const;

/** id → nome de toda a equipe (inclusive quem saiu), para rotular contato e reunião. */
export async function nomesDaEquipe(): Promise<Map<string, string>> {
  const vendedores = await prisma.ambassador.findMany({ where: { isVendedor: true }, select: { id: true, name: true } });
  return new Map(vendedores.map((v) => [v.id, v.name]));
}
