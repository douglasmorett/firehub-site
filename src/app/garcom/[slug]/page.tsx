/**
 * /garcom/<slug> — porta de entrada do garçom.
 *
 * É o link que o gerente copia na aba Garçons e manda para a equipe. Quem já
 * está logado NESTA loja vai direto para as mesas; quem tem cookie de outra
 * loja (mesmo celular, dois empregos) vê o formulário e, ao entrar, troca.
 */
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { autenticarGarcom } from "@/lib/garcom-auth";
import LoginDoGarcom from "./LoginDoGarcom";

export const dynamic = "force-dynamic";

export default async function PaginaDeLoginDoGarcom({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { slug } = await params;
  const { motivo } = await searchParams;

  const loja = await prisma.user.findUnique({
    where: { slug },
    select: { id: true, storeName: true, name: true, storeLogo: true },
  });
  if (!loja) notFound();

  const auth = await autenticarGarcom();
  if (auth.ok && auth.garcom.franchiseeId === loja.id) {
    redirect(`/garcom/${encodeURIComponent(slug)}/mesas`);
  }

  return (
    <LoginDoGarcom
      slug={slug}
      nomeDaLoja={loja.storeName || loja.name || "Restaurante"}
      logo={loja.storeLogo}
      motivo={motivo || null}
    />
  );
}
