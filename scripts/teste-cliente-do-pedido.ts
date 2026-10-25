/**
 * Incluir/corrigir o cliente de um pedido já lançado (lib/cliente-do-pedido.ts).
 *
 *   npx tsx scripts/teste-cliente-do-pedido.ts
 *
 * Divinos Burguer, 24/10/2026: balcão lançado sem cliente, sem como incluir.
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
import {
  descricaoDaMudancaDoCliente, mesmoCliente, motivoParaNaoMudarOCliente, nomeParaGravar, problemaDoCliente, semTelefone, telefoneParaGravar,
} from "../src/lib/cliente-do-pedido";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const dono = { role: "FRANCHISEE", permissions: "" };
const staffSem = { role: "STAFF", permissions: "caixa" };
const balcao = { id: "p1", status: "ACEITO", source: "PRESENCIAL", deliveryType: "RETIRADA", customerName: "Cliente", customerPhone: "00000000000" };

// ── quem pode ──
confere("balcão aceito, dono: pode", motivoParaNaoMudarOCliente(balcao, dono), null);
confere("balcão em preparo: pode", motivoParaNaoMudarOCliente({ ...balcao, status: "EM_PREPARO" }, dono), null);
confere("funcionário sem permissão: não", /permissão/.test(String(motivoParaNaoMudarOCliente(balcao, staffSem))), true);
confere("cancelado: não", /cancelado/i.test(String(motivoParaNaoMudarOCliente({ ...balcao, status: "CANCELADO" }, dono))), true);
confere("mesa: não", /mesa/i.test(String(motivoParaNaoMudarOCliente({ ...balcao, deliveryType: "MESA" }, dono))), true);
confere("mesa pela sessão: não", /mesa/i.test(String(motivoParaNaoMudarOCliente({ ...balcao, tableSessionId: "s1" }, dono))), true);
confere("pedido do iFood: não", /aplicativo/i.test(String(motivoParaNaoMudarOCliente({ ...balcao, source: "IFOOD", deliveryType: "DELIVERY", ifoodOrderId: "x1", ifoodReference: "9999" }, dono))), true);
confere("delivery do site: pode", motivoParaNaoMudarOCliente({ ...balcao, source: "ONLINE", deliveryType: "DELIVERY" }, dono), null);
confere("sem id: não", /não encontrado/i.test(String(motivoParaNaoMudarOCliente({}, dono))), true);

// ── o que se grava ──
confere("nome: espaços juntados", nomeParaGravar("  Maria   da  Silva \n"), "Maria da Silva");
confere("telefone: só dígitos", telefoneParaGravar("(22) 99999-9999"), "22999999999");
confere("telefone zerado do balcão conta como sem telefone", semTelefone("00000000000"), true);
confere("telefone vazio conta como sem telefone", semTelefone(""), true);
confere("telefone de verdade", semTelefone("+55 (21) 97598-9881"), false);

// ── o que a tela aceita ──
confere("tudo em branco: pede", problemaDoCliente("", ""), "Preencha o nome ou o telefone do cliente.");
confere("só o nome serve", problemaDoCliente("Ana", ""), null);
confere("só o telefone serve", problemaDoCliente("", "22999999999"), null);
confere("telefone curto: recusa", /DDD/.test(String(problemaDoCliente("Ana", "9999"))), true);
confere("telefone com 55: aceita", problemaDoCliente("Ana", "5522999999999"), null);
confere("nome de 1 letra: recusa", /nome/i.test(String(problemaDoCliente("A", ""))), true);
confere("nome enorme: recusa", /longo/.test(String(problemaDoCliente("x".repeat(90), ""))), true);

// ── mudou ou não ──
confere("igual: não é mudança", mesmoCliente({ nome: "ana", telefone: "" }, { customerName: "Ana", customerPhone: "22999999999" }), true);
confere("campo em branco não conta como mudança", mesmoCliente({ nome: "", telefone: "22999999999" }, { customerName: "Ana", customerPhone: "(22) 99999-9999" }), true);
confere("telefone novo: é mudança", mesmoCliente({ nome: "", telefone: "22988887777" }, { customerName: "Ana", customerPhone: "22999999999" }), false);
confere("nome novo no balcão sem cliente: é mudança", mesmoCliente({ nome: "Ana", telefone: "" }, { customerName: "Cliente", customerPhone: "00000000000" }), false);

// ── o histórico ──
confere("histórico: sem cliente → Ana · telefone", descricaoDaMudancaDoCliente({ nome: "Ana", telefone: "22999999999" }, { customerName: "Cliente", customerPhone: "00000000000" }), "Cliente (sem cliente) → Ana · 22999999999");
confere("histórico: só trocou o telefone, o nome fica", descricaoDaMudancaDoCliente({ nome: "", telefone: "22988887777" }, { customerName: "Ana", customerPhone: "22999999999" }), "Cliente Ana · 22999999999 → Ana · 22988887777");

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
