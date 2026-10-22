/**
 * GET /api/tablet-mesa/estado — o sinal de vida do tablet da mesa (a cada 20 s).
 *
 * Marca o tablet como visto e o uso do dia (a base da cobrança) e devolve o
 * que a faixa do tablet mostra: a mesa, a conta aberta e o chamado. Quando a
 * conta fecha, o tablet limpa a sacola e o nome para o próximo cliente.
 * Módulo desligado ou tablet tirado no painel: o tablet sai do cardápio.
 */
import { NextResponse } from "next/server";
import { tabletEstaLigado } from "@/lib/tablet-da-mesa/assinatura";
import { chamadoDaMesa, sinalDoTablet } from "@/lib/tablet-da-mesa/tablets";
import { contaDaMesa, tabletDaRequisicao } from "@/lib/tablet-da-mesa/no-tablet";

export const dynamic = "force-dynamic";

export async function GET() {
  const t = await tabletDaRequisicao();
  if (!t) return NextResponse.json({ pareado: false }, { status: 401 });
  const ligado = await tabletEstaLigado(t.lojaId);
  if (!ligado) return NextResponse.json({ pareado: true, ligado: false });
  // O sinal só conta com o módulo ligado: tablet com o módulo desligado não é cobrado.
  await sinalDoTablet(t).catch((e) => console.warn("[Tablet na mesa] sinal:", e?.message));
  const [conta, chamado] = await Promise.all([contaDaMesa(t.mesa.id), chamadoDaMesa(t.mesa.id).catch(() => null)]);
  return NextResponse.json({
    pareado: true,
    ligado: true,
    mesa: { numero: t.mesa.numero, rotulo: t.mesa.rotulo, ativa: t.mesa.ativa },
    conta,
    chamado,
  });
}
