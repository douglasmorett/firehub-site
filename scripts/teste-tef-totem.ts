/**
 * scripts/teste-tef-totem.ts — TEF no totem (pinpad PayGo pelo Assistente), lado
 * do SERVIDOR, sem banco e sem rede.
 *
 *   npx tsx scripts/teste-tef-totem.ts
 *
 * Banco em memória (o jeito de scripts/teste-stone-connect.ts), com o SQL cru
 * da tabela "TefDoTotem" emulado. Confere:
 *   - ligar o TEF: a chave do Assistente fica só em HASH, o segredo local
 *     cifrado (e volta para o totem);
 *   - start com TEF: modo "TEF", segredo local, posStatus TEF_NO_PINPAD (NUNCA
 *     AGUARDANDO_TERMINAL, que é a fila do app da maquininha) e SEM
 *     gatewayProvider; licença sem TEF não entra no caminho;
 *   - /api/totem/tef/resultado: sem Bearer/Bearer errado 401; aprovado →
 *     CONFIRMAR + confirmOrderPayment uma vez; reenvio idempotente; outra
 *     transação no pedido pago → DESFAZER; pedido de outra loja 403 DESFAZER;
 *     cancelado → DESFAZER; inexistente 404; valor divergente → DESFAZER;
 *     cancelado DURANTE a confirmação → DESFAZER e tira o carimbo;
 *     recusado → RECUSADO e o payment-status oferece tentar de novo;
 *   - /api/totem/tef/pedido (pendência na volta do Assistente).
 */
export {}; // módulo: sem isto o `main` colide com o de outros scripts no tsc

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

Object.assign(process.env, { NEXTAUTH_SECRET: "segredo-de-teste-do-cofre", NODE_ENV: "development" });
delete process.env.COFRE_CHAVE;
process.env.DATABASE_URL = "postgresql://banco-falso/teste";

// ── Banco em memória ─────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: Record<string, Linha[]> = { user: [], customerOrder: [], posTerminal: [], totemLicense: [], cashSession: [] };
const tefs: Linha[] = [];

const casaValor = (v: any, alvo: any): boolean => {
  if (alvo && typeof alvo === "object" && !(alvo instanceof Date)) {
    if ("in" in alvo) return alvo.in.includes(v);
    if ("not" in alvo) return (v ?? null) !== (alvo.not ?? null);
  }
  return (v ?? null) === (alvo ?? null);
};
const casa = (l: Linha, where: any): boolean =>
  !where ||
  Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as any[]).some((w) => casa(l, w));
    return casaValor(l[k], v);
  });
const aplicar = (l: Linha, data: any) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as any)) l[k] = (l[k] || 0) + (v as any).increment;
    else l[k] = v;
  }
};
const pega = (l: Linha | undefined, select?: any) => {
  if (!l) return null;
  if (!select) return { ...l };
  const out: Linha = {};
  for (const k of Object.keys(select)) out[k] = l[k];
  return out;
};
let seq = 1;
const delegado = (tabela: string) => ({
  findFirst: async ({ where, select }: any) => pega(db[tabela].find((l) => casa(l, where)), select),
  findUnique: async ({ where, select }: any) => pega(db[tabela].find((l) => casa(l, where)), select),
  findMany: async ({ where, select, take }: any) =>
    db[tabela].filter((l) => casa(l, where)).slice(0, take ?? 1e9).map((l) => pega(l, select)),
  update: async ({ where, data, select }: any) => {
    const l = db[tabela].find((x) => casa(x, where));
    if (!l) throw new Error(`update sem linha em ${tabela}`);
    aplicar(l, data);
    return pega(l, select);
  },
  updateMany: async ({ where, data }: any) => {
    const ls = db[tabela].filter((x) => casa(x, where));
    ls.forEach((l) => aplicar(l, data));
    return { count: ls.length };
  },
  create: async ({ data, select }: any) => {
    const l = { id: `${tabela}${seq++}`, ...data };
    db[tabela].push(l);
    return pega(l, select);
  },
});

