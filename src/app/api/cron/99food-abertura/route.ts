import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { manterTodasOnline99 } from "@/lib/food99-abertura";

/**
 * GET /api/cron/99food-abertura
 *
 * Mantém a loja ONLINE no 99Food sem ninguém abrir o gestor deles.
 *
 * ── Por que é um cron, e não só um botão na tela ────────────────────────────
 *
 * A loja sai do ar no 99Food por caminhos que não passam por aqui: alguém fecha
 * o gestor no PC, o vínculo oscila. Um gatilho só no clique do lojista assumiria
 * que o estado de lá nunca muda sozinho — e ele muda. Conferir de tempos em
 * tempos é o que faz "ligado" significar ligado.
 *
 * Toda rodada LÊ o estado de cada loja e só ESCREVE quando encontra o problema
 * que veio consertar (desconectada, ou offline). Pausa e fechamento deliberados
 * são respeitados — ver a lista NAO_MEXER em src/lib/food99-abertura.ts.
 *
 * É também o que mantém o `auth_token` de cada loja vivo: a renovação do 99Food
 * só acontecia no uso (chegou pedido, mudou status), então loja parada mais de
 * um dia perto do vencimento perdia o token — e sem token o webhook descarta
 * pedido novo em silêncio.
 *
 * ── O que esta rota NÃO faz ─────────────────────────────────────────────────
 *
 * Não fecha loja e não olha o horário do FireHub. `storeOpen` / `storeHours` são
 * do nosso cardápio digital; o 99Food tem agenda própria. E não confundir com
 * `/api/cron/99food-poll`, que não busca pedido e não tem como buscar: a API do
 * 99Food não lista pedidos. Entrada de pedido é só o webhook.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inicio = Date.now();
  try {
    // Folga contra o corte do cron-runner (55s) e o maxDuration (60s): o laço
    // para sozinho antes, devolvendo o que já fez em vez de ser cortado no meio.
    const { lojas, naoAlcancadas } = await manterTodasOnline99({ prazoMs: 45_000 });

    const conta = (a: string) => lojas.filter((l) => l.acao === a).length;

    // Loja sem token é acionável (o lojista precisa reconectar) e hoje só
    // apareceria para quem fosse ler o log do container. Fica no corpo, e
    // separada, para o suporte enxergar de fora.
    const precisamReconectar = lojas
      .filter((l) => l.erros.some((e) => e.includes("auth_token")))
      .map((l) => ({ lojaId: l.lojaId, loja: l.loja }));

    return NextResponse.json({
      ok: true,
      lojas: lojas.length,
      naoAlcancadas,
      religadas: conta("religada"),
      jaOnline: conta("ja-online"),
      respeitadas: conta("respeitado"),
      // OPENAPI dispensa o app do 99Food de ficar online, e só vale onde o
      // aceite automático está ligado — é ele que faz o FireHub confirmar o
      // pedido sozinho. Loja em BAPP não é erro: é o modo certo para quem
      // prefere aceitar pedido na mão.
      emOpenapi: lojas.filter((l) => l.confirmacao === "openapi").length,
      emBapp: lojas.filter((l) => l.confirmacao === "bapp").length,
      comErro: lojas.filter((l) => l.erros.length > 0).length,
      precisamReconectar,
      detalhe: lojas,
      durationMs: Date.now() - inicio,
    });
  } catch (err: any) {
    console.error("[99Food online] Erro geral:", err);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
