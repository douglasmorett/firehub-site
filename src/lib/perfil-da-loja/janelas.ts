/**
 * As janelas de venda do perfil e o canal da linha agrupada — sem banco, para
 * o teste (scripts/teste-perfil-da-loja.ts) conferir.
 */
import { chaveDoCanal, type ChaveDeCanal } from "@/lib/canal-do-pedido";
import { hojeNaLoja, periodoAnterior, periodoDoAtalho } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";

export type Janelas = { i7: Date; i30: Date; iAnt: Date; fim: Date };

/**
 * 7 dias, 30 dias e os 30 anteriores, como os atalhos dos relatórios
 * (periodoDoAtalho): dias OPERACIONAIS no fuso da loja, virando às 5h, e
 * "30 dias" são 30 contando hoje.
 */
export function janelasDaLoja(tz: string | null | undefined, agora: Date): Janelas {
  const hoje = hojeNaLoja(tz, agora);
  const p30 = periodoDoAtalho("30d", hoje);
  const p7 = periodoDoAtalho("7d", hoje);
  const ant = periodoAnterior(p30.de, p30.ate);
  const j30 = janelaDoPeriodo(p30.de, p30.ate, tz);
  return { i7: janelaDoPeriodo(p7.de, p7.ate, tz).inicio, i30: j30.inicio, iAnt: janelaDoPeriodo(ant.de, ant.ate, tz).inicio, fim: j30.fim };
}

/** As colunas que decidem o canal, como o SQL agrupado as devolve. */
export type ColunasDoCanal = { src: string; od: string; ifood: boolean; tem_od: boolean; cw: boolean };

/**
 * O canal da linha agrupada, pela mesma função dos relatórios (`chaveDoCanal`),
 * com a mesa separada como em `canalDoRelatorio` (o SQL já põe "MESA" no src
 * de todo pedido com conta de mesa).
 */
export function canalDaLinha(l: ColunasDoCanal): ChaveDeCanal {
  if (l.src === "MESA") return "MESA";
  return chaveDoCanal({
    source: l.src,
    openDeliveryChannel: l.od || null,
    ifoodOrderId: l.ifood ? "x" : null,
    openDeliveryOrderId: l.cw ? "cardapioweb_x" : l.tem_od ? "x" : null,
  });
}
