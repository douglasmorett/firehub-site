/**
 * A Cotação automática sem banco e sem IA (lib/cotacao):
 * - a agenda: nasce vazia, vários horários, a frase da tela, o horário que
 *   vence agora no fuso da loja (e uma vez só por chave), o próximo horário;
 * - a próxima entrega (dias, prazo, horário limite) e o pedido mínimo;
 * - o casamento do nome do fornecedor com o produto da loja (abreviação,
 *   apelido aprendido, tamanho diferente não casa, dúvida vira sugestão);
 * - o que a IA devolve, limpo; a mensagem sem preço não chama a IA; colar
 *   lista de produtos e de fornecedores;
 * - o comparativo (mais barato, anterior e variação, preço velho, quem não
 *   respondeu, "precisa comprar") e as maiores quedas/altas do resumo;
 * - o pedido agrupado por fornecedor, com mínimo e entrega, e os textos;
 * - a entrada no estoque com o fator da caixa;
 * - o cadastro (WhatsApp normalizado igual ao do cliente);
 * - a cobrança de R$ 97 no mês.
 * Roda: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-cotacao-regras.ts
 */
import assert from "node:assert/strict";
import {
  diasFalados, horaFalada, horarioDevido, normalizarAgenda, proximoHorario, relogioDaLoja, resumoDaAgenda,
} from "../src/lib/cotacao/agenda";
import { faltaParaOMinimo, proximaEntrega } from "../src/lib/cotacao/entrega";
import { casarProduto, normalizarNome, semelhanca } from "../src/lib/cotacao/casamento";
import { lerListaDeFornecedores, lerListaDeProdutos, lerPreco, linhasDaIa, textoTemPreco, unidadeDeCompra } from "../src/lib/cotacao/leitura";
import { fornecedorAtende, maioresVariacoes, montarComparativo, type ProdutoDoComparativo } from "../src/lib/cotacao/comparativo";
import { agruparPedido } from "../src/lib/cotacao/pedido";
import { LINK_DO_COMPARATIVO, saudacao, textoDoPedidoDeCompra, textoDoPedidoDePrecos, textoDoResumo } from "../src/lib/cotacao/mensagens";
import { itensParaOEstoque } from "../src/lib/cotacao/estoque";
import { conferirFornecedor, conferirProduto } from "../src/lib/cotacao/cadastro";
import { valorDaCotacaoNoMes, PRECO_DA_COTACAO, DIAS_DE_TESTE_DA_COTACAO, type TrechoDaCotacao } from "../src/lib/cotacao/assinatura";
import { CLAUSULAS_DO_TERMO_DA_COTACAO } from "../src/lib/cotacao/termo";
import { receitaDoMes, SERVICOS_VAZIOS } from "../src/lib/performance-das-carteiras/regras";

let passou = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  assert.deepEqual(obtido, esperado, nome);
  passou++;
}

const TZ = "America/Sao_Paulo";
/** Uma hora de Brasília (UTC-3, sem horário de verão) como Date. */
const brt = (iso: string) => new Date(`${iso}-03:00`);

// ── Agenda ────────────────────────────────────────────────────────────────
console.log("— Agenda —");
confere("agenda vazia continua vazia", normalizarAgenda([]), []);
confere("lixo vira vazia", normalizarAgenda("x"), []);
confere("horário sem dia sai", normalizarAgenda([{ dias: [], hora: "08:00" }]), []);
confere("hora inválida sai", normalizarAgenda([{ dias: [1], hora: "25:00" }]), []);
confere("mesma hora junta os dias", normalizarAgenda([{ dias: [4], hora: "8:00" }, { dias: [1, 4], hora: "08:00" }]), [{ dias: [1, 4], hora: "08:00" }]);
confere("dois horários, em ordem", normalizarAgenda([{ dias: [6], hora: "14:30" }, { dias: [1, 4], hora: "08:00" }]).map((h) => h.hora), ["08:00", "14:30"]);
confere("8h", horaFalada("08:00"), "8h");
confere("14h30", horaFalada("14:30"), "14h30");
confere("segunda e quinta", diasFalados([4, 1]), "toda segunda e quinta");
confere("dias úteis", diasFalados([1, 2, 3, 4, 5]), "de segunda a sexta");
confere("todo dia", diasFalados([0, 1, 2, 3, 4, 5, 6]), "todo dia");
confere("segunda e sábado", diasFalados([1, 6]), "toda segunda e todo sábado");
confere("frase de segunda e quinta às 8h",
  resumoDaAgenda([{ dias: [1, 4], hora: "08:00" }], "Pizzaria do Zé"),
  "Toda segunda e quinta às 8h a Pizzaria do Zé pede os preços aos fornecedores.");
