/**
 * Os módulos LOJA e CAIXA do Bill (lib/assessor/modulos/loja.ts e caixa.ts).
 *
 *   1. Puro: hora dita ("18h30"), dia ("hoje", "sábado"), grade nova com a
 *      conferência de turnos da tela, texto da entrega, formas de pagamento
 *      (inclusive o formato antigo) e a conferência do fechamento do caixa.
 *   2. LOJA com o banco trocado por um falso em memória: horário, pausa por
 *      data, entrega (mínimo, grátis, tempo das áreas), robô (desligar pede
 *      confirmação), formas de pagamento — e o "desfaz" de cada um.
 *   3. Opcional, SÓ LEITURA no banco de verdade (LOJA=<id>): consultas e a
 *      prévia do fechamento do caixa. Toda gravação é bloqueada no prisma.
 *
 *   npx tsx --env-file=.env scripts/teste-bill-loja-e-caixa.ts
 *   LOJA=<id> npx tsx --env-file=.env scripts/teste-bill-loja-e-caixa.ts
 */
import assert from "node:assert/strict";

const LOJA = process.env.LOJA || "";
// Sem LOJA, banco que não existe: se alguma consulta escapar do falso, falha na hora.
if (!LOJA) process.env.DATABASE_URL = "postgresql://teste@127.0.0.1:1/teste";

const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x));

