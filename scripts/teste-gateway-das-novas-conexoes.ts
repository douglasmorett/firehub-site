/**
 * Quem vai para o gateway de Baileys 7 ao pedir o QR (lib/gateway-da-loja.ts).
 *
 *   npx tsx scripts/teste-gateway-das-novas-conexoes.ts
 */
export {};
process.env.EVOLUTION_API_KEY ||= "teste";

(async () => {
const { vaiParaOGatewayNovo, FORA_HA_PELO_MENOS_MS, GATEWAY_DAS_NOVAS_CONEXOES } = await import("../src/lib/gateway-da-loja");

let ok = 0;
let falhou = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  if (obtido === esperado) ok++;
  else {
    falhou++;
    console.log(`✖ ${nome}: ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`);
  }
}

const agora = Date.parse("2026-09-30T23:00:00Z");
const ha = (ms: number) => new Date(agora - ms).toISOString();

igual("gateway padrão é o de teste", GATEWAY_DAS_NOVAS_CONEXOES, "https://whatsapp-gateway-teste-production.up.railway.app");
igual("loja nova (nunca conectou)", vaiParaOGatewayNovo({}, agora), true);
igual("loja nova com config vazia", vaiParaOGatewayNovo(null, agora), true);
igual("conectada fica", vaiParaOGatewayNovo({ connected: true, jaConectouAlgumaVez: true }, agora), false);
igual("já tem gateway próprio fica", vaiParaOGatewayNovo({ evolutionUrl: "https://outro", connected: false }, agora), false);
igual("caiu há 2 min fica (reconexão normal)", vaiParaOGatewayNovo({ connected: false, jaConectouAlgumaVez: true, desconectadoDesde: ha(2 * 60 * 1000) }, agora), false);
igual("caiu há 10 min vai", vaiParaOGatewayNovo({ connected: false, jaConectouAlgumaVez: true, desconectadoDesde: ha(FORA_HA_PELO_MENOS_MS) }, agora), true);
igual("caiu há 3 h vai", vaiParaOGatewayNovo({ connected: false, jaConectouAlgumaVez: true, desconectadoDesde: ha(3 * 3600 * 1000) }, agora), true);
igual("já conectou, sem data de queda, fica", vaiParaOGatewayNovo({ connected: false, jaConectouAlgumaVez: true }, agora), false);

console.log(`${ok} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
})();