confere("frase com dois horários",
  resumoDaAgenda([{ dias: [1, 4], hora: "08:00" }, { dias: [6], hora: "14:30" }], "Hakim"),
  "Toda segunda e quinta às 8h e todo sábado às 14h30 a Hakim pede os preços aos fornecedores.");
assert.match(resumoDaAgenda([], "Hakim"), /Pedir cotação agora/);
passou++;

// 09/11/2026 é segunda-feira.
confere("relógio da loja em Brasília", relogioDaLoja(new Date("2026-11-09T11:05:00Z"), TZ), { dia: "2026-11-09", diaDaSemana: 1, minutos: 8 * 60 + 5 });
const agenda = [{ dias: [1, 4], hora: "08:00" }];
confere("7h59 de segunda: ainda não", horarioDevido(agenda, brt("2026-11-09T07:59:00"), TZ), null);
confere("8h00 de segunda: vence", horarioDevido(agenda, brt("2026-11-09T08:00:00"), TZ), "2026-11-09 08:00");
confere("8h40: ainda dentro da janela, a mesma chave", horarioDevido(agenda, brt("2026-11-09T08:40:00"), TZ), "2026-11-09 08:00");
confere("9h01: passou da janela, não manda o bom dia atrasado", horarioDevido(agenda, brt("2026-11-09T09:01:00"), TZ), null);
confere("terça 8h: não é dia", horarioDevido(agenda, brt("2026-11-10T08:00:00"), TZ), null);
confere("o servidor em UTC não adianta 3 h (5h de Brasília = 8h UTC)", horarioDevido(agenda, new Date("2026-11-09T08:00:00Z"), TZ), null);
confere("fuso de Manaus (UTC-4)", horarioDevido(agenda, new Date("2026-11-09T12:00:00Z"), "America/Manaus"), "2026-11-09 08:00");
confere("fuso inválido cai em Brasília", horarioDevido(agenda, brt("2026-11-09T08:00:00"), "Lua/Crateras"), "2026-11-09 08:00");
confere("próximo depois de segunda 9h = quinta 8h", proximoHorario(agenda, brt("2026-11-09T09:00:00"), TZ), { dia: "2026-11-12", diaDaSemana: 4, hora: "08:00" });
confere("próximo de segunda 7h = hoje 8h", proximoHorario(agenda, brt("2026-11-09T07:00:00"), TZ), { dia: "2026-11-09", diaDaSemana: 1, hora: "08:00" });
confere("sem agenda, sem próximo", proximoHorario([], brt("2026-11-09T07:00:00"), TZ), null);