(async () => {
  const { Prisma } = await import("@prisma/client");
  const { prisma } = await import("../src/lib/prisma");
  const loja = await import("../src/lib/assessor/modulos/loja");
  const caixa = await import("../src/lib/assessor/modulos/caixa");
  const { normalizeStoreHours } = await import("../src/lib/store-hours");
  const { dataDaLoja } = await import("../src/lib/fuso");
  const { MODULO_LOJA, MODULO_CAIXA } = { MODULO_LOJA: loja.MODULO_LOJA, MODULO_CAIXA: caixa.MODULO_CAIXA };

  // ── 1. PURO ───────────────────────────────────────────────────────────────
  assert.equal(loja.lerHora("18"), "18:00");
  assert.equal(loja.lerHora("18h30"), "18:30");
  assert.equal(loja.lerHora("9:05"), "09:05");
  assert.equal(loja.lerHora("25:00"), null);
  assert.equal(loja.lerHora("meia-noite"), null);

  // 19/11/2026 é quinta.
  assert.deepEqual(loja.diasPedidos("hoje", "2026-11-19"), [3]);
  assert.deepEqual(loja.diasPedidos("amanha", "2026-11-19"), [4]);
  assert.deepEqual(loja.diasPedidos("amanhã", "2026-11-22"), [0], "domingo → segunda");
  assert.deepEqual(loja.diasPedidos("Sábado", "2026-11-19"), [5]);
  assert.equal(loja.diasPedidos("todos", "2026-11-19")!.length, 7);
  assert.equal(loja.diasPedidos("feriado", "2026-11-19"), null);

  const padrao = normalizeStoreHours(null);
  let g = loja.aplicarNaGrade(padrao, [{ dia: "sexta", turnos: [{ abre: "18h", fecha: "22" }] }, { dia: "domingo", fechado: true }], "2026-11-19");
  assert.ok(g.ok);
  if (g.ok) {
    assert.deepEqual(g.mudou, [{ dia: "Sexta", antes: "18:00–23:00", depois: "18:00–22:00" }, { dia: "Domingo", antes: "18:00–23:00", depois: "fechado" }]);
    assert.deepEqual(g.grade[4], { day: "Sexta", open: "18:00", close: "22:00", active: true, shifts: [{ open: "18:00", close: "22:00" }] });
    assert.equal(g.grade[0].close, "23:00", "o resto da semana não mexe");
  }
  g = loja.aplicarNaGrade(padrao, [{ dia: "segunda", turnos: [{ abre: "11:00", fecha: "15:00" }, { abre: "14:00", fecha: "23:00" }] }], "2026-11-19");
  assert.ok(!g.ok && /se sobrepõe/.test(g.erro), "turnos sobrepostos são recusados como na tela");
  g = loja.aplicarNaGrade(padrao, [{ dia: "segunda", turnos: [{ abre: "11:00", fecha: "15:00" }, { abre: "18:00", fecha: "02:00" }] }], "2026-11-19");
  assert.ok(g.ok, "almoço + jantar que vira a noite");
  g = loja.aplicarNaGrade(padrao, [{ dia: "segunda" }], "2026-11-19");
  assert.ok(!g.ok, "sem turno nem fechado: pergunta");
  console.log("✓ horário: hora, dia, grade e turnos");

  assert.deepEqual(loja.configDaEntrega({}), { pedidoMinimoEntrega: "sem mínimo", pedidoMinimoRetirada: "o mesmo da entrega", entregaGratis: "desligada", tempoDeRetirada: "40 min (padrão)" });
  assert.deepEqual(loja.configDaEntrega({ minimumOrderValue: 25, minimumOrderValuePickup: 0, freeShippingActive: true, freeShippingMinValue: 80, tempoRetiradaMin: 20 }), {
    pedidoMinimoEntrega: "R$ 25,00", pedidoMinimoRetirada: "sem mínimo", entregaGratis: "acima de R$ 80,00", tempoDeRetirada: "20 min",
  });
  assert.deepEqual(loja.pagamentoComFormas({ PIX: 0, DINHEIRO: 0, formasProprias: [] }, { DINHEIRO: false }), { PIX: 0, DINHEIRO: { rate: 0, active: false }, formasProprias: [] }, "formato antigo vira objeto, o resto fica");
  console.log("✓ entrega e formas de pagamento (texto e gravação)");

  const zero = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0 };
  let c = caixa.textoDaConferencia({ ...zero, cash: 512.3, debit: 300 }, { cash: 500, debit: null, credit: null, pix: null, voucher: null }, false);
  assert.equal(c.diferenca, -12.3);
  assert.ok(c.linhas.includes("Diferença: faltam R$ 12,30."));
  assert.ok(c.linhas.includes("Débito: esperado R$ 300,00, contado — (não conferido)"));
  c = caixa.textoDaConferencia({ ...zero, cash: 100 }, { cash: null, debit: null, credit: null, pix: null, voucher: null }, false);
  assert.equal(c.semConferencia, true);
  c = caixa.textoDaConferencia({ ...zero, cash: 100 }, { cash: 120, debit: null, credit: null, pix: null, voucher: null }, true);
  assert.equal(c.diferenca, null, "cego não vê a diferença");
  assert.ok(!c.linhas.join(" ").includes("esperado"), "cego não vê o esperado");
  assert.equal(caixa.lerValor("1.200,50"), 1200.5);
  assert.equal(caixa.lerValor("R$ 150.50"), 150.5);
  assert.equal(caixa.lerValor(undefined), null);
  console.log("✓ caixa: conferência (falta, sem conferência, cego) e leitura do valor");

  // Contrato: o que grava está declarado; tipos com o prefixo do módulo.
  for (const m of [MODULO_LOJA, MODULO_CAIXA]) {
    const nomes = m.declaracoes.map((d: any) => d.name);
    for (const n of m.gravam) assert.ok(nomes.includes(n), `${m.nome}: ${n}`);
    for (const t of m.tipos || []) assert.ok(t.startsWith(m.nome === "loja" ? "LOJA_" : "CAIXA_"), t);
    assert.ok(m.regras.trim().split("\n").length >= 3 && m.regras.trim().split("\n").length <= 6, `${m.nome}: regras com 3–6 linhas`);
  }
  const ctxFalso = { franchiseeId: "loja", usuarioId: "dono", canal: "WHATSAPP" as const, telefone: "5522999990000" };
  for (const t of ["CAIXA_ABERTO", "CAIXA_FECHADO"]) {
    const d: any = await MODULO_CAIXA.desfazer!(t, {}, ctxFalso);
    assert.ok(d && d.ok === false && /painel em Caixa/.test(d.erro), t);
  }
  assert.equal(await MODULO_CAIXA.executar("horario_de_funcionamento", {}, ctxFalso), null, "ferramenta de outro módulo = null");
  console.log("✓ contrato dos módulos (gravam, tipos, regras, desfazer do caixa)");

  if (LOJA) return somenteLeitura(LOJA, prisma, MODULO_LOJA, MODULO_CAIXA);

  // ── 2. LOJA COM O BANCO FALSO ─────────────────────────────────────────────
  let l: any;
  const regs: { tipo: string; resumo: string; refs: any }[] = [];
  const falso: any = {
    user: {
      findUnique: async ({ where }: any) => (where.id === "loja" || where.id === "dono" ? copia(l) : null),
      update: async ({ where, data }: any) => {
        assert.equal(where.id, "loja", "grava só na loja do contexto");
        for (const [k, v] of Object.entries(data)) l[k] = v === Prisma.DbNull ? null : copia(v);
        return l;
      },
    },
    assessorRegistro: { create: async ({ data }: any) => { regs.push({ tipo: data.tipo, resumo: data.resumo, refs: data.refs }); return {}; } },
  };
  for (const k of Object.keys(falso)) Object.defineProperty(prisma, k, { value: falso[k], configurable: true });
  const ctx = ctxFalso;
  const r = async (nome: string, args: any) => (await MODULO_LOJA.executar(nome, args, ctx)) as any;
  const desfaz = async () => { const u = regs[regs.length - 1]; return (await MODULO_LOJA.desfazer!(u.tipo, u.refs, ctx)) as any; };
  const hoje = dataDaLoja("America/Sao_Paulo");
  const amanha = loja.somarDias(hoje, 1);

  l = {
    storeHours: normalizeStoreHours(null), storePause: null, storeTimezone: "America/Sao_Paulo", storeOpen: true, aberturaAutomatica: false,
    deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [{ name: "Centro", fee: 5, time: 30 }, { name: "Vila Nova", fee: 8, time: 45, motoboyFee: 6 }],
    deliveryConfig: { areasDeRisco: [{ nome: "x" }], minimumOrderValue: 20 },
    storeDeliveryOnly: false,
    chatbotConfig: { instanceName: "firehub_x", connected: true, personality: "AGIL" },
    paymentFees: { PIX: { rate: 0, active: true }, VOUCHER: { rate: 0, active: true, brands: [{ name: "VR", active: true }] }, descontoOnline: { PIX: 5 } },
  };

  // Horário: "hoje fecho às 22h" muda o dia da semana e lembra de voltar; desfaz volta.
  let res = await r("horario_de_funcionamento", { acao: "MUDAR", dias: [{ dia: "hoje", turnos: [{ abre: "18:00", fecha: "22:00" }] }] });
  assert.equal(res.ok, true, res.erro);
  assert.match(res.resumo, /→ 18:00–22:00/);
  assert.match(res.observacao, /TODA/);
  assert.equal(regs.at(-1)!.tipo, "LOJA_HORARIO");
  const antesDoHorario = copia(regs.at(-1)!.refs.antes);
  assert.equal((await desfaz()).ok, true);
  assert.deepEqual(l.storeHours, antesDoHorario);
  res = await r("horario_de_funcionamento", { acao: "CONSULTAR" });
  assert.equal(res.grade.length, 7);
  console.log("✓ horário: muda hoje, avisa que é toda semana, desfaz");

  // Pausa por data: "amanhã não abro"; trocar a pausa existente pede confirmação; tirar.
  res = await r("horario_de_funcionamento", { acao: "FECHAR_DIAS", de: amanha, motivo: "Feriado" });
  assert.equal(res.ok, true, res.erro);
  assert.deepEqual(l.storePause, { active: true, from: amanha, to: amanha, reason: "Feriado" });
  res = await r("horario_de_funcionamento", { acao: "FECHAR_DIAS", de: loja.somarDias(hoje, 10), ate: loja.somarDias(hoje, 12), motivo: "Férias" });
  assert.equal(res.precisaConfirmar, true);
  assert.equal(l.storePause.to, amanha, "sem confirmar, nada muda");
  res = await r("horario_de_funcionamento", { acao: "FECHAR_DIAS", de: "2020-01-01" });
  assert.equal(res.ok, false, "pausa no passado é recusada");
  res = await r("horario_de_funcionamento", { acao: "TIRAR_PAUSA" });
  assert.equal(res.ok, true);
  assert.equal(l.storePause.active, false);
  assert.equal((await desfaz()).ok, true);
  assert.equal(l.storePause.active, true, "desfaz volta a pausa");
  console.log("✓ pausa por data: fecha amanhã, confirma troca, recusa passado, tira e desfaz");

  // Entrega: mínimo, grátis e +15 min em todas as áreas; o resto do deliveryConfig fica.
  res = await r("configurar_entrega", { pedidoMinimo: 30, entregaGratisAcimaDe: "80", somarAoTempoDeEntrega: 15 });
  assert.equal(res.ok, true, res.erro);
  assert.equal(l.deliveryConfig.minimumOrderValue, 30);
  assert.equal(l.deliveryConfig.freeShippingActive, true);
  assert.equal(l.deliveryConfig.freeShippingMinValue, 80);
  assert.deepEqual(l.deliveryConfig.areasDeRisco, [{ nome: "x" }], "mesclado, não substituído");
  assert.deepEqual(l.deliveryZones.map((z: any) => z.time), [45, 60]);
  assert.equal(l.deliveryZones[0].fee, 5, "taxa não muda");
  assert.match(res.resumo, /pedido mínimo da entrega R\$ 20,00 → R\$ 30,00/);
  assert.match(res.resumo, /tempo de entrega de 30 min a 45 min \(cada área tem o seu\) → de 45 min a 60 min/);
  assert.equal((await desfaz()).ok, true);
  assert.equal(l.deliveryConfig.minimumOrderValue, 20);
  assert.ok(!("freeShippingActive" in l.deliveryConfig));
  assert.deepEqual(l.deliveryZones.map((z: any) => z.time), [30, 45]);
  res = await r("configurar_entrega", {});
  assert.equal(res.tempoDeEntrega, "de 30 min a 45 min (cada área tem o seu)");
  assert.equal(res.pedidoMinimoEntrega, "R$ 20,00");
  res = await r("configurar_entrega", { tempoEntregaMin: 500 });
  assert.equal(res.ok, false, "tempo fora de 1–360");
  console.log("✓ entrega: mínimo, grátis e tempo das áreas, mesclado; desfaz volta tudo");

  // Robô: desligar pede confirmação; confirmado desliga; desfaz liga.
  res = await r("robo_do_whatsapp", {});
  assert.deepEqual(res, { ok: true, ligado: true, whatsappConectado: true });
  res = await r("robo_do_whatsapp", { ligado: false });
  assert.equal(res.precisaConfirmar, true);
  assert.ok(!("active" in l.chatbotConfig), "sem confirmar, nada muda");
  res = await r("robo_do_whatsapp", { ligado: false, confirmado: true });
  assert.equal(res.ok, true);
  assert.equal(l.chatbotConfig.active, false);
  assert.equal(l.chatbotConfig.personality, "AGIL", "o resto do robô fica");
  assert.equal((await desfaz()).ok, true);
  assert.ok(!("active" in l.chatbotConfig), "volta ao exato de antes (ausente = ligado)");
  console.log("✓ robô: consulta, desligar com confirmação, desfaz");

  // Formas de pagamento: desliga vale e dinheiro; bandeiras e desconto online ficam; desfaz.
  res = await r("formas_de_pagamento", { mudar: [{ forma: "VOUCHER", ligada: false }, { forma: "DINHEIRO", ligada: false }, { forma: "PIX", ligada: true }] });
  assert.equal(res.ok, true, res.erro);
  assert.equal(l.paymentFees.VOUCHER.active, false);
  assert.deepEqual(l.paymentFees.VOUCHER.brands, [{ name: "VR", active: true }]);
  assert.deepEqual(l.paymentFees.DINHEIRO, { rate: 0, active: false });
  assert.deepEqual(l.paymentFees.descontoOnline, { PIX: 5 });
  assert.ok(!res.resumo.includes("Pix"), "o que já estava assim não entra no resumo");
  assert.equal((await desfaz()).ok, true);
  assert.equal(l.paymentFees.VOUCHER.active, true);
  assert.deepEqual(l.paymentFees.DINHEIRO, { rate: 0 }, "ausente antes = ligada");
  res = await r("formas_de_pagamento", { mudar: [{ forma: "CHEQUE", ligada: true }] });
  assert.equal(res.ok, false);
  console.log("✓ formas de pagamento: liga/desliga sem mexer no resto; desfaz");

  // Mexido de novo depois do Bill: não desfaz por aqui.
  await r("formas_de_pagamento", { mudar: [{ forma: "CREDITO", ligada: false }] });
  l.paymentFees.CREDITO.active = true;
  assert.equal((await desfaz()).ok, false);
  console.log("✓ mudado de novo depois: o desfaz recusa");

  console.log("\nTUDO OK");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Parte 3: banco de verdade, só leitura. Qualquer gravação no prisma lança. */
async function somenteLeitura(LOJA: string, prisma: any, MODULO_LOJA: any, MODULO_CAIXA: any) {
  const ESCRITAS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
  for (const modelo of ["user", "cashSession", "cashMovement", "assessorRegistro", "customerOrder"]) {
    const original = prisma[modelo];
    const guardado = new Proxy(original, {
      get(alvo, prop) {
        if (ESCRITAS.includes(String(prop))) return () => { throw new Error(`GRAVAÇÃO BLOQUEADA no teste: ${modelo}.${String(prop)}`); };
        const v = Reflect.get(alvo, prop);
        return typeof v === "function" ? v.bind(alvo) : v;
      },
    });
    Object.defineProperty(prisma, modelo, { value: guardado, configurable: true });
  }
  for (const raw of ["$executeRaw", "$executeRawUnsafe"]) Object.defineProperty(prisma, raw, { value: () => { throw new Error(`GRAVAÇÃO BLOQUEADA: ${raw}`); }, configurable: true });

  const dono = await prisma.user.findUnique({ where: { id: LOJA }, select: { id: true, storeName: true, storeTimezone: true } });
  assert.ok(dono, `loja ${LOJA} não existe`);
  const ctx = { franchiseeId: LOJA, usuarioId: LOJA, timezone: dono.storeTimezone, canal: "PAINEL" as const, telefone: null };
  console.log(`\n── Só leitura: ${dono.storeName} ──`);
  const ver = async (m: any, nome: string, args: any) => {
    const res: any = await m.executar(nome, args, ctx);
    console.log(`${nome} ${JSON.stringify(args)} →`, JSON.stringify(res).slice(0, 700));
    return res;
  };
  assert.equal((await ver(MODULO_LOJA, "horario_de_funcionamento", { acao: "CONSULTAR" })).ok, true);
  assert.equal((await ver(MODULO_LOJA, "configurar_entrega", {})).ok, true);
  assert.equal((await ver(MODULO_LOJA, "robo_do_whatsapp", {})).ok, true);
  assert.equal((await ver(MODULO_LOJA, "formas_de_pagamento", {})).ok, true);
  // Desligar o robô sem confirmar: só a pergunta.
  const robo = await ver(MODULO_LOJA, "robo_do_whatsapp", { ligado: false });
  assert.ok(robo.precisaConfirmar || /já estava/.test(robo.resumo || ""));
  // Caixa: a prévia do fechamento (sem confirmado) e o abrir sem troco só leem.
  const fechar = await ver(MODULO_CAIXA, "fechar_caixa", { dinheiro: 100 });
  assert.ok(fechar.precisaConfirmar || /Não há caixa aberto/.test(fechar.erro || ""), "fechar sem confirmado não fecha");
  const abrir = await ver(MODULO_CAIXA, "abrir_caixa", {});
  assert.equal(abrir.ok, false, "sem troco (ou com caixa aberto) não abre");
  console.log("\nSÓ LEITURA OK");
  process.exit(0);
}
