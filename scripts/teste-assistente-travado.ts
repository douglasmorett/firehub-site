/**
 * O Assistente que ficou mais de três versões atrás não está se atualizando
 * sozinho (lib/print.ts › assistenteTravadoNaVersao): o painel avisa.
 *
 *   npx tsx scripts/teste-assistente-travado.ts
 */
import { assistenteTravadoNaVersao, VERSAO_ASSISTENTE_ATUAL } from "../src/lib/print";

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}

const [a, b, p] = VERSAO_ASSISTENTE_ATUAL.split(".").map(Number);
const v = (n: number) => `${a}.${b}.${n}`;
confere("a atual não está travada", !assistenteTravadoNaVersao(VERSAO_ASSISTENTE_ATUAL));
confere("uma atrás (atualizando normalmente) não está travada", !assistenteTravadoNaVersao(v(p - 1)));
confere("três atrás ainda não avisa", !assistenteTravadoNaVersao(v(p - 3)));
confere("quatro atrás avisa", assistenteTravadoNaVersao(v(p - 4)));
confere("1.2.37 com a 1.2.46 no ar avisa (o PC do Douglas)", VERSAO_ASSISTENTE_ATUAL !== "1.2.46" || assistenteTravadoNaVersao("1.2.37"));
confere("sem versão relatada não avisa por aqui (o aviso de versão antiga cuida)", !assistenteTravadoNaVersao(null));
confere("versão mais nova que a do site não avisa", !assistenteTravadoNaVersao(v(p + 1)));

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
