/**
 * A porta das PÁGINAS de relatório (Server Components): exige login com papel
 * de loja e devolve o nome da loja e o "hoje" no dia operacional DELA.
 *
 * O "hoje" vai daqui para a tela junto com a query da URL (`inicioDosFiltros`)
 * porque a tela é desenhada duas vezes — no servidor e no navegador — e as
 * duas precisam começar do MESMO período. Calculado no navegador, o servidor
 * (em UTC, sem a URL) desenhava "7 dias" e o navegador "Ontem": o React não
 * corrige atributo divergente na hidratação e ficavam dois botões acesos.
 * Os números vêm depois, pela rota de cada relatório (lib/relatorios/servidor.ts),
 * que confere o acesso de novo.
 */
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hojeNaLoja } from "@/lib/relatorios/base";

export async function acessoAoRelatorio(): Promise<{ nomeDaLoja: string; hoje: string }> {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");
  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { storeName: true, storeTimezone: true, owner: { select: { storeName: true, storeTimezone: true } } },
  }).catch(() => null);
  return {
    nomeDaLoja: usuario?.owner?.storeName || usuario?.storeName || "Minha loja",
    hoje: hojeNaLoja(usuario?.owner?.storeTimezone || usuario?.storeTimezone),
  };
}

/** A query da URL como o Next entrega (`searchParams`), em texto. */
export function queryDaPagina(sp: Record<string, string | string[] | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp || {})) {
    if (Array.isArray(v)) { if (v[0] !== undefined) u.set(k, v[0]); }
    else if (v !== undefined) u.set(k, v);
  }
  return u.toString();
}
