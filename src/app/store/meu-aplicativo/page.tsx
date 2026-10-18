import { redirect } from "next/navigation";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { appLigadoNaConta } from "@/lib/app-da-loja/instalacoes";
import MeuAplicativoClient from "./MeuAplicativoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Meu aplicativo" };

/**
 * /store/meu-aplicativo — o painel do app próprio da loja, depois que o admin
 * ativa o plano: base de aparelhos, ativos agora, o que o app vendeu no mês e
 * a notificação push (GET/POST /api/store/meu-aplicativo).
 *
 * Só o dono (ou o ADMIN na loja que abriu). Sem plano ligado, a tela de venda.
 */
export default async function MeuAplicativoPage() {
  const s = await lojaDoAssessorDaSessao().catch(() => null);
  if (!s) redirect("/store");
  if (!(await appLigadoNaConta(s.franchiseeId))) redirect("/store/aplicativo");
  return <MeuAplicativoClient />;
}
