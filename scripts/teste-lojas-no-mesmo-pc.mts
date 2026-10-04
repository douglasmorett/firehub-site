import { lojasQueOPcAtende, lojasQueOPcConfirma, ligadoNaConfig, juntarJobsDasLojas, CHAVE_DAS_LOJAS_NO_PC, CHAVE_DA_SELECAO } from "../src/lib/lojas-no-mesmo-pc.ts";
let falhas = 0;
const ok = (n, c, d) => { console.log((c ? "  ok    " : "  FALHA ") + n + (c ? "" : " " + JSON.stringify(d))); if (!c) falhas++; };
const ligado = { [CHAVE_DAS_LOJAS_NO_PC]: true };
const china = { id: "china", printerConfig: { printers: [] } };
const yaki = { id: "yaki", printerConfig: null };
console.log("\nA regra do dono: o painel manda");
{
  const lig = { [CHAVE_DAS_LOJAS_NO_PC]: true };
  // China Pow é a principal; Yakisoba é filial dela.
  const conta = (cfgDaPrincipal = {}, cfgDaFilial = null) => [
    { id: "china", accountGroupId: null, printerConfig: { printers: [], ...cfgDaPrincipal } },
    { id: "yaki", accountGroupId: "china", printerConfig: cfgDaFilial },
  ];
  const atende = (id, g) => JSON.stringify(lojasQueOPcAtende(id, g));
  // Opção ligada (como está na conta do Flávio: na filial)
  ok("TODAS selecionado: imprime as duas", atende("yaki", conta({ [CHAVE_DA_SELECAO]: "all" }, lig)) === '["yaki","china"]', atende("yaki", conta({ [CHAVE_DA_SELECAO]: "all" }, lig)));
  ok("YAKISOBA selecionado, Assistente configurado nele: só ele", atende("yaki", conta({ [CHAVE_DA_SELECAO]: "yaki" }, lig)) === '["yaki"]');
  ok("YAKISOBA selecionado, Assistente configurado na CHINA: imprime só o Yakisoba (o painel manda)", atende("china", conta({ [CHAVE_DA_SELECAO]: "yaki" }, lig)) === '["yaki"]', atende("china", conta({ [CHAVE_DA_SELECAO]: "yaki" }, lig)));
  ok("CHINA selecionada, Assistente configurado no Yakisoba: imprime só a China", atende("yaki", conta({ [CHAVE_DA_SELECAO]: "china" }, lig)) === '["china"]');
  ok("sem seleção registrada: todas (ninguém fica sem papel)", atende("china", conta({}, lig)) === '["china","yaki"]');
  ok("seleção de loja que não é deste grupo: ignora, vale todas", atende("china", conta({ [CHAVE_DA_SELECAO]: "outra-conta" }, lig)) === '["china","yaki"]');
  ok("opção ligada na principal também vale", atende("yaki", conta({ ...lig, [CHAVE_DA_SELECAO]: "all" }, null)) === '["yaki","china"]');
  // Opção desligada: a seleção NÃO mexe em nada (conta com lojas em endereços diferentes)
  ok("OPÇÃO DESLIGADA + Yakisoba selecionado: o Assistente da China segue só com a China", atende("china", conta({ [CHAVE_DA_SELECAO]: "yaki" }, null)) === '["china"]');
  ok("OPÇÃO DESLIGADA + Todas: cada Assistente só a sua loja", atende("china", conta({ [CHAVE_DA_SELECAO]: "all" }, null)) === '["china"]' && atende("yaki", conta({ [CHAVE_DA_SELECAO]: "all" }, null)) === '["yaki"]');
  ok("conta de uma loja só nunca muda", JSON.stringify(lojasQueOPcAtende("china", [{ id: "china", accountGroupId: null, printerConfig: lig }])) === '["china"]');
  ok("loja fora do grupo lido: só ela", atende("outra", conta({}, lig)) === '["outra"]');
  ok("grupo vazio/nulo/indefinido", lojasQueOPcAtende("x", []).join() === "x" && lojasQueOPcAtende("x", null).join() === "x" && lojasQueOPcAtende("x", undefined).join() === "x");
  ok("só `true` de verdade liga (string e 1 não)", !ligadoNaConfig({ [CHAVE_DAS_LOJAS_NO_PC]: "true" }) && !ligadoNaConfig({ [CHAVE_DAS_LOJAS_NO_PC]: 1 }) && !ligadoNaConfig(null) && ligadoNaConfig(lig));
  ok("três lojas, Todas: a pedida primeiro, sem repetir", JSON.stringify(lojasQueOPcAtende("b", [{ id: "a", accountGroupId: null, printerConfig: { ...lig, [CHAVE_DA_SELECAO]: "all" } }, { id: "b", accountGroupId: "a" }, { id: "c", accountGroupId: "a" }])) === '["b","a","c"]');
  ok("a seleção é lida da PRINCIPAL, não da filial", atende("china", [{ id: "china", accountGroupId: null, printerConfig: { ...lig, [CHAVE_DA_SELECAO]: "yaki" } }, { id: "yaki", accountGroupId: "china", printerConfig: { [CHAVE_DA_SELECAO]: "all" } }]) === '["yaki"]');
}

console.log("\nConfirmar impressão (/ack) vale para o grupo, qualquer que seja a seleção");
{
  const lig = { [CHAVE_DAS_LOJAS_NO_PC]: true };
  const g = (sel) => [{ id: "china", accountGroupId: null, printerConfig: { [CHAVE_DA_SELECAO]: sel } }, { id: "yaki", accountGroupId: "china", printerConfig: lig }];
  ok("com Yakisoba selecionado, ainda confirma a comanda da China que estava em voo", JSON.stringify(lojasQueOPcConfirma("china", g("yaki"))) === '["china","yaki"]');
  ok("com Todas, confirma as duas", JSON.stringify(lojasQueOPcConfirma("yaki", g("all"))) === '["yaki","china"]');
  ok("opção desligada: só a própria loja", JSON.stringify(lojasQueOPcConfirma("china", [{ id: "china", accountGroupId: null }, { id: "yaki", accountGroupId: "china" }])) === '["china"]');
}
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


