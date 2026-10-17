import { redirect } from "next/navigation";

/**
 * /store/integracoes/cardapioweb — a "URL de instalação" e a "URL de login"
 * cadastradas no app do FireHub na CW App Store do CardápioWeb. É por aqui que
 * o lojista chega quando clica no FireHub de dentro do CardápioWeb.
 *
 * Não tem tela própria: manda para a Central de Integrações com o modal do
 * CardápioWeb já aberto, onde ele conecta cada marca. A autorização começa
 * sempre pelo botão de lá, porque o FireHub precisa gerar e guardar o `state`
 * do OAuth antes de mandar o lojista ao CardápioWeb.
 *
 * A sessão é a do /store: o redirect é no mesmo domínio e leva o cookie junto.
 * Sem login, o proxy manda para /login com o callbackUrl desta página, e depois
 * do login ela passa por aqui de novo e cai no modal.
 * Plano: Obsidian → Projetos/FireHub - Integração CardápioWeb.md.
 */
export const dynamic = "force-dynamic";

export default function CardapioWebInstalacaoPage() {
  redirect("/store/integracoes?integracao=cardapioweb");
}
