import { redirect } from "next/navigation";

/**
 * firehubfood.com.br/s — o atalho do suporte pelo navegador, curto para digitar
 * no WhatsApp ou falar por telefone (Douglas, 20/11/2026: "faz um link bem curto
 * que eu consiga digitar"). Leva para /suporte, mantendo o ?c= do link pessoal.
 */
export default async function Atalho({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  redirect(typeof c === "string" && c ? `/suporte?c=${encodeURIComponent(c)}` : "/suporte");
}
