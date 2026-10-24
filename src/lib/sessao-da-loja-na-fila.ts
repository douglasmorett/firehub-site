/**
 * /src/lib/sessao-da-loja-na-fila.ts
 *
 * A sessão do painel como credencial no POST /api/store/print-queue e no /ack
 * (lib/token-do-assistente.ts, `barrarChamadaDaFila`). A reimpressão e a
 * confirmação que o NAVEGADOR faz (GlobalPrintListener, quadro de pedidos) não
 * levam o token do Assistente: quando a fase 2 ligar, é a sessão da loja que
 * as deixa passar. Qualquer falha aqui = "sem sessão", nunca erro.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDoGrupo } from "@/lib/loja-ativa";
import { sessaoValeComoCredencial } from "@/lib/token-do-assistente";

/** A sessão desta requisição é da loja `lojaId` (ou de uma loja do grupo dela)? */
export async function sessaoDaLojaNaFila(lojaId: string | null | undefined, sessaoJaLida?: any): Promise<boolean> {
  if (!lojaId) return false;
  try {
    const session = sessaoJaLida === undefined ? await getServerSession(authOptions) : sessaoJaLida;
    const email = session?.user?.email;
    if (!email) return false;
    const conta = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, role: true } });
    if (!conta) return false;
    if (sessaoValeComoCredencial(conta, lojaId)) return true;
    if (String(conta.role || "").toUpperCase() === "STAFF") return false;
    const grupo = await lojasDoGrupo(conta.ownerId || conta.id);
    return sessaoValeComoCredencial(conta, lojaId, grupo.map((l) => l.id));
  } catch {
    return false;
  }
}
