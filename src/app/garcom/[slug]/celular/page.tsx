/**
 * /garcom/<slug>/celular — o módulo de mesa do garçom, desenhado para celular.
 *
 * Mesma porta e mesmas regras de /garcom/<slug>/mesas (que segue sendo a tela
 * completa, para tablet): só muda a tela. As rotas de API conferem o cookie do
 * garçom por conta própria (src/lib/garcom-auth.ts).
 */
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { autenticarGarcom } from "@/lib/garcom-auth";
import MesasCelular from "@/components/mesas/MesasCelular";

export const dynamic = "force-dynamic";

export default async function PaginaDeMesasDoGarcomNoCelular({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // O login lembra de qual tela o garçom veio, para devolvê-lo a ela.
  const destinoDoLogin = `/garcom/${encodeURIComponent(slug)}?tela=celular`;

  const auth = await autenticarGarcom();
  if (!auth.ok) redirect(`${destinoDoLogin}&motivo=${encodeURIComponent(auth.codigo)}`);

  const loja = await prisma.user.findUnique({
    where: { id: auth.garcom.franchiseeId },
    select: { slug: true },
  });
  if (!loja || loja.slug !== slug) redirect(destinoDoLogin);

  return (
    <MesasCelular
      modo="garcom"
      garcom={{ id: auth.garcom.id, name: auth.garcom.name }}
      slug={slug}
    />
  );
}
