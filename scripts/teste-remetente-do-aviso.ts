/**
 * Por qual WhatsApp sai o aviso de status (lib/remetente-do-aviso.ts).
 *
 *   npx tsx scripts/teste-remetente-do-aviso.ts
 *
 * Casos reais: Yakisoba do San (filial da China Pow, número no Anota AI),
 * pedido nº 20 do site em 11/10/2026; Pizzaria 17 → Aeroporto (09/10).
 */
import { lojaQueEnviaOAviso } from "../src/lib/remetente-do-aviso";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${obtido}, esperava ${esperado}`}`);
};

confere("Yakisoba desconectada, pedido do site: não sai pela China Pow",
  lojaQueEnviaOAviso({ lojaDoPedido: "yakisoba", lojaConectada: false, origemDoPedido: "ONLINE", principalDoGrupo: "china", principalConectada: true }), null);
confere("Filial desconectada, pedido de balcão: nada",
  lojaQueEnviaOAviso({ lojaDoPedido: "yakisoba", lojaConectada: false, origemDoPedido: "PDV", principalDoGrupo: "china", principalConectada: true }), null);
confere("Aeroporto desconectado, pedido nascido no robô da P17: sai pela P17",
  lojaQueEnviaOAviso({ lojaDoPedido: "aeroporto", lojaConectada: false, origemDoPedido: "WHATSAPP_IA", principalDoGrupo: "p17", principalConectada: true }), "p17");
confere("Pedido do robô, filial e principal desconectadas: nada",
  lojaQueEnviaOAviso({ lojaDoPedido: "aeroporto", lojaConectada: false, origemDoPedido: "WHATSAPP_IA", principalDoGrupo: "p17", principalConectada: false }), null);
confere("Filial conectada: sempre pelo número dela",
  lojaQueEnviaOAviso({ lojaDoPedido: "yakisoba", lojaConectada: true, origemDoPedido: "ONLINE", principalDoGrupo: "china", principalConectada: true }), "yakisoba");
confere("Principal conectada, pedido dela: pelo número dela",
  lojaQueEnviaOAviso({ lojaDoPedido: "china", lojaConectada: true, origemDoPedido: "ONLINE", principalDoGrupo: null, principalConectada: false }), "china");
confere("Loja sozinha com connected falso: tenta pelo próprio número (como antes)",
  lojaQueEnviaOAviso({ lojaDoPedido: "solo", lojaConectada: false, origemDoPedido: "ONLINE", principalDoGrupo: null, principalConectada: false }), "solo");

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
