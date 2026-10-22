/**
 * Puxar a rota inteira pelo QR — Rota 100% automatizada (22/10/2026, plano
 * "FireHub - Plano despacho automático", D11/D12, §4.8).
 *
 *   [1] as regras puras (lib/despacho-da-rota.ts): quem pode puxar a rota
 *       chamada nos dois modos (`podePuxarARota`), só rota AUTOMÁTICA aberta
 *       oferece o grupo (`ofereceARota`) e quem são os "outros" da rota
 *       (`outrosDaRota`: sem motoboy, DELIVERY, sem parceiro, puxável);
 *   [2] efeitosDoDespacho com `semPushAoMotoboy`: quem puxou não recebe o
 *       push "N entregas para você"; o resto dos efeitos igual;
 *   [3] POST /api/motoboys/orders com banco falso: ROTA_DE_OUTRO antes do
 *       claim (nada muda), o chamado puxa um e recebe os números dos outros,
 *       "Sim, puxar todos" despacha a rota (SAIU_ENTREGA, DISPATCHED, efeitos
 *       depois da resposta, sem aviso em dobro), chamada para todos e
 *       "qualquer" fazem de quem escaneia o chamado, rota manual não oferece.
 *
 *   npx tsx scripts/teste-puxar-a-rota.ts
 *
 * Sem banco e sem rede: o Prisma é um banco falso EM MEMÓRIA (globalThis.prisma,
 * que lib/prisma.ts reaproveita fora de produção), a sessão do motoboy é o id
 * no Bearer, e WhatsApp, notificação, NFC-e, app e parceiros só anotam.
 */
// Módulo (e não script): o tsconfig inclui scripts/, e sem isto as variáveis
// deste arquivo colidiriam com as de outros testes no mesmo escopo global.
export {};

Object.assign(process.env, { NODE_ENV: "development" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copia = <T,>(v: T): T => (v == null ? v : structuredClone(v));

// ── Banco falso e trocas (instalados ANTES de importar a rota) ───────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; routeSchedule: Linha[]; motoboy: Linha[] } = {
  user: [], customerOrder: [], routeSchedule: [], motoboy: [],
};
const valorDe = (v: any) => (v instanceof Date ? v.getTime() : v);
function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (filtro instanceof Date) return valorDe(valor) === filtro.getTime();
  if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
  for (const [op, alvo] of Object.entries(filtro)) {
    // `not` do Prisma é o `<>` do SQL: NULL não casa com nada.
    if (op === "not") { if (alvo === null ? valor == null : valor == null || igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if ((alvo as unknown[]).includes(valor)) return false; }
    else if (op === "gte") { if (!(valorDe(valor) >= valorDe(alvo))) return false; }
    else if (op === "lt") { if (!(valorDe(valor) < valorDe(alvo))) return false; }
    else throw new Error(`operador não previsto no banco falso: ${op}`);
  }
  return true;
}
function casa(linha: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") { if (!(v as any[]).every((w) => casa(linha, w))) return false; }
    else if (k === "OR") { if (!(v as any[]).some((w) => casa(linha, w))) return false; }
    else if (k === "NOT") { if (casa(linha, v)) return false; }
    // Relação (ex.: { franchisee: { ownerId } }): o banco falso não carrega
    // relação; a checagem cai no franchiseeId da outra cláusula do OR.
    else if (k === "franchisee") return false;
    else if (!casaCampo(linha[k], v)) return false;
  }
  return true;
}
const projetar = (linha: Linha, select?: Record<string, any>): Linha => {
  const c = copia(linha);
  if (!select) return c;
  const saida: Linha = {};
  for (const k of Object.keys(select)) saida[k] = c[k] ?? null;
  return saida;
};
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findFirst: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findMany: async (a: any = {}) => db[modelo].filter((x) => casa(x, a.where)).map((l) => projetar(l, a.select)),
  updateMany: async (a: any) => {
    const alvos = db[modelo].filter((x) => casa(x, a.where));
    for (const l of alvos) Object.assign(l, copia(a.data));
    return { count: alvos.length };
  },
});
const prismaFalso: any = {
  user: delegado("user"), customerOrder: delegado("customerOrder"),
  routeSchedule: delegado("routeSchedule"), motoboy: delegado("motoboy"),
  $transaction: async (fn: (tx: any) => Promise<unknown>) => {
    const foto = structuredClone(db);
    try {
      return await fn(prismaFalso);
    } catch (e) {
      for (const k of Object.keys(db) as (keyof typeof db)[]) db[k].splice(0, db[k].length, ...foto[k]);
      throw e;
    }
  },
};
(globalThis as any).prisma = prismaFalso;

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  // `__esModule: true`: sem isto, o `await import()` de um módulo do
  // require.cache devolve só `default` (ver teste-seguranca-da-rota-de-status).
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};

