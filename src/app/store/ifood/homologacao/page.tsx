/**
 * /store/ifood/homologacao
 *
 * A tela usada para gravar os vídeos da homologação do iFood.
 *
 * Ela existe separada de propósito. A antiga `/store/ifood` virou um redirect
 * para a Central de Integrações quando o hub unificado entrou, e o
 * IfoodHomologacaoClient ficou sem nenhuma rota que o renderizasse — o
 * componente continuou no repositório, mas inalcançável. Como a homologação
 * exige demonstrar os cenários numa interface funcional em produção, ele
 * precisa de um endereço próprio.
 *
 * Não toca no caminho que os lojistas usam: quem entra em /store/ifood continua
 * indo para a Central de Integrações como antes.
 *
 * O clientId exibido é o do app DISTRIBUÍDO, porque é ele que o chamado declara
 * e é por ele que as chamadas precisam sair.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { lojasIfood } from "@/lib/ifood-token";
import IfoodHomologacaoClient from "../IfoodHomologacaoClient";

export const dynamic = "force-dynamic";

export default async function IfoodHomologacaoPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");

  const email = session.user.email;

  const clientId =
    process.env.IFOOD_CLIENT_ID_DISTRIBUTED || process.env.IFOOD_CLIENT_ID || "";

  const user = await prisma.user.findUnique({
    where: { email },
    select: { ifoodWidgetId: true, ifoodMerchantId: true },
  });

  // A loja pode estar na tabela de integrações e não no registro do usuário —
  // é o caso das lojas que conectaram pelo hub.
  const lojas = await lojasIfood(email).catch(() => []);
  const merchantId = lojas[0]?.merchantId || user?.ifoodMerchantId || "";

  return (
    <IfoodHomologacaoClient
      merchantId={merchantId}
      clientId={clientId}
      ifoodWidgetId={user?.ifoodWidgetId || undefined}
    />
  );
}
