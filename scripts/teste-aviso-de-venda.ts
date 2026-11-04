/**
 * Aviso de venda no celular do Douglas (lib/app-firehub/aviso-de-venda.ts).
 *
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-aviso-de-venda.ts
 *
 * Sem banco. Prova que só a conta da lista recebe (lojista, equipe, ADMIN e
 * vazio ficam de fora) e o texto no modelo da Cakto, sem nome de loja.
 */
import { CONTAS_QUE_RECEBEM, podeReceberAvisoDeVenda, textoDaVenda } from "../src/lib/app-firehub/aviso-de-venda";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n— quem recebe");
confere("lista tem só a conta do FireHub", CONTAS_QUE_RECEBEM, ["firehubfood@gmail.com"]);
confere("firehubfood@gmail.com recebe", podeReceberAvisoDeVenda("firehubfood@gmail.com"), true);
confere("maiúscula e espaço contam igual", podeReceberAvisoDeVenda("  FireHubFood@Gmail.com "), true);
confere("lojista não recebe", podeReceberAvisoDeVenda("pizzaria@gmail.com"), false);
confere("e-mail parecido não recebe", podeReceberAvisoDeVenda("firehubfood@gmail.com.br"), false);
confere("contido no meio não recebe", podeReceberAvisoDeVenda("xfirehubfood@gmail.com"), false);
confere("contatohakim (ADMIN) não recebe", podeReceberAvisoDeVenda("contatohakim@gmail.com"), false);
confere("sem e-mail não recebe", podeReceberAvisoDeVenda(null), false);
confere("vazio não recebe", podeReceberAvisoDeVenda(""), false);

console.log("\n— texto");
const t = textoDaVenda(149.9);
confere("título", t.titulo, "Assinatura aprovada! 🔥");
confere("corpo com o valor em reais", t.corpo.replace(/\s/g, " "), "Valor: R$ 149,90");
confere("milhar com ponto", textoDaVenda(1299).corpo.replace(/\s/g, " "), "Valor: R$ 1.299,00");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