// O `after()` guarda o callback: é assim que se prova que a resposta saiu antes.
const agendados: (() => unknown)[] = [];
stub("next/server", { ...require("next/server"), after: (fn: () => unknown) => { agendados.push(fn); } });

// A sessão assinada vira o id do motoboy no Bearer (a assinatura tem teste próprio).
stub("../src/lib/motoboy-sessao", {
  exigirMotoboy: async (req: Request) => {
    const id = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const m = db.motoboy.find((x) => x.id === id);
    return m ? { id: m.id, name: m.name, franchiseeId: m.franchiseeId } : null;
  },
});

const efeitos: string[] = [];
stub("../src/lib/whatsapp-evolution", { sendEvolutionMessage: async (loja: string) => { efeitos.push(`whatsapp:${loja}`); return true; } });
stub("../src/lib/order-notifications", { sendOrderNotification: async (id: string, tipo: string) => { efeitos.push(`cliente:${id}:${tipo}`); } });
stub("../src/lib/fiscal-automatico", {
  emitirNfceDosPedidos: async (w: any) => { efeitos.push(`nfce:${w.id.in.join(",")}`); },
  emitirNfceAutomatica: async (id: string) => { efeitos.push(`nfce1:${id}`); },
});
// Os pushes da rota automática (ROTA_FOI_COM_OUTRO, ROTA_JA_SAIU) ficam à parte dos efeitos do despacho.
const avisos: { para: string; tipo: string; titulo: string; corpo: string }[] = [];
stub("../src/lib/app-motoboy/aparelhos", {
  avisarPedidosNovos: async (mb: string, ps: any[]) => { efeitos.push(`app:${mb}:${ps.map((p) => p.id).join(",")}`); },
  avisarMotoboy: async (mb: string, a: any) => { avisos.push({ para: mb, tipo: a?.dados?.tipo, titulo: a?.titulo, corpo: a?.corpo }); },
});
const canal = (c: string) => (p: any) => Boolean(p.openDeliveryOrderId) && String(p.openDeliveryChannel || "").toUpperCase() === c;
stub("../src/lib/food99-status", { ehPedido99Food: canal("99FOOD"), sincronizar99Food: async () => ({ erros: [] }) });
stub("../src/lib/wabiz-status", { ehPedidoWabiz: canal("WABIZ"), sincronizarWabiz: async () => ({ erros: [] }) });
stub("../src/lib/brendi-status", { ehPedidoBrendi: canal("BRENDI"), sincronizarBrendi: async () => ({ erros: [] }) });
stub("../src/lib/keeta/status", { ehPedidoKeeta: canal("KEETA"), sincronizarKeeta: async () => ({ erros: [] }) });
stub("../src/lib/jotaja-api", { jotajaMutate: async () => ({ status: 200 }) });
stub("../src/lib/ifood-pedido", {
  despacharNoIfood: async (p: any, rotulo: string) => { efeitos.push(`ifood:${p.ifoodOrderId}:${rotulo}`); return { ok: true }; },
  acaoNoPedidoIfood: async () => ({ ok: true }),
});

type Pedido = Record<string, any>;
const pedido = (p: Pedido): any => ({
  franchiseeId: "dono", status: "PRONTO", source: "ONLINE", deliveryType: "DELIVERY", deliveryBy: null,
  customerName: "Cliente", customerPhone: "22999990000", customerAddress: "Rua A, 10", dailyOrderNumber: null,
  ifoodOrderId: null, ifoodReference: null, ifoodStoreMerchant: null,
  openDeliveryOrderId: null, openDeliveryChannel: null, openDeliveryReference: null,
  ifoodDriverName: null, ifoodDriverStatus: null, ifoodPickupCode: null, food99AppShopId: null,
  motoboyId: null, routeId: null, isRoutePriority: true, createdAt: new Date(), ...p,
});

