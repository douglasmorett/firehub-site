/**
 * "NAO E DOCUMENTO FISCAL" no papel que vai para a mão do cliente.
 *
 * Comprovante não fiscal entregue ao consumidor com itens, valores e total tem
 * de dizer que não é documento fiscal (obrigatório desde 01/02/2025 — Ajuste
 * SINIEF 32/24, cl. 10ª §4º, conforme a orientação fiscal do projeto). A
 * comanda do Assistente (firehub-print-assistant/server.js → buildEscPos) é
 * esse papel na entrega, na conta da mesa e no balcão. As vias INTERNAS
 * (cozinha, bebidas) não vão ao cliente e não levam a linha.
 *
 * ── Duas perguntas diferentes ───────────────────────────────────────────────
 *
 *  1. O Assistente que vai ser distribuído imprime a linha? Roda o buildEscPos
 *     RECORTADO do server.js (como firehub-print-assistant/scripts/
 *     teste-modelo-comanda.js), não da cópia da prévia: é o código que vai
 *     para a loja no próximo instalador.
 *
 *  2. A prévia do painel ("Personalizar impressão") desenha o papel que as
 *     lojas RECEBEM? Ela roda a cópia gerada (src/lib/gerado/
 *     comanda-do-assistente.ts), e as lojas recebem o Assistente anunciado em
 *     VERSAO_ASSISTENTE_ATUAL (src/lib/print.ts — o auto-update baixa esse).
 *     Em 24/09/2026 a cópia foi regravada com o server.js da 1.2.24 sem o
 *     instalador: a prévia mostrava a linha e o papel das lojas (1.2.23) saía
 *     sem ela — o lojista via na tela uma obrigação cumprida que o papel não
 *     cumpria. A regra agora é a do lançamento: a cópia da prévia é a da
 *     versão ANUNCIADA, e anda junto com o instalador e a constante, no mesmo
 *     commit. Enquanto o server.js está à frente (lançamento pendente), o teste
 *     diz isso e não falha.
 *
 *   npx tsx scripts/teste-fiscal-comprovante.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { ASSINATURA_DO_CODIGO, comandaDoAssistente, VERSAO_DO_ASSISTENTE } from "../src/lib/gerado/comanda-do-assistente";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── O buildEscPos do server.js, recortado (o mesmo recorte do gerador) ──────
const raiz = join(__dirname, "..");
const fonte = readFileSync(join(raiz, "firehub-print-assistant", "server.js"), "utf8").replace(/\r\n/g, "\n");
const FUNCOES = ["cleanAscii", "documentoDoCliente", "nomeSemDocumento", "normalizarCombo", "buildEscPos"];
function recortar(nome: string): string {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`não achei function ${nome} em server.js`);
  let nivel = 0;
  let i = fonte.indexOf("{", inicio);
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  if (nivel !== 0) throw new Error(`chaves desbalanceadas em ${nome}`);
  return fonte.slice(inicio, i + 1);
}
const codigoDoServidor = FUNCOES.map(recortar).join("\n\n");
// eslint-disable-next-line no-new-func
const { buildEscPos } = new Function(`${codigoDoServidor}\n return { buildEscPos };`)() as {
  buildEscPos: (order: unknown, storeName: string, columns: number, profile: string) => Buffer;
};

const FRASE = "NAO E DOCUMENTO FISCAL";
const vezes = (texto: string, frase: string) => texto.split(frase).length - 1;
const pedido = {
  id: "exemplo", dailyOrderNumber: 12, customerName: "Larissa", customerPhone: "(22) 99999-1020",
  customerAddress: "Rua Dez, 59 - Costazul", deliveryType: "DELIVERY", source: "SITE", paymentMethod: "Dinheiro",
  items: [{ name: "Pizza Calabresa G", qty: 1, quantity: 1, price: 54.9 }, { name: "Coca-Cola Lata", qty: 1, quantity: 1, price: 6 }],
  deliveryFee: 7, totalAmount: 67.9, createdAt: "2026-09-23T21:45:00.000Z",
};
const papel = (order: Record<string, unknown>, colunas = 48) => buildEscPos(order, "Loja Teste", colunas, "safe").toString("binary");

console.log("\n— O Assistente do próximo instalador (server.js) —");
const entrega = papel(pedido);
confere("comanda da entrega (vai no saco, com valores): leva a frase uma vez", vezes(entrega, FRASE), 1);
confere("…antes do \"Obrigado\"", entrega.indexOf(FRASE) < entrega.indexOf("Obrigado pela preferencia"), true);
confere("…em negrito (ESC E 1 antes da frase)", entrega.lastIndexOf("\x1bE\x01", entrega.indexOf(FRASE)) > entrega.lastIndexOf("\x1bE\x00", entrega.indexOf(FRASE)), true);
confere("com o \"Obrigado\" desligado pela loja, a frase continua (não é escolha da loja)", vezes(papel({ ...pedido, avisos: { obrigado: false } }), FRASE), 1);
confere("em 58 mm (32 colunas) também", vezes(papel(pedido, 32), FRASE), 1);
confere("conta da mesa (vai para a mão do cliente): leva", vezes(papel({ ...pedido, kind: "CONTA_DA_MESA", deliveryType: "MESA" }), FRASE), 1);
confere("via da COZINHA (interna): não leva", vezes(papel({ ...pedido, semValores: true }), FRASE), 0);
confere("comanda de BEBIDAS (interna): não leva", vezes(papel({ ...pedido, somenteBebidas: true }), FRASE), 0);
// O papel do caixa já traz a frase no próprio relatório (lib/cupom-do-caixa):
// não pode sair duas vezes.
confere(
  "papel do caixa: a frase do relatório, uma vez só",
  vezes(papel({ ...pedido, kind: "CAIXA_FECHAMENTO", dailyOrderNumber: "FECHAMENTO", relatorio: [{ tipo: "linha", texto: "Dinheiro", valor: "R$ 10,00" }, { tipo: "titulo", texto: "NÃO É DOCUMENTO FISCAL" }] }), FRASE),
  1
);

// ── A prévia é o papel que as lojas recebem ─────────────────────────────────
console.log("\n— A prévia do painel —");
const pacote = JSON.parse(readFileSync(join(raiz, "firehub-print-assistant", "package.json"), "utf8"));
// Lido do texto: lib/print.ts puxa meio site junto, e só a constante interessa.
const anunciada = readFileSync(join(raiz, "src", "lib", "print.ts"), "utf8").match(/export const VERSAO_ASSISTENTE_ATUAL = "([^"]+)"/)?.[1];
confere(
  "a cópia da prévia é a do Assistente ANUNCIADO às lojas (VERSAO_ASSISTENTE_ATUAL) — a cópia só anda com o instalador",
  VERSAO_DO_ASSISTENTE,
  anunciada
);
const assinaturaDoServidor = createHash("sha256").update(codigoDoServidor).digest("hex").slice(0, 16);
if (pacote.version === anunciada) {
  // Lançado: a cópia tem de ser o server.js de agora (o `--conferir` do gerador).
  confere("versão lançada: a cópia da prévia é o buildEscPos do server.js atual", ASSINATURA_DO_CODIGO, assinaturaDoServidor);
  confere("versão lançada: a prévia já desenha a frase", vezes(String(comandaDoAssistente(pedido, "Loja Teste", 48, "safe")), FRASE), 1);
} else {
  confere(
    `server.js à frente da versão anunciada (${pacote.version} × ${anunciada}): o package.json foi subido para o próximo instalador`,
    pacote.version.localeCompare(String(anunciada), undefined, { numeric: true }) > 0,
    true
  );
  console.log(
    `⏳ Assistente ${pacote.version} pendente de lançamento. No MESMO commit: gerar o instalador e trocar public/downloads, ` +
      `subir VERSAO_ASSISTENTE_ATUAL (src/lib/print.ts) e rodar node scripts/gerar-comanda-do-assistente.mjs. ` +
      `Até lá a prévia desenha o ${anunciada}, que é o papel das lojas.`
  );
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
if (falhas > 0) process.exit(1);
