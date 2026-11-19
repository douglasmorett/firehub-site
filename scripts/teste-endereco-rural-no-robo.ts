/**
 * Endereço de zona rural no robô: "Sítio Coité, perto da capela" sem rua nem
 * número (Pizzaria Charles, Meruoca/CE, 19/11/2026).
 *
 *   npx tsx scripts/teste-endereco-rural-no-robo.ts
 *
 * O robô pedia "rua, número e bairro" e insistia no número que não existe.
 * Agora, quando o cliente diz que não tem, vale a localidade/sítio com um ponto
 * de referência. O bairro continua obrigatório (é ele que dá a taxa) e a loja
 * de cidade pequena (só referência) segue como estava.
 */
import { readFileSync } from "node:fs";
import { ENDERECO_SEM_NUMERO, regrasDoRobo } from "../src/lib/regras-do-robo";

let falhas = 0;
const confere = (oQue: string, ok: boolean, detalhe?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok || detalhe === undefined ? "" : ` — ${JSON.stringify(detalhe)}`}`);
};

const ctxBase: any = {
  storeLink: "x", cardapioArquivoUrl: null, cardapioArquivoNoInicio: false, temCupomParaCitar: false, diaDeHoje: "quinta", codigoDoDia: "QUI",
  diaDeAmanha: "sexta", lojaFisica: true, enderecoDaLoja: "Rua do açude", fazReservaDeMesa: false, modoDaArea: "BAIRRO", ehRota: false, regraDoPix: "",
  anotaPedido: true, notaFiscal: null, regraDoMinimo: "", lembreteDoMinimo: "",
};

// ── A regra que o robô recebe ──
confere("a exceção fala de sítio, zona rural e s/n", /sítio/.test(ENDERECO_SEM_NUMERO) && /zona rural/.test(ENDERECO_SEM_NUMERO) && /s\/n/.test(ENDERECO_SEM_NUMERO));
confere("a exceção troca o número pelo ponto de referência", /PONTO DE REFERÊNCIA/.test(ENDERECO_SEM_NUMERO) && /não insista no número/.test(ENDERECO_SEM_NUMERO));

const porBairro = regrasDoRobo(ctxBase);
const linhaDoEndereco = porBairro.split("\n").find((l) => l.includes("pergunte só o próximo dado faltante")) || "";
confere("loja por bairro: ainda pede rua, número e BAIRRO", /endereço com rua, número e BAIRRO/.test(linhaDoEndereco), linhaDoEndereco);
confere("loja por bairro: o bairro continua obrigatório (sem bairro não há taxa)", /sem bairro não há taxa/.test(linhaDoEndereco));
confere("loja por bairro: aceita sítio + referência sem número", linhaDoEndereco.includes(ENDERECO_SEM_NUMERO), linhaDoEndereco);

const porKm = regrasDoRobo({ ...ctxBase, modoDaArea: "KM" });
confere("loja por km: a mesma exceção", porKm.includes(ENDERECO_SEM_NUMERO));

const soReferencia = regrasDoRobo({ ...ctxBase, soReferencia: true });
confere("cidade pequena (só referência): igual a antes, sem a exceção", !soReferencia.includes(ENDERECO_SEM_NUMERO) && /só um PONTO DE REFERÊNCIA de onde entregar/.test(soReferencia));

// ── A validação da área (chatbot-ai.ts) diz o mesmo nas duas frases que pediam rua e número ──
const fonte = readFileSync(new URL("../src/lib/chatbot-ai.ts", import.meta.url), "utf8");
confere("validação pelo bairro: confere rua/número OU a exceção", /tem rua, número e um ponto de referência \(é o que o entregador usa para achar a casa; \$\{ENDERECO_SEM_NUMERO\}\)/.test(fonte));
confere("validação pela localização: idem", /precisa do endereço escrito \(\$\{ENDERECO_SEM_NUMERO\}\)/.test(fonte));

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
