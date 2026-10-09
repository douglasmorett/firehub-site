/**
 * O robô reconhece o pedido de quem já pediu (lib/pedido-do-cliente.ts).
 *
 *   npx tsx scripts/teste-pedido-do-cliente.ts
 *
 * Caso real: Lapastine, 09/10/2026 — Alessandro pediu pelo site com
 * 94 99266-0433; o WhatsApp dele é 559492690433 (94 99269-0433).
 */
import { pedidoEhDoCliente, telefoneComUmErro, primeiroNomeDe, funilDoCliente, CANAIS_DA_LOJA } from "../src/lib/pedido-do-cliente";
import { pedidoAtivoParaOPrompt } from "../src/lib/acrescimo-do-pedido";

let ok = 0;
let falhou = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) {
    ok++;
  } else {
    falhou++;
    console.log(`❌ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`);
  }
}

const WHATSAPP = "559492690433";
const alessandro = { telefone: WHATSAPP, nomes: ["Alessandro"] };

// ── O caso da Lapastine ──
confere("site com um dígito trocado + mesmo nome = é dele", pedidoEhDoCliente({ customerPhone: "94992660433", customerName: "Alessandro martins " }, alessandro), "parecido");
confere("mesmo telefone, com máscara e nono dígito", pedidoEhDoCliente({ customerPhone: "+55 (94) 99269-0433", customerName: "Fulano" }, alessandro), "telefone");
confere("mesmo telefone sem o nono dígito", pedidoEhDoCliente({ customerPhone: "(94) 9269-0433", customerName: "" }, alessandro), "telefone");
confere("site grava ONLINE e o balcão PRESENCIAL: os dois são canais da loja", ["ONLINE", "PRESENCIAL", "WHATSAPP_IA"].every((c) => CANAIS_DA_LOJA.includes(c)), true);
confere("iFood não é canal da loja", CANAIS_DA_LOJA.includes("IFOOD"), false);

// ── O que NÃO pode casar ──
confere("telefone parecido, nome diferente = vizinho", pedidoEhDoCliente({ customerPhone: "94992660433", customerName: "Bruno Silva" }, alessandro), null);
confere("telefone parecido, pedido sem nome", pedidoEhDoCliente({ customerPhone: "94992660433", customerName: "" }, alessandro), null);
confere("telefone parecido, nome genérico", pedidoEhDoCliente({ customerPhone: "94992660433", customerName: "Cliente WhatsApp" }, { telefone: WHATSAPP, nomes: ["Cliente WhatsApp"] }), null);
confere("mesmo nome, telefone com dois dígitos errados", pedidoEhDoCliente({ customerPhone: "94992110433", customerName: "Alessandro" }, alessandro), null);
confere("DDD com um dígito errado + mesmo nome = é dele", pedidoEhDoCliente({ customerPhone: "91992690433", customerName: "Alessandro" }, alessandro), "parecido");
confere("telefone carimbo do balcão", pedidoEhDoCliente({ customerPhone: "00000000000", customerName: "Alessandro" }, alessandro), null);
confere("cliente sem telefone utilizável", pedidoEhDoCliente({ customerPhone: "94992690433", customerName: "Alessandro" }, { telefone: "123", nomes: ["Alessandro"] }), null);

// ── Erro de digitação ──
confere("vizinhos invertidos contam", telefoneComUmErro("94992690433", "94992960433"), true);
confere("iguais não são 'um erro'", telefoneComUmErro("94992690433", "559492690433"), false);
confere("dois dígitos longe não contam", telefoneComUmErro("94992690433", "94991690434"), false);

// ── Nome ──
confere("acento e caixa", primeiroNomeDe("  JOÃO Pedro"), "joao");
confere("emoji na frente", primeiroNomeDe("🎀 Laryana"), "laryana");
confere("nome curto demais não compara", primeiroNomeDe("Jo"), "");
confere("funil: final 4 e nomes", funilDoCliente({ telefone: WHATSAPP, nomes: ["Alessandro", "alessandro martins", null] }), { final4: "0433", primeirosNomes: ["alessandro"] });

// ── O prompt ──
const base = { numero: 4, minutos: 30, itens: "1x PIZZA FILÉ COM CATUPIRY, 1x PIZZA GUAJARÁ", total: 130, entrega: true, taxaDeEntrega: 5 };
const saiu = pedidoAtivoParaOPrompt({ ...base, status: "SAIU_ENTREGA", outroTelefone: { nome: "Alessandro martins", telefone: "94992660433" } });
confere("saiu para entrega: avisa e oferece pedido novo", saiu.includes("JÁ SAIU PARA ENTREGA") && saiu.includes("pedido novo"), true);
confere("telefone diferente: confirma o nome", saiu.includes('É o pedido nº 4, no nome de Alessandro martins?'), true);
const cozinha = pedidoAtivoParaOPrompt({ ...base, status: "PREPARANDO" });
confere("em preparo: oferece acrescentar", cozinha.includes("Quer acrescentar nesse pedido?") && cozinha.includes("acrescentarAoPedido"), true);
confere("telefone igual: sem a pergunta do nome", cozinha.includes("no nome de"), false);

console.log(`\n${falhou === 0 ? "✅" : "❌"} pedido do cliente: ${ok} ok, ${falhou} falha(s)`);
process.exit(falhou === 0 ? 0 : 1);
