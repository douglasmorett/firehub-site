/**
 * Teste do app FireHub com impressora Bluetooth: a comanda do celular é a do
 * Assistente (lib/app-firehub/impressao.ts + comanda-escpos.gerado.ts) e o
 * texto do aviso de pedido novo (lib/app-firehub/aviso-de-pedido.ts). Rodar:
 * npx tsx scripts/teste-comanda-do-celular.ts
 */
import fs from "node:fs";
import { trabalhosParaOCelular } from "../src/lib/app-firehub/impressao";
import { textoDoAviso } from "../src/lib/app-firehub/aviso-de-pedido";
// @ts-ignore — .mjs sem tipos
import { gerar, DESTINO } from "./gerar-comanda-do-celular.mjs";

let falhas = 0;
const confere = (nome: string, ok: boolean, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — ${detalhe}`}`);
};
const texto = (b64: string) => Buffer.from(b64, "base64").toString("binary");

// 1. O gerado está em dia com o Assistente.
confere(
  "comanda-escpos.gerado.ts igual ao recorte do server.js (rode node scripts/gerar-comanda-do-celular.mjs)",
  // Sem o \r: no Windows o git devolve os dois arquivos em CRLF.
  fs.readFileSync(DESTINO, "utf8").replace(/\r/g, "") === gerar().replace(/\r/g, ""),
);

const pedido = {
  id: "p1",
  dailyOrderNumber: 47,
  customerName: "Joao",
  deliveryType: "DELIVERY",
  totalAmount: 58.9,
  paymentMethod: "PIX",
  createdAt: new Date().toISOString(),
  items: [
    { name: "X Tudo", quantity: 2, price: 25 },
    { name: "Coca-Cola 2L", quantity: 1, price: 8.9, isBeverage: true },
  ],
};

// 2. Loja sem impressora cadastrada: um papel com o pedido inteiro, 32 colunas no 58 mm.
const [semDestino] = trabalhosParaOCelular([{ id: "job_p1", order: pedido, storeName: "Hakim" }], "58mm");
confere("sem destino: um papel", semDestino?.papeis.length === 1, JSON.stringify(semDestino));
const papel = texto(semDestino.papeis[0]);
confere("papel tem o item", papel.includes("X Tudo"), papel.slice(0, 200));
confere("papel começa com ESC @", papel.charCodeAt(0) === 0x1b && papel[1] === "@", JSON.stringify(papel.slice(0, 4)));
const linhaMaisLarga = Math.max(...papel.split("\n").map((l) => l.replace(/[\x00-\x1f]./g, "").length));
confere("58 mm não passa de 32 colunas", linhaMaisLarga <= 34, `linha com ${linhaMaisLarga}`);

// 3. Com destinos: cada impressora com os itens dela; cópias repetem o papel.
const [comDestinos] = trabalhosParaOCelular([{
  id: "job_p1", order: pedido, storeName: "Hakim",
  destinos: [
    { printer: "Cozinha", items: [pedido.items[0]], copies: 2 },
    { printer: "Bar", items: [pedido.items[1]] },
  ],
}], "80mm");
confere("dois destinos, Cozinha 2 cópias = 3 papéis", comDestinos.papeis.length === 3, String(comDestinos.papeis.length));
confere("papel da cozinha sem a Coca", !texto(comDestinos.papeis[0]).includes("Coca"));
confere("papel do bar com a Coca", texto(comDestinos.papeis[2]).includes("Coca"));

// 4. Impressora só de bebida num pedido sem bebida: nada a imprimir, mas o trabalho volta para o ack.
const [soBebida] = trabalhosParaOCelular([{
  id: "job_p2", order: { ...pedido, items: [pedido.items[0]] }, storeName: "Hakim",
  destinos: [{ printer: "Bar", items: [pedido.items[0]], somenteBebidas: true }],
}], "58mm");
confere("só bebida sem bebida: zero papel, trabalho volta", soBebida?.jobId === "job_p2" && soBebida.papeis.length === 0, JSON.stringify(soBebida));

// 5. Texto do aviso.
const a = textoDoAviso({ dailyOrderNumber: 47, customerName: "Maria", totalAmount: 58.9, deliveryType: "DELIVERY", canal: "iFood" });
confere("título do aviso", a.titulo === "🔔 Pedido novo #47 · iFood", a.titulo);
confere("corpo do aviso", a.corpo === "Maria · R$ 58,90 · Entrega", JSON.stringify(a.corpo));

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo ok");
process.exit(falhas ? 1 : 0);
