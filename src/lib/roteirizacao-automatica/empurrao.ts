/**
 * Rota 100% automatizada — o EMPURRÃO: um ciclo da loja logo depois de algo
 * que muda a rota, sem esperar o cron de 20 s (Fase 3 do plano, vault
 * "FireHub - Plano despacho automático").
 *
 * Quem empurra:
 *   - o KDS dando o pedido de entrega por pronto (`finish_order`): é o que
 *     faz a rota ficar pronta para chamar;
 *   - o motoboy que acabou de chegar na loja (motoboy-na-loja.ts): é quem a
 *     rota pronta chama primeiro (D10);
 *   - o cancelamento do pedido pelo painel: a rota tira o pedido (e some, se
 *     ficou vazia) antes de o motoboy sair com a sacola errada.
 *
 * O ciclo vai no `after()` (next/server): a resposta do KDS, do GPS e do
 * painel não espera o planejador. E a vez por loja (lib/vez.ts, dentro de
 * `rodarRoteirizacaoDaLoja`) segura dois ciclos juntos: se o cron estiver
 * gravando, o empurrão devolve `pulada` sem gravar nada — o cron já está
 * vendo o banco, e o próximo pega o resto.
 *
 * Custo nas outras lojas: zero. `liberadaPara` é uma lista no código e vem
 * antes de tudo; a regra (`ativo`) só é lida para a loja liberada, e já
 * dentro do `after()`. Nunca lança: o empurrão é atalho, quem garante é o cron.
 */
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { liberadaPara } from "./liberacao";
import { lerRoteirizacaoAutomatica } from "./config";
import { rodarRoteirizacaoDaLoja } from "./executar";

export function empurrarRoteirizacao(lojaId: string | null | undefined, motivo: string): void {
  if (!lojaId || !liberadaPara(lojaId)) return;
  try {
    after(async () => {
      try {
        const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { deliveryConfig: true } });
        if (!lerRoteirizacaoAutomatica(loja?.deliveryConfig).ativo) return;
        const r = await rodarRoteirizacaoDaLoja(lojaId, { gravar: true });
        if (r.aplicadas?.length) console.log(`[rota-automatica] empurrão (${motivo}) loja ${lojaId}: ${r.aplicadas.join("; ")}`);
      } catch (e: any) {
        console.warn(`[rota-automatica] empurrão (${motivo}) falhou:`, e?.message?.slice(0, 160));
      }
    });
  } catch (e: any) {
    // `after` fora de um pedido (script, teste) lança: o cron cobre.
    console.warn(`[rota-automatica] empurrão (${motivo}) sem after():`, e?.message?.slice(0, 120));
  }
}
