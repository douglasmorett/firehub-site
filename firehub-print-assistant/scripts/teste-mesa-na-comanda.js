/**
 * A comanda de MESA (1.2.24): o numero da mesa no topo, o garcom logo abaixo,
 * e o papel sem o que nao serve a uma rodada de mesa.
 *
 * A queixa (24/09/2026), com a comanda da Ragnar Burger na mao: o topo saia
 * "(3) MESA" — o numero do pedido, e de mesa nenhuma (era a 4) — e o garcom
 * nao aparecia. O mesmo papel dizia "Outros valores do pedido: R$ 36,00"
 * (os dois sucos que foram para a outra cozinha), "Forma de Pagamento: N/A" e
 * "!! TOTAL A PAGAR !!" de uma rodada que se paga no fechamento da mesa.
 *
 * O site manda a mesa e o garcom DE DOIS JEITOS (src/lib/mesa-na-comanda.ts):
 * embutidos no nome, para o Assistente antigo, e em campo proprio. Este
 * harness trava que a versao nova usa os campos e nao imprime nada duas vezes.
 *
 * server.js nao pode ser exigido daqui (sobe servidor e toca no Electron):
 * recortamos as funcoes do arquivo e as avaliamos isoladas.
 *
 *   node scripts/teste-mesa-na-comanda.js
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
const papel = (pedido, colunas = 48) => legivel(buildEscPos(pedido, "Ragnar Burger", colunas, "safe"));

let falhas = 0;
const conferir = (nome, condicao, detalhe) => {
  if (condicao) { console.log("  ok   " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? "\n        " + detalhe : ""));
};

// O pedido #3 da Ragnar como a fila manda para a COZINHA ENTREGA RAGNA: so os
// itens dela (os sucos foram para a COZINHA PIZZA), total do pedido inteiro.
const RODADA = {
  id: "ped_mesa_3", dailyOrderNumber: 3,
  customerName: "Matheus · Mesa 4 · Garçom Rafaela Cereja",
  customerPhone: "00000000000", customerAddress: "Mesa 4",
  deliveryType: "MESA", source: "PRESENCIAL", paymentMethod: "N/A",
  tableSessionId: "sessao_mesa_4",
  mesa: "4", garcom: "Rafaela Cereja",
  restoDoPedido: { itens: 2, valor: 36 },
  items: [
    { name: "Thor", qty: 2, price: 39.9 },
    { name: "Batata Frita", qty: 1, price: 12.9 },
  ],
  totalAmount: 128.7, deliveryFee: 0, createdAt: "2026-09-24T21:28:00.000Z",
};

console.log("\n1) O topo diz o pedido, a MESA e o garcom");
{
  const l = linhas(papel(RODADA));
  const topo = l.findIndex((x) => x === "(3) MESA 4");
  conferir("\"(3) MESA 4\" no topo", topo >= 0, l.slice(0, 4).join(" | "));
  conferir("o garcom logo abaixo", l[topo + 1] === "GARCOM: RAFAELA CEREJA", l[topo + 1]);
}

console.log("\n2) O nome sem o que o site embutiu para o Assistente antigo");
{
  const l = linhas(papel(RODADA));
  conferir("\"Nome: Matheus\" e so isso", l.includes("Nome: Matheus"), l.filter((x) => x.startsWith("Nome")).join(" | "));
  conferir("a mesa nao sai de novo no nome", !l.some((x) => x.startsWith("Nome") && /mesa/i.test(x)));
  conferir("o garcom nao sai de novo no nome", !l.some((x) => x.startsWith("Nome") && /garcom/i.test(x)));
  conferir("o garcom sai UMA vez no papel", l.filter((x) => /RAFAELA/i.test(x)).length === 1);

  // O documento vem por ultimo no nome (nomeDoClienteNaComanda no site): o
  // Assistente tira o CPF do fim e depois a mesa e o garcom de onde estiverem.
  const comCpf = linhas(papel({
    ...RODADA,
    customerName: "Matheus · Mesa 4 · Garçom Rafaela Cereja · CPF 529.982.247-25",
    customerCpfCnpj: "52998224725",
  }));
  conferir("com CPF: \"Nome: Matheus\"", comCpf.includes("Nome: Matheus"), comCpf.filter((x) => x.startsWith("Nome")).join(" | "));
  conferir("com CPF: o documento na linha dele", comCpf.includes("CPF/CNPJ: 529.982.247-25"));
}

console.log("\n3) O que nao serve a uma rodada de mesa");
{
  const t = papel(RODADA);
  conferir("sem \"Qtd Pedidos\"", !/Qtd Pedidos/.test(t));
  conferir("sem \"Taxa de Entrega: R$ 0,00\"", !/Taxa de Entrega/.test(t));
  conferir("pagamento: na conta da mesa", /Forma de Pagamento: na conta da mesa/.test(t));
  conferir("sem \"N/A\"", !/N\/A/.test(t));
  conferir("sem \"TOTAL A PAGAR\" de uma rodada", !/TOTAL A PAGAR/.test(t));
  conferir("sem \"(PAGAR NO CAIXA OU NA MESA)\"", !/PAGAR NO CAIXA/.test(t));
}

console.log("\n4) O que foi para a outra cozinha tem nome — e a conta fecha");
{
  const l = linhas(papel(RODADA));
  const resto = l.find((x) => x.startsWith("Em outra impressora"));
  conferir("\"Em outra impressora (2 itens): R$ 36,00\"", /^Em outra impressora \(2 itens\):\s+R\$ 36,00$/.test(resto || ""), resto);
  conferir("sem \"Outros valores do pedido\"", !l.some((x) => /Outros valores/.test(x)));
  conferir("sem desconto inventado", !l.some((x) => /^Desconto/.test(x)));
  conferir("subtotal desta impressora", l.some((x) => /^Subtotal:\s+R\$ 92,70$/.test(x)));
  conferir("total do pedido inteiro", l.some((x) => /^Total:\s+R\$ 128,70$/.test(x)));
}

console.log("\n5) Servidor antigo (sem `mesa`): o numero sai do rotulo do endereco");
{
  const { mesa, garcom, ...semCampos } = RODADA;
  const l = linhas(papel({ ...semCampos, customerName: "Matheus" }));
  conferir("\"(3) MESA 4\" pelo endereco", l.includes("(3) MESA 4"));
  conferir("sem linha de garcom (ninguem mandou)", !l.some((x) => /GARCOM/.test(x)));
  conferir("\"Nome: Matheus\"", l.includes("Nome: Matheus"));
}

console.log("\n6) Mesa aberta sem nome: o nome ERA a mesa");
{
  const l = linhas(papel({ ...RODADA, customerName: "Mesa 4 · Garçom Rafaela Cereja" }));
  conferir("sem linha \"Nome:\"", !l.some((x) => x.startsWith("Nome")), l.filter((x) => x.startsWith("Nome")).join(" | "));
  conferir("sem \"CLIENTE\" sozinho no papel", !l.includes("CLIENTE"));
  conferir("a mesa continua no topo", l.includes("(3) MESA 4"));
}

console.log("\n7) \"Mesa 20\" do PDV, sem conta aberta: o pagamento segue como era");
{
  const pdv = {
    id: "ped_pdv_12", dailyOrderNumber: 12, customerName: "Mesa 20", customerPhone: "",
    customerAddress: "Mesa 20", deliveryType: "MESA", source: "PRESENCIAL",
    paymentMethod: "Cartão Crédito", mesa: "20",
    items: [{ name: "Esfiha de Carne", qty: 4, price: 9.05 }],
    totalAmount: 36.2, deliveryFee: 0, createdAt: "2026-09-24T22:48:00.000Z",
  };
  const t = papel(pdv);
  const l = linhas(t);
  conferir("\"(12) MESA 20\" no topo", l.includes("(12) MESA 20"));
  conferir("forma de pagamento escolhida no PDV", /Forma de Pagamento: Cartao Credito/.test(t));
  conferir("\"TOTAL A PAGAR\" continua (nao tem conta para fechar)", /TOTAL A PAGAR: R\$ 36,20/.test(t));
}

console.log("\n8) Entrega dividida entre duas cozinhas, com cupom: a conta fecha");
{
  const entrega = {
    id: "ped_entrega_40", dailyOrderNumber: 40, customerName: "Ana", customerPhone: "91988887777",
    customerAddress: "Travessa WE 62, 661 - Cidade Nova", deliveryType: "DELIVERY", source: "SITE",
    paymentMethod: "Pix", isPrepaid: true,
    restoDoPedido: { itens: 1, valor: 40 },
    items: [{ name: "Thor", qty: 1, price: 39.9 }, { name: "Batata Frita", qty: 1, price: 20.1 }],
    discountTotal: 10, discountMerchant: 10,
    totalAmount: 95, deliveryFee: 5, createdAt: "2026-09-24T22:10:00.000Z",
  };
  const l = linhas(papel(entrega));
  conferir("\"Em outra impressora (1 item): R$ 40,00\"", l.some((x) => /^Em outra impressora \(1 item\):\s+R\$ 40,00$/.test(x)));
  conferir("o cupom da loja na linha dele", l.some((x) => /^Desconto \(Cupom - Loja\):\s+-R\$ 10,00$/.test(x)), l.filter((x) => /Desconto|Outros/.test(x)).join(" | "));
  conferir("sem \"Outros valores\"", !l.some((x) => /Outros valores/.test(x)));
  conferir("a taxa de entrega continua (nao e mesa)", l.some((x) => /^Taxa de Entrega:\s+R\$ 5,00$/.test(x)));
  conferir("\"Qtd Pedidos\" continua fora da mesa", l.some((x) => /^Qtd Pedidos: 1$/.test(x)));
}

console.log("\n9) Em 58 mm");
{
  const l = linhas(papel(RODADA, 32));
  conferir("o topo cabe em corpo triplo (10 colunas)", l.includes("(3) MESA 4"), l.slice(0, 3).join(" | "));
  conferir("o garcom inteiro", l.includes("GARCOM: RAFAELA CEREJA"));
  conferir("rotulo curto, sem a contagem", l.some((x) => /^Em outra impressora:\s+R\$ 36,00$/.test(x)), l.filter((x) => /outra/.test(x)).join(" | "));
  conferir("nenhuma linha passa de 32 colunas", legivel(buildEscPos(RODADA, "Ragnar Burger", 32, "safe")).split("\n").every((x) => x.length <= 32));
}

console.log("\n10) Loja com modelo proprio: a mesa e o garcom tambem saem");
{
  const blocos = [
    { tipo: "numeroPedido", ligado: true, tamanho: 3, negrito: true, alinhamento: "centro" },
    { tipo: "separador", ligado: true },
    { tipo: "cliente", ligado: true, titulo: "CLIENTE" },
    { tipo: "itens", ligado: true, titulo: "RESUMO DO PEDIDO" },
    { tipo: "totais", ligado: true },
    { tipo: "pagamento", ligado: true },
  ];
  const l = linhas(papel({ ...RODADA, blocos }));
  conferir("\"(3) MESA 4\" no topo do modelo", l.includes("(3) MESA 4"), l.slice(0, 3).join(" | "));
  conferir("o garcom no bloco do numero", l.includes("GARCOM: RAFAELA CEREJA"));
  conferir("\"Nome: Matheus\" no modelo", l.includes("Nome: Matheus"));
  conferir("a outra impressora no modelo", l.some((x) => x.startsWith("Em outra impressora (2 itens)")));
  conferir("\"na conta da mesa\" no modelo", l.some((x) => /na conta da mesa/.test(x)));
}

console.log("\n11) A loja que trocou a palavra do topo");
{
  const blocos = [
    { tipo: "numeroPedido", ligado: true, tamanho: 3, rotulos: { delivery: "PEDIDO" } },
    { tipo: "itens", ligado: true },
  ];
  const l = linhas(papel({ ...RODADA, blocos }));
  // 17 letras em corpo triplo (16 colunas): quebra em duas linhas, como o
  // "(79) DELIVERY #3523" de sempre. O que importa e a palavra MESA antes do 4.
  conferir("\"(3) PEDIDO MESA 4\" — o 4 continua sendo a mesa", l.slice(0, 2).join(" ") === "(3) PEDIDO MESA 4", l.slice(0, 2).join(" | "));
}

console.log("\n12) A conta da mesa nao muda");
{
  const conta = {
    id: "conta_sessao_mesa_4_1", kind: "CONTA_DA_MESA", dailyOrderNumber: "CONTA MESA 4",
    customerName: "Mesa 4 (Matheus)", customerAddress: "Mesa 4", deliveryType: "MESA", source: "MESA",
    paymentMethod: "Pendente - pagar no caixa ou na mesa", isPrepaid: false, garcom: "Rafaela Cereja", mesa: "4",
    items: [{ name: "Thor", qty: 2, price: 39.9 }], totalAmount: 79.8, deliveryFee: 0,
  };
  const t = papel(conta);
  conferir("sem linha de garcom na conta", !/GARCOM:/.test(t));
  conferir("\"TOTAL A PAGAR\" continua na conta", /TOTAL A PAGAR/.test(t));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exitCode = falhas ? 1 : 0;
