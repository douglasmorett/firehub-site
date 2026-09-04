/**
 * /garcom/<slug>/mesas — o módulo de mesa visto pelo garçom.
 *
 * Mesma tela do painel (src/components/mesas/MesasApp.tsx), em modo garçom:
 * sem menu do painel, sem cadastro de mesa, e a mesa abre sempre em nome de
 * quem está logado. As rotas de API conferem o cookie do garçom por conta
 * própria (src/lib/garcom-auth.ts); esta página só decide se ele entra.
 */
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { autenticarGarcom } from "@/lib/garcom-auth";
import MesasApp from "@/components/mesas/MesasApp";

export const dynamic = "force-dynamic";

export default async function PaginaDeMesasDoGarcom({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const destinoDoLogin = `/garcom/${encodeURIComponent(slug)}`;

  const auth = await autenticarGarcom();
  if (!auth.ok) redirect(destinoDoLogin);

  // Cookie de OUTRA loja neste endereço: volta para o login desta, que vai
  // mostrar o formulário (e não um redirect de volta para cá).
  const loja = await prisma.user.findUnique({
    where: { id: auth.garcom.franchiseeId },
    select: { slug: true },
  });
  if (!loja || loja.slug !== slug) redirect(destinoDoLogin);

  return <MesasApp modo="garcom" garcom={{ id: auth.garcom.id, name: auth.garcom.name }} slug={slug} />;
}