const sql = (q: string) => q.replace(/\s+/g, " ").trim();
const sqlVisto: string[] = [];
async function executar(qCru: string, ...p: any[]): Promise<number> {
  const q = sql(qCru);
  sqlVisto.push(q);
  if (/^CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(q)) return 0;
  if (q.startsWith(`INSERT INTO "TefDoTotem"`)) {
    const linha = { licencaId: p[0], franchiseeId: p[1], chaveHash: p[2], segredoLocalCifrado: p[3], ligadoEm: new Date(), ligadoPor: p[4], ultimoContato: null };
    const i = tefs.findIndex((t) => t.licencaId === p[0]);
    if (i >= 0) tefs[i] = linha;
    else tefs.push(linha);
    return 1;
  }
  if (q.startsWith(`DELETE FROM "TefDoTotem"`)) {
    const antes = tefs.length;
    for (let i = tefs.length - 1; i >= 0; i--) if (tefs[i].licencaId === p[0] && tefs[i].franchiseeId === p[1]) tefs.splice(i, 1);
    return antes - tefs.length;
  }
  if (q.startsWith(`UPDATE "TefDoTotem" SET "ultimoContato"`)) {
    const t = tefs.find((x) => x.licencaId === p[0]);
    if (t) t.ultimoContato = new Date();
    return t ? 1 : 0;
  }
  throw new Error(`SQL não emulado: ${q}`);
}
async function consultar(qCru: string, ...p: any[]): Promise<any[]> {
  const q = sql(qCru);
  if (q === `SELECT * FROM "TefDoTotem" WHERE "licencaId" = $1`) return tefs.filter((t) => t.licencaId === p[0]);
  if (q === `SELECT * FROM "TefDoTotem" WHERE "chaveHash" = $1`) return tefs.filter((t) => t.chaveHash === p[0]);
  if (q === `SELECT * FROM "TefDoTotem" WHERE "franchiseeId" = $1`) return tefs.filter((t) => t.franchiseeId === p[0]);
  throw new Error(`SELECT não emulado: ${q}`);
}

const prismaFalso: any = {};
for (const t of Object.keys(db)) prismaFalso[t] = delegado(t);
prismaFalso.$executeRawUnsafe = executar;
prismaFalso.$queryRawUnsafe = consultar;
prismaFalso.$transaction = async (fn: any) => fn(prismaFalso);
(globalThis as any).prisma = prismaFalso;

// ── O que fica fora do teste ─────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
const confirmados: string[] = [];
let cancelarDuranteAConfirmacao: string | null = null;
stub("../src/lib/order-payment-confirm", {
  confirmOrderPayment: async (id: string) => {
    confirmados.push(id);
    const p = db.customerOrder.find((o) => o.id === id);
    if (!p) return null;
    if (cancelarDuranteAConfirmacao === id) {
      p.status = "CANCELADO";
      return { ...p };
    }
    if (!p.paymentPaidAt) {
      p.paymentPaidAt = new Date();
      p.status = "NOVO";
      p.dailyOrderNumber = p.dailyOrderNumber ?? 77;
    }
    return { ...p };
  },
});
stub("../src/lib/totem-auth", {
  autenticarTotem: async (token: string) => {
    const l = db.totemLicense.find((x) => x.token === token);
    return l ? { ok: true, licenca: { id: l.id, franchiseeId: l.franchiseeId, label: l.label } } : { ok: false, status: 401, erro: "token", codigo: "X" };
  },
});
(globalThis as any).fetch = async (url: string) => {
  throw new Error(`rede proibida no teste: ${url}`);
};

// ── Cenário ──────────────────────────────────────────────────────────────────
db.user.push({ id: "lojaA", storeName: "Loja A", mpAccessToken: null }, { id: "lojaB", storeName: "Loja B", mpAccessToken: null });
db.cashSession.push({ id: "cx1", franchiseeId: "lojaA", status: "OPEN" }, { id: "cx2", franchiseeId: "lojaB", status: "OPEN" });
db.totemLicense.push(
  { id: "licA", franchiseeId: "lojaA", token: "totem-a", label: "Totem A", posTerminalId: null },
  { id: "licA2", franchiseeId: "lojaA", token: "totem-a2", label: "Totem sem TEF", posTerminalId: null },
  { id: "licB", franchiseeId: "lojaB", token: "totem-b", label: "Totem B", posTerminalId: null },
);
const novoPedido = (id: string, loja: string, total: number) =>
  db.customerOrder.push({
    id, franchiseeId: loja, totalAmount: total, status: "AGUARDANDO_PAGAMENTO", dailyOrderNumber: null, paymentPaidAt: null,
    posOrderId: null, posTerminalId: null, posStatus: null, posTentativas: 0, gatewayProvider: null, gatewayPaymentId: null,
    paymentMethod: "Cartão (Maquininha)", pagarmeStatus: null, posDadosTransacao: null, totemLicenseId: "licA",
  });