// ── Entrega e mínimo ──────────────────────────────────────────────────────
console.log("— Entrega —");
const regra = { diasDeEntrega: [2, 5], prazoEntregaDias: 1, horarioLimite: "16:00" };
confere("pedido segunda 10h, entrega ter/sex, prazo 1 = terça", proximaEntrega(regra, brt("2026-11-09T10:00:00"), TZ).texto, "amanhã, 10/11");
confere("pedido segunda 17h (passou do limite) = sexta", proximaEntrega(regra, brt("2026-11-09T17:00:00"), TZ).texto, "sexta, 13/11");
confere("sem dias e sem prazo = amanhã", proximaEntrega({ diasDeEntrega: [], prazoEntregaDias: null, horarioLimite: null }, brt("2026-11-09T10:00:00"), TZ).dia, "2026-11-10");
confere("prazo 0, entrega todo dia = hoje", proximaEntrega({ diasDeEntrega: [], prazoEntregaDias: 0, horarioLimite: null }, brt("2026-11-09T10:00:00"), TZ).texto, "hoje, 09/11");
confere("falta R$ 50 para o mínimo de 300", faltaParaOMinimo(250, 300), 50);
confere("sem mínimo, não falta nada", faltaParaOMinimo(10, null), 0);
confere("passou do mínimo", faltaParaOMinimo(400, 300), 0);

// ── Casamento de nomes ────────────────────────────────────────────────────
console.log("— Casamento —");
const produtos = [
  { id: "mus", nome: "Queijo mussarela", apelidos: [] as string[] },
  { id: "coca-lata", nome: "Coca-Cola lata 350ml", apelidos: [] },
  { id: "coca-2l", nome: "Coca-Cola 2L", apelidos: [] },
  { id: "tomate", nome: "Tomate", apelidos: [] },
  { id: "calab", nome: "Calabresa", apelidos: ["LINGUICA CALAB SADIA"] },
];
confere("abreviação aberta", normalizarNome("QJO MUSS"), "queijo mussarela");
const muss = casarProduto("QJO MUSS PEÇA KG", produtos);
confere("QJO MUSS PEÇA KG = mussarela, com certeza", [muss?.produtoId, muss?.certo], ["mus", true]);
confere("muçarela com cedilha casa", casarProduto("Mussarela", produtos)?.produtoId, "mus");
confere("tomate italiano casa com tomate", casarProduto("Tomate italiano", produtos)?.produtoId, "tomate");
const lata = casarProduto("Coca Cola Lata 350 ml", produtos);
confere("coca lata vai para a lata, não para a 2L", lata?.produtoId, "coca-lata");
confere("número diferente derruba: 2L não é 350ml", semelhanca("Coca-Cola 2L", "Coca-Cola lata 350ml") < 0.6, true);
const coca = casarProduto("Coca-Cola", produtos);
confere("\"Coca-Cola\" sozinho: sugestão, nunca certeza (lata ou 2L?)", coca?.certo, false);
confere("apelido aprendido = certeza", casarProduto("Linguiça calab. Sadia", produtos), { produtoId: "calab", confianca: 1, certo: true });
confere("nada parecido = nulo", casarProduto("Detergente Ypê", produtos), null);

