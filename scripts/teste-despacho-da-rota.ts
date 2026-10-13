/**
 * O despacho da rota responde JÁ e os efeitos vêm DEPOIS (13/10/2026, queixa
 * do Lucas, Frangoso: "toda vez que eu despacho, trava").
 *
 *   [1] quem é avisado: o cliente só do que saiu agora, o app do entregador só
 *       do que chegou a ele agora; a mensagem do motoboy é a de sempre;
 *   [2] efeitosDoDespacho (lib/despacho-da-rota.ts): cada efeito uma vez, na
 *       ordem de sempre, um que falha não segura nem cancela os outros, e
 *       nunca lança;
 *   [3] a rota POST /api/store/routes/dispatch: grava, agenda os efeitos no
 *       `after()` e responde ANTES de qualquer efeito; a mesma rota com o
 *       mesmo motoboy uma segunda vez não manda nada de novo; erro na
 *       gravação não agenda efeito.
 *
 *   npx tsx scripts/teste-despacho-da-rota.ts
 *
 * Sem banco e sem rede: o Prisma é um banco falso EM MEMÓRIA (globalThis.prisma,
 * que lib/prisma.ts reaproveita fora de produção), e WhatsApp, notificação,
 * NFC-e, app do entregador e parceiros são trocados por versões que só anotam.
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

type Pedido = Record<string, any>;
const pedido = (p: Pedido): any => ({
  franchiseeId: "dono", status: "PRONTO", source: "ONLINE", deliveryType: "DELIVERY", deliveryBy: null,
  customerName: "Cliente", customerPhone: "22999990000", customerAddress: null, dailyOrderNumber: null,
  ifoodOrderId: null, ifoodReference: null, ifoodStoreMerchant: null,
  openDeliveryOrderId: null, openDeliveryChannel: null, openDeliveryReference: null,
  motoboyId: null, ...p,
});

// ── Banco falso e trocas (instalados ANTES de importar a rota) ───────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; routeSchedule: Linha[]; motoboy: Linha[] } = {
  user: [], customerOrder: [], routeSchedule: [], motoboy: [],
};
function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
  for (const [op, alvo] of Object.entries(filtro)) {
    // `not` do Prisma é o `<>` do SQL: NULL não casa com nada.
    if (op === "not") { if (valor == null || igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if ((alvo as unknown[]).includes(valor)) return false; }
    else if (op === "equals") { if (!igual(valor, alvo)) return false; }
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
const gravacoes: string[] = [];
let quebrarGravacaoDePedidos = false;
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findFirst: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findMany: async (a: any = {}) => db[modelo].filter((x) => casa(x, a.where)).map((l) => projetar(l, a.select)),
  update: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); if (!l) throw new Error(`update ${modelo} não achou`); Object.assign(l, copia(a.data)); gravacoes.push(`${modelo}.update`); return projetar(l, a.select); },
  updateMany: async (a: any) => {
    if (modelo === "customerOrder" && quebrarGravacaoDePedidos) throw new Error("banco caiu no meio");
    const alvos = db[modelo].filter((x) => casa(x, a.where));
    for (const l of alvos) Object.assign(l, copia(a.data));
    gravacoes.push(`${modelo}.updateMany(${alvos.length})`);
    return { count: alvos.length };
  },
});
const prismaFalso: any = {
  user: delegado("user"), customerOrder: delegado("customerOrder"),
  routeSchedule: delegado("routeSchedule"), motoboy: delegado("motoboy"),
  // Transação de verdade no essencial: erro lá dentro desfaz tudo.
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

// O `after()` do Next só existe dentro de uma requisição de verdade; aqui ele
// guarda o callback para o teste rodar quando quiser — é assim que se prova
// que a resposta saiu ANTES dos efeitos.
const agendados: (() => unknown)[] = [];
stub("next/server", { ...require("next/server"), after: (fn: () => unknown) => { agendados.push(fn); } });

let sessaoEmail: string | null = null;
stub("next-auth/next", { getServerSession: async () => (sessaoEmail ? { user: { email: sessaoEmail } } : null) });
stub("../src/lib/auth", { authOptions: {} });

const efeitos: string[] = [];
stub("../src/lib/whatsapp-evolution", {
  sendEvolutionMessage: async (loja: string, tel: string, texto: string) => { efeitos.push(`whatsapp:${loja}:${tel}:${texto.split("\n")[0]}`); return true; },
});
stub("../src/lib/order-notifications", { sendOrderNotification: async (id: string, tipo: string) => { efeitos.push(`cliente:${id}:${tipo}`); } });
stub("../src/lib/fiscal-automatico", {
  emitirNfceDosPedidos: async (w: any) => { efeitos.push(`nfce:${w.id.in.join(",")}`); },
  emitirNfceAutomatica: async () => {},
});
stub("../src/lib/app-motoboy/aparelhos", {
  avisarPedidosNovos: async (mb: string, ps: any[], rota: string) => { efeitos.push(`app:${mb}:${ps.map((p) => p.id).join(",")}:${rota}`); },
});
const canal = (c: string) => (p: any) => Boolean(p.openDeliveryOrderId) && String(p.openDeliveryChannel || "").toUpperCase() === c;
stub("../src/lib/food99-status", { ehPedido99Food: canal("99FOOD"), sincronizar99Food: async (p: any) => { efeitos.push(`99food:${p.openDeliveryOrderId}:${p.entregador?.nome}`); } });
stub("../src/lib/wabiz-status", { ehPedidoWabiz: canal("WABIZ"), sincronizarWabiz: async (p: any) => { efeitos.push(`wabiz:${p.openDeliveryOrderId}`); } });
stub("../src/lib/brendi-status", { ehPedidoBrendi: canal("BRENDI"), sincronizarBrendi: async (p: any) => { efeitos.push(`brendi:${p.openDeliveryOrderId}`); } });
stub("../src/lib/keeta/status", { ehPedidoKeeta: canal("KEETA"), sincronizarKeeta: async (p: any) => { efeitos.push(`keeta:${p.openDeliveryOrderId}`); } });
stub("../src/lib/jotaja-api", { jotajaMutate: async (rota: string) => { efeitos.push(`jotaja:${rota}`); return { status: 200 }; } });
stub("../src/lib/ifood-pedido", { despacharNoIfood: async (p: any, rotulo: string) => { efeitos.push(`ifood:${p.ifoodOrderId}:${rotulo}`); return { ok: true }; } });

async function main() {
  const {
    efeitosDoDespacho,
    mensagemDaRotaParaOMotoboy,
    quemChegouAoEntregador,
    quemSaiuAgora,
    telefoneDoMotoboyNoWhatsApp,
  } = await import("../src/lib/despacho-da-rota");

  // ── [1] Quem é avisado, e a mensagem ─────────────────────────────────────
  console.log("\n[1] Quem é avisado e a mensagem do motoboy");
  const daRota = [
    pedido({ id: "a", status: "PRONTO", motoboyId: "mb1" }),
    pedido({ id: "b", status: "ACEITO", motoboyId: null }),
    pedido({ id: "c", status: "SAIU_ENTREGA", motoboyId: "mb1" }),
    pedido({ id: "d", status: "ENTREGUE", motoboyId: "mb1" }),
    pedido({ id: "e", status: "CANCELLED", motoboyId: null }),
  ];
  conferir("cliente: só quem saiu AGORA (nem o que já estava na rua, nem entregue/cancelado)", igual(quemSaiuAgora(daRota).map((o) => o.id), ["a", "b"]));
  conferir("app do entregador: só o que chegou a ELE agora (a rota montada com ele já avisou)", igual(quemChegouAoEntregador(daRota, "mb1").map((o) => o.id), ["b"]));
  conferir("telefone: 55 na frente quando falta", telefoneDoMotoboyNoWhatsApp("(22) 99888-7766") === "5522998887766");
  conferir("telefone: com 55 fica como está", telefoneDoMotoboyNoWhatsApp("+55 22 99888-7766") === "5522998887766");
  conferir("telefone: vazio/sem dígito → null (não envia)", telefoneDoMotoboyNoWhatsApp("") === null && telefoneDoMotoboyNoWhatsApp(null) === null && telefoneDoMotoboyNoWhatsApp("sem") === null);

  // O texto de antes, com UMA diferença: o link do Maps. Partia de "Rio das
  // Ostras, RJ" fixo — na Frangoso (São Gonçalo) a rota do motoboy abria a
  // 150 km da loja. Agora é o mesmo link do COPIAR (lib/link-da-rota.ts).
  const textoEsperado = (routeNumber: string, pedidosDaRota: any[], mapsUrl: string) => {
    let summaryText = `🚀 *NOVA ROTA ATRIBUÍDA: ${routeNumber}*

`;
    summaryText += `📦 *Total de Pedidos:* ${pedidosDaRota.length}

`;
    summaryText += `📍 *Paradas da Rota:*
`;
    pedidosDaRota.forEach((o, idx) => {
      const displayNum = o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : (o.ifoodReference || o.openDeliveryReference || "");
      summaryText += `${idx + 1}️⃣ *Pedido ${displayNum}*: ${o.customerName || "Cliente"}
   🏠 ${o.customerAddress || "Sem endereço"}
`;
    });
    summaryText += `
🗺️ *Navegação GPS (Google Maps):*
${mapsUrl}`;
    return summaryText;
  };
  const paradas = [
    pedido({ id: "a", dailyOrderNumber: 41, customerName: "Ana", customerAddress: "Rua A, 10 - Centro - Comp: apto 2" }),
    pedido({ id: "b", ifoodReference: "ABC1", customerName: "", customerAddress: "Rua B, 20 - Trindade, São Gonçalo" }),
    pedido({ id: "c", openDeliveryReference: "9921", customerName: "Caio", customerAddress: null }),
  ];
  const linkEsperado =
    "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent("Rua B, 20 - Trindade, São Gonçalo") +
    "&waypoints=" + encodeURIComponent("Rua A, 10 - Centro, São Gonçalo");
  const msg = mensagemDaRotaParaOMotoboy("Rota #7", paradas, "São Gonçalo");
  conferir("mensagem do motoboy: mesmo texto, link novo", msg === textoEsperado("Rota #7", paradas, linkEsperado));
  conferir("link não parte mais de Rio das Ostras", !!msg && !/Rio%20das%20Ostras|Rio das Ostras/.test(msg));
  conferir("sem cidade cadastrada: nada colado no endereço", (mensagemDaRotaParaOMotoboy("Rota #7", [paradas[0]], null) || "").includes("destination=" + encodeURIComponent("Rua A, 10 - Centro")));
  conferir("rota sem endereço nenhum: sem mensagem", mensagemDaRotaParaOMotoboy("Rota #7", [pedido({ id: "x" })]) === null);

  // ── [2] Os efeitos, com portas falsas ───────────────────────────────────
  console.log("\n[2] efeitosDoDespacho: ordem, uma vez cada, falha isolada");
  const anotados: string[] = [];
  const portas = (falhas: Partial<Record<string, string>> = {}) => ({
    avisarCliente: async (id: string) => { anotados.push(`cliente:${id}`); if (falhas.cliente === id) throw new Error("zap fora"); },
    emitirNfce: async (ids: string[]) => { anotados.push(`nfce:${ids.join(",")}`); if (falhas.nfce) throw new Error("sefaz fora"); },
    avisarApp: async (mb: string, ps: any[]) => { anotados.push(`app:${mb}:${ps.map((p) => p.id).join(",")}`); },
    sincronizarPlataformas: async (p: any) => {
      anotados.push(`plataforma:${p.id}`);
      await new Promise((r) => setTimeout(r, 5)); // um de cada vez, como sempre
      if (falhas.plataforma === p.id) throw new Error("ifood 403");
    },
    enviarWhatsApp: async (loja: string, tel: string) => { anotados.push(`whatsapp:${loja}:${tel}`); if (falhas.whatsapp) throw new Error("evolution fora"); },
    cidadeDaLoja: async () => "São Gonçalo",
  });
  const ctx = {
    lojaId: "dono",
    rota: { id: "r1", routeNumber: "Rota #7" },
    motoboy: { id: "mb1", name: "MATHEUS", phone: "22998887766" },
    pedidos: [
      pedido({ id: "a", status: "PRONTO", motoboyId: "mb1", customerAddress: "Rua A" }),
      pedido({ id: "b", status: "ACEITO", motoboyId: null, customerAddress: "Rua B" }),
      pedido({ id: "c", status: "SAIU_ENTREGA", motoboyId: "mb1", customerAddress: "Rua C" }),
    ],
  };
  await efeitosDoDespacho(ctx, portas());
  conferir(
    "começam na ordem de sempre: cliente, nota, app, plataformas (uma a uma), WhatsApp",
    igual(anotados, ["cliente:a", "cliente:b", "nfce:a,b,c", "app:mb1:b", "plataforma:a", "whatsapp:dono:5522998887766", "plataforma:b", "plataforma:c"]),
    anotados,
  );
  conferir("WhatsApp do motoboy UMA vez, pela instância da LOJA", anotados.filter((x) => x.startsWith("whatsapp")).length === 1);

  anotados.length = 0;
  let lancou = false;
  try {
    await efeitosDoDespacho(ctx, portas({ cliente: "a", nfce: "sim", plataforma: "a", whatsapp: "sim" }));
  } catch { lancou = true; }
  conferir("com tudo falhando, não lança (o despacho já está gravado)", !lancou);
  conferir("cliente de 'a' falhou → 'b' avisado mesmo assim", anotados.includes("cliente:b"));
  conferir("iFood do 1º pedido lançou → os seguintes sincronizam", anotados.includes("plataforma:b") && anotados.includes("plataforma:c"), anotados);

  anotados.length = 0;
  await efeitosDoDespacho({ ...ctx, motoboy: { ...ctx.motoboy, phone: null } }, portas());
  conferir("motoboy sem telefone: sem WhatsApp, o resto igual", !anotados.some((x) => x.startsWith("whatsapp")) && anotados.includes("plataforma:c"));

  anotados.length = 0;
  await efeitosDoDespacho({ ...ctx, pedidos: [] }, portas());
  conferir("rota sem pedido: nenhum efeito", anotados.length === 0, anotados);

  // ── [3] A rota de verdade, com banco falso ──────────────────────────────
  console.log("\n[3] POST /api/store/routes/dispatch: responde antes dos efeitos");
  db.user.push({ id: "dono", email: "lucas@frangoso.teste", ownerId: null });
  db.motoboy.push(
    { id: "mb1", name: "MATHEUS", phone: "(22) 99888-7766", franchiseeId: "dono" },
    { id: "mb2", name: "FRED", phone: null, franchiseeId: "dono" },
  );
  db.routeSchedule.push(
    { id: "rota1", routeNumber: "Rota #7", motoboyId: "mb1", franchiseeId: "dono", status: "PENDING", dispatchedAt: null },
    { id: "rota2", routeNumber: "Rota #8", motoboyId: null, franchiseeId: "dono", status: "PENDING", dispatchedAt: null },
  );
  db.customerOrder.push(
    { ...pedido({ id: "p1", dailyOrderNumber: 41, customerName: "Ana", customerAddress: "Rua A, 10", motoboyId: "mb1" }), routeId: "rota1", isRoutePriority: true },
    { ...pedido({ id: "p2", ifoodOrderId: "if-123", ifoodReference: "ABC1", customerAddress: "Rua B, 20", motoboyId: "mb1" }), routeId: "rota1", isRoutePriority: false },
    { ...pedido({ id: "p3", status: "ACEITO", openDeliveryOrderId: "99-xyz", openDeliveryChannel: "99FOOD", customerAddress: "Rua C, 30" }), routeId: "rota1", isRoutePriority: true },
    { ...pedido({ id: "p4", status: "ENTREGUE", customerAddress: "Rua D, 40", motoboyId: "mb1" }), routeId: "rota1", isRoutePriority: false },
    { ...pedido({ id: "alheio", franchiseeId: "OUTRA_LOJA", customerAddress: "Rua X" }), routeId: "rota1", isRoutePriority: true },
    { ...pedido({ id: "p5", customerAddress: "Rua E, 50" }), routeId: "rota2", isRoutePriority: true },
  );
  sessaoEmail = "lucas@frangoso.teste";
  const { POST } = await import("../src/app/api/store/routes/dispatch/route");
  const despachar = async (corpo: Record<string, unknown>) => {
    const res = await POST(new Request("http://teste/api/store/routes/dispatch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    }) as any);
    return { status: res.status, json: await res.json() };
  };

  const r1 = await despachar({ routeId: "rota1", motoboyId: "mb1" });
  conferir("respondeu 200 com sucesso", r1.status === 200 && r1.json.success === true, r1);
  conferir("os efeitos ficaram para DEPOIS: um after() agendado", agendados.length === 1);
  await new Promise((r) => setTimeout(r, 20)); // nada solto rodando por fora
  conferir("na hora da resposta, NENHUM efeito tinha rodado (nem WhatsApp, nem iFood, nem cliente)", efeitos.length === 0, efeitos);

  const linha = (id: string) => db.customerOrder.find((o) => o.id === id)!;
  const rota1 = db.routeSchedule.find((r) => r.id === "rota1")!;
  conferir("rota DISPATCHED, com o motoboy e a hora", rota1.status === "DISPATCHED" && rota1.motoboyId === "mb1" && Boolean(rota1.dispatchedAt));
  conferir(
    "pedidos da loja em SAIU_ENTREGA, com o motoboy, sem prioridade de rota",
    ["p1", "p2", "p3"].every((id) => linha(id).status === "SAIU_ENTREGA" && linha(id).motoboyId === "mb1" && linha(id).isRoutePriority === false),
  );
  conferir("pedido já entregue não volta para a rua", linha("p4").status === "ENTREGUE");
  conferir("pedido de OUTRA loja pendurado na rota não é tocado", linha("alheio").status === "PRONTO");
  conferir("routeId continua o mesmo (o acerto e o app do entregador leem por ele)", ["p1", "p2", "p3", "p4"].every((id) => linha(id).routeId === "rota1"));

  await agendados[0]();
  const de = (prefixo: string) => efeitos.filter((x) => x.startsWith(prefixo));
  conferir("depois: WhatsApp UMA vez, pela loja, para o número do motoboy", igual(de("whatsapp"), ["whatsapp:dono:5522998887766:🚀 *NOVA ROTA ATRIBUÍDA: Rota #7*"]), de("whatsapp"));
  conferir("depois: cliente avisado só de quem saiu agora (p1, p2, p3 — não o entregue)", igual(de("cliente"), ["cliente:p1:SAIU_ENTREGA", "cliente:p2:SAIU_ENTREGA", "cliente:p3:SAIU_ENTREGA"]), de("cliente"));
  conferir("depois: app do entregador só com o que chegou a ele agora (p3)", igual(de("app"), ["app:mb1:p3:Rota #7"]), de("app"));
  conferir("depois: NFC-e chamada uma vez com os pedidos da rota (da loja)", igual(de("nfce"), ["nfce:p1,p2,p3,p4"]), de("nfce"));
  conferir("depois: iFood despachado com o mesmo rótulo de log", igual(de("ifood"), ["ifood:if-123:Route Dispatch → iFood"]), de("ifood"));
  conferir("depois: 99Food com o entregador da rota", igual(de("99food"), ["99food:99-xyz:MATHEUS"]), de("99food"));

  console.log("\n[3b] A mesma rota de novo");
  const antes = { efeitos: efeitos.length, agendados: agendados.length, hora: String(rota1.dispatchedAt) };
  const r2 = await despachar({ routeId: "rota1", motoboyId: "mb1" });
  conferir("mesmo motoboy outra vez (2º clique, outra aba): responde que já saiu", r2.status === 200 && r2.json.jaDespachada === true, r2);
  conferir("…e não agenda efeito nenhum (motoboy não recebe a mensagem duas vezes)", agendados.length === antes.agendados && efeitos.length === antes.efeitos);
  conferir("…nem regrava a hora da saída", String(rota1.dispatchedAt) === antes.hora);

  const r3 = await despachar({ routeId: "rota1", motoboyId: "mb2" });
  conferir("com OUTRO motoboy continua passando, como sempre passou", r3.status === 200 && !r3.json.jaDespachada && agendados.length === antes.agendados + 1, r3);
  await agendados[agendados.length - 1]();
  conferir("…sem avisar de novo o cliente de quem já estava na rua", de("cliente").length === 3, de("cliente"));

  console.log("\n[3c] Erro na gravação não dispara efeito");
  const agendadosAntes = agendados.length;
  quebrarGravacaoDePedidos = true;
  const r4 = await despachar({ routeId: "rota2", motoboyId: "mb1" });
  quebrarGravacaoDePedidos = false;
  conferir("o banco caiu no meio: 500", r4.status === 500, r4);
  conferir("…e nenhum efeito foi agendado (o motoboy não recebe rota que não saiu)", agendados.length === agendadosAntes);
  const rota2 = db.routeSchedule.find((r) => r.id === "rota2")!;
  conferir("…a rota voltou a esperar o despacho (não ficou DISPATCHED com o pedido na cozinha)", rota2.status === "PENDING" && rota2.dispatchedAt == null, rota2);
  const r5 = await despachar({ routeId: "rota2", motoboyId: "mb1" });
  conferir("…e despachar de novo funciona", r5.status === 200 && !r5.json.jaDespachada && linha("p5").status === "SAIU_ENTREGA" && agendados.length === agendadosAntes + 1, r5);
  conferir("o pedido que saiu leva a hora da saída (o acerto do motoboy conta por ela)", Boolean(linha("p5").dispatchedAt));

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
