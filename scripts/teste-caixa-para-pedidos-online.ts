/**
 * scripts/teste-caixa-para-pedidos-online.ts — o que fazer com pedido do site
 * e do robô quando o caixa está fechado (lib/balcao-config.ts,
 * `caixaParaPedidosOnline`; decisão em lib/caixa-aberto.ts).
 *
 *   npx tsx scripts/teste-caixa-para-pedidos-online.ts
 *
 * Divinos, 08/11/2026: ~R$ 2.500 vendidos pelo site e pelo robô antes de abrir
 * o caixa. Padrão = como sempre foi; "travar" recusa; "abrir_sozinho" abre.
 */
import { lerBalcaoConfig, BALCAO_CONFIG_PADRAO } from "../src/lib/balcao-config";
import { decidirCaixaDoPedidoOnline } from "../src/lib/caixa-aberto";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

// ── Leitura ──────────────────────────────────────────────────────────────
confere("padrão é como hoje (null)", BALCAO_CONFIG_PADRAO.caixaParaPedidosOnline, null);
confere("coluna vazia → null", lerBalcaoConfig(null).caixaParaPedidosOnline, null);
confere("config antiga só com pager → null", lerBalcaoConfig({ pagerObrigatorioBalcao: true }).caixaParaPedidosOnline, null);
confere("travar é lido", lerBalcaoConfig({ caixaParaPedidosOnline: "travar" }).caixaParaPedidosOnline, "travar");
confere("abrir_sozinho é lido", lerBalcaoConfig({ caixaParaPedidosOnline: "abrir_sozinho" }).caixaParaPedidosOnline, "abrir_sozinho");
confere("valor desconhecido → null (ilegível não trava)", lerBalcaoConfig({ caixaParaPedidosOnline: "TRAVAR" }).caixaParaPedidosOnline, null);
confere("booleano → null", lerBalcaoConfig({ caixaParaPedidosOnline: true }).caixaParaPedidosOnline, null);
confere("string JSON crua → padrão", lerBalcaoConfig('{"caixaParaPedidosOnline":"travar"}').caixaParaPedidosOnline, null);
confere(
  "o pager continua sendo lido junto",
  lerBalcaoConfig({ pagerObrigatorioMesa: true, caixaParaPedidosOnline: "travar" }),
  // caixaPorUsuario (13/11/2026) nasce desligado em quem nunca escolheu.
  { pagerObrigatorioBalcao: false, pagerObrigatorioMesa: true, caixaParaPedidosOnline: "travar", caixaPorUsuario: false },
);

// ── Decisão ──────────────────────────────────────────────────────────────
for (const modo of [null, "travar", "abrir_sozinho"] as const) {
  confere(`caixa aberto, modo ${modo} → seguir`, decidirCaixaDoPedidoOnline(modo, true), "seguir");
}
confere("caixa fechado, como hoje → seguir avisando", decidirCaixaDoPedidoOnline(null, false), "seguir_avisando");
confere("caixa fechado, travar → recusar", decidirCaixaDoPedidoOnline("travar", false), "recusar");
confere("caixa fechado, abrir_sozinho → abrir", decidirCaixaDoPedidoOnline("abrir_sozinho", false), "abrir");

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
