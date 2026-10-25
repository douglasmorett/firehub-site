/**
 * /kds/<tela> — o link curto de uma tela do KDS (lib/kds-link-curto.ts):
 * firehubfood.com.br/kds/esfirra ou /kds/3. A loja é a do login; sem login,
 * vai para o login e volta para cá. Tela que não existe: o hub do KDS.
 */
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acharTela, urlDaTela, type TelaDoKds } from "@/lib/kds-link-curto";

export const dynamic = "force-dynamic";

export default async function LinkCurtoDoKds({ params }: { params: Promise<{ tela: string }> }) {
  const { tela } = await params;
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect(`/login?callbackUrl=${encodeURIComponent(`/kds/${tela}`)}`);

  const usuario = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  if (!usuario) redirect("/login");
  const loja = await prisma.user.findUnique({ where: { id: usuario.ownerId || usuario.id }, select: { kdsScreens: true } });
  const telas = (Array.isArray(loja?.kdsScreens) ? loja.kdsScreens : []) as TelaDoKds[];

  const achada = acharTela(telas.filter((t) => t && t.id && t.name), tela);
  redirect(achada ? urlDaTela(achada) : "/store/kds");
}
