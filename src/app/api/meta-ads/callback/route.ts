/**
 * GET /api/meta-ads/callback
 * Retorno do OAuth do Meta — guarda o token de anúncios da loja.
 *
 * ── O QUE ESTAVA ERRADO AQUI ────────────────────────────────────────────────
 * A versão anterior era pública (sem sessão) e lia o `franchiseeId` de um
 * `state` em base64 montado no navegador. Trocando o id no state, o token de
 * anúncios de um lojista — com permissão `ads_management` — era gravado na
 * conta de outra pessoa, que passava a gastar o dinheiro da conta de anúncios
 * da vítima.
 *
 * Agora exige as três coisas ao mesmo tempo:
 *   1. sessão válida;
 *   2. state assinado pelo servidor e dentro da validade;
 *   3. a loja do state igual à loja da sessão.
 *
 * Também deixou de dizer "conectado" quando não conectou: antes, se a troca de
 * código falhasse, `exchangeCodeForToken` devolvia undefined sem lançar, o
 * Prisma ignorava o campo e o registro ficava com `metaAdsEnabled: true` sem
 * token nenhum — e a tela exibia "✅ Facebook conectado!".
 *
 * PENDENTE (precisa de rota + tela, não cabe aqui): a Página escolhida ainda
 * não pode ser TROCADA pelo lojista. A conta de anúncios já tem saída própria
 * (POST /api/meta-ads/escolher-conta). Enquanto a Página não tiver a mesma,
 * quem administra várias Páginas depende do acerto automático abaixo.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  exchangeCodeForToken,
  getMetaAccounts,
  descobrirPixelDaConta,
  escolherMelhorContaDeAnuncios,
  escolherMelhorPagina,
  listarTodasAsContasDeAnuncio,
} from "@/lib/meta-ads";
import { lerState } from "@/lib/meta-oauth-state";

export const dynamic = "force-dynamic";

function baseDoSite(): string {
  const bruto = process.env.NEXTAUTH_URL || "";
  const ok = bruto && !bruto.includes("[SENSITIVE]") && bruto.startsWith("http");
  return (ok ? bruto : "https://firehubfood.com.br").replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
  const base = baseDoSite();
  const voltarCom = (erro: string) =>
    NextResponse.redirect(`${base}/store/meta-ads?error=${encodeURIComponent(erro)}`);

  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (searchParams.get("error")) return voltarCom("facebook_denied");
  if (!code || !state) return voltarCom("missing_params");

  // 1. Sessão
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaDaSessao = (session?.user as any)?.id as string | undefined;
  if (!lojaDaSessao) return voltarCom("sessao_expirada");

  // 2. Assinatura e validade do state
  const conferido = lerState(state);
  if (!conferido.ok) {
    console.warn(`[MetaAds OAuth] state recusado (${conferido.motivo}) na loja ${lojaDaSessao}`);
    return voltarCom(conferido.motivo === "expirado" ? "link_expirado" : "state_invalido");
  }

  // 3. O state tem que ser DESTA loja
  if (conferido.dados.franchiseeId !== lojaDaSessao) {
    console.error(
      `[MetaAds OAuth] TENTATIVA DE DESVIO: state pede a loja ${conferido.dados.franchiseeId} ` +
      `mas a sessão é da loja ${lojaDaSessao}. Conexão recusada.`
    );
    return voltarCom("loja_divergente");
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    if (!accessToken) {
      console.error("[MetaAds OAuth] troca de código não devolveu token.");
      return voltarCom("token_exchange_failed");
    }

    const { pages } = await getMetaAccounts(accessToken);

    // A busca das contas passa por TODOS os caminhos (pessoais + de cada
    // business): a conta que o lojista usa costuma viver dentro do Business
    // Manager, e por `/me/adaccounts` ela simplesmente não aparece.
    //
    // E a escolha NÃO pode ser `[0]`: quem já anunciou tem a conta velha
    // encerrada ao lado da atual. Na conta do dono as duas coisas se somaram —
    // o módulo gravou uma conta encerrada e disse "sua conta está desativada"
    // enquanto a conta boa nem tinha sido consultada.
    const { contas, porCaminho, erros } = await listarTodasAsContasDeAnuncio(accessToken);
    const contaEscolhida = escolherMelhorContaDeAnuncios(contas);
    const adAccountId = contaEscolhida?.id ?? null;

    // A Página que ASSINA o anúncio tinha o mesmo defeito da conta: era
    // `pages[0]`, a ordem que a Meta devolveu. `pages_show_list` traz TODA
    // Página em que a pessoa tem qualquer papel — a antiga, a do sócio, a do
    // parente onde ela é só Analista. Analista não anuncia: o POST
    // /adcreatives é recusado e o lojista leva o JSON cru da Meta no último
    // passo, depois de montar o criativo inteiro. Agora prefere quem tem a
    // tarefa ADVERTISE; se a Meta não informar tarefas, mantém a ordem dela
    // (bloquear por falta de dado tiraria do ar quem está funcionando).
    const paginaEscolhida = escolherMelhorPagina(pages);
    const pageId = paginaEscolhida?.id ?? null;

    console.log(
      `[Meta Ads] Loja ${lojaDaSessao}: ${contas.length} conta(s) de anúncio. ` +
        `Escolhida ${adAccountId} (status ${contaEscolhida?.account_status}, via ${porCaminho[adAccountId as string] || "?"}). ` +
        (contas.length > 1
          ? `Demais: ${contas.filter((c: any) => c.id !== adAccountId).map((c: any) => `${c.id}=${c.account_status}`).join(", ")}. `
          : "") +
        (erros.length ? `Erros: ${erros.join(" | ")}` : "")
    );

    // A Página escolhida vai no log pelo mesmo motivo da conta: quando o
    // lojista reclamar que o anúncio saiu assinado pela marca errada, dá para
    // ver aqui quais eram as candidatas e por que esta ganhou.
    console.log(
      `[Meta Ads] Loja ${lojaDaSessao}: ${pages?.length ?? 0} Página(s). ` +
        `Escolhida ${pageId ?? "nenhuma"} ("${paginaEscolhida?.name ?? "?"}", ` +
        `tarefas: ${
          Array.isArray(paginaEscolhida?.tasks) && paginaEscolhida.tasks.length
            ? paginaEscolhida.tasks.join("/")
            : "não informadas pela Meta"
        })` +
        ((pages?.length ?? 0) > 1
          ? `. Demais: ${pages
              .filter((p: any) => p?.id !== pageId)
              .map((p: any) => `${p.id}="${p.name ?? "?"}"`)
              .join(", ")}`
          : "")
    );

    // Descobre o Pixel na hora da conexão. Sem ele não há medição de pedido, e
    // pedir para o lojista achar o ID sozinho é atrito que a maioria não vence.
    const pixel = adAccountId ? await descobrirPixelDaConta(adAccountId, accessToken) : null;

    // Sem conta de anúncios — ou sem Página — não há como veicular. Guarda o
    // token (a conta pode ser trocada depois em /api/meta-ads/escolher-conta)
    // mas NÃO liga o módulo, para a tela não prometer o que não existe.
    await prisma.user.update({
      where: { id: lojaDaSessao },
      data: {
        metaFbAccessToken: accessToken,
        metaAdAccountId: adAccountId,
        metaFbPageId: pageId,
        // Liga o módulo só quando existem AS DUAS pontas — conta e Página.
        // `metaAdsEnabled` não é enfeite de tela: `detectarUsoDaLoja`
        // (lib/billing.ts) conta "Meta Ads" como uso da loja no fechamento do
        // mês. Ligar uma loja sem Página é cobrar mensalidade por um módulo que
        // não consegue nem criar o criativo.
        //
        // E aqui NUNCA se desliga: `metaAdsEnabled` é o filtro do cron que
        // renova o token da loja (api/cron/meta-ads-sync). Se uma reconexão
        // voltasse incompleta — permissão desmarcada no diálogo do Facebook —
        // desligar deixaria o token morrer com campanha veiculando na Meta,
        // gastando o cartão do lojista sem ninguém acompanhando. Desligar é
        // atribuição do cron, que já faz isso quando o token de fato morre.
        ...(adAccountId && pageId ? { metaAdsEnabled: true } : {}),
        // Só grava o pixel se descobriu algum — não apaga o que o lojista já
        // tenha configurado à mão na tela de Integrações.
        ...(pixel?.id ? { metaPixelId: pixel.id } : {}),
      },
    });

    if (!adAccountId) return voltarCom("sem_conta_de_anuncios");

    // Anúncio é publicado POR uma Página; sem ela o criativo não existe. Isto
    // passava batido: a tela dizia "✅ Facebook conectado!", o lojista escolhia
    // imagem, escrevia o texto, apertava Publicar — e só então recebia o erro
    // cru da Meta, sem nada na tela para resolver. Falhar agora custa um clique
    // e diz o que fazer.
    if (!pageId) return voltarCom("sem_pagina_do_facebook");

    const investimento = conferido.dados.investment;
    const extra = investimento ? `&budget=${investimento}` : "";
    return NextResponse.redirect(`${base}/store/meta-ads?connected=true${extra}`);
  } catch (err) {
    console.error("[MetaAds OAuth]", err);
    return voltarCom("token_exchange_failed");
  }
}
