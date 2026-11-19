/**
 * O módulo de BUSCA do Bill (lib/assessor/modulos/busca.ts): pedido, cliente,
 * caixa, mesas, NFC-e, integrações, DRE e o guia do painel — só leitura.
 *
 * 1) Sem banco: o contrato (nada grava, nomes únicos, ferramenta alheia = null),
 *    o período (futuro, invertido, grande demais) e o guia do painel achando a
 *    tela certa pelo menu de verdade.
 * 2) Com banco (SÓ LEITURA — o banco é o de produção): cada ferramenta na loja
 *    real responde ok e enxuta.
 *
 *   npx tsx --env-file=.env scripts/teste-bill-busca.ts            (só a parte 1)
 *   LOJA=<id> npx tsx --env-file=.env scripts/teste-bill-busca.ts  (as duas)
 */
import assert from "node:assert/strict";
import { MODULO_BUSCA, buscarNoGuia, periodoDaBusca } from "../src/lib/assessor/modulos/busca";

(async () => {
  // ── 1a. Contrato ──
  assert.deepEqual(MODULO_BUSCA.gravam, [], "módulo de busca não grava");
  const nomes = MODULO_BUSCA.declaracoes.map((d) => d.name);
  assert.equal(new Set(nomes).size, nomes.length, "nomes únicos");
  for (const n of nomes) assert.match(n, /^[a-z_]+$/, `snake_case: ${n}`);
  const ctxFalso = { franchiseeId: "x", usuarioId: "x", canal: "PAINEL" as const, timezone: "America/Sao_Paulo" };
  assert.equal(await MODULO_BUSCA.executar("registrar_compra", {}, ctxFalso), null, "ferramenta de outro módulo = null");
  assert.ok(MODULO_BUSCA.regras.split("\n").length >= 3 && MODULO_BUSCA.regras.split("\n").length <= 6);
  console.log(`✓ contrato: ${nomes.join(", ")}`);

  // ── 1b. Período ──
  assert.deepEqual(periodoDaBusca({}, "2026-11-18"), { de: "2026-11-18", ate: "2026-11-18" });
  assert.deepEqual(periodoDaBusca({ de: "2026-11-10", ate: "2026-11-30" }, "2026-11-18"), { de: "2026-11-10", ate: "2026-11-18" }, "fim no futuro vira hoje");
  assert.ok("erro" in periodoDaBusca({ de: "2026-11-20" }, "2026-11-18"), "começo no futuro");
  assert.ok("erro" in periodoDaBusca({ de: "2026-11-10", ate: "2026-11-01" }, "2026-11-18"), "invertido");
  assert.ok("erro" in periodoDaBusca({ de: "2026-01-01", ate: "2026-11-18" }, "2026-11-18"), "grande demais");
  console.log("✓ período");

  // ── 1c. Guia do painel (caminhos tirados de lib/menu-do-painel.ts) ──
  const primeiro = (assunto: string) => buscarNoGuia(assunto)[0]?.caminho || "(nada)";
  const casos: [string, RegExp][] = [
    ["onde mudo a impressora", /Configurações › Impressoras/],
    ["cadastrar garçom", /Equipe › Garçons/],
    ["horário de funcionamento", /Minha loja › Horários/],
    ["taxa de entrega", /Minha loja › Entrega/],
    ["histórico de caixa", /histórico de caixas/i],
    ["cupom de desconto", /Cupons|Marketing/],
    ["motoboy", /Equipe › Motoboys/],
    ["nota fiscal", /Gestão › Fiscal/],
    ["conectar o ifood", /Configurações › Integrações/],
    ["aceitar pix", /Minha loja › Pagamento/],
  ];
  for (const [assunto, esperado] of casos) {
    const achado = primeiro(assunto);
    assert.match(achado, esperado, `"${assunto}" → ${achado}`);
    console.log(`✓ guia: "${assunto}" → ${achado}`);
  }
  const g: any = await MODULO_BUSCA.executar("guia_do_sistema", { assunto: "onde mudo a impressora" }, ctxFalso);
  assert.equal(g.ok, true);
  assert.match(g.telas[0].link, /^https:\/\/firehubfood\.com\.br\/store\/impressoras$/);
  const nada: any = await MODULO_BUSCA.executar("guia_do_sistema", { assunto: "xyzwq" }, ctxFalso);
  assert.equal(nada.telas.length, 0);
  assert.ok(nada.menu.length >= 4, "sem acerto devolve o menu para escolher");
  console.log("✓ guia: link da tela, vídeo e menu quando não casa");

  const LOJA = process.env.LOJA;
  if (!LOJA) {
    console.log("(sem LOJA=<id>: pulei a parte com banco)");
    process.exit(0);
  }

  // ── 2. Banco, só leitura ──
  const ctx = { franchiseeId: LOJA, usuarioId: LOJA, canal: "WHATSAPP" as const }; // como no WhatsApp: sem fuso
  const rodar = async (nome: string, args: any = {}) => {
    const t = Date.now();
    const r: any = await MODULO_BUSCA.executar(nome, args, ctx);
    assert.ok(r, `${nome} respondeu`);
    const texto = JSON.stringify(r);
    assert.equal(r.ok, true, `${nome}: ${texto.slice(0, 400)}`);
    assert.ok(texto.length < 16000, `${nome}: resposta grande demais (${texto.length})`);
    console.log(`✓ ${nome} ${JSON.stringify(args)} (${Date.now() - t} ms, ${texto.length} car.): ${texto.slice(0, 700)}`);
    return r;
  };

  const caixa = await rodar("consultar_caixa");
  const ontem = caixa.hoje ? new Date(new Date(`${caixa.hoje}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10) : undefined;
  await rodar("consultar_caixa", { de: ontem && new Date(new Date(`${ontem}T12:00:00Z`).getTime() - 6 * 86400000).toISOString().slice(0, 10), ate: ontem });
  await rodar("consultar_mesas");
  await rodar("status_das_integracoes");
  await rodar("consultar_notas_fiscais", { de: ontem, ate: ontem });
  await rodar("consultar_dre");

  // Pedido: o nº 1 de ontem e, pelo nome dele, o cliente.
  const p = await rodar("buscar_pedido", { numero: "1", data: ontem });
  const nome = p.pedidos?.[0]?.cliente || p.pedidos?.linhas?.[0]?.cliente;
  if (nome) {
    await rodar("buscar_pedido", { cliente: String(nome).split(" ")[0] });
    await rodar("consultar_cliente", { busca: nome });
  }
  const tel = p.pedidos?.[0]?.telefone;
  if (tel) await rodar("buscar_pedido", { cliente: tel });

  // Recusas
  const semNada: any = await MODULO_BUSCA.executar("buscar_pedido", {}, ctx);
  assert.equal(semNada.ok, false);
  const futuro: any = await MODULO_BUSCA.executar("consultar_notas_fiscais", { de: "2099-01-01" }, ctx);
  assert.equal(futuro.ok, false);
  console.log("✓ recusa busca sem dado e período no futuro");

  console.log("\nTUDO OK");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
