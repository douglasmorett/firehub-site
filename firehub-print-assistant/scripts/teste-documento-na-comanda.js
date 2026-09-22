/**
 * O "CPF na nota" em linha propria (1.2.20) — e sem sair duas vezes.
 *
 * O site manda o documento DE DOIS JEITOS ao mesmo tempo: colado no nome do
 * cliente (o caminho que funciona em toda versao instalada, igual ao pager) e
 * no campo `customerCpfCnpj`. Quem tem esta versao precisa imprimir UM so — e
 * e isso que este harness trava.
 *
 * server.js nao pode ser exigido daqui: ele sobe servidor e toca no Electron.
 * Entao recortamos as funcoes que interessam do arquivo e as avaliamos
 * isoladas — o que garante que estamos testando o codigo que vai para a loja.
 *
 *   node scripts/teste-documento-na-comanda.js
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

const codigo = [
  recortar("cleanAscii"), recortar("documentoDoCliente"), recortar("nomeSemDocumento"),
  recortar("normalizarCombo"), recortar("buildEscPos"),
].join("\n\n");
const { buildEscPos, documentoDoCliente, nomeSemDocumento, cleanAscii } =
  new Function(`${codigo}\n return { buildEscPos, documentoDoCliente, nomeSemDocumento, cleanAscii };`)();

let falhas = 0;
const confere = (oQue, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok   " : "FALHA"} ${oQue}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
};

const CPF = "52998224725";
const CPF_FMT = "529.982.247-25";
const CNPJ_FMT = "11.222.333/0001-81";

console.log("\n1) O documento pronto para o papel");
confere("CPF ganha mascara", documentoDoCliente(CPF), CPF_FMT);
confere("CPF ja mascarado continua igual", documentoDoCliente(CPF_FMT), CPF_FMT);
confere("CNPJ ganha mascara", documentoDoCliente("11222333000181"), CNPJ_FMT);
confere("vazio e vazio", documentoDoCliente(""), "");
confere("nulo e vazio", documentoDoCliente(null), "");
confere("numero curto nao vira documento", documentoDoCliente("1234"), "");

console.log("\n2) Tirar do nome o que o site embutiu");
confere("nome + CPF", nomeSemDocumento("Joao Silva · CPF 529.982.247-25"), "Joao Silva");
confere("nome + CPF ja sem o ponto-medio", nomeSemDocumento(cleanAscii("Joao Silva · CPF 529.982.247-25")), "Joao Silva");
confere("pager + CPF", nomeSemDocumento("PAGER 12 · CPF 529.982.247-25"), "PAGER 12");
confere("nome + CNPJ", nomeSemDocumento("Joao · CNPJ 11.222.333/0001-81"), "Joao");
confere("nome que era so o documento some", nomeSemDocumento("CPF 529.982.247-25"), "");
confere("nome sem documento fica intacto", nomeSemDocumento("Joao Silva"), "Joao Silva");
confere("nome vazio segue vazio", nomeSemDocumento(""), "");
// A armadilha: nao pode comer nome de gente que por acaso tenha as letras.
confere("nao come nome parecido", nomeSemDocumento("Maria Cpfeiro"), "Maria Cpfeiro");
confere("nao come 'PAGER 12' sozinho", nomeSemDocumento("PAGER 12"), "PAGER 12");

console.log("\n3) O papel de verdade");
const base = {
  id: "ped_balcao", dailyOrderNumber: "20",
  customerPhone: "00000000000", customerAddress: "Balcao",
  deliveryType: "RETIRADA", paymentMethod: "Cartao Credito",
  items: [{ name: "Pizza Portuguesa", qty: 1, price: 57.9 }],
  totalAmount: 57.9, deliveryFee: 0, createdAt: "2026-09-21T23:50:00.000Z",
};
const papel = (pedido, colunas = 48) =>
  Buffer.from(buildEscPos(pedido, "FIREHUB PIZZARIA", colunas, "safe")).toString("latin1")
    .replace(/[\x00-\x09\x0b-\x1f]/g, "");

// a) Site novo + Assistente novo: linha propria, e UMA vez so.
const novo = papel({ ...base, customerName: "Joao Silva · CPF 529.982.247-25", customerCpfCnpj: CPF });
confere("sai a linha CPF/CNPJ:", /CPF\/CNPJ: 529\.982\.247-25/.test(novo), true);
confere("o nome fica limpo", /Nome: Joao Silva\s/.test(novo), true);
confere("o documento sai UMA vez", (novo.match(/529\.982\.247-25/g) || []).length, 1);

// b) Site novo + balcao sem nome: so a linha do documento.
const semNome = papel({ ...base, customerName: "CPF 529.982.247-25", customerCpfCnpj: CPF });
confere("sem nome, nao sai linha 'Nome:'", /Nome:/.test(semNome), false);
confere("sem nome, sai o documento", /CPF\/CNPJ: 529\.982\.247-25/.test(semNome), true);

// c) Pager + documento: os dois, cada um no seu lugar.
const comPager = papel({ ...base, customerName: "PAGER 12 · CPF 529.982.247-25", customerCpfCnpj: CPF });
confere("o pager continua no nome", /Nome: PAGER 12\s/.test(comPager), true);
confere("e o documento na linha dele", /CPF\/CNPJ: 529\.982\.247-25/.test(comPager), true);

// d) Site ANTIGO (sem o campo): o sufixo no nome tem que continuar saindo.
const siteAntigo = papel({ ...base, customerName: "Joao Silva · CPF 529.982.247-25" });
confere("sem o campo, o documento segue no nome", /Nome: Joao Silva\s+CPF 529\.982\.247-25/.test(siteAntigo), true);
confere("sem o campo, nao inventa linha propria", /CPF\/CNPJ:/.test(siteAntigo), false);

// e) Pedido sem documento nenhum: nada muda para quem nao usa.
const semDoc = papel({ ...base, customerName: "Joao Silva" });
confere("pedido sem documento imprime o nome igual", /Nome: Joao Silva/.test(semDoc), true);
confere("pedido sem documento nao ganha linha nova", /CPF\/CNPJ:/.test(semDoc), false);

// f) 58mm: a linha cabe sozinha, sem quebrar o documento ao meio.
const estreito = papel({ ...base, customerName: "Joao Silva · CPF 529.982.247-25", customerCpfCnpj: CPF }, 32);
confere("em 58mm o documento nao quebra", /CPF\/CNPJ: 529\.982\.247-25/.test(estreito), true);

console.log("\n── Como fica o papel (48 colunas) ──");
console.log(novo.split("\n").slice(0, 14).map(l => "   " + l).join("\n"));

console.log(falhas === 0 ? "\n✅ Tudo certo.\n" : `\n❌ ${falhas} falha(s).\n`);
process.exit(falhas === 0 ? 0 : 1);
