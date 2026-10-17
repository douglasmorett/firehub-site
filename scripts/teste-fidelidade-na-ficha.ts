/**
 * Trilha Premiada e cartão de carimbos na ficha do cliente (aba Clientes):
 * o número da ficha tem de ser o que o cliente vê no cardápio.
 *
 *   npx tsx scripts/teste-fidelidade-na-ficha.ts
 *
 * Prova, sem banco:
 * 1) carimbos — a regra de lib/carimbos.ts (desde 17/10/2026 o prêmio entra no
 *    pedido; a prova do prêmio é scripts/teste-carimbos-premio.ts): mínimo,
 *    status, cartela completa, prêmio a receber e usado, configuração com zero;
 * 2) trilha — janela, canais, próxima parada, depois da última parada, prêmio a
 *    receber, e a ficha igual ao que o cardápio recebe (resumoDaTrilha);
 * 3) a busca por telefone pelos 8 últimos dígitos (lib/pedidos-do-telefone.ts);
 * 4) o exemplo real: Karin, Pizzaria Lapastine (16/10/2026).
 */
import { carimbosDoCliente, contarCarimbos, ganhaCarimbo, lerCarimbos, minimoDosCarimbos, premioDosCarimbos } from "../src/lib/carimbos";
import { carimbosNaFicha, trilhaNaFicha } from "../src/lib/fidelidade-na-ficha";
import { finalDoTelefone, mesmoTelefoneDoCardapio } from "../src/lib/pedidos-do-telefone";
import { lerTrilha, resumoDaTrilha } from "../src/lib/trilha-premiada";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// A configuração real da Lapastine (User.storeLoyalty, lida no Neon em 16/10/2026).
const LAPASTINE = {
  stampsActive: true, stampGoal: 10, stampMinOrder: 43, stampRewardType: "discount", stampRewardValue: 50,
  trilha: {
    ativa: true, janelaDias: 60,
    canais: { mesa: false, totem: false, balcao: false, whatsapp: true, marketplace: false },
    paradas: [
      { tipo: "frete", pedidos: 5 },
      { tipo: "produto", pedidos: 12, produtoId: "prd_f84npgeel9692o", produtoNome: "GUARANA TUCHAUA 1 LT" },
      { tipo: "desconto", valor: 10, pedidos: 20 },
      { tipo: "frete", pedidos: 25 },
      { tipo: "produto", pedidos: 30, produtoId: "prd_1ojjotwdkq6sk4", produtoNome: "PIZZA BACON COM CALABRESA" },
    ],
  },
};

// ── 1) Carimbos ──────────────────────────────────────────────────────────────
// Desde 17/10/2026 a conta mudou de propósito (o prêmio entra sozinho no pedido,
// lib/carimbos.ts): histórico em vez dos 10 de "Meus pedidos", status e canal
// como a trilha, e o zero da configuração vale. O prêmio no pedido tem a prova
// própria em scripts/teste-carimbos-premio.ts; aqui, o que a ficha mostra.
console.log("\n1) Carimbos: a ficha mostra o cartão que o cardápio recebe");

const regra = lerCarimbos(LAPASTINE);
const pedido = (totalAmount: number, status = "ENTREGUE", extra: Record<string, unknown> = {}) => ({ status, totalAmount, source: "ONLINE", ...extra });
confere("abaixo do mínimo (R$ 42,99 com mínimo R$ 43) não ganha carimbo", ganhaCarimbo(pedido(42.99), regra), false);
confere("no mínimo exato (R$ 43,00) ganha", ganhaCarimbo(pedido(43), regra), true);
confere("cancelado (qualquer grafia), recusado, rascunho e Pix esperando pagamento não ganham",
  ["CANCELADO", "CANCELLED", "CANCELED", "RECUSADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"].map((st) => ganhaCarimbo(pedido(134, st), regra)),
  [false, false, false, false, false, false]);
confere("3 que contam + 1 abaixo + 1 cancelado = 3 de 10, faltam 7",
  contarCarimbos(regra, [pedido(57.5), pedido(134), pedido(81), pedido(20), pedido(90, "CANCELADO")]),
  { validos: 3, noCartao: 3, faltam: 7, completas: 0, usados: 0, aReceber: 0, acabouDeCompletar: false });
