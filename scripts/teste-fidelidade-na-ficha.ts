/**
 * Trilha Premiada e cartão de carimbos na ficha do cliente (aba Clientes):
 * o número da ficha tem de ser o que o cliente vê no cardápio.
 *
 *   npx tsx scripts/teste-fidelidade-na-ficha.ts
 *
 * Prova, sem banco:
 * 1) carimbos — a conta saiu do navegador (CustomerStorePage) para lib/carimbos.ts
 *    sem mudar o resultado: compara com a fórmula antiga em milhares de listas;
 *    mínimo, cancelado, cartela completa (0 de 10 + 1 completa);
 * 2) trilha — janela, canais, próxima parada, depois da última parada, prêmio a
 *    receber, e a ficha igual ao que o cardápio recebe (resumoDaTrilha);
 * 3) a busca por telefone é a mesma de antes (lib/pedidos-do-telefone.ts);
 * 4) o exemplo real: Karin, Pizzaria Lapastine (16/10/2026).
 */
import { contarCarimbos, ganhaCarimbo, lerCarimbos, minimoDosCarimbos, premioDosCarimbos } from "../src/lib/carimbos";
import { carimbosNaFicha, trilhaNaFicha } from "../src/lib/fidelidade-na-ficha";
import { ondeEstaoOsPedidosDoTelefone, PEDIDOS_DO_CARDAPIO } from "../src/lib/pedidos-do-telefone";
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
console.log("\n1) Carimbos: a conta do cardápio, igual");

/** A fórmula que morava em CustomerStorePage.tsx até 16/10/2026, copiada sem mexer. */
function cardapioAntigo(loyalty: any, lista: any[]) {
  const stampGoal = Number(loyalty.stampGoal || 10);
  const stampMinOrder = Number(loyalty.stampMinOrder || 30);
  const validStampOrders = lista.filter((o) => o.status !== "CANCELADO" && (Number(o.totalAmount) >= stampMinOrder || !stampMinOrder)).length;
  const currentStamps = validStampOrders % stampGoal;
  return { isStampsActive: Boolean(loyalty.stampsActive), stampGoal, stampMinOrder, stampRewardValue: Number(loyalty.stampRewardValue || 25), currentStamps, remainingStamps: Math.max(0, stampGoal - currentStamps) };
}

let sorteio = 20261016;
const aleatorio = () => ((sorteio = (sorteio * 1103515245 + 12345) % 2147483648) / 2147483648);
const um = <T,>(xs: T[]) => xs[Math.floor(aleatorio() * xs.length)];
const STATUS = ["ENTREGUE", "CANCELADO", "CANCELLED", "CANCELED", "PRONTO", "ACEITO", "SAIU_ENTREGA", "AGUARDANDO_PAGAMENTO", "CRIANDO_IA", "RECUSADO", "cancelado", null];
let iguais = 0;
let diferentes = "";
for (let i = 0; i < 5000; i++) {
  const loyalty = {
    stampsActive: um([true, false, undefined, 1]),
    stampGoal: um([5, 8, 10, 12, undefined, 0, "10"]),
    stampMinOrder: um([0, 30, 43, 49.9, undefined, "45", 35]),
    stampRewardValue: um([0, 25, 50, undefined, 5]),
  };
  const lista = Array.from({ length: Math.floor(aleatorio() * 12) }, () => ({
    status: um(STATUS),
    totalAmount: um([0, 10, 29.99, 30, 42.99, 43, 45, 49.9, 57.5, 134, 81, null]),
  }));
  const antigo = cardapioAntigo(loyalty, lista);
  const regra = lerCarimbos(loyalty);
  const novo = contarCarimbos(regra, lista);
  const igual = antigo.isStampsActive === regra.ativo && antigo.stampGoal === regra.meta && antigo.stampMinOrder === regra.pedidoMinimo
    && antigo.stampRewardValue === regra.premioValor && antigo.currentStamps === novo.noCartao && antigo.remainingStamps === novo.faltam;
  if (igual) iguais++;
  else if (!diferentes) diferentes = JSON.stringify({ loyalty, lista, antigo, regra, novo });
}
confere(`5000 listas sorteadas: a lib dá o mesmo cartão que a fórmula antiga do cardápio${diferentes ? " — " + diferentes : ""}`, iguais, 5000);

