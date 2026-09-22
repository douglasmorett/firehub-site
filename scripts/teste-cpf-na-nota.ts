/**
 * Trava o "CPF na nota" do balcão (lib/documento-do-cliente.ts).
 *
 *   npx tsx scripts/teste-cpf-na-nota.ts
 *
 * Dois riscos a cobrir, e eles puxam para lados opostos:
 *
 *   1. Número inválido NÃO pode ser gravado. Esta coluna é o destinatário da
 *      NFC-e — um dígito trocado vira rejeição da SEFAZ com a fila esperando.
 *   2. Campo vazio NÃO pode travar a venda. Quem não pediu CPF na nota é a
 *      maioria dos pedidos de balcão.
 *
 * E, no papel, o documento divide a linha do nome com o pager: a ordem entre
 * os dois é o que este teste fixa.
 */
import {
  normalizarDocumento, lerDocumentoDoCliente, problemaDoDocumento, tipoDoDocumento,
  formatarDocumento, mascararDocumentoDigitado, etiquetaDoDocumento, nomeComDocumento,
} from "../src/lib/documento-do-cliente";
import { nomeComPager } from "../src/lib/pager";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok   " : "FALHA"} ${oQue}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
};

// Documentos de teste com dígitos verificadores corretos.
const CPF = "52998224725";
const CPF_MASCARADO = "529.982.247-25";
const CNPJ = "11222333000181";
const CNPJ_MASCARADO = "11.222.333/0001-81";

console.log("\n1) Como o número é guardado");
confere("tira a máscara do CPF", normalizarDocumento(CPF_MASCARADO), CPF);
confere("tira a máscara do CNPJ", normalizarDocumento(CNPJ_MASCARADO), CNPJ);
confere("espaço em branco é vazio", normalizarDocumento("   "), "");
// CNPJ alfanumérico (Receita, desde julho/2026): jogar fora as letras
// transformaria um CNPJ válido em lixo de 2 dígitos.
confere("mantém letra do CNPJ alfanumérico", normalizarDocumento("ab.222.333/0001-81"), "AB22233300 0181".replace(/\s/g, ""));

console.log("\n2) O que entra e o que é recusado");
confere("CPF válido entra", lerDocumentoDoCliente(CPF_MASCARADO), CPF);
confere("CNPJ válido entra", lerDocumentoDoCliente(CNPJ_MASCARADO), CNPJ);
confere("campo vazio NÃO é problema (a venda segue)", problemaDoDocumento(""), null);
confere("CPF certo não é problema", problemaDoDocumento(CPF), null);
confere("dígito trocado é recusado", problemaDoDocumento("52998224726"), "Este CPF não existe: os dígitos verificadores não batem.");
confere("tamanho errado é recusado", problemaDoDocumento("1234"), "CPF tem 11 dígitos e CNPJ tem 14. Confira o número digitado.");
confere("111.111.111-11 é recusado", problemaDoDocumento("11111111111"), "Este CPF não existe: os dígitos verificadores não batem.");
confere("inválido não chega ao banco", lerDocumentoDoCliente("52998224726"), null);
confere("sabe que é CPF", tipoDoDocumento(CPF_MASCARADO), "CPF");
confere("sabe que é CNPJ", tipoDoDocumento(CNPJ_MASCARADO), "CNPJ");
confere("não chuta enquanto digita", tipoDoDocumento("529"), null);

console.log("\n3) A máscara enquanto o atendente digita");
confere("3 dígitos", mascararDocumentoDigitado("529"), "529");
confere("6 dígitos", mascararDocumentoDigitado("529982"), "529.982");
confere("CPF inteiro", mascararDocumentoDigitado(CPF), CPF_MASCARADO);
confere("vira CNPJ ao passar de 11", mascararDocumentoDigitado(CNPJ), CNPJ_MASCARADO);
confere("não aceita mais que 14", mascararDocumentoDigitado(CNPJ + "999"), CNPJ_MASCARADO);
confere("formata para exibir", formatarDocumento(CPF), CPF_MASCARADO);

console.log("\n4) O que sai na comanda");
confere("etiqueta do CPF", etiquetaDoDocumento(CPF), `CPF ${CPF_MASCARADO}`);
confere("etiqueta do CNPJ", etiquetaDoDocumento(CNPJ), `CNPJ ${CNPJ_MASCARADO}`);
confere("nome + CPF", nomeComDocumento("João", CPF), `João · CPF ${CPF_MASCARADO}`);
confere("'Balcão' dá lugar ao CPF", nomeComDocumento("Balcão", CPF), `CPF ${CPF_MASCARADO}`);
confere("sem documento, o nome fica intacto", nomeComDocumento("João", ""), "João");
confere("documento inválido não suja o nome", nomeComDocumento("João", "52998224726"), "João");
confere("pager vem antes do documento", nomeComDocumento(nomeComPager("João", "12"), CPF), `João · PAGER 12 · CPF ${CPF_MASCARADO}`);
confere("balcão sem nome, com pager e CPF", nomeComDocumento(nomeComPager("Balcão", "12"), CPF), `PAGER 12 · CPF ${CPF_MASCARADO}`);
confere("balcão sem nome e sem pager", nomeComDocumento(nomeComPager("Balcão", null), CPF), `CPF ${CPF_MASCARADO}`);

console.log(falhas === 0 ? "\n✅ Tudo certo.\n" : `\n❌ ${falhas} falha(s).\n`);
process.exit(falhas === 0 ? 0 : 1);