const dez = Array.from({ length: 10 }, () => pedido(50));
confere("10 que contam: o cartão volta a 0 de 10, 1 cartela completa e 1 prêmio a receber",
  contarCarimbos(regra, dez), { validos: 10, noCartao: 0, faltam: 10, completas: 1, usados: 0, aReceber: 1, acabouDeCompletar: true });
confere("sem pedido nenhum: 0 de 10, nada completo", contarCarimbos(regra, []),
  { validos: 0, noCartao: 0, faltam: 10, completas: 0, usados: 0, aReceber: 0, acabouDeCompletar: false });
confere("a configuração salva vale: mínimo 0 = qualquer pedido, prêmio 0 = R$ 0 (e o cartão sai do ar)",
  (({ meta, pedidoMinimo, premioValor }) => ({ meta, pedidoMinimo, premioValor }))(lerCarimbos({ stampsActive: true, stampMinOrder: 0, stampRewardValue: 0 })),
  { meta: 10, pedidoMinimo: 0, premioValor: 0 });
confere("campo nunca salvo herda o padrão do formulário (R$ 30 / R$ 25)",
  (({ pedidoMinimo, premioValor }) => ({ pedidoMinimo, premioValor }))(lerCarimbos({ stampsActive: true })), { pedidoMinimo: 30, premioValor: 25 });
confere("meta quebrada no banco não divide por zero", lerCarimbos({ stampGoal: -3 }).meta, 10);
confere("textos da ficha: prêmio e mínimo", [premioDosCarimbos(regra), minimoDosCarimbos(regra)], ["R$ 50,00 de desconto", "pedido a partir de R$ 43,00"]);
confere("carimbos desligados: a ficha não mostra o bloco", carimbosNaFicha({ ...LAPASTINE, stampsActive: false }, [pedido(50)]), null);
confere("prêmio R$ 0 (Point da Pizza): o cartão não está no ar, a ficha não mostra o bloco",
  carimbosNaFicha({ ...LAPASTINE, stampRewardValue: 0 }, [pedido(50)]), null);
const fichaDez = carimbosNaFicha(LAPASTINE, dez)!;
confere("10 que contam: a ficha mostra 1 prêmio a receber, nenhum usado",
  [fichaDez.completas, fichaDez.aReceber, fichaDez.usados, fichaDez.acabouDeCompletar], [1, 1, 0, true]);
const usado = { programa: "carimbos", cartela: 1, tipo: "discount", valor: 50, valorAplicado: 50, descricao: "R$ 50,00 de desconto", em: "" };
const fichaUsou = carimbosNaFicha(LAPASTINE, [pedido(80, "ENTREGUE", { carimboPremio: usado }), ...dez])!;
confere("o 11º pedido usou o prêmio: 1 de 10, nada a receber, 1 usado",
  [fichaUsou.noCartao, fichaUsou.aReceber, fichaUsou.usados], [1, 0, 1]);

// ── 2) Trilha ────────────────────────────────────────────────────────────────
console.log("\n2) Trilha: a mesma conta do cardápio e do prêmio do pedido");

const T0 = Date.parse("2026-08-01T20:00:00Z");
const DIA = 86_400_000;
let seq = 0;
const ped = (dia: number, extra: Record<string, unknown> = {}) => ({ id: `p${++seq}`, createdAt: new Date(T0 + dia * DIA), status: "ENTREGUE", source: "ONLINE", ...extra });
const agoraEm = (dia: number) => new Date(T0 + dia * DIA);

let t = trilhaNaFicha(LAPASTINE, [ped(0), ped(1), ped(2)], agoraEm(3))!;
confere("3 pedidos do site: 3 passos, faltam 2 para o frete grátis do 5º",
  [t.passos, t.faltam, t.proxima, t.alcancada], [3, 2, { pedidos: 5, premio: "Frete grátis" }, null]);
confere("as paradas na ordem, a próxima marcada",
  t.paradas.map((p) => `${p.pedidos}:${p.situacao}:${p.premio}`),
  ["5:proxima:Frete grátis", "12:adiante:GUARANA TUCHAUA 1 LT", "20:adiante:10% de desconto", "25:adiante:Frete grátis", "30:adiante:PIZZA BACON COM CALABRESA"]);
confere("a bandeira é o 30º pedido; prazo de 60 dias vence 60 dias depois do 1º pedido",
  [t.tamanho, t.janelaDias, t.cicloExpiraEm], [30, 60, new Date(T0 + 60 * DIA).toISOString()]);
