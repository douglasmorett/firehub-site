/**
 * A chave Pix da loja que o robô manda (lib/pix-da-loja.ts).
 *
 *   npx tsx scripts/teste-pix-da-loja.ts
 *
 * Pedido de 01/10/2026: lojista com ~200 vendas/mês no Pix não quer o Asaas;
 * quer que o robô passe a chave dele e o cliente mande o comprovante.
 */
import {
  reconhecerChavePix, limparPixDaLoja, lerPixDaLoja, pagaNoPix,
  textoDoPixNoPedido, regraDoPixNoPrompt, MARCA_ENVIAR_PIX,
} from "../src/lib/pix-da-loja";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const tipo = (bruta: string) => {
  const r = reconhecerChavePix(bruta);
  return "erro" in r ? "ERRO" : `${r.tipo}:${r.chave}`;
};

console.log("\n— A chave do jeito que o lojista digita —");
confere("CPF com máscara", tipo("529.982.247-25"), "CPF:52998224725");
confere("CPF sem máscara", tipo("52998224725"), "CPF:52998224725");
confere("CPF com dígito errado e máscara = erro", tipo("529.982.247-26"), "ERRO");
confere("CNPJ com máscara", tipo("55.878.184/0001-89"), "CNPJ:55878184000189");
confere("CNPJ com dígito errado = erro", tipo("55.878.184/0001-88"), "ERRO");
confere("celular com parêntese", tipo("(22) 99962-7179"), "TELEFONE:+5522999627179");
confere("celular com +55", tipo("+55 22 99962-7179"), "TELEFONE:+5522999627179");
confere("celular 11 dígitos sem máscara (não é CPF válido)", tipo("22999627179"), "TELEFONE:+5522999627179");
confere("celular com 55 na frente", tipo("5522999627179"), "TELEFONE:+5522999627179");
confere("fixo não é chave de celular", tipo("(22) 2522-1234"), "ERRO");
confere("e-mail vira minúsculo", tipo(" Loja@Gmail.com "), "EMAIL:loja@gmail.com");
confere("e-mail incompleto = erro", tipo("loja@gmail"), "ERRO");
confere("chave aleatória", tipo("1B2C3D4E-1111-2222-3333-444455556666"), "ALEATORIA:1b2c3d4e-1111-2222-3333-444455556666");
confere("aleatória sem tracinhos = erro", tipo("1b2c3d4e111122223333444455556666"), "ERRO");
confere("texto qualquer = erro", tipo("meu pix"), "ERRO");
confere("vazio = erro", tipo("   "), "ERRO");

console.log("\n— O que a rota grava —");
confere("sem titular é recusado", "erro" in (limparPixDaLoja({ chave: "52998224725", titular: " " }) as any), true);
confere("chave vazia apaga", limparPixDaLoja({ chave: "", titular: "X" }), null);
confere("null apaga", limparPixDaLoja(null), null);
confere("limpa espaços do titular e do banco", limparPixDaLoja({ chave: "529.982.247-25", titular: "  João   da Silva ", banco: " Nubank " }),
  { chave: "52998224725", tipo: "CPF", titular: "João da Silva", banco: "Nubank" });
confere("ler: estragado vale como sem chave", lerPixDaLoja({ pixDaLoja: { chave: "abc", titular: "X" } }), null);
confere("ler: sem config", lerPixDaLoja(undefined), null);

console.log("\n— Forma de pagamento —");
confere("Pix", pagaNoPix("Pix"), true);
confere("PIX na entrega", pagaNoPix("PIX na entrega"), true);
confere("Cartão", pagaNoPix("Cartão de crédito"), false);
confere("Dinheiro", pagaNoPix("Dinheiro"), false);
confere("vazio", pagaNoPix(null), false);

console.log("\n— Mensagem e marca —");
const pix = lerPixDaLoja({ pixDaLoja: { chave: "(22) 99962-7179", titular: "Fulano", banco: "Inter" } })!;
const texto = textoDoPixNoPedido(pix, 45.9);
confere("valor em reais", texto.includes("R$ 45,90"), true);
confere("titular e banco", texto.includes("Em nome de: Fulano · Inter"), true);
confere("a chave NÃO vai no texto (vai sozinha na mensagem seguinte)", texto.includes(pix.chave), false);
confere("pede o comprovante", /comprovante/.test(texto), true);
const prompt = regraDoPixNoPrompt(pix, true);
confere("prompt não contém a chave", prompt.includes(pix.chave) || prompt.includes("99962"), false);
confere("prompt manda usar a marca", prompt.includes("[[ENVIAR_PIX]]"), true);
confere("prompt sem chave proíbe inventar", /NUNCA invente/.test(regraDoPixNoPrompt(null, true)), true);
for (const marca of ["[[ENVIAR_PIX]]", "[[enviar pix]]", "[[ENVIAR_PIX: sim]]", "[[ ENVIARPIX ]]"]) {
  confere(`marca ${marca} é reconhecida e some`, [`Segue 👇 ${marca}`.search(MARCA_ENVIAR_PIX) >= 0, `Segue 👇 ${marca}`.replace(MARCA_ENVIAR_PIX, "").trim()], [true, "Segue 👇"]);
}
// search duas vezes seguidas: regex global com lastIndex não pode falhar na segunda.
confere("search repetido não depende de lastIndex", ["a [[ENVIAR_PIX]]", "b [[ENVIAR_PIX]]"].map((t) => t.search(MARCA_ENVIAR_PIX) >= 0), [true, true]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