// ── O que entra como texto ────────────────────────────────────────────────
console.log("— Leitura —");
confere("preço em texto", lerPreco("R$ 42,90"), 42.9);
confere("preço com milhar", lerPreco("1.250,00"), 1250);
confere("preço zero não é preço", lerPreco("0"), null);
confere("unidade: caixa → cx", unidadeDeCompra("Caixa"), "cx");
confere("unidade: KG → kg", unidadeDeCompra("KG"), "kg");
confere("linhas da IA conferidas", linhasDaIa({ itens: [
  { nome: "Tomate", unidade: "kg", preco: "7,50", validade: null },
  { nome: "Sem preço", unidade: "un", preco: null },
  { nome: "", preco: 3 },
  { nome: "tomate", unidade: "kg", preco: 7.2, validade: "até 10/11" },
] }), [{ nome: "tomate", unidade: "kg", preco: 7.2, validade: "até 10/11" }]);
confere("lixo da IA = nada", linhasDaIa("x"), []);
confere("\"bom dia\" não chama a IA", textoTemPreco("Bom dia! Tudo certo por aí?"), false);
confere("\"ok, amanhã entrego\" não chama a IA", textoTemPreco("ok, amanhã entrego"), false);
confere("tabela com R$ chama", textoTemPreco("Tomate R$ 7,50"), true);
confere("tabela com centavos chama", textoTemPreco("tomate 7,50\ncebola 4,20"), true);
confere("lista sem centavos, várias linhas com número, chama", textoTemPreco("tomate 7\ncebola 4\nbatata 5"), true);
confere("colar lista de produtos", lerListaDeProdutos("HORTIFRUTI:\n- Tomate kg 10\n2) Cebola - kg - 5\n\nBEBIDAS:\n10 cx Coca-Cola lata 350ml\nGuardanapo"), [
  { nome: "Tomate", unidade: "kg", quantidade: 10, categoria: "HORTIFRUTI" },
  { nome: "Cebola", unidade: "kg", quantidade: 5, categoria: "HORTIFRUTI" },
  { nome: "Coca-Cola lata 350ml", unidade: "cx", quantidade: 10, categoria: "BEBIDAS" },
  { nome: "Guardanapo", unidade: "un", quantidade: null, categoria: "BEBIDAS" },
]);
confere("colar lista de fornecedores", lerListaDeFornecedores("Hortifruti Silva - (22) 99999-8888 - João\nAtacadão 21 3333-4444\nDistribuidora Sem Telefone"), [
  { nome: "Hortifruti Silva", telefone: "22999998888", contato: "João" },
  { nome: "Atacadão", telefone: "2133334444", contato: null },
  { nome: "Distribuidora Sem Telefone", telefone: null, contato: null },
]);

// ── Comparativo ───────────────────────────────────────────────────────────
console.log("— Comparativo —");
const AGORA = brt("2026-11-09T12:00:00");
const p = (id: string, nome: string, extra: Partial<ProdutoDoComparativo> = {}): ProdutoDoComparativo => ({
  id, nome, categoria: null, unidade: "kg", quantidadePadrao: null, saldo: null, minimo: null, unidadeDoInsumo: null, ...extra,
});
const ps = [p("tomate", "Tomate", { saldo: 2, minimo: 5, quantidadePadrao: 10 }), p("cebola", "Cebola"), p("mus", "Mussarela", { saldo: 20, minimo: 5 })];
const fs = [{ id: "A", nome: "Hortifruti A", categorias: [] }, { id: "B", nome: "Ceasa B", categorias: [] }, { id: "C", nome: "Frios C", categorias: ["Frios"] }];
const precos = [
  { fornecedorId: "A", produtoId: "tomate", preco: 8, em: "2026-11-05T12:00:00.000Z", validade: null },
  { fornecedorId: "A", produtoId: "tomate", preco: 7.5, em: "2026-11-09T11:00:00.000Z", validade: null },
  { fornecedorId: "B", produtoId: "tomate", preco: 7.9, em: "2026-11-09T11:30:00.000Z", validade: "até 10/11" },
  // Tabela velha (40 dias) e mais barata: aparece, mas não ganha do preço de hoje.
  { fornecedorId: "C", produtoId: "tomate", preco: 5, em: "2026-09-30T12:00:00.000Z", validade: null },
  { fornecedorId: "B", produtoId: "cebola", preco: 4, em: "2026-11-01T12:00:00.000Z", validade: null },
  { fornecedorId: "B", produtoId: "cebola", preco: 4.6, em: "2026-11-09T11:30:00.000Z", validade: null },
];
const c = montarComparativo(ps, fs, precos, { pedidosA: ["A", "B", "C"], responderam: ["A", "B"] }, AGORA);
const tomate = c.linhas.find((l) => l.produto.id === "tomate")!;
confere("tomate: o mais barato recente é o A", tomate.menor, { fornecedorId: "A", preco: 7.5 });
confere("tomate no A: anterior 8, caiu 6,25%", [tomate.precos.A.anterior, tomate.precos.A.variacao], [8, -0.062]);
confere("tomate no C: velho", tomate.precos.C.velho, true);
confere("tomate: economia entre o mais caro e o mais barato recentes", tomate.economia, 0.4);
confere("tomate abaixo do mínimo = precisa comprar", tomate.precisaComprar, true);
confere("mussarela acima do mínimo = não precisa", c.linhas.find((l) => l.produto.id === "mus")!.precisaComprar, false);
confere("mussarela sem preço: sem mais barato", c.linhas.find((l) => l.produto.id === "mus")!.menor, null);
confere("quem respondeu e quem não", c.colunas.map((x) => [x.id, x.respondeu]), [["A", true], ["B", true], ["C", false]]);
confere("última atualização do B", c.colunas.find((x) => x.id === "B")!.ultimaAtualizacao, "2026-11-09T11:30:00.000Z");
const sem = montarComparativo(ps, fs, precos, null, AGORA);
confere("sem rodada, ninguém está \"sem responder\"", sem.colunas.map((x) => x.respondeu), [null, null, null]);
const v = maioresVariacoes(c, "2026-11-09T00:00:00.000Z");
confere("o resumo: caiu o tomate, subiu a cebola", [v.quedas.map((x) => x.nome), v.altas.map((x) => x.nome)], [["Tomate"], ["Cebola"]]);
confere("fornecedor de frios não atende hortifruti", fornecedorAtende({ categorias: ["Frios"] }, "Hortifruti"), false);
confere("fornecedor sem categoria atende tudo", fornecedorAtende({ categorias: [] }, "Hortifruti"), true);

