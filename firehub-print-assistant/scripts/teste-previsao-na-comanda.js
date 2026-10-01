/**
 * A PREVISAO DE ENTREGA no topo da comanda (1.2.29).
 *
 * O dono (01/10/2026): "preciso que saia o horario de previsao de entrega para
 * o cliente nas notas impressas, proximo do topo". Quem decide o horario e o
 * site (src/lib/previsao-da-entrega.ts) e manda `previsaoEntrega: { em, tipo }`;
 * este harness trava ONDE e COMO a linha sai, nas duas vias (layout embutido e
 * modelo da loja), e que pedido sem previsao continua igual.
 *
 * server.js nao pode ser exigido daqui (sobe servidor e toca no Electron):
 * recortamos as funcoes do arquivo e as avaliamos isoladas.
 *
 *   node scripts/teste-previsao-na-comanda.js
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

const codigo = ["cleanAscii", "documentoDoCliente", "nomeSemDocumento", "normalizarCombo", "buildEscPos"]
  .map(recortar).join("\n\n");
const { buildEscPos } = new Function(`${codigo}\n return { buildEscPos };`)();

/** O texto como ele cai no papel (mesmo decodificador de teste-modelo-comanda.js). */
const legivel = (buf) => {
  const s = Buffer.from(buf).toString("binary");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\x1D" && s[i + 1] === "(" && s[i + 2] === "k") {
      const len = s.charCodeAt(i + 3) + (s.charCodeAt(i + 4) << 8);
      i += 4 + len;
      continue;
    }
    if (c === "\x1B") { const p = s[i + 1]; i += (p === "@" || p === "2") ? 1 : 2; continue; }
    if (c === "\x1D") { const p = s[i + 1]; i += (p === "L" || p === "W") ? 3 : 2; continue; }
    if (c === "\r") continue;
    out += c;
  }
  return out;
};
const linhas = (texto) => texto.split("\n").map((l) => l.trim()).filter(Boolean);
const papel = (pedido, colunas = 48) => linhas(legivel(buildEscPos(pedido, "Hakim Centro", colunas, "safe")));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) console.log(`  ok  ${nome}`);
  else { falhas++; console.log(`  FALHOU  ${nome}`); if (detalhe !== undefined) console.log(detalhe); }
};

// O horario e formatado no relogio do PC, como na loja: o esperado tambem.
const EM = "2026-10-01T23:45:00.000Z";
const HORA = new Date(EM).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DIA = new Date(EM).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const PEDIDO = {
  id: "cmprevisao000000000001",
  dailyOrderNumber: 12,
  customerName: "Larissa Moreira",
  customerPhone: "(22) 99999-1020",
  customerAddress: "Rua Dez, 59 - Costazul",
  deliveryType: "DELIVERY",
  source: "SITE",
  paymentMethod: "Dinheiro",
  items: [{ name: "Pizza Calabresa G", qty: 1, price: 54.9 }],
  deliveryFee: 7,
  totalAmount: 61.9,
  createdAt: "2026-10-01T23:05:00.000Z",
};
const COM = (tipo) => ({ ...PEDIDO, previsaoEntrega: { em: EM, tipo } });

const MODELO_PADRAO = [
  { tipo: "numeroPedido", ligado: true, tamanho: 2, negrito: true, alinhamento: "centro" },
  { tipo: "canal", ligado: true, alinhamento: "centro" },
  { tipo: "avisoEntrega", ligado: true },
  { tipo: "separador", ligado: true },
  { tipo: "loja", ligado: true },
  { tipo: "dataHora", ligado: true },
  { tipo: "cliente", ligado: true, titulo: "CLIENTE" },
  { tipo: "entrega", ligado: true, titulo: "ENTREGA" },
  { tipo: "itens", ligado: true, titulo: "RESUMO DO PEDIDO" },
  { tipo: "totais", ligado: true },
  { tipo: "pagamento", ligado: true },
];

console.log("— Layout embutido (loja que nunca montou modelo) —");
{
  const p = papel(COM("ENTREGA"));
  conferir("1a linha e o numero", p[0] === "(12) DELIVERY", p.slice(0, 3));
  conferir("2a linha e a previsao", p[1] === `PREVISAO DE ENTREGA: ${HORA}`, p.slice(0, 3));
  conferir("sai uma vez so", p.filter((l) => l.startsWith("PREVISAO")).length === 1);
}
conferir("retirada", papel(COM("RETIRADA"))[1] === `PREVISAO DE RETIRADA: ${HORA}`, papel(COM("RETIRADA")).slice(0, 3));
conferir("agendado leva a data", papel(COM("AGENDADO"))[1] === `AGENDADO PARA: ${DIA} ${HORA}`, papel(COM("AGENDADO")).slice(0, 3));
{
  const ifood = papel({ ...COM("ENTREGA"), source: "IFOOD", ifoodReference: "4035" });
  conferir("iFood: numero, previsao, depois o canal", ifood[1] === `PREVISAO DE ENTREGA: ${HORA}` && ifood[2] === "IFOOD", ifood.slice(0, 4));
}

console.log("— Modelo da loja (order.blocos) —");
{
  const p = papel({ ...COM("ENTREGA"), blocos: MODELO_PADRAO });
  conferir("logo abaixo do numero", p[0] === "(12) DELIVERY" && p[1] === `PREVISAO DE ENTREGA: ${HORA}`, p.slice(0, 3));
  const texto = papel({ ...COM("ENTREGA"), blocos: [...MODELO_PADRAO, { tipo: "textoLivre", ligado: true, texto: "Chega ate {previsao}" }] });
  conferir("{previsao} do texto livre ganha o horario", texto.includes(`Chega ate ${HORA}`), texto.slice(-4));
}

console.log("— 58 mm (32 colunas) —");
{
  // O numero em corpo triplo ja quebra em "(12)" / "DELIVERY" nesta bobina
  // (16 colunas em 3x): a previsao vem logo depois dele, numa linha so.
  const p = papel(COM("RETIRADA"), 32);
  conferir("a linha mais longa cabe inteira, logo abaixo do numero",
    p[0] === "(12)" && p[1] === "DELIVERY" && p[2] === `PREVISAO DE RETIRADA: ${HORA}`, p.slice(0, 4));
}

console.log("— Quando NAO sai —");
{
  const sem = legivel(buildEscPos(PEDIDO, "Hakim Centro", 48, "safe"));
  conferir("sem previsaoEntrega: nenhuma linha", !/PREVISAO|AGENDADO PARA/.test(sem));
  const comNada = legivel(buildEscPos({ ...PEDIDO, previsaoEntrega: null }, "Hakim Centro", 48, "safe"));
  conferir("previsaoEntrega nula: papel identico ao de sempre", comNada === sem);
  conferir("data invalida: nenhuma linha", !papel({ ...PEDIDO, previsaoEntrega: { em: "lixo", tipo: "ENTREGA" } }).some((l) => l.startsWith("PREVISAO")));
  const desligado = papel({ ...COM("ENTREGA"), avisos: { previsaoEntrega: false } });
  conferir("desligada na aba Avisos: some", !desligado.some((l) => l.startsWith("PREVISAO")), desligado.slice(0, 3));
  const desligadoTexto = papel({ ...COM("ENTREGA"), avisos: { previsaoEntrega: false }, blocos: [...MODELO_PADRAO, { tipo: "textoLivre", ligado: true, texto: "Chega ate {previsao}" }] });
  conferir("desligada: {previsao} do texto livre continua", desligadoTexto.includes(`Chega ate ${HORA}`));
}

console.log(falhas ? `\n${falhas} falharam` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
