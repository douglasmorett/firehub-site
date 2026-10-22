import { redirect } from "next/navigation";
import { tabletDaRequisicao } from "@/lib/tablet-da-mesa/no-tablet";
import ParearTablet from "./ParearTablet";

/**
 * /tablet — a porta do Tablet na mesa (lib/tablet-da-mesa). Tablet já pareado
 * vai direto para o cardápio da mesa dele; o novo pede o número de 6 dígitos
 * que o dono gera no painel (Tablet na mesa › Adicionar tablet).
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Tablet da mesa", robots: { index: false, follow: false } };

export default async function PaginaDoTablet() {
  if (await tabletDaRequisicao()) redirect("/tablet/mesa");
  return <ParearTablet />;
}
