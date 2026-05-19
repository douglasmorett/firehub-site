import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Obtém a sessão do servidor de forma segura, com fallback para redirect.
 * Substitui o uso direto de getServerSession() nas páginas /store.
 */
export async function requireStoreSession() {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    console.error("[requireStoreSession] Erro ao obter sessão:", err);
    redirect("/login");
  }
  if (!session) redirect("/login");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/login");
  return { session, role };
}
