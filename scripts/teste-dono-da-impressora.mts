import { chaveDoAssistente, registrarAssistente, trabalhosDoAssistente, donoDaImpressora, compararVersoes, esquecerAssistentes, VALIDADE_DO_DONO_MS, tirarAssistentesParaOBanco } from "../src/lib/dono-da-impressora.ts";
let falhas = 0;
const ok = (n, c, d) => { console.log((c ? "  ok    " : "  FALHA ") + n + (c ? "" : " " + JSON.stringify(d))); if (!c) falhas++; };

const job = (id, ...imps) => ({ id, order: { id }, destinos: imps.map((p) => ({ printer: p, items: [] })) });
const nomes = (jobs) => jobs.map((j) => j.id + ":" + (j.destinos || []).map((d) => d.printer).join("+")).join(" ");
const T = 1_000_000;

console.log("\nVersões");
ok("1.2.32 > 1.2.9", compararVersoes("1.2.32", "1.2.9") > 0);
ok("sem versão < qualquer uma", compararVersoes("", "1.2.7") < 0);

console.log("\nNIK: caixa com 1.2.32 (ELGIN + EPSON) e cozinha com Assistente antigo (só ELGIN)");
{
  esquecerAssistentes();
  const caixa = { versao: "1.2.32", porta: 7899, impressoras: ["ELGIN i8", "EPSON TM-T20X-II"] };
  const cozinha = { versao: "1.2.18", porta: 7899, impressoras: ["ELGIN i8"] };
  const kCaixa = chaveDoAssistente("1.2.3.4", caixa);
  const kCozinha = chaveDoAssistente("1.2.3.4", cozinha);
  ok("mesmo IP, chaves diferentes", kCaixa !== kCozinha);
  registrarAssistente("nik", kCozinha, cozinha, T);       // o antigo chegou primeiro
  registrarAssistente("nik", kCaixa, caixa, T + 1000);
  const fila = [job("p1", "ELGIN i8", "EPSON TM-T20X-II"), job("p2", "ELGIN i8")];
  ok("ELGIN é do mais novo, mesmo tendo chegado depois", donoDaImpressora("nik", "elgin i8", T + 1000) === kCaixa);
  ok("o caixa recebe tudo", nomes(trabalhosDoAssistente(fila, "nik", kCaixa, T + 1000)) === "p1:ELGIN i8+EPSON TM-T20X-II p2:ELGIN i8");
  ok("a cozinha não recebe nada (nenhum papel em dobro)", trabalhosDoAssistente(fila, "nik", kCozinha, T + 1000).length === 0, nomes(trabalhosDoAssistente(fila, "nik", kCozinha, T + 1000)));
  const depois = T + 1000 + VALIDADE_DO_DONO_MS + 1;
  registrarAssistente("nik", kCozinha, cozinha, depois);
  ok("caixa some por 30 s: a cozinha volta a receber (EPSON sem dono vai como sempre foi)", nomes(trabalhosDoAssistente(fila, "nik", kCozinha, depois)) === "p1:ELGIN i8+EPSON TM-T20X-II p2:ELGIN i8", nomes(trabalhosDoAssistente(fila, "nik", kCozinha, depois)));
}

console.log("\nAssistente anterior à 1.2.7 (não diz o que enxerga)");
{
  esquecerAssistentes();
  const novo = { versao: "1.2.32", porta: 7899, impressoras: ["ELGIN i8"] };
  const kNovo = chaveDoAssistente("ip", novo);
  const kVelho = chaveDoAssistente("ip", null);
  registrarAssistente("loja", kVelho, null, T);
  registrarAssistente("loja", kNovo, novo, T);
  const fila = [job("p1", "ELGIN i8"), job("p2", "BAR")];
  ok("o velho só recebe a impressora sem dono", nomes(trabalhosDoAssistente(fila, "loja", kVelho, T)) === "p2:BAR");
  ok("o novo recebe a dele e a sem dono", nomes(trabalhosDoAssistente(fila, "loja", kNovo, T)) === "p1:ELGIN i8 p2:BAR");
}

