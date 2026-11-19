// npx tsx scripts/teste-mensagem-ao-cliente.ts — o texto do WhatsApp do entregador ao cliente (e a cópia do app igual).
import { readFileSync } from "node:fs";
import { mensagemAoCliente } from "../src/lib/app-motoboy/mensagem-ao-cliente";

let falhas = 0;
const caso = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
};

const loja = "Pizzaria Bom Cheff";
caso("Com nome, loja e número", mensagemAoCliente({ cliente: "Maria Souza", loja, numero: "75" }), "Oi, Maria! Aqui é o entregador da Pizzaria Bom Cheff. Seu pedido #75 já está a caminho 🛵");
caso("Nome em maiúsculas", mensagemAoCliente({ cliente: "JOÃO DA SILVA", loja, numero: 12 }), "Oi, João! Aqui é o entregador da Pizzaria Bom Cheff. Seu pedido #12 já está a caminho 🛵");
caso("Sem nome", mensagemAoCliente({ cliente: "", loja, numero: "8" }), "Oi! Aqui é o entregador da Pizzaria Bom Cheff. Seu pedido #8 já está a caminho 🛵");
caso("Cliente iFood não é nome", mensagemAoCliente({ cliente: "Cliente iFood", loja, numero: "8" }), "Oi! Aqui é o entregador da Pizzaria Bom Cheff. Seu pedido #8 já está a caminho 🛵");
caso("Número com # da página web", mensagemAoCliente({ cliente: "Ana", loja, numero: "#" }), "Oi, Ana! Aqui é o entregador da Pizzaria Bom Cheff. Seu pedido já está a caminho 🛵");
caso("Servidor antigo (sem loja)", mensagemAoCliente({ cliente: "Ana", loja: undefined, numero: "8" }), "Olá! Sou o entregador da loja e estou a caminho do seu endereço!");

// A cópia do app nativo tem que ser a mesma função (só o cabeçalho muda).
const corpo = (arq: string) => readFileSync(arq, "utf8").replace(/\r/g, "").split("export function")[1];
caso("Cópia do app igual à do site", corpo("apps/motoboy/src/lib/mensagem-ao-cliente.ts") === corpo("src/lib/app-motoboy/mensagem-ao-cliente.ts"), true);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\ntudo ok");
