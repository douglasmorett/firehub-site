/**
 * npx tsx scripts/teste-nome-da-borda-ifood.ts
 *
 * Nome da opção de massa/borda que o iFood monta ("Massa <massa> + Borda <borda>").
 * Casos tirados dos pedidos reais da Ragnar (30 dias até 09/10/2026).
 */
import { nomeDaOpcaoDePizza } from "../src/lib/ifood-itens";

let falhas = 0;
function confere(entrada: string, esperado: string) {
  const saiu = nomeDaOpcaoDePizza(entrada);
  const ok = saiu === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${JSON.stringify(entrada)} → ${JSON.stringify(saiu)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

// O pedido 8069: a borda paga fica, a tradicional sai, e a massa sem repetição.
confere("Massa Massa Artesanal + Borda Catupiry + Borda Tradicional", "Massa Artesanal + Borda Catupiry");
// Prefixo repetido.
confere("Massa Artesanal + Borda Borda Catupiry", "Massa Artesanal + Borda Catupiry");
confere("Massa Artesanal + Borda Borda Catupiry C/ Bacon", "Massa Artesanal + Borda Catupiry C/ Bacon");
confere("Massa Artesanal + Borda Borda Cream Cheese", "Massa Artesanal + Borda Cream Cheese");
// Sem borda.
confere("Massa Artesanal + Borda : Sem Borda", "Massa Artesanal + Sem Borda");
// Uma borda só, tradicional: fica como está (é a escolha do cliente).
confere("Massa Tradicional + Borda Tradicional", "Massa Tradicional + Borda Tradicional");
confere("Massa Artesanal + Borda de Catupiry", "Massa Artesanal + Borda de Catupiry");
// Sem borda junto de recheada: fica a recheada.
confere("Massa Artesanal + Borda : Sem Borda + Borda Catupiry", "Massa Artesanal + Borda Catupiry");
// Fora do modelo: intacto.
confere("Massa Artesanal - Sem Borda", "Massa Artesanal - Sem Borda");
confere("1/2 Pizza de Frango com Catupiry", "1/2 Pizza de Frango com Catupiry");
confere("Borda Catupiry", "Borda Catupiry");
confere("Coca-Cola 2L + Guaraná", "Coca-Cola 2L + Guaraná");
confere("", "");

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