async function main() {
  const { podePuxarARota, ofereceARota, outrosDaRota, efeitosDoDespacho } = await import("../src/lib/despacho-da-rota");

  // ── [1] As regras puras ────────────────────────────────────────────────
  console.log("\n[1] Quem pode puxar a rota, quem oferece e quem são os outros");
  const chamada = new Date();
  for (const quemPuxa of ["chamado", "qualquer"] as const) {
    conferir(`${quemPuxa}: rota ainda não chamada é de qualquer um`, podePuxarARota({ quemPuxa, chamadaEm: null, chamadaMotoboyId: null, motoboyId: "b" }));
    conferir(`${quemPuxa}: o próprio chamado puxa`, podePuxarARota({ quemPuxa, chamadaEm: chamada, chamadaMotoboyId: "a", motoboyId: "a" }));
    conferir(`${quemPuxa}: chamada para todos (chamado nulo) — quem escanear leva`, podePuxarARota({ quemPuxa, chamadaEm: chamada, chamadaMotoboyId: null, motoboyId: "b" }));
  }
  conferir("chamado: OUTRO motoboy é barrado", !podePuxarARota({ quemPuxa: "chamado", chamadaEm: chamada, chamadaMotoboyId: "a", motoboyId: "b" }));
  conferir("qualquer: OUTRO motoboy passa (vira o chamado)", podePuxarARota({ quemPuxa: "qualquer", chamadaEm: chamada, chamadaMotoboyId: "a", motoboyId: "b" }));

  conferir("rota AUTO aberta oferece o grupo", ofereceARota({ origem: "AUTO", status: "PENDING" }));
  conferir("rota MANUAL não oferece (v1)", !ofereceARota({ origem: "MANUAL", status: "PENDING" }));
  conferir("rota de antes do módulo (origem nula) não oferece", !ofereceARota({ origem: null, status: "PENDING" }));
  conferir("rota AUTO já despachada não oferece", !ofereceARota({ origem: "AUTO", status: "DISPATCHED" }));
  conferir("rota AUTO cancelada não oferece", !ofereceARota({ origem: "AUTO", status: "CANCELLED" }));
  conferir("sem rota: não oferece", !ofereceARota(null));

  const daRota = [
    pedido({ id: "alvo", dailyOrderNumber: 7 }),
    pedido({ id: "livre", dailyOrderNumber: 15 }),
    pedido({ id: "preparo", dailyOrderNumber: 16, status: "PREPARANDO" }),
    pedido({ id: "com-outro", dailyOrderNumber: 17, motoboyId: "x" }),
    pedido({ id: "ifood-entrega", dailyOrderNumber: 18, source: "IFOOD", deliveryBy: "IFOOD" }),
    pedido({ id: "ifood-entregador", dailyOrderNumber: 19, source: "IFOOD", deliveryBy: null, ifoodDriverName: "João iFood" }),
    pedido({ id: "99-parceiro", dailyOrderNumber: 20, source: "99FOOD", deliveryBy: "99FOOD" }),
    pedido({ id: "retirada", dailyOrderNumber: 21, deliveryType: "PICKUP" }),
    pedido({ id: "entregue", dailyOrderNumber: 22, status: "ENTREGUE" }),
    pedido({ id: "cancelado", dailyOrderNumber: 23, status: "CANCELADO" }),
    pedido({ id: "ifood-loja", dailyOrderNumber: 24, source: "IFOOD", deliveryBy: "MERCHANT" }),
  ];
  conferir(
    "outros: sem motoboy, DELIVERY, sem parceiro, puxável — e nunca o próprio",
    igual(outrosDaRota(daRota, "alvo").map((p) => p.id), ["livre", "preparo", "ifood-loja"]),
    outrosDaRota(daRota, "alvo").map((p) => p.id),
  );

  // ── [2] Sem o push para quem puxou ──────────────────────────────────────
  console.log("\n[2] efeitosDoDespacho com semPushAoMotoboy");
  const anotados: string[] = [];
  const portas = {
    avisarCliente: async (id: string) => { anotados.push(`cliente:${id}`); },
    emitirNfce: async (ids: string[]) => { anotados.push(`nfce:${ids.join(",")}`); },
    avisarApp: async (mb: string, ps: any[]) => { anotados.push(`app:${mb}:${ps.map((p) => p.id).join(",")}`); },
    sincronizarPlataformas: async (p: any) => { anotados.push(`plataforma:${p.id}`); },
    enviarWhatsApp: async (loja: string) => { anotados.push(`whatsapp:${loja}`); },
    cidadeDaLoja: async () => null,
  };
  const ctx = {
    lojaId: "dono",
    rota: { id: "r1", routeNumber: "Rota #7" },
    motoboy: { id: "mb1", name: "MAICON", phone: "22998887766" },
    pedidos: [pedido({ id: "a", motoboyId: null }), pedido({ id: "b", motoboyId: null })],
  };
  await efeitosDoDespacho(ctx, portas);
  conferir("sem a opção: o app do entregador é avisado (o /dispatch de sempre)", anotados.includes("app:mb1:a,b"), anotados);
  anotados.length = 0;
  await efeitosDoDespacho({ ...ctx, semPushAoMotoboy: true }, portas);
  conferir("com a opção: nenhum push ao motoboy", !anotados.some((x) => x.startsWith("app:")), anotados);
  conferir("…e o resto igual: cliente, nota, plataformas, WhatsApp", igual([...anotados].sort(), ["cliente:a", "cliente:b", "nfce:a,b", "plataforma:a", "plataforma:b", "whatsapp:dono"]), anotados);

  // ── [3] A rota de verdade, com banco falso ──────────────────────────────
  console.log("\n[3] POST /api/motoboys/orders");
  db.user.push({ id: "dono", ownerId: null, deliveryConfig: { roteirizacaoAutomatica: { ativo: true, quemPuxa: "chamado" } } });
  db.motoboy.push(
    { id: "mbA", name: "MAICON SILVA", phone: "(22) 99888-7766", franchiseeId: "dono", active: true },
    { id: "mbB", name: "FRED", phone: null, franchiseeId: "dono", active: true },
    // Livre o tempo todo: é quem recebe o ROTA_JA_SAIU quando a chamada para todos tem dono.
    { id: "mbC", name: "KAIO", phone: null, franchiseeId: "dono", active: true },
  );
  const { POST } = await import("../src/app/api/motoboys/orders/route");
  const puxar = async (motoboyId: string, corpo: Record<string, unknown>) => {
    const res = await POST(new Request("http://teste/api/motoboys/orders", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${motoboyId}` }, body: JSON.stringify(corpo),
    }) as any);
    return { status: res.status, json: await res.json() };
  };
  const linha = (id: string) => db.customerOrder.find((o) => o.id === id)!;
  const rotaDe = (id: string) => db.routeSchedule.find((r) => r.id === id)!;
  const esperar = () => new Promise((r) => setTimeout(r, 30));
  const rodarAgendados = async () => { while (agendados.length) await agendados.shift()!(); };

  db.routeSchedule.push({ id: "r7", routeNumber: "Rota #7", franchiseeId: "dono", status: "PENDING", motoboyId: null, dispatchedAt: null, origem: "AUTO", chamadaEm: new Date(), chamadaMotoboyId: "mbA" });
  db.customerOrder.push(
    pedido({ id: "p15", dailyOrderNumber: 15, routeId: "r7" }),
    pedido({ id: "p16", dailyOrderNumber: 16, routeId: "r7", ifoodOrderId: "if-16", source: "IFOOD", deliveryBy: "MERCHANT" }),
    pedido({ id: "p18", dailyOrderNumber: 18, routeId: "r7" }),
    pedido({ id: "p19", dailyOrderNumber: 19, routeId: "r7", source: "IFOOD", deliveryBy: "IFOOD" }),
  );

  console.log("\n[3a] Só o chamado: outro motoboy é barrado ANTES do claim");
  const fotoAntes = JSON.stringify(db);
  const r1 = await puxar("mbB", { codigo: "15" });
  conferir("409 ROTA_DE_OUTRO com o primeiro nome do chamado", r1.status === 409 && r1.json.erro === "ROTA_DE_OUTRO" && r1.json.error === "Esta rota é do MAICON. Peça para a loja trocar.", r1);
  conferir("…e nada mudou no banco (nem o pedido, nem a rota)", JSON.stringify(db) === fotoAntes);
  const r1b = await puxar("mbB", { codigo: "15", puxarRota: true });
  conferir("…pedindo a rota inteira, a mesma recusa", r1b.status === 409 && r1b.json.erro === "ROTA_DE_OUTRO" && JSON.stringify(db) === fotoAntes, r1b);

  console.log("\n[3b] O chamado puxa um e o servidor oferece o resto (só números)");
  const r2 = await puxar("mbA", { codigo: "15" });
  conferir("200, o pedido é dele e saiu", r2.status === 200 && r2.json.success && r2.json.numero === 15 && r2.json.saiuParaEntrega === true, r2);
  conferir("rota com os NÚMEROS dos outros puxáveis (sem o do entregador do iFood)", igual(r2.json.rota, { id: "r7", routeNumber: "Rota #7", origem: "AUTO", outros: [{ numero: 16 }, { numero: 18 }] }), r2.json.rota);
  conferir("p15 em SAIU_ENTREGA com o Maicon; a rota continua aberta", linha("p15").status === "SAIU_ENTREGA" && linha("p15").motoboyId === "mbA" && rotaDe("r7").status === "PENDING");
  conferir("os outros continuam sem motoboy (só o \"Sim\" leva)", !linha("p16").motoboyId && !linha("p18").motoboyId);
  await esperar();
  conferir("o puxar de um avisa o cliente dele uma vez (caminho de sempre)", igual(efeitos.filter((x) => x.startsWith("cliente")), ["cliente:p15:SAIU_ENTREGA"]), efeitos);

  console.log("\n[3c] \"Sim, puxar todos\"");
  efeitos.length = 0;
  const r3 = await puxar("mbA", { codigo: "15", puxarRota: true });
  conferir("200 com os números de tudo que é dele na rota", r3.status === 200 && igual(r3.json.numeros, [15, 16, 18]) && r3.json.saiuParaEntrega === true, r3);
  conferir("…e mais ninguém para levar", igual(r3.json.rota?.outros, []), r3.json.rota);
  conferir("p16 e p18 em SAIU_ENTREGA com o Maicon, sem prioridade, com a hora da saída", ["p16", "p18"].every((id) => linha(id).status === "SAIU_ENTREGA" && linha(id).motoboyId === "mbA" && linha(id).isRoutePriority === false && !!linha(id).dispatchedAt));
  conferir("o claim carimba a hora do puxar (os 10 min do soltar contam por ela)", ["p16", "p18"].every((id) => !!linha(id).motoboyPuxadoEm));
  conferir("o pedido do entregador do iFood não é tocado", !linha("p19").motoboyId && linha("p19").status === "PRONTO");
  conferir("rota DISPATCHED com o Maicon", rotaDe("r7").status === "DISPATCHED" && rotaDe("r7").motoboyId === "mbA" && !!rotaDe("r7").dispatchedAt);
  conferir("os efeitos ficaram para depois da resposta (um after())", agendados.length === 1 && efeitos.length === 0, { agendados: agendados.length, efeitos });
  await rodarAgendados();
  conferir("depois: cliente avisado só de p16 e p18 (p15 já tinha sido)", igual(efeitos.filter((x) => x.startsWith("cliente")).sort(), ["cliente:p16:SAIU_ENTREGA", "cliente:p18:SAIU_ENTREGA"]), efeitos);
  conferir("depois: iFood de p16 despachado pelo caminho da rota", igual(efeitos.filter((x) => x.startsWith("ifood")), ["ifood:if-16:Route Dispatch → iFood"]), efeitos);
  conferir("depois: NFC-e dos que saíram agora", igual(efeitos.filter((x) => x.startsWith("nfce")), ["nfce:p16,p18"]), efeitos);
  conferir("depois: SEM push \"N entregas para você\" para quem puxou", !efeitos.some((x) => x.startsWith("app:")), efeitos);
  const r3b = await puxar("mbA", { codigo: "15", puxarRota: true });
  conferir("o \"Sim\" repetido (4G): não oferece rota despachada nem agenda nada", r3b.status === 200 && r3b.json.jaEraSeu === true && !r3b.json.rota && agendados.length === 0, r3b);

  console.log("\n[3d] Chamada para todos: quem escanear primeiro vira o chamado");
  db.routeSchedule.push({ id: "r8", routeNumber: "Rota #8", franchiseeId: "dono", status: "PENDING", motoboyId: null, dispatchedAt: null, origem: "AUTO", chamadaEm: new Date(), chamadaMotoboyId: null });
  db.customerOrder.push(pedido({ id: "p30", dailyOrderNumber: 30, routeId: "r8" }), pedido({ id: "p31", dailyOrderNumber: 31, routeId: "r8" }));
  const r4 = await puxar("mbB", { codigo: "30" });
  conferir("Fred puxa e recebe a oferta do resto", r4.status === 200 && igual(r4.json.rota?.outros, [{ numero: 31 }]), r4);
  conferir("…e vira o chamado da rota", rotaDe("r8").chamadaMotoboyId === "mbB");
  await esperar();
  const jaSaiu = avisos.filter((a) => a.tipo === "ROTA_JA_SAIU");
  conferir("…e os outros livres ficam sabendo: ROTA_JA_SAIU ao Kaio, não ao Fred (quem levou)",
    jaSaiu.length === 1 && jaSaiu[0].para === "mbC" && jaSaiu[0].titulo === "Rota #8 já saiu" && jaSaiu[0].corpo === "FRED levou a Rota #8.", avisos);
  conferir("…nem ao Maicon, que está na rua com outra rota (não é livre)", !jaSaiu.some((a) => a.para === "mbA"), avisos);
  const r5 = await puxar("mbA", { codigo: "31" });
  conferir("Maicon escaneia o outro pedido: agora é do Fred", r5.status === 409 && r5.json.error === "Esta rota é do FRED. Peça para a loja trocar." && !linha("p31").motoboyId, r5);
  const r5b = await puxar("mbB", { codigo: "30", puxarRota: true });
  await esperar();
  conferir("o \"Sim\" do Fred leva o resto, sem um 2º ROTA_JA_SAIU (o aviso é de quando a chamada ganhou dono)",
    r5b.status === 200 && igual(r5b.json.numeros, [30, 31]) && avisos.filter((a) => a.tipo === "ROTA_JA_SAIU").length === 1, { r5b, avisos });
  await rodarAgendados();

  console.log("\n[3e] \"Quem escanear primeiro\": outro passa e vira o chamado");
  db.user[0].deliveryConfig = { roteirizacaoAutomatica: { ativo: true, quemPuxa: "qualquer" } };
  db.routeSchedule.push({ id: "r9", routeNumber: "Rota #9", franchiseeId: "dono", status: "PENDING", motoboyId: null, dispatchedAt: null, origem: "AUTO", chamadaEm: new Date(), chamadaMotoboyId: "mbA" });
  db.customerOrder.push(pedido({ id: "p40", dailyOrderNumber: 40, routeId: "r9" }), pedido({ id: "p41", dailyOrderNumber: 41, routeId: "r9" }));
  efeitos.length = 0;
  const r6 = await puxar("mbB", { codigo: "40", puxarRota: true });
  conferir("Fred (sem ser o chamado) leva a rota inteira num POST só", r6.status === 200 && igual(r6.json.numeros, [40, 41]), r6);
  conferir("…vira o chamado e a rota sai com ele", rotaDe("r9").chamadaMotoboyId === "mbB" && rotaDe("r9").status === "DISPATCHED" && rotaDe("r9").motoboyId === "mbB");
  await esperar();
  conferir("chamada com NOME (Maicon) levada por outro: ROTA_FOI_COM_OUTRO ao Maicon, e nenhum ROTA_JA_SAIU",
    avisos.some((a) => a.tipo === "ROTA_FOI_COM_OUTRO" && a.para === "mbA" && a.titulo === "Rota #9 foi com FRED") &&
      avisos.filter((a) => a.tipo === "ROTA_JA_SAIU").length === 1, avisos);
  conferir("…os dois pedidos na rua com ele", ["p40", "p41"].every((id) => linha(id).status === "SAIU_ENTREGA" && linha(id).motoboyId === "mbB"));
  await esperar();
  await rodarAgendados();
  conferir("puxarRota no 1º POST: cada cliente avisado UMA vez (o do QR não sai pelos dois caminhos)", igual(efeitos.filter((x) => x.startsWith("cliente")).sort(), ["cliente:p40:SAIU_ENTREGA", "cliente:p41:SAIU_ENTREGA"]), efeitos);
  conferir("…e uma NFC-e só, pelo despacho da rota", igual(efeitos.filter((x) => x.startsWith("nfce")), ["nfce:p40,p41"]), efeitos);

  console.log("\n[3f] Rota montada à mão: o puxar de sempre");
  db.routeSchedule.push({ id: "r10", routeNumber: "Rota #10", franchiseeId: "dono", status: "PENDING", motoboyId: null, dispatchedAt: null, origem: null, chamadaEm: null, chamadaMotoboyId: null });
  db.customerOrder.push(pedido({ id: "p50", dailyOrderNumber: 50, routeId: "r10" }), pedido({ id: "p51", dailyOrderNumber: 51, routeId: "r10" }));
  const r7 = await puxar("mbA", { codigo: "50" });
  conferir("sem `rota` na resposta", r7.status === 200 && r7.json.numero === 50 && !("rota" in r7.json), r7);
  const r8 = await puxar("mbA", { codigo: "51", puxarRota: true });
  conferir("puxarRota é ignorado: só o pedido do QR", r8.status === 200 && !r8.json.numeros && linha("p51").motoboyId === "mbA", r8);
  conferir("…a rota manual não é despachada por aqui", rotaDe("r10").status === "PENDING");
  await esperar();

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exitCode = falhou ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 20);
  });