// ── Pedido ────────────────────────────────────────────────────────────────
console.log("— Pedido —");
const fornecedoresDoPedido = [
  { id: "A", nome: "Hortifruti A", contato: "joão silva", pedidoMinimo: 100, diasDeEntrega: [2, 5], prazoEntregaDias: 1, horarioLimite: "16:00" },
  { id: "B", nome: "Ceasa B", contato: null, pedidoMinimo: null, diasDeEntrega: [], prazoEntregaDias: null, horarioLimite: null },
];
const grupos = agruparPedido([
  { produtoId: "tomate", fornecedorId: "A", quantidade: 10, preco: 7.5 },
  { produtoId: "tomate", fornecedorId: "A", quantidade: 2, preco: 7.5 },
  { produtoId: "cebola", fornecedorId: "B", quantidade: 5, preco: 4.6 },
  { produtoId: "mus", fornecedorId: "B", quantidade: 3, preco: null },
  { produtoId: "tomate", fornecedorId: "X", quantidade: 1, preco: 1 },
  { produtoId: "cebola", fornecedorId: "A", quantidade: 0, preco: 4 },
], [{ id: "tomate", nome: "Tomate", unidade: "kg" }, { id: "cebola", nome: "Cebola", unidade: "kg" }, { id: "mus", nome: "Mussarela", unidade: "kg" }],
fornecedoresDoPedido, AGORA, TZ);
confere("dois fornecedores (o desconhecido e a quantidade zero saem)", grupos.map((g) => g.fornecedor.id), ["A", "B"]);
confere("o mesmo item duas vezes soma", grupos[0].itens.map((i) => [i.nome, i.quantidade, i.subtotal]), [["Tomate", 12, 90]]);
confere("A: R$ 90, faltam R$ 10 para o mínimo de 100", [grupos[0].total, grupos[0].falta], [90, 10]);
confere("A: entrega terça", grupos[0].entrega.texto, "amanhã, 10/11");
confere("B: item sem preço contado à parte", [grupos[1].total, grupos[1].semPreco], [23, 1]);

// ── Mensagens ─────────────────────────────────────────────────────────────
console.log("— Mensagens —");
confere("bom dia / boa tarde / boa noite", [saudacao(8 * 60), saudacao(13 * 60), saudacao(19 * 60)], ["Bom dia", "Boa tarde", "Boa noite"]);
const pedidoDePreco = textoDoPedidoDePrecos({ loja: "Pizzaria do Zé", contato: "joão silva", itens: ["Tomate", "Cebola"], minutos: 8 * 60 });
confere("pedido de preços curto, com a loja e o contato",
  pedidoDePreco,
  "Bom dia, João! Aqui é da Pizzaria do Zé 😊\nPode me mandar a tabela de preços atualizada ou o encarte da semana?\nItens que estamos cotando: tomate, cebola.\nObrigado!");