console.log("\nO caso de sempre não muda");
{
  esquecerAssistentes();
  const unico = { versao: "1.2.20", porta: 7899, impressoras: ["COZINHA"] };
  const k = chaveDoAssistente("ip", unico);
  registrarAssistente("loja", k, unico, T);
  const fila = [job("p1", "COZINHA", "BALCAO"), { id: "sem", order: {}, destinos: [] }];
  const r = trabalhosDoAssistente(fila, "loja", k, T);
  ok("um Assistente só: a mesma lista, os mesmos objetos", r.length === 2 && r[0] === fila[0] && r[1] === fila[1]);
  ok("nome com maiúscula/espaço diferente é a mesma impressora", donoDaImpressora("loja", "  cozinha ", T) === k);
  ok("loja que ninguém consultou: ninguém é dono", donoDaImpressora("outra", "COZINHA", T) === null);
}

console.log("\nDois Assistentes da mesma versão no mesmo PC (portas diferentes)");
{
  esquecerAssistentes();
  const a = { versao: "1.2.32", porta: 7899, impressoras: ["X"] };
  const b = { versao: "1.2.32", porta: 7900, impressoras: ["X"] };
  const ka = chaveDoAssistente("ip", a), kb = chaveDoAssistente("ip", b);
  registrarAssistente("loja", ka, a, T);
  registrarAssistente("loja", kb, b, T + 10);
  ok("empate de versão: o que chegou primeiro", donoDaImpressora("loja", "X", T + 10) === ka);
  ok("o segundo não recebe", trabalhosDoAssistente([job("p", "X")], "loja", kb, T + 10).length === 0);
}

console.log("\nDuas instâncias: cada uma viu um Assistente primeiro (o banco desempata igual)");
{
  esquecerAssistentes();
  const caixa = { versao: "1.2.36", porta: 7899, impressoras: ["ELGIN i8"] };
  const cozinha = { versao: "1.2.36", porta: 7899, impressoras: ["ELGIN i8"] };
  const kCaixa = chaveDoAssistente("10.0.0.1", caixa), kCozinha = chaveDoAssistente("10.0.0.2", cozinha);
  // ESTA instância (B) só viu a cozinha; o caixa consultou só a outra (A).
  registrarAssistente("loja", kCozinha, cozinha, T);
  ok("só pela memória: a cozinha é a dona aqui (em A seria o caixa: papel em dobro)", donoDaImpressora("loja", "ELGIN i8", T) === kCozinha);
  const doBanco = [
    { chave: kCaixa, versao: "1.2.36", impressoras: ["elgin i8"], desdeHaMs: 60_000, vistoHaMs: 4_000 },
    { chave: kCozinha, versao: "1.2.36", impressoras: ["elgin i8"], desdeHaMs: 20_000, vistoHaMs: 1_000 },
  ];
  ok("com o banco: o caixa (visto antes no cluster) é o dono aqui também", donoDaImpressora("loja", "ELGIN i8", T, doBanco) === kCaixa);
  ok("…e a cozinha não recebe a comanda por esta instância", trabalhosDoAssistente([job("p", "ELGIN i8")], "loja", kCozinha, T, doBanco).length === 0);
  ok("linha do banco velha (> 20 s) não faz dono quem esta instância não vê", donoDaImpressora("loja", "ELGIN i8", T, [{ ...doBanco[0], vistoHaMs: 25_000 }, doBanco[1]]) === kCozinha);
  ok("mesmo desde e mesma versão: a chave desempata (igual nos dois servidores)", donoDaImpressora("loja", "ELGIN i8", T, doBanco.map((b) => ({ ...b, desdeHaMs: 30_000 }))) === [kCaixa, kCozinha].sort()[0]);
  ok("banco vazio (falhou): como antes, só a memória", donoDaImpressora("loja", "ELGIN i8", T, []) === kCozinha);
}

console.log("\nO que vai para o banco");
{
  esquecerAssistentes();
  const novo = { versao: "1.2.36", porta: 7899, impressoras: ["ELGIN i8"] };
  const k = chaveDoAssistente("ip", novo);
  registrarAssistente("loja", k, novo, T);
  registrarAssistente("loja", k, novo, T + 3_000);
  registrarAssistente("loja", chaveDoAssistente("ip", null), null, T);
  const fila = tirarAssistentesParaOBanco();
  ok("a cada 3 s na memória, uma linha só para o banco (e o antigo, sem impressora, nenhuma)", fila.length === 1 && fila[0].chave === k, fila);
  registrarAssistente("loja", k, novo, T + 9_000);
  ok("antes de 10 s: nada", tirarAssistentesParaOBanco().length === 0);
  registrarAssistente("loja", k, novo, T + 10_000);
  ok("10 s depois: de novo", tirarAssistentesParaOBanco().length === 1);
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
