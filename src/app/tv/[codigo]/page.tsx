import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { normalizarCodigo } from "@/lib/painel-de-senhas";
import { contarCodigoErrado, tvBloqueada } from "@/lib/codigo-errado-da-tv";
import { origemDaRequisicao } from "@/lib/login-throttle";
import PainelDeSenhasTV from "@/components/painel-de-senhas/PainelDeSenhasTV";

export const metadata: Metadata = {
  title: "Painel de senhas",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0B0F17" };

/**
 * A TV do salão (lib/painel-de-senhas.ts). O código acha a loja uma vez aqui;
 * depois a TV pergunta pela loja + código, sem varrer as lojas a cada 4 s.
 */
export default async function PainelDaTvPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo: bruto } = await params;
  const codigo = normalizarCodigo(bruto);
  if (!codigo) redirect("/tv?erro=codigo");

  // Quem já errou códigos demais nesta rede não testa mais nenhum por um tempo
  // (lib/codigo-errado-da-tv.ts) — nem o certo, senão o teto não segura nada.
  const ip = origemDaRequisicao(await headers());
  if (tvBloqueada(ip)) redirect("/tv?erro=codigo");

  const achada = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE "painelDeSenhas"->>'codigo' = ${codigo} LIMIT 1`.catch(() => []);
  if (!achada.length) {
    contarCodigoErrado(ip, codigo);
    redirect("/tv?erro=codigo");
  }

  return <PainelDeSenhasTV lojaId={achada[0].id} codigo={codigo} previa={false} />;
}