confere("onde conta: o que a loja ligou", t.ondeConta, "Contam os pedidos feitos pelo site e pelo WhatsApp. Pedido por iFood ou 99Food não anda na trilha.");

const canais = [
  ped(0), ped(1),
  ped(2, { source: "WHATSAPP_IA" }), // WhatsApp ligado: conta
  ped(3, { source: "PRESENCIAL" }), // balcão desligado: não conta
  ped(4, { source: "IFOOD", ifoodOrderId: "x" }), // marketplace desligado: não conta
  ped(5, { tableSessionId: "mesa1", source: "PRESENCIAL" }), // mesa desligada: não conta
  ped(6, { status: "CANCELADO" }), // cancelado nunca conta
  ped(7, { status: "CRIANDO_IA", source: "WHATSAPP_IA" }), // rascunho do robô não conta
];
confere("canais: site sempre, WhatsApp ligado conta; balcão, iFood, mesa, cancelado e rascunho não", trilhaNaFicha(LAPASTINE, canais, agoraEm(8))!.passos, 3);
const tudoLigado = { ...LAPASTINE, trilha: { ...LAPASTINE.trilha, canais: { mesa: true, totem: true, balcao: true, whatsapp: true, marketplace: true } } };
confere("com todos os canais ligados, balcão, iFood e mesa contam", trilhaNaFicha(tudoLigado, canais, agoraEm(8))!.passos, 6);

const cinco = [0, 1, 2, 3, 4].map((d) => ped(d));
t = trilhaNaFicha(LAPASTINE, cinco, agoraEm(5))!;
confere("no 5º pedido: frete conquistado, próxima o guaraná do 12º (faltam 7), prêmio a receber",
  [t.passos, t.alcancada?.premio, t.proxima?.pedidos, t.faltam, t.premioAReceber, t.premiosNaFila, t.paradas[0].situacao],
  [5, "Frete grátis", 12, 7, "Frete grátis", 1, "conquistada"]);
const resgatado = [...cinco, ped(6, { trilhaPremio: { pedidos: 5, tipo: "frete", valorAplicado: 8, descricao: "Frete grátis", em: "" } })];
t = trilhaNaFicha(LAPASTINE, resgatado, agoraEm(7))!;
confere("o 6º pedido usou o frete: nada a receber, 6 passos", [t.passos, t.premioAReceber, t.premiosNaFila], [6, null, 0]);

// Janela de 60 dias.
t = trilhaNaFicha(LAPASTINE, [ped(0), ped(10), ped(59)], agoraEm(59.5))!;
confere("dentro dos 60 dias tudo conta", t.passos, 3);
t = trilhaNaFicha(LAPASTINE, [ped(0), ped(10), ped(61)], agoraEm(62))!;
confere("pedido depois do prazo abre ciclo novo: 1 passo, vence 60 dias depois dele",
  [t.passos, t.prazoVenceu, t.cicloExpiraEm], [1, false, new Date(T0 + 121 * DIA).toISOString()]);
t = trilhaNaFicha(LAPASTINE, [ped(0), ped(10)], agoraEm(61))!;
confere("prazo vencido sem pedido novo: zero passos, a ficha diz que venceu",
  [t.passos, t.prazoVenceu, t.cicloExpiraEm, t.proxima?.pedidos, t.faltam], [0, true, null, 5, 5]);
const semPrazo = { ...LAPASTINE, trilha: { ...LAPASTINE.trilha, janelaDias: 0 } };
t = trilhaNaFicha(semPrazo, [ped(0), ped(200), ped(400)], agoraEm(500))!;
confere("janela 0 = sem prazo: pedidos de um ano e pouco somam", [t.passos, t.janelaDias, t.cicloExpiraEm, t.prazoVenceu], [3, 0, null, false]);
confere("janela vazia (\"\") também é sem prazo", lerTrilha({ trilha: { ...LAPASTINE.trilha, janelaDias: "" } }).janelaDias, 0);

// Depois da última parada.
const trinta = Array.from({ length: 30 }, (_, i) => ped(i * 0.5));
t = trilhaNaFicha(LAPASTINE, trinta, agoraEm(16))!;
confere("no 30º pedido: completou, sem próxima, todas conquistadas",
  [t.passos, t.completou, t.proxima, t.faltam, t.paradas.every((p) => p.situacao === "conquistada")], [30, true, null, 0, true]);
