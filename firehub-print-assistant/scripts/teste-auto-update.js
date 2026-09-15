/**
 * Prova que a janela calma do auto-update AFROUXA com o tempo.
 *
 * Exigir 30 min sem imprimir era um impasse: loja movimentada nunca fica 30 min
 * parada com o PC ligado, e o PC é desligado ao fechar. Pior, ao ligar o
 * Assistente puxa o ATRASO e imprime logo — então até a checagem dos 90 s de
 * boot caía na janela e adiava.
 *
 * Medido em 15/09/2026: cinco lojas em quatro versões diferentes, cada uma
 * congelada no dia em que teve sorte de pegar um intervalo. A Pastel da
 * Paulista, com 211 pedidos de balcão em três dias, estava oito dias atrás.
 *
 *   node scripts/teste-auto-update.js
 */
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function recortar(nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`nao achei function ${nome}`);
  let nivel = 0, i = fonte.indexOf("{", inicio);
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  if (nivel !== 0) throw new Error(`chaves desbalanceadas em ${nome}`);
  return fonte.slice(inicio, i + 1);
}

// JANELA_CALMA_MS é o padrão de 30 min declarado no server.js; o teste lê de lá
// para não congelar um número que pode mudar.
const declarada = fonte.match(/const JANELA_CALMA_MS = ([^;]+);/);
if (!declarada) throw new Error("nao achei JANELA_CALMA_MS");

const { janelaCalmaParaVersao, versaoRemotaEhMaisNova } = new Function(
  `const JANELA_CALMA_MS = ${declarada[1]};
   ${recortar("janelaCalmaParaVersao")}
   ${recortar("versaoRemotaEhMaisNova")}
   return { janelaCalmaParaVersao, versaoRemotaEhMaisNova };`
)();

let falhas = 0;
const min = (ms) => Math.round(ms / 60000);
const confere = (oQue, obtido, esperado) => {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${oQue}: ${obtido}${ok ? "" : ` (esperava ${esperado})`}`);
};

console.log("── quanto silêncio a atualização exige (minutos) ──");
confere("versão recém-lançada", min(janelaCalmaParaVersao(0)), 30);
confere("pendente há 23 h", min(janelaCalmaParaVersao(23)), 30);
confere("pendente há 24 h — afrouxa", min(janelaCalmaParaVersao(24)), 10);
confere("pendente há 47 h", min(janelaCalmaParaVersao(47)), 10);
confere("pendente há 48 h — afrouxa de novo", min(janelaCalmaParaVersao(48)), 2);
confere("pendente há 8 dias (a Pastel da Paulista)", min(janelaCalmaParaVersao(24 * 8)), 2);
confere("entrada inválida não vira NaN", min(janelaCalmaParaVersao(undefined)), 30);

console.log("\n── a janela nunca aperta com o tempo ──");
let anterior = Infinity;
let monotonica = true;
for (let h = 0; h <= 72; h++) {
  const atual = janelaCalmaParaVersao(h);
  if (atual > anterior) monotonica = false;
  anterior = atual;
}
confere("exigência só diminui, nunca aumenta", monotonica, true);

console.log("\n── comparação de versão (a trava que decide se atualiza) ──");
confere("1.2.15 é mais nova que 1.2.9", versaoRemotaEhMaisNova("1.2.15", "1.2.9"), true);
confere("1.2.9 NÃO é mais nova que 1.2.15", versaoRemotaEhMaisNova("1.2.9", "1.2.15"), false);
confere("igual não atualiza", versaoRemotaEhMaisNova("1.2.15", "1.2.15"), false);
confere("1.2.10 é mais nova que 1.2.9 (não é ordem alfabética)", versaoRemotaEhMaisNova("1.2.10", "1.2.9"), true);

console.log(falhas === 0 ? "\nTUDO CERTO" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