const pedido = (id: string) => db.customerOrder.find((o) => o.id === id)!;

async function main() {
  const { NextRequest } = await import("next/server");
  const tefLib = await import("../src/lib/tef-do-totem");
  const { POST: start } = await import("../src/app/api/totem/payment/start/route");
  const { GET: status } = await import("../src/app/api/totem/payment-status/route");
  const { POST: resultado } = await import("../src/app/api/totem/tef/resultado/route");
  const { GET: pendencia } = await import("../src/app/api/totem/tef/pedido/route");

  const BASE = "https://firehubfood.com.br";
  const json = async (r: Response) => ({ status: r.status, corpo: await r.json() });
  const postStart = (corpo: any) =>
    start(new NextRequest(`${BASE}/api/totem/payment/start`, { method: "POST", body: JSON.stringify(corpo) })).then(json);
  const getStatus = (token: string, orderId: string) =>
    status(new NextRequest(`${BASE}/api/totem/payment-status?token=${token}&orderId=${orderId}`)).then(json);
  const postResultado = (chave: string | null, corpo: any) =>
    resultado(
      new NextRequest(`${BASE}/api/totem/tef/resultado`, {
        method: "POST",
        headers: chave ? { authorization: `Bearer ${chave}` } : {},
        body: JSON.stringify(corpo),
      }),
    ).then(json);
  const getPendencia = (chave: string, id: string, transacao: string) =>
    pendencia(new NextRequest(`${BASE}/api/totem/tef/pedido?id=${id}&transacao=${transacao}`, { headers: { authorization: `Bearer ${chave}` } })).then(json);

  // ── Ligar o TEF ───────────────────────────────────────────────────────────
  const a = await tefLib.ligarTef({ licencaId: "licA", franchiseeId: "lojaA", por: "dono@loja.com" });
  const b = await tefLib.ligarTef({ licencaId: "licB", franchiseeId: "lojaB", por: "dono@b.com" });
  const linhaA = tefs.find((t) => t.licencaId === "licA")!;
  confere("chave do Assistente NÃO fica no banco (só hash)", JSON.stringify(linhaA).includes(a.chave), false);
  confere("segredo local NÃO fica em texto no banco", JSON.stringify(linhaA).includes(a.segredoLocal), false);
  confere("segredo local volta decifrado para o totem", (await tefLib.tefDaLicenca("licA"))?.segredoLocal, a.segredoLocal);
  confere("licença sem TEF → null", await tefLib.tefDaLicenca("licA2"), null);

  // ── Start ─────────────────────────────────────────────────────────────────
  novoPedido("p1", "lojaA", 39.9);
  const s1 = await postStart({ token: "totem-a", orderId: "p1" });
  confere("start com TEF: modo TEF", [s1.status, s1.corpo.modo, s1.corpo.valorCentavos, s1.corpo.pedidoId], [200, "TEF", 3990, "p1"]);
  confere("start com TEF: devolve o segredo local", s1.corpo.segredoLocal, a.segredoLocal);
  confere("start com TEF: posStatus próprio (não é a fila do app)", pedido("p1").posStatus, "TEF_NO_PINPAD");
  confere("start com TEF: NÃO carimba gatewayProvider nem pago", [pedido("p1").gatewayProvider, pedido("p1").paymentPaidAt], [null, null]);
  const st0 = await getStatus("totem-a", "p1");
  confere("payment-status: TEF aguardando, não pago", [st0.corpo.tef, st0.corpo.paid, st0.corpo.aguardando], [true, false, true]);

  novoPedido("p0", "lojaA", 10);
  db.customerOrder.find((o) => o.id === "p0")!.totemLicenseId = "licA2";
  const s0 = await postStart({ token: "totem-a2", orderId: "p0" });
  confere("licença sem TEF não vai para o pinpad", s0.corpo.modo === "TEF", false);

  db.cashSession[0].status = "CLOSED";
  novoPedido("pcx", "lojaA", 12);
  const scx = await postStart({ token: "totem-a", orderId: "pcx" });
  confere("caixa fechado: TEF não começa", [scx.status, scx.corpo.code], [409, "CAIXA_FECHADO"]);
  db.cashSession[0].status = "OPEN";

  // ── Resultado: autenticação ───────────────────────────────────────────────
  const aprovado = (pedidoId: string, transacaoId: string, valorCentavos: number, extra: any = {}) => ({
    pedidoId, transacaoId, aprovado: true, valorCentavos, nsu: "NSU000001", nsuHost: "HOST000001", autorizacao: "A1",
    bandeira: "VISA", cartao: "************1234", tipo: "1", parcelas: "1", rede: "REDE", comprovanteLoja: "VIA LOJA", comprovanteCliente: "VIA CLIENTE", ...extra,
  });
  confere("resultado sem Bearer → 401", (await postResultado(null, aprovado("p1", "t1", 3990))).status, 401);
  confere("resultado com Bearer errado → 401", (await postResultado("chave-errada-de-alguem-123456", aprovado("p1", "t1", 3990))).status, 401);
  confere("resultado com o segredo LOCAL no lugar da chave → 401", (await postResultado(a.segredoLocal, aprovado("p1", "t1", 3990))).status, 401);

  // ── Aprovado ──────────────────────────────────────────────────────────────
  const r1 = await postResultado(a.chave, aprovado("p1", "t1", 3990));
  confere("aprovado → 200 CONFIRMAR", [r1.status, r1.corpo.acao, r1.corpo.numero], [200, "CONFIRMAR", 77]);
  confere("aprovado: gatewayProvider PAYGO_TEF e forma do cartão", [pedido("p1").gatewayProvider, pedido("p1").paymentMethod, pedido("p1").posStatus], ["PAYGO_TEF", "Cartão Crédito (TEF)", "PAGO"]);
  confere("aprovado: rastro guardado (NSU, autorização, transação, comprovante)", [pedido("p1").posDadosTransacao.nsu, pedido("p1").posDadosTransacao.autorizacao, pedido("p1").posDadosTransacao.transacaoId, pedido("p1").posDadosTransacao.comprovanteCliente], ["NSU000001", "A1", "t1", "VIA CLIENTE"]);
  confere("aprovado: gatewayPaymentId = NSU do host", pedido("p1").gatewayPaymentId, "HOST000001");
  confere("confirmOrderPayment uma vez", confirmados, ["p1"]);
  const st1 = await getStatus("totem-a", "p1");
  confere("payment-status: pago", [st1.corpo.paid, st1.corpo.tef], [true, true]);

  const r1b = await postResultado(a.chave, aprovado("p1", "t1", 3990));
  confere("reenvio da mesma transação → CONFIRMAR de novo (idempotente)", [r1b.status, r1b.corpo.acao, r1b.corpo.jaConfirmado], [200, "CONFIRMAR", true]);
  confere("reenvio não confirma de novo", confirmados, ["p1"]);

  const r1c = await postResultado(a.chave, aprovado("p1", "t2", 3990));
  confere("OUTRA transação no pedido já pago → DESFAZER", [r1c.status, r1c.corpo.acao, r1c.corpo.motivo], [409, "DESFAZER", "JA_PAGO"]);
  confere("o rastro continua o da primeira", pedido("p1").posDadosTransacao.transacaoId, "t1");

  // ── Isolamento entre lojas ────────────────────────────────────────────────
  novoPedido("pB", "lojaB", 20);
  const rB = await postResultado(a.chave, aprovado("pB", "t3", 2000));
  confere("pedido de outra loja → 403 DESFAZER", [rB.status, rB.corpo.acao], [403, "DESFAZER"]);
  confere("pedido da outra loja intocado", [pedido("pB").gatewayProvider, pedido("pB").paymentPaidAt], [null, null]);
  const rBb = await postResultado(b.chave, aprovado("pB", "t3", 2000));
  confere("a chave da loja B paga o pedido da B", rBb.corpo.acao, "CONFIRMAR");

  // ── Cancelado / inexistente / valor errado ────────────────────────────────
  novoPedido("pC", "lojaA", 15);
  pedido("pC").status = "CANCELADO";
  const rC = await postResultado(a.chave, aprovado("pC", "t4", 1500));
  confere("pedido cancelado → DESFAZER", [rC.status, rC.corpo.acao, rC.corpo.motivo], [409, "DESFAZER", "PEDIDO_CANCELADO"]);
  confere("cancelado: nada carimbado", [pedido("pC").gatewayProvider, pedido("pC").paymentPaidAt], [null, null]);
  const rX = await postResultado(a.chave, aprovado("nao-existe", "t5", 1500));
  confere("pedido inexistente → 404 DESFAZER", [rX.status, rX.corpo.acao], [404, "DESFAZER"]);
  novoPedido("pV", "lojaA", 15);
  const rV = await postResultado(a.chave, aprovado("pV", "t6", 1400));
  confere("valor divergente → DESFAZER", [rV.corpo.acao, rV.corpo.motivo, pedido("pV").gatewayProvider], ["DESFAZER", "VALOR_DIVERGENTE", null]);

  // ── Cancelado no meio da confirmação ──────────────────────────────────────
  novoPedido("pM", "lojaA", 18);
  cancelarDuranteAConfirmacao = "pM";
  const rM = await postResultado(a.chave, aprovado("pM", "t7", 1800));
  cancelarDuranteAConfirmacao = null;
  confere("cancelado durante a confirmação → DESFAZER", [rM.status, rM.corpo.acao], [409, "DESFAZER"]);
  confere("…e o carimbo de recebido sai", [pedido("pM").gatewayProvider, pedido("pM").posStatus], [null, "CANCELADO"]);

  // ── Recusado ──────────────────────────────────────────────────────────────
  novoPedido("pR", "lojaA", 10.99);
  await postStart({ token: "totem-a", orderId: "pR" });
  const rR = await postResultado(a.chave, { pedidoId: "pR", transacaoId: "t8", aprovado: false, valorCentavos: 1099, mensagem: "TRANSACAO NEGADA" });
  confere("recusado → 200 NADA, pode tentar de novo", [rR.status, rR.corpo.acao, rR.corpo.podeTentarDeNovo], [200, "NADA", true]);
  confere("recusado: posStatus RECUSADO, sem carimbo", [pedido("pR").posStatus, pedido("pR").gatewayProvider], ["RECUSADO", null]);
  const stR = await getStatus("totem-a", "pR");
  confere("payment-status oferece tentar de novo", [stR.corpo.paid, stR.corpo.podeTentarDeNovo], [false, true]);
  const sR2 = await postStart({ token: "totem-a", orderId: "pR" });
  confere("tentar de novo: start volta ao pinpad", [sR2.corpo.modo, pedido("pR").posStatus], ["TEF", "TEF_NO_PINPAD"]);
  const rR2 = await postResultado(a.chave, aprovado("pR", "t9", 1099, { tipo: "2" }));
  confere("segunda tentativa aprovada (débito)", [rR2.corpo.acao, pedido("pR").paymentMethod], ["CONFIRMAR", "Cartão Débito (TEF)"]);

  // ── Pendência na volta do Assistente ──────────────────────────────────────
  const g1 = await getPendencia(a.chave, "p1", "t1");
  confere("pendência: transação gravada → CONFIRMAR", [g1.status, g1.corpo.acao, g1.corpo.pagoPorEstaTransacao], [200, "CONFIRMAR", true]);
  const g2 = await getPendencia(a.chave, "p1", "t-outra");
  confere("pendência: outra transação → DESFAZER", g2.corpo.acao, "DESFAZER");
  novoPedido("pN", "lojaA", 9);
  const g3 = await getPendencia(a.chave, "pN", "t10");
  confere("pendência: pedido não pago → DESFAZER", [g3.corpo.acao, g3.corpo.pago], ["DESFAZER", false]);
  const g4 = await getPendencia(a.chave, "pB", "t3");
  confere("pendência: pedido de outra loja → 403 DESFAZER", [g4.status, g4.corpo.acao], [403, "DESFAZER"]);

  // ── Religar troca as credenciais; desligar corta ──────────────────────────
  const a2 = await tefLib.ligarTef({ licencaId: "licA", franchiseeId: "lojaA", por: "dono@loja.com" });
  novoPedido("pZ", "lojaA", 5);
  confere("religar: chave antiga para de valer", (await postResultado(a.chave, aprovado("pZ", "t11", 500))).status, 401);
  confere("religar: chave nova vale", (await postResultado(a2.chave, aprovado("pZ", "t11", 500))).corpo.acao, "CONFIRMAR");
  await tefLib.desligarTef("licA", "lojaA");
  confere("desligado: chave não vale", (await postResultado(a2.chave, aprovado("pZ", "t11", 500))).status, 401);
  novoPedido("pD", "lojaA", 5);
  confere("desligado: start não vai mais para o pinpad", (await postStart({ token: "totem-a", orderId: "pD" })).corpo.modo === "TEF", false);

  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
