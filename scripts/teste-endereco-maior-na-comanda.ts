/**
 * O endereço de entrega em 1,5x e em negrito (Charlie Brown Pizzas, 07/11/2026).
 *
 *   npx tsx scripts/teste-endereco-maior-na-comanda.ts
 *
 * Monta a comanda pelo código do Assistente (lib/gerado/comanda-do-assistente.ts)
 * com o modelo salvo passando por `lerModelo` + `blocosParaOAssistente`, como a
 * fila e o navegador fazem, e confere os BYTES e o papel lido deles:
 *   1. de fábrica (ninguém mexeu) os bytes são os de antes, byte a byte;
 *   2. 1,5x + negrito: cada linha do endereço sai alta (GS ! 0x01), em
 *      negrito, e quebra no MESMO lugar que em 1x (a letra não fica mais larga);
 *   3. 2x pedido na mão vira 1,5x — no site (lerModelo) e no Assistente;
 *   4. o endereço que não se separa ("Endereco: …") recebe o mesmo tratamento.
 */
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";
import { lerPapel } from "../src/lib/papel-da-impressora";
import { blocosParaOAssistente, lerModelo, modeloPadrao, type Bloco } from "../src/lib/comanda-modelo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n     obtido   ${JSON.stringify(obtido)}\n     esperava ${JSON.stringify(esperado)}`}`);
};

const GS_ALTA = "\x1d!\x01", GS_NORMAL = "\x1d!\x00", NEGRITO = "\x1bE\x01";

const pedido = {
  id: "teste", dailyOrderNumber: 7, customerName: "Cliente Teste", deliveryType: "DELIVERY",
  customerPhone: "(35) 99999-0000",
  paymentMethod: "Dinheiro", items: [{ name: "Pizza G", qty: 1, price: 50 }], totalAmount: 57, deliveryFee: 7,
  customerAddress: "Rua Marechal Deodoro da Fonseca, 1234 - Jardim dos Manacas, Pocos de Caldas - MG",
  enderecoImpresso: [
    { rotulo: "Rua", valor: "Rua Marechal Deodoro da Fonseca Filho Neto Sobrinho" },
    { rotulo: "Numero", valor: "1234" },
    { rotulo: "Bairro", valor: "Jardim dos Manacas" },
    { rotulo: "Cidade", valor: "Pocos de Caldas - MG" },
  ],
};

/** O modelo de fábrica com o bloco de entrega mexido, lido como a tela grava. */
const modeloCom = (entrega: Partial<Bloco>) => {
  const m = modeloPadrao();
  return lerModelo({ ...m, completo: m.completo.map((b) => (b.tipo === "entrega" ? { ...b, ...entrega } : b)) });
};
const bytes = (blocos: Bloco[] | undefined, order: Record<string, unknown> = pedido, colunas = 32) =>
  comandaDoAssistente({ ...order, ...(blocos ? { blocos } : {}) }, "Loja Teste", colunas, "safe") as unknown as string;
/** As linhas da seção ENTREGA (sem o título), com o formato de cada uma. */
const entrega = (escpos: string) => {
  const linhas = lerPapel(escpos);
  const textos = linhas.map((l) => l.trechos.map((t) => t.texto).join(""));
  const ini = textos.findIndex((t) => t.trim() === "ENTREGA");
  const fim = textos.findIndex((t, i) => i > ini && /RESUMO DO PEDIDO/.test(t));
  return linhas.slice(ini + 1, fim)
    .filter((l) => l.trechos.some((t) => t.texto.trim()))
    .map((l) => {
      const ts = l.trechos.filter((t) => t.texto.trim());
      return { texto: l.trechos.map((t) => t.texto).join("").trimEnd(), altura: ts[0].altura, largura: ts[0].largura, negrito: ts.every((t) => t.negrito) };
    });
};

// 1. De fábrica.
const fabrica = modeloPadrao().completo;
const blocosFabrica = blocosParaOAssistente(fabrica);
confere("de fábrica o bloco de entrega não leva `corpos` nem `negritos`",
  blocosFabrica.find((b) => b.tipo === "entrega"), { tipo: "entrega", ligado: true, titulo: "ENTREGA" });
const papelDeFabrica = entrega(bytes(blocosFabrica));
confere("de fábrica o endereço sai em 1x e sem negrito",
  papelDeFabrica.every((l) => l.altura === 1 && l.largura === 1 && !l.negrito), true);
confere("1x pedido explicitamente dá os MESMOS bytes do de fábrica",
  bytes(blocosParaOAssistente(modeloCom({ corpos: { endereco: 1 } }).completo)) === bytes(blocosFabrica), true);

// 2. 1,5x + negrito.
const m15 = modeloCom({ corpos: { endereco: 1.5 }, negritos: { endereco: true } });
const blocos15 = blocosParaOAssistente(m15.completo);
confere("1,5x + negrito viajam no `order.blocos`",
  blocos15.find((b) => b.tipo === "entrega"), { tipo: "entrega", ligado: true, titulo: "ENTREGA", negritos: { endereco: true }, corpos: { endereco: 1.5 } });
const papel15 = entrega(bytes(blocos15));
for (const l of papel15) console.log(`    |${l.texto}  (altura ${l.altura}, largura ${l.largura}${l.negrito ? ", negrito" : ""})`);
confere("cada linha do endereço sai alta (2), na largura normal (1) e em negrito",
  papel15.every((l) => l.altura === 2 && l.largura === 1 && l.negrito), true);
confere("a quebra é a mesma do 1x (mesmas linhas, mesmo texto)",
  papel15.map((l) => l.texto), papelDeFabrica.map((l) => l.texto));
confere("nenhuma linha passa das 32 colunas", papel15.every((l) => l.texto.length <= 32), true);
confere("o primeiro pedaço da rua sai como \"Rua: Rua Marechal Deodoro da\"", papel15[0]?.texto, "Rua: Rua Marechal Deodoro da");
const b15 = bytes(blocos15);
confere("os bytes do endereço: GS ! 0x01, ESC E 1, \"Numero: 1234\"",
  b15.includes(GS_ALTA + NEGRITO + "Numero: 1234\n"), true);
confere("e o corpo volta ao normal antes dos itens",
  b15.indexOf(GS_NORMAL, b15.indexOf("Pocos de Caldas - MG")) < b15.indexOf("RESUMO DO PEDIDO"), true);

// 3. 2x vira 1,5x.
const m2 = modeloCom({ corpos: { endereco: 2 } });
confere("o site lê 2x gravado na mão como 1,5x", m2.completo.find((b) => b.tipo === "entrega")?.corpos, { endereco: 1.5 });
const blocos2NaMao = blocosParaOAssistente(fabrica).map((b) => (b.tipo === "entrega" ? { ...b, corpos: { endereco: 2 as const } } : b));
confere("o Assistente também segura em 1,5x (largura 1) um 2x que chegue",
  entrega(bytes(blocos2NaMao)).every((l) => l.altura === 2 && l.largura === 1), true);

// 4. Endereço sem separar.
const semSeparar = { ...pedido, enderecoImpresso: undefined };
const papelInteiro = entrega(bytes(blocos15, semSeparar));
confere("sem `enderecoImpresso`: \"Endereco: …\" em 1,5x e negrito",
  papelInteiro[0]?.texto.startsWith("Endereco: ") && papelInteiro.every((l) => l.altura === 2 && l.largura === 1 && l.negrito), true);
confere("e quebra igual ao 1x", papelInteiro.map((l) => l.texto), entrega(bytes(blocosFabrica, semSeparar)).map((l) => l.texto));

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