const regra = lerCarimbos(LAPASTINE);
const pedido = (totalAmount: number, status = "ENTREGUE") => ({ status, totalAmount });
confere("abaixo do mínimo (R$ 42,99 com mínimo R$ 43) não ganha carimbo", ganhaCarimbo(pedido(42.99), regra), false);
confere("no mínimo exato (R$ 43,00) ganha", ganhaCarimbo(pedido(43), regra), true);
confere("cancelado não ganha, mesmo acima do mínimo", ganhaCarimbo(pedido(134, "CANCELADO"), regra), false);
confere("3 que contam + 1 abaixo + 1 cancelado = 3 de 10, faltam 7",
  contarCarimbos(regra, [pedido(57.5), pedido(134), pedido(81), pedido(20), pedido(90, "CANCELADO")]),
  { validos: 3, noCartao: 3, faltam: 7, completas: 0, acabouDeCompletar: false });
const dez = Array.from({ length: 10 }, () => pedido(50));
confere("10 que contam: o cartão volta a 0 de 10 e vira 1 cartela completa",
  contarCarimbos(regra, dez), { validos: 10, noCartao: 0, faltam: 10, completas: 1, acabouDeCompletar: true });
confere("o 11º que conta abre o cartão novo: 1 de 10, ainda 1 completa",
  contarCarimbos(regra, [...dez, pedido(50)]), { validos: 11, noCartao: 1, faltam: 9, completas: 1, acabouDeCompletar: false });
confere("depois de completar, pedido abaixo do mínimo não abre o cartão novo",
  contarCarimbos(regra, [...dez, pedido(10)]).acabouDeCompletar, true);
confere("lista cortada (o cliente tem mais que os 10 da lista): a mesma contagem, mas não diz 'acabou de completar'",
  contarCarimbos(regra, dez, true), { validos: 10, noCartao: 0, faltam: 10, completas: 1, acabouDeCompletar: false });
confere("sem pedido nenhum: 0 de 10, nada completo", contarCarimbos(regra, []), { validos: 0, noCartao: 0, faltam: 10, completas: 0, acabouDeCompletar: false });
confere("a regra do cardápio só tira 'CANCELADO': CANCELLED e esperando pagamento ganham carimbo (como sempre ganharam)",
  [ganhaCarimbo(pedido(50, "CANCELLED"), regra), ganhaCarimbo(pedido(50, "AGUARDANDO_PAGAMENTO"), regra)], [true, true]);
confere("os padrões do cardápio: mínimo 0 vira R$ 30, prêmio 0 vira R$ 25, meta vazia vira 10",
  (({ meta, pedidoMinimo, premioValor }) => ({ meta, pedidoMinimo, premioValor }))(lerCarimbos({ stampsActive: true, stampMinOrder: 0, stampRewardValue: 0 })),
  { meta: 10, pedidoMinimo: 30, premioValor: 25 });
confere("meta quebrada no banco não divide por zero", lerCarimbos({ stampGoal: -3 }).meta, 10);
confere("textos da ficha: prêmio e mínimo", [premioDosCarimbos(regra), minimoDosCarimbos(regra)], ["R$ 50,00 de desconto", "pedido a partir de R$ 43,00"]);
confere("carimbos desligados: a ficha não mostra o bloco", carimbosNaFicha({ ...LAPASTINE, stampsActive: false }, [pedido(50)]), null);
const cortada = carimbosNaFicha(LAPASTINE, Array.from({ length: PEDIDOS_DO_CARDAPIO }, () => pedido(50)), true);
confere("a ficha avisa quando o cliente passa da lista do cardápio, e não mostra 'completou' (o cardápio também não)",
  [cortada?.alemDaLista, cortada?.acabouDeCompletar, cortada?.completas], [true, false, 1]);
confere("lista inteira com 10 que contam: a ficha mostra a cartela completa, como o cardápio",
  carimbosNaFicha(LAPASTINE, dez)?.acabouDeCompletar, true);

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
console.log("\n3) A busca por telefone é a de antes");
confere("contém os 8 últimos dígitos OU é o número inteiro (o que api/store-customer e a trilha faziam)",
  ondeEstaoOsPedidosDoTelefone("loja1", "(91) 99107-7190"),
  { franchiseeId: "loja1", OR: [{ customerPhone: { contains: "91077190" } }, { customerPhone: "91991077190" }] });
confere("com e sem o 9, com e sem o 55: os mesmos 8 dígitos",
  ["91991077190", "9191077190", "5591991077190"].map((n) => (ondeEstaoOsPedidosDoTelefone("l", n).OR as any)[0].customerPhone.contains),
  ["91077190", "91077190", "91077190"]);

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
confere("no cardápio ela vê o mesmo cartão (fórmula antiga)", cardapioAntigo(LAPASTINE, karin).currentStamps, ck.noCartao);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
