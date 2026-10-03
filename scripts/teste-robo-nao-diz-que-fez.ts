/**
 * O robô do número do FireHub não diz que fez o que não fez (conferente.ts,
 * acaoDitaSemFerramenta).
 *
 *   npx tsx scripts/teste-robo-nao-diz-que-fez.ts
 *
 * 03/10/2026, Luxúria: "se você conseguir mudar pra mim, eu agradeço" → o robô
 * respondeu "Mudei aqui para você! Agora a categoria de Marmitas é a primeira"
 * sem ferramenta nenhuma, e o lojista mandou o print com os lanches em primeiro.
 */
import { acaoDitaSemFerramenta } from "../src/lib/atendimento/conferente";

let falhas = 0;
const confere = (oQue: string, ok: boolean, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok || !detalhe ? "" : ` — ${detalhe}`}`);
};

const BARRA = [
  "Mudei aqui para você! Agora a categoria de Marmitas é a primeira que aparece no cardápio para o seu cliente.",
  "Pronto, já coloquei a Grande de volta na Calabresa do Chef.",
  "Acabei de ajustar o horário da marmita.",
  "Corrigi o preço, pode conferir.",
  "Já fiz a troca aqui.",
  "Tudo certo! Ativei o Pix pelo site na sua loja.",
  "Reordenei as categorias como você pediu.",
  "Excluí o tamanho duplicado.",
];
for (const r of BARRA) {
  const frase = acaoDitaSemFerramenta(r, []);
  confere(`barra: "${r.slice(0, 60)}"`, !!frase);
}
confere("devolve só a frase do feito", acaoDitaSemFerramenta("Bom dia, Luxúria! Mudei aqui para você.", []) === "Mudei aqui para você.");

const PASSA = [
  "Já chamei alguém da nossa equipe, em instantes te respondem por aqui.",
  "Já passei para a nossa equipe e em breve uma pessoa vai te responder.",
  "Mandei no e-mail o link para criar a senha.",
  "1. Clique em Reordenar Cardápio. 2. Arraste Marmitas para o topo. 3. Clique em Salvar Ordem do Cardápio.",
  "Para mudar a ordem, clique em Reordenar Cardápio.",
  "Coloque 15 no Promo +R$ e a Grande sai a R$ 65.",
  "Se você já mudou o horário, abra o cardápio de novo.",
  "Anotei aqui o nome da sua loja.",
  "O cliente escolhe na tela do cardápio como quer pagar.",
];
for (const r of PASSA) {
  const frase = acaoDitaSemFerramenta(r, []);
  confere(`passa: "${r.slice(0, 60)}"`, frase === null, `pegou "${frase}"`);
}

confere(
  "com ferramenta que faz (reiniciar), o 'pronto' pode ser verdade",
  acaoDitaSemFerramenta("Reiniciei e ativei a conexão do WhatsApp da sua loja.", [{ nome: "reiniciar_whatsapp_da_loja" }]) === null,
);
confere("chamar_pessoa não conta como ter feito", !!acaoDitaSemFerramenta("Mudei aqui para você!", [{ nome: "chamar_pessoa" }]));

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