confere("até 4 linhas", pedidoDePreco.split("\n").length <= 4, true);
confere("pedido de preços sem robô nem IA", /rob[oô]|intelig|autom/i.test(pedidoDePreco) || /\bIA\b/.test(pedidoDePreco), false);
const muitos = textoDoPedidoDePrecos({ loja: "X", contato: null, itens: Array.from({ length: 20 }, (_, i) => `Item ${i}`), minutos: 600 });
assert.match(muitos, /e mais 8\./);
passou++;
const textoPedido = textoDoPedidoDeCompra({ loja: "Pizzaria do Zé", grupo: grupos[0], minutos: 14 * 60 });
assert.match(textoPedido, /^Boa tarde, João! Aqui é da Pizzaria do Zé\. Segue o nosso pedido:/);
assert.match(textoPedido, /• 12 kg Tomate — R\$\s7,50/);
assert.match(textoPedido, /Total: R\$\s90,00/);
assert.match(textoPedido, /Entrega: amanhã, 10\/11\./);
passou += 4;
assert.match(textoDoPedidoDeCompra({ loja: "Z", grupo: grupos[1], minutos: 600 }), /me confirma o preço dos outros/);
passou++;
const resumo = textoDoResumo({ loja: "Pizzaria do Zé", responderam: 2, pedidos: 3, quedas: [{ nome: "Tomate", de: 8, para: 7.5 }], altas: [], paraConferir: 1 });
const linhasDoResumo = resumo.split("\n");
confere("o link vai sozinho na última linha", linhasDoResumo[linhasDoResumo.length - 1], LINK_DO_COMPARATIVO);
confere("nada colado no link", /\*|[.,;:!]$/.test(LINK_DO_COMPARATIVO), false);
assert.match(resumo, /2 de 3 fornecedores responderam/);
assert.match(resumo, /1 preço para você conferir/);
passou += 2;

// ── Estoque ───────────────────────────────────────────────────────────────
console.log("— Estoque —");
const entrada = itensParaOEstoque(
  [
    { produtoId: "coca", nome: "Coca lata", unidade: "cx", quantidade: 2, preco: 36 },
    { produtoId: "tomate", nome: "Tomate", unidade: "kg", quantidade: 5, preco: 7.5 },
    { produtoId: "guard", nome: "Guardanapo", unidade: "pct", quantidade: 3, preco: 4 },
    { produtoId: "solto", nome: "Sem insumo", unidade: "un", quantidade: 1, preco: 1 },
  ],
  [
    { id: "coca", stockItemId: "i-coca", fatorDoInsumo: 12 },
    { id: "tomate", stockItemId: "i-tomate", fatorDoInsumo: null },
    { id: "guard", stockItemId: "i-guard", fatorDoInsumo: null },
    { id: "solto", stockItemId: null, fatorDoInsumo: null },
  ],
  [{ id: "i-coca", unit: "un" }, { id: "i-tomate", unit: "g" }, { id: "i-guard", unit: "un" }],
);
confere("2 cx × 12 = 24 un, valor da linha inteiro", entrada.itens[0], { stockItemId: "i-coca", nome: "Coca lata", quantidade: 24, unidade: "un", valorTotal: 72 });
confere("kg para insumo em g: a conversão fica com o lançamento de compra", entrada.itens[1], { stockItemId: "i-tomate", nome: "Tomate", quantidade: 5, unidade: "kg", valorTotal: 37.5 });
confere("pacote para un, sem fator: fora, com o porquê", entrada.fora.length, 2);
assert.match(entrada.fora[0], /Guardanapo .*quantos un vêm em 1 pct/);
assert.match(entrada.fora[1], /não está ligado/);
passou += 2;

