import { notFound } from "next/navigation";
import { CODIGO_DO_CURSO, COMISSAO_DO_CURSO } from "@/lib/embaixador-do-curso";
import CadastroDoCurso from "./CadastroDoCurso";

export const metadata = { title: "Seja embaixador FireHub", robots: { index: false, follow: false } };

/** Link que só existe dentro do curso "O Jogo da Recorrência" (lib/embaixador-do-curso.ts). */
export default async function EmbaixadorDoCursoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (codigo !== CODIGO_DO_CURSO) notFound();
  return <CadastroDoCurso codigoDoCurso={codigo} comissao={COMISSAO_DO_CURSO} />;
}
