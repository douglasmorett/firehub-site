/**
 * Trava a pergunta "Imprimir o cupom fiscal (DANFE) sozinho?" da tela fiscal
 * (ComoANotaEEmitida): a gravação pelo PUT (lib/fiscal-config →
 * aplicarFormularioFiscal) e a leitura que a fila de impressão usa
 * (lib/nfce/impressao-do-danfe → lojaImprimeODanfe).
 *
 *   npx tsx scripts/teste-fiscal-imprimir-danfe.ts
 *
 * Garagem Burger, 29/10/2026: o cupom saía em todo pedido entregue e a loja
 * não tinha onde desligar.
 */
import { aplicarFormularioFiscal } from "../src/lib/fiscal-config";
import { lojaImprimeODanfe } from "../src/lib/nfce/impressao-do-danfe";
import { rotuloDoCampoFiscal } from "../src/lib/textos-da-tela-fiscal";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const opcoes = (papel: string) => ({ papel, cifrar: (s: string) => `cifrado:${s}`, conferir: () => [] });
const gravar = (bruto: unknown, body: Record<string, unknown>, papel = "FRANCHISEE") => {
  const r = aplicarFormularioFiscal(bruto, body, opcoes(papel));
  return (r as any).config ?? r;
};

console.log("— Leitura (o que a fila de impressão usa) —");
confere("nada gravado = imprime", lojaImprimeODanfe({}), true);
confere("config nula = imprime", lojaImprimeODanfe(null), true);
confere("imprimirDanfe false desliga", lojaImprimeODanfe({ imprimirDanfe: false }), false);
confere("sefaz.imprimirDanfe false também desliga", lojaImprimeODanfe({ sefaz: { imprimirDanfe: false } }), false);

console.log("— Gravação pela tela —");
const desligada = gravar({}, { imprimirDanfe: false });
confere("Não → grava false", desligada.imprimirDanfe, false);
confere("Não → a fila deixa de imprimir", lojaImprimeODanfe(desligada), false);

const religada = gravar({ imprimirDanfe: false }, { imprimirDanfe: true });
confere("Sim depois de Não → imprime de novo", lojaImprimeODanfe(religada), true);

const doEvoPdv = gravar({ imprimirDanfe: false, sefaz: { serie: 1, imprimirDanfe: false } }, { imprimirDanfe: true });
confere("Sim solta também o do bloco sefaz (loja que nasceu desligada)", lojaImprimeODanfe(doEvoPdv), true);
confere("…sem perder o resto do bloco sefaz", (doEvoPdv.sefaz as any)?.serie, 1);

const semCampo = gravar({ imprimirDanfe: false }, { momentoDaEmissao: "saida" });
confere("salvar outra coisa não religa a impressão", lojaImprimeODanfe(semCampo), false);

const doFuncionario = gravar({}, { imprimirDanfe: false }, "STAFF");
confere("funcionário também pode desligar (é o papel, não a nota)", lojaImprimeODanfe(doFuncionario), false);

confere("o campo tem rótulo na tela", rotuloDoCampoFiscal("imprimirDanfe") !== "imprimirDanfe", true);

console.log(falhas === 0 ? "\nTUDO CERTO" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
