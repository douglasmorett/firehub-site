import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ComandaModeloClient from "./ComandaModeloClient";

/**
 * Personalizar impressão: página inteira, não pop-up.
 *
 * Começou como modal dentro da tela de Impressoras e não coube — a lista de
 * blocos e o papel precisam de duas colunas, e num diálogo o cabeçalho ficava
 * cortado por cima pela faixa do modo suporte (visto em 12/09/2026). Editar a
 * comanda é trabalho de bancada, não uma pergunta de sim/não: merece a tela.
 *
 * A configuração continua morando em `User.printerConfig.comandaModelo` — esta
 * página lê o mesmo objeto que a tela de Impressoras e grava pela mesma rota,
 * então não há dois lugares guardando a mesma coisa.
 */
export const dynamic = "force-dynamic";

export default async function ComandaModeloPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  const me = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  });
  if (!me) redirect("/");

  // Mesma resolução de dono do GET/PUT de /api/store/printer-config: o modelo
  // é da LOJA, não de quem está logado nela.
  const ownerId = me.ownerId || me.id;
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { storeName: true, name: true, printerConfig: true },
  });
  if (!user) redirect("/");

  return (
    <ComandaModeloClient
      storeName={user.storeName || user.name || "Minha loja"}
      initialConfig={(user.printerConfig as any) || { autoprint: true, printers: [] }}
    />
  );
}
