/**
 * scripts/teste-recuperacao-pelo-qr.ts — quem cai em cada marco da recuperação
 * pelo QR (lib/recuperacao-pelo-qr.ts) e o cupom "1 vez por mês" (lib/cupons.ts),
 * sem banco e sem rede.
 *
 *   npx tsx scripts/teste-recuperacao-pelo-qr.ts
 */
import { alvosDoMarco, diasSemPedir, juntarPorCliente, lerJanela, podarEnvios, type PedidosDoTelefone } from "../src/lib/recuperacao-pelo-qr";
import { avaliarCupom, lerCupom } from "../src/lib/cupons";
import { inicioDoMesDaLoja } from "../src/lib/fuso";

let ok = 0, falhou = 0;
function confere(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

const AGORA = new Date("2026-11-19T15:00:00Z");
const DIA = 24 * 60 * 60 * 1000;
const haDias = (d: number, horas = 2) => new Date(AGORA.getTime() - d * DIA - horas * 60 * 60 * 1000);
const chave = (t: string) => { const d = t.replace(/\D/g, ""); return d.startsWith("55") ? d : `55${d}`; };

const lista: PedidosDoTelefone[] = [
  { telefone: "21900000020", ultimo: haDias(20), pedidos: 1 },  // um pedido, há 20 dias
  { telefone: "21900000021", ultimo: haDias(20), pedidos: 3 },  // freguês, há 20 dias
  { telefone: "21900000030", ultimo: haDias(30), pedidos: 1 },  // um pedido, há 30 dias
  { telefone: "21900000007", ultimo: haDias(7), pedidos: 5 },   // sumido há 7
  { telefone: "21900000018", ultimo: haDias(18), pedidos: 2 },  // na janela
  { telefone: "21900000026", ultimo: haDias(26), pedidos: 2 },  // passou da janela
];

console.log("\n== 2º pedido: só quem tem UM pedido ==");
confere("20 dias sem o 2º", alvosDoMarco(lista, { tipo: "segundo", dias: 20 }, AGORA), ["21900000020"]);
confere("30 dias sem o 2º", alvosDoMarco(lista, { tipo: "segundo", dias: 30 }, AGORA), ["21900000030"]);
confere("o sumido de 20 dias de sempre pega os dois", alvosDoMarco(lista, { tipo: "sumido", dias: 20 }, AGORA), ["21900000020", "21900000021"]);
confere("7 dias como antes", alvosDoMarco(lista, { tipo: "sumido", dias: 7 }, AGORA), ["21900000007"]);
confere("19 dias e 23 h ainda é 19", diasSemPedir(new Date(AGORA.getTime() - 20 * DIA + 60_000), AGORA), 19);

console.log("\n== mesmo cliente com e sem 55 ==");
const juntos = juntarPorCliente(
  [
    { telefone: "21900000099", ultimo: haDias(20), pedidos: 1 },
    { telefone: "5521900000099", ultimo: haDias(40), pedidos: 1 },
  ],
  chave
);
confere("vira um cliente com 2 pedidos", juntos.map((p) => p.pedidos), [2]);
confere("fica o pedido mais recente", diasSemPedir(juntos[0].ultimo, AGORA), 20);
confere("não recebe o do 2º pedido", alvosDoMarco(juntos, { tipo: "segundo", dias: 20 }, AGORA), []);
confere("e nem o sumido de 40 pelo formato velho", alvosDoMarco(juntos, { tipo: "sumido", dias: 40 }, AGORA), []);

console.log("\n== janela: entre X e Y dias, 1 vez por mês ==");
const janela = { tipo: "janela" as const, dias: 15, ate: 25 };
confere("pega quem está dentro", alvosDoMarco(lista, janela, AGORA, { chave }), ["21900000020", "21900000021", "21900000018"]);
confere(
  "quem recebeu há 10 dias espera",
  alvosDoMarco(lista, janela, AGORA, { chave, recebeuJanela: { "5521900000018": new Date(AGORA.getTime() - 10 * DIA).toISOString() } }),
  ["21900000020", "21900000021"]
);
confere(
  "quem recebeu há 31 dias recebe de novo",
  alvosDoMarco(lista, janela, AGORA, { chave, recebeuJanela: { "5521900000018": new Date(AGORA.getTime() - 31 * DIA).toISOString() } }),
  ["21900000020", "21900000021", "21900000018"]
);
confere("padrão 15 a 25", lerJanela({}), { de: 15, ate: 25 });
confere("lê a da loja", lerJanela({ janelaDe: "10", janelaAte: 20 }), { de: 10, ate: 20 });
confere("invertida se acerta", lerJanela({ janelaDe: 30, janelaAte: 20 }), { de: 20, ate: 30 });
confere("zero ou lixo volta ao padrão", lerJanela({ janelaDe: 0, janelaAte: "x" }), { de: 15, ate: 25 });
confere("teto de 120", lerJanela({ janelaDe: 5, janelaAte: 999 }), { de: 5, ate: 120 });
confere(
  "poda o que passou de 31 dias",
  Object.keys(podarEnvios({ a: haDias(5).toISOString(), b: haDias(40).toISOString() }, 31, AGORA)),
  ["a"]
);

console.log("\n== cupom 1 vez por mês ==");
const fatos = (usos: number | null) => ({ subtotal: 100, taxa: 8, hojeDaLoja: "2026-11-19", usosDoCliente: usos, jaPediuPeloSite: null });
const porMes = lerCupom({ code: "VOLTA10", discount: 10, usosPorCliente: 1, usosPorMes: true })!;
confere("lê usosPorMes", porMes.usosPorMes, true);
confere("antigo sem o campo = false", lerCupom({ code: "X", discount: 10 })!.usosPorMes, false);
confere("sem uso no mês vale", avaliarCupom(porMes, fatos(0)).ok, true);
confere(
  "já usou no mês: recusa dizendo 'por mês'",
  avaliarCupom(porMes, fatos(1)).motivo,
  "Este cupom pode ser usado 1 vez por mês por cliente, e este telefone já usou este mês."
);
confere(
  "início do mês em São Paulo (dia 1, 00h = 03h UTC)",
  inicioDoMesDaLoja("America/Sao_Paulo", AGORA).toISOString(),
  "2026-11-01T03:00:00.000Z"
);
confere(
  "dia 1 às 01h de SP ainda é o mês novo",
  inicioDoMesDaLoja("America/Sao_Paulo", new Date("2026-12-01T04:00:00Z")).toISOString(),
  "2026-12-01T03:00:00.000Z"
);
confere(
  "30/11 às 23h de SP ainda é novembro",
  inicioDoMesDaLoja("America/Sao_Paulo", new Date("2026-12-01T02:00:00Z")).toISOString(),
  "2026-11-01T03:00:00.000Z"
);

console.log(`\n${ok} ok, ${falhou} falhou`);
if (falhou) process.exit(1);
