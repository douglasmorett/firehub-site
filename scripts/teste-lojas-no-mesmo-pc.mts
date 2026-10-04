import { lojasQueOPcAtende, ligadoNaConfig, juntarJobsDasLojas, CHAVE_DAS_LOJAS_NO_PC } from "../src/lib/lojas-no-mesmo-pc.ts";
let falhas = 0;
const ok = (n, c, d) => { console.log((c ? "  ok    " : "  FALHA ") + n + (c ? "" : " " + JSON.stringify(d))); if (!c) falhas++; };
const ligado = { [CHAVE_DAS_LOJAS_NO_PC]: true };
const china = { id: "china", printerConfig: { printers: [] } };
const yaki = { id: "yaki", printerConfig: null };
console.log("\nLojas que o PC atende");
ok("sem a opção ligada, só a própria loja (o de sempre)", JSON.stringify(lojasQueOPcAtende("china", [china, yaki])) === '["china"]');
ok("ligada na própria loja: as duas, a dela primeiro", JSON.stringify(lojasQueOPcAtende("china", [{ ...china, printerConfig: ligado }, yaki])) === '["china","yaki"]');
ok("ligada só na IRMÃ vale para a conta toda", JSON.stringify(lojasQueOPcAtende("china", [china, { ...yaki, printerConfig: ligado }])) === '["china","yaki"]');
ok("painel aberto na outra loja: continua atendendo as duas", JSON.stringify(lojasQueOPcAtende("yaki", [{ ...china, printerConfig: ligado }, yaki])) === '["yaki","china"]');
ok("conta de uma loja só", JSON.stringify(lojasQueOPcAtende("china", [{ ...china, printerConfig: ligado }])) === '["china"]');
ok("loja fora do grupo lido não atende ninguém além dela", JSON.stringify(lojasQueOPcAtende("outra", [china, yaki])) === '["outra"]');
ok("grupo vazio/nulo/indefinido", lojasQueOPcAtende("x", []).join() === "x" && lojasQueOPcAtende("x", null).join() === "x" && lojasQueOPcAtende("x", undefined).join() === "x");
ok("só `true` de verdade liga (string e 1 não)", !ligadoNaConfig({ [CHAVE_DAS_LOJAS_NO_PC]: "true" }) && !ligadoNaConfig({ [CHAVE_DAS_LOJAS_NO_PC]: 1 }) && !ligadoNaConfig(null) && ligadoNaConfig(ligado));
ok("três lojas, sem repetir a pedida", JSON.stringify(lojasQueOPcAtende("b", [{ id: "a", printerConfig: ligado }, { id: "b" }, { id: "c" }])) === '["b","a","c"]');
console.log("\nJunção das filas das lojas");
{
  const resp = (jobs, status = 200) => new Response(JSON.stringify({ jobs }), { status });
  const j = (id, createdAt) => ({ id: "job_" + id, createdAt });
  const ids = (l) => l.map((x) => x.id).join();
  const juntou = await juntarJobsDasLojas(resp([j("a1", "2026-10-04T20:00:03Z")]), [resp([j("b1", "2026-10-04T20:00:01Z"), j("b2", "2026-10-04T20:00:05Z")])]);
  ok("comandas das duas lojas, da mais antiga à mais nova", ids(juntou) === "job_b1,job_a1,job_b2", ids(juntou));
  ok("irmã com erro 500 não derruba a principal", ids(await juntarJobsDasLojas(resp([j("a1", "2026-10-04T20:00:03Z")]), [resp([], 500)])) === "job_a1");
  ok("irmã que falhou (null) não derruba a principal", ids(await juntarJobsDasLojas(resp([j("a1", "2026-10-04T20:00:03Z")]), [null, undefined])) === "job_a1");
  ok("irmã com JSON quebrado não derruba a principal", ids(await juntarJobsDasLojas(resp([j("a1", "2026-10-04T20:00:03Z")]), [new Response("não é json", { status: 200 })])) === "job_a1");
  ok("irmã sem comanda: só a principal", ids(await juntarJobsDasLojas(resp([j("a1", "2026-10-04T20:00:03Z")]), [resp([])])) === "job_a1");
  ok("principal vazia, irmã com comanda: sai a da irmã", ids(await juntarJobsDasLojas(resp([]), [resp([j("b1", "2026-10-04T20:00:01Z")])])) === "job_b1");
  ok("corpo sem `jobs` vira lista vazia", (await juntarJobsDasLojas(new Response("{}"), [new Response("{}")])).length === 0);
  const tres = await juntarJobsDasLojas(resp([j("a", "3")]), [resp([j("b", "1")]), resp([j("c", "2")])]);
  ok("três lojas ordenam juntas", ids(tres) === "job_b,job_c,job_a", ids(tres));
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);

