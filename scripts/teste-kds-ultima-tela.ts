/**
 * A TV abre a última tela do KDS dela, e o link do motoboy sai da nuvem.
 *
 *   npx tsx scripts/teste-kds-ultima-tela.ts
 *
 * Hakim Centro, 14/10/2026: o endereço curto da TV (/tv do computador da
 * loja) abria /store/kds/tela sem etapa e caía na lista de telas — no
 * controle remoto, sem caminho fácil para a Finalização. E no computador da
 * loja (http://<ip>:7890) o "Copiar link para motoboys" quebrava (sem
 * navigator.clipboard) e copiaria o IP do caixa.
 */
import { destinoDaTelaSemEtapa, ultimaTelaParaGuardar } from "../src/lib/kds-ultima-tela";
import { origemParaLinkDeFora } from "../src/lib/copiar-texto";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const finalizacao = "stage=finishing&filter=all&name=Finaliza%C3%A7%C3%A3o+1&tela=f1";

console.log("\n— O que se guarda —");
confere("tela de finalização: guarda a query inteira", ultimaTelaParaGuardar(finalizacao), finalizacao);
confere("com '?' na frente: guarda sem ele", ultimaTelaParaGuardar("?" + finalizacao), finalizacao);
confere("sem etapa: não guarda", ultimaTelaParaGuardar("tela=f1"), null);
confere("etapa inventada: não guarda", ultimaTelaParaGuardar("stage=xyz&tela=f1"), null);
confere("vazio: não guarda", ultimaTelaParaGuardar(""), null);

console.log("\n— Para onde vai o /store/kds/tela sem etapa —");
confere("sem nada e com a última guardada: reabre a última", destinoDaTelaSemEtapa("", finalizacao), `/store/kds/tela?${finalizacao}`);
confere("sem nada e sem guardada: a lista", destinoDaTelaSemEtapa("", null), "/store/kds");
confere("guardada estragada (sem etapa): a lista", destinoDaTelaSemEtapa("", "tela=f1"), "/store/kds");
confere("guardada com etapa inventada: a lista", destinoDaTelaSemEtapa("", "stage=xyz"), "/store/kds");
confere("link com tela mas sem etapa: a lista, não a guardada", destinoDaTelaSemEtapa("tela=p2", finalizacao), "/store/kds");
confere("link com nome mas sem etapa: a lista", destinoDaTelaSemEtapa("?name=Pizza", finalizacao), "/store/kds");
confere("parâmetro que não é de tela (utm): reabre a última", destinoDaTelaSemEtapa("utm=tv", finalizacao), `/store/kds/tela?${finalizacao}`);
// Sem laço: o destino reaberto tem etapa, então não passa por aqui de novo.
const reaberto = destinoDaTelaSemEtapa("", finalizacao).split("?")[1];
confere("o destino reaberto tem etapa válida (sem laço)", ultimaTelaParaGuardar(reaberto) !== null, true);

console.log("\n— Link do motoboy —");
confere("na nuvem: a própria origem", origemParaLinkDeFora("https://firehubfood.com.br"), "https://firehubfood.com.br");
confere("no www: a própria origem", origemParaLinkDeFora("https://www.firehubfood.com.br"), "https://www.firehubfood.com.br");
confere("na porta da loja pela rede: a nuvem", origemParaLinkDeFora("http://192.168.15.106:7890"), "https://firehubfood.com.br");
confere("na porta da loja no próprio caixa: a nuvem", origemParaLinkDeFora("http://127.0.0.1:7890"), "https://firehubfood.com.br");
confere("desenvolvimento: a própria origem", origemParaLinkDeFora("http://localhost:3000"), "http://localhost:3000");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