// ── Cadastro ──────────────────────────────────────────────────────────────
console.log("— Cadastro —");
const f1 = conferirFornecedor({ nome: "  Hortifruti   Silva ", telefone: "(22) 99999-8888", pedidoMinimo: "150,00", diasDeEntrega: [5, 2, 2, 9], prazoEntregaDias: "1", horarioLimite: "16:00" });
confere("WhatsApp para enviar e canônico para comparar", f1.ok && [f1.dados.nome, f1.dados.telefone, f1.dados.telefoneCanonico, f1.dados.pedidoMinimo, f1.dados.diasDeEntrega],
  ["Hortifruti Silva", "5522999998888", "2299998888", 150, [2, 5]]);
const f2 = conferirFornecedor({ nome: "Outro", telefone: "5522999998888" });
confere("o mesmo número com 55 dá o mesmo canônico", f2.ok && f2.dados.telefoneCanonico, "2299998888");
confere("telefone sem DDD recusa", conferirFornecedor({ nome: "X", telefone: "99999-8888" }).ok, false);
confere("sem nome recusa", conferirFornecedor({ nome: "  " }).ok, false);
confere("horário limite inválido recusa", conferirFornecedor({ nome: "X", horarioLimite: "16h" }).ok, false);
confere("fornecedor sem WhatsApp pode (cadastro primeiro, número depois)", conferirFornecedor({ nome: "X" }).ok, true);
const pr = conferirProduto({ nome: "Coca lata", unidade: "Caixa", quantidadePadrao: "2", fatorDoInsumo: "12" });
confere("produto: unidade e fator", pr.ok && [pr.dados.unidade, pr.dados.quantidadePadrao, pr.dados.fatorDoInsumo], ["cx", 2, 12]);

// ── Cobrança ──────────────────────────────────────────────────────────────
console.log("— Cobrança —");
confere("R$ 97, 7 dias", [PRECO_DA_COTACAO, DIAS_DE_TESTE_DA_COTACAO], [97, 7]);
const t = (de: string, ate: string | null): TrechoDaCotacao => ({ de, ate, valor: 97 });
const ini = new Date("2026-11-01T03:00:00Z"), fim = new Date("2026-12-01T03:00:00Z"), agora = new Date("2026-11-25T12:00:00Z");
confere("ligado o mês todo depois do teste: 97", valorDaCotacaoNoMes([t("2026-10-01T12:00:00Z", null)], null, ini, fim, agora), 97);
confere("teste até 10/11 e continuou: novembro inteiro", valorDaCotacaoNoMes([t("2026-11-03T12:00:00Z", null)], "2026-11-10T12:00:00Z", ini, fim, agora), 97);
confere("desligou dentro do teste: nada", valorDaCotacaoNoMes([t("2026-11-03T12:00:00Z", "2026-11-06T12:00:00Z")], "2026-11-10T12:00:00Z", ini, fim, agora), 0);
confere("ligou e desligou duas vezes: uma vez só", valorDaCotacaoNoMes([t("2026-11-12T12:00:00Z", "2026-11-13T12:00:00Z"), t("2026-11-20T12:00:00Z", null)], "2026-11-01T00:00:00Z", ini, fim, agora), 97);
confere("o termo diz o preço e o WhatsApp da loja", [CLAUSULAS_DO_TERMO_DA_COTACAO.some((x) => /R\$\s97,00/.test(x)), CLAUSULAS_DO_TERMO_DA_COTACAO.some((x) => /WhatsApp da MINHA loja/.test(x))], [true, true]);
const receita = receitaDoMes(null, { ...SERVICOS_VAZIOS, cotacao: 97 }, false);
confere("a carteira do vendedor conta a cotação no boleto previsto", [receita.boleto, receita.servicos.cotacao], [97, 97]);

console.log(`\n✅ ${passou} conferências passaram.`);