t = trilhaNaFicha(LAPASTINE, [...trinta, ped(16)], agoraEm(17))!;
confere("o 31º pedido recomeça a trilha: 1 passo, próxima o frete do 5º", [t.passos, t.completou, t.proxima?.pedidos, t.faltam], [1, false, 5, 4]);
confere("os prêmios das 5 paradas continuam a receber (nenhum foi usado)", t.premiosNaFila, 5);

// A ficha é o que o cardápio recebe.
const lista = [ped(0), ped(1, { source: "WHATSAPP_IA" }), ped(2), ped(3), ped(4), ped(5, { source: "PRESENCIAL" })];
const doCardapio = resumoDaTrilha(lerTrilha(LAPASTINE), lista, agoraEm(6));
t = trilhaNaFicha(LAPASTINE, lista, agoraEm(6))!;
confere("ficha = cardápio (passos, faltam, próxima, chamada, prêmio, fila)",
  [t.passos, t.faltam, t.proxima?.pedidos, t.chamada, t.premioAReceber, t.premiosNaFila],
  [doCardapio.passos, doCardapio.faltam, doCardapio.proxima?.pedidos, doCardapio.chamada, "Frete grátis", doCardapio.premiosNaFila]);
confere("trilha desligada: a ficha não mostra o bloco", trilhaNaFicha({ ...LAPASTINE, trilha: { ...LAPASTINE.trilha, ativa: false } }, lista), null);
confere("parada de produto sem produto escolhido: a trilha não está no ar (nem no cardápio)",
  trilhaNaFicha({ trilha: { ativa: true, paradas: [{ pedidos: 3, tipo: "produto" }] } }, lista), null);

// ── 3) A busca por telefone ──────────────────────────────────────────────────
console.log("\n3) A busca por telefone: os 8 últimos dígitos (as máscaras estão em teste-carimbos-premio.ts)");
confere("com e sem o 9, com e sem o 55: os mesmos 8 dígitos",
  ["91991077190", "9191077190", "5591991077190", "(91) 99107-7190"].map((n) => finalDoTelefone(n)),
  ["91077190", "91077190", "91077190", "91077190"]);
confere("o pedido gravado com máscara é achado", mesmoTelefoneDoCardapio("+55 (91) 99107-7190", "91991077190"), true);

// ── 4) O exemplo real ────────────────────────────────────────────────────────
console.log("\n4) Karin (Pizzaria Lapastine): 3 pedidos pelo site");
// Os 3 pedidos dela no Neon (lidos pelo Prisma em 16/10/2026, UTC), do mais novo
// para o mais velho, como a busca devolve. Telefone gravado "91991077190".
const karin = [
  { id: "k3", createdAt: new Date("2026-10-16T23:47:18.604Z"), status: "ENTREGUE", source: "ONLINE", totalAmount: 57.5 },
  { id: "k2", createdAt: new Date("2026-10-10T23:51:13.135Z"), status: "ENTREGUE", source: "ONLINE", totalAmount: 134 },
  { id: "k1", createdAt: new Date("2026-10-10T00:13:36.257Z"), status: "ENTREGUE", source: "ONLINE", totalAmount: 81 },
];
const agora = new Date("2026-10-17T01:00:00Z");
const tk = trilhaNaFicha(LAPASTINE, karin, agora)!;
confere("trilha: 3 pedidos, faltam 2 para Frete grátis no 5º",
  [tk.passos, tk.faltam, tk.proxima, tk.premioAReceber], [3, 2, { pedidos: 5, premio: "Frete grátis" }, null]);
confere("o ciclo vence 60 dias depois do 1º pedido (09/10 21h13 em Belém → 08/12 21h13)", tk.cicloExpiraEm, "2026-12-09T00:13:36.257Z");
confere("a chamada é a do cardápio", tk.chamada, "Faltam 2 pedidos para você ganhar Frete grátis.");
const ck = carimbosNaFicha(LAPASTINE, karin)!;
confere("carimbos: 3 de 10, faltam 7, nenhuma cartela completa, prêmio R$ 50 de desconto, mínimo R$ 43",
  [ck.noCartao, ck.meta, ck.faltam, ck.completas, ck.premio, ck.minimo],
  [3, 10, 7, 0, "R$ 50,00 de desconto", "pedido a partir de R$ 43,00"]);
confere("o cardápio recebe o mesmo cartão (carimbosDoCliente)",
  carimbosDoCliente(lerCarimbos(LAPASTINE), contarCarimbos(lerCarimbos(LAPASTINE), karin)).noCartao, ck.noCartao);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
