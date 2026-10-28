/**
 * A finalização que espera a produção INTEIRA (`kdsConfig.finalizacaoSoComTudoPronto`).
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-kds-finalizacao-so-no-fim.ts
 *
 * NIK Esfihas e Pizzas, 28/10/2026, pedido #22 (2 esfihas doces + pizza +
 * Coca): a Produção Esfiha deu pronto e a pizza apareceu ao mesmo tempo na
 * Produção Pizza e na Finalização Pizza, com o relógio da finalização correndo
 * antes de ela sair do forno. Com a regra ligada, o pedido só entra na
 * finalização depois da última tela de produção, e o relógio conta dali.
 *
 * Regras puras (lib/kds-telas.ts) e a rota de verdade (GET e PUT de
 * src/app/api/kds/route.ts, e o PUT de /api/store/kds-config) com banco em memória.
 */
import { NextRequest } from "next/server";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── As telas da NIK (User.kdsScreens, 28/10/2026, resumidas) ────────────────
const P_ESFIHA = { id: "nik-p-esfiha", name: "Produção Esfiha", stage: "production", filter: "all", categoryFilter: ["Combos Esfihas", "Esfihas Tradicionais", "Esfihas Doces", "Esfihas Especiais"] };
const P_PIZZA = { id: "nik-p-pizza", name: "Produção Pizza", stage: "production", filter: "all", categoryFilter: ["Pizzas Especiais", "Pizzas Tradicionais", "Combos de Pizza", "Bordas"] };
const F_ESFIHA = { id: "nik-f-esfiha", name: "Finalização Esfihas", stage: "finishing", filter: "all", categoryFilter: ["Combos Esfihas", "Esfihas Tradicionais", "Esfihas Especiais", "Esfihas Doces"] };
const F_PIZZA = { id: "nik-f-pizza", name: "Finalização Pizza", stage: "finishing", filter: "all", categoryFilter: ["Pizzas Tradicionais", "Pizzas Especiais", "Combos de Pizza", "Bordas", "Adicionais"] };
const TELAS_NIK = [P_ESFIHA, P_PIZZA, F_ESFIHA, F_PIZZA];
const SO_UMA_PRODUCAO = [P_PIZZA, F_PIZZA];

const LIGADO = { soNaFinalizacao: ["Bebidas", "Molhos"], prioridade: [], finalizacaoSoComTudoPronto: true };
const DESLIGADO = { soNaFinalizacao: ["Bebidas", "Molhos"] };
const COM_COMBO = { ...LIGADO, opcaoDoComboNaTelaDela: true };

// O resolvedor (lib/categoria-do-item.ts) dá a categoria do produto à escolha do combo.
const CATEGORIA_DA_OPCAO: Record<string, string> = { "Esfiha Chocolate": "Esfihas Doces", "Coca Cola 2l": "Bebidas" };
const comOpcoes = (i: any) => {
  const opcoes = (i.comboSelections || [])
    .filter((s: any) => CATEGORIA_DA_OPCAO[s.name])
    .map((s: any) => ({ name: s.name, quantity: s.quantity, category: CATEGORIA_DA_OPCAO[s.name] }));
  return opcoes.length ? { ...i, opcoesParaImpressao: opcoes } : i;
};

const item = (id: string, nome: string, categoria: string, extra: any = {}) => ({
  id, productName: nome, quantity: 1, prontoEm: null, comboSelections: null,
  menuProduct: { id: `p-${id}`, active: true, name: nome, category: categoria }, ...extra,
});
const esfiha = (id = "e1") => item(id, "Esfiha Nutella com Ninho", "Esfihas Doces");
const pizza = (id = "z1") => item(id, "Pizza Frango Catupiry", "Pizzas Especiais");
const coca = (id = "b1") => item(id, "Coca Cola Zero 2l", "Bebidas");
const orfao = (id = "x1") => item(id, "Item do iFood sem casar", "");
const comboPizzaEsfihas = (id = "c1") =>
  item(id, "Combo Pizza + 4 Esfihas Doces", "Combos de Pizza", {
    comboSelections: [
      { name: "Frango Catupiry", quantity: 1, price: 0 },
      { name: "Esfiha Chocolate", quantity: 4, price: 0 },
      { name: "Coca Cola 2l", quantity: 1, price: 0 },
    ],
  });

// ── Banco em memória ────────────────────────────────────────────────────────
const db: { user: any; order: any } = { user: null, order: null };
const copia = () => ({ ...db.order, items: db.order.items.map((i: any) => ({ ...i })) });
const prismaFalso: any = {
  user: {
    findUnique: async ({ where }: any) => (where?.email === db.user.email || where?.id === db.user.id ? { ...db.user } : null),
    findMany: async () => [],
    update: async ({ data }: any) => Object.assign(db.user, data),
  },
  customerOrder: {
    findUnique: async () => (db.order ? copia() : null),
    findMany: async ({ where }: any) => {
      if (!db.order) return [];
      const etapa = db.order.kdsStage;
      if (where?.kdsStage === "FINISHING") return etapa === "FINISHING" ? [copia()] : [];
      if (Array.isArray(where?.OR)) return [null, "PENDING", "PRODUCTION"].includes(etapa) ? [copia()] : [];
      return [];
    },
    update: async ({ data }: any) => Object.assign(db.order, data),
  },
  customerOrderItem: {
    updateMany: async ({ where, data }: any) => {
      for (const i of db.order.items) {
        if (!where.id.in.includes(i.id)) continue;
        if ("prontoEm" in where && i.prontoEm !== null) continue;
        Object.assign(i, data);
      }
      return { count: 0 };
    },
  },
};
(globalThis as any).prisma = prismaFalso;

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
stub("next-auth/next", { getServerSession: async () => ({ user: { email: "nik@teste" } }) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/categoria-do-item", {
  resolverCategoriasDosPedidos: async (p: any[]) => p.map((o) => ({ ...o, items: (o.items || []).map(comOpcoes) })),
});
stub("../src/lib/food99-status", { ehPedido99Food: () => false });
stub("../src/lib/wabiz-status", { ehPedidoWabiz: () => false });
stub("../src/lib/brendi-status", { ehPedidoBrendi: () => false });
stub("../src/lib/keeta/status", { ehPedidoKeeta: () => false });
stub("../src/lib/cardapioweb/status", { ehPedidoCardapioWeb: () => false });

function montar(itens: any[], config: any, telas: any[] = TELAS_NIK) {
  db.user = { id: "nik", email: "nik@teste", role: "USER", ownerId: null, kdsScreens: telas, kdsConfig: config, agendamentoConfig: null, storeTimezone: null };
  db.order = {
    id: "o22", kdsStage: "PRODUCTION", status: "PREPARANDO", deliveryType: "DELIVERY", franchiseeId: "nik",
    ifoodOrderId: null, ifoodStoreMerchant: null, openDeliveryOrderId: null, openDeliveryChannel: null, source: "SITE",
    deliveryBy: null, openDeliveryReference: null, kdsTelasProntas: [], kdsBaixas: [], kdsFinishingAt: null,
    dailyOrderNumber: 22, food99AppShopId: null, createdAt: new Date(), items: itens,
  };
}

async function main() {
  const kds = await import("../src/lib/kds-telas");
  const { GET, PUT } = await import("../src/app/api/kds/route");
  const kdsConfigRota = await import("../src/app/api/store/kds-config/route");
  const { esquecerTudo } = await import("../src/lib/cache-curto");
  const { esquecerTudoDaNovidade } = await import("../src/lib/novidade-da-loja");

  const acao = async (corpo: Record<string, unknown>) => {
    await espera(5); // horas diferentes entre uma baixa e outra
    const req = new NextRequest("http://localhost/api/kds", { method: "PUT", body: JSON.stringify({ orderId: "o22", ...corpo }) });
    const res = await PUT(req);
    return { status: res.status, corpo: await res.json() };
  };
  /** Os pedidos que a TV desta tela recebe (o GET de verdade, sem as memórias de 10 s). */
  const tv = async (stage: string, tela?: string) => {
    esquecerTudo();
    esquecerTudoDaNovidade();
    const res = await GET(new NextRequest(`http://localhost/api/kds?stage=${stage}${tela ? `&tela=${tela}` : ""}&t=${Date.now()}`));
    const corpo = await res.json();
    return Array.isArray(corpo) ? corpo.map((p: any) => p.id) : corpo;
  };
  const prontoDe = (id: string) => db.order.items.find((i: any) => i.id === id)?.prontoEm?.toISOString?.() ?? null;
  const relogio = () => (db.order.kdsFinishingAt ? new Date(db.order.kdsFinishingAt).toISOString() : null);

  console.log("\n— A regra: lerKdsConfig e quem espera —");
  confere("ausente = desligada", kds.lerKdsConfig({}).finalizacaoSoComTudoPronto, false);
  confere("true liga", kds.lerKdsConfig({ finalizacaoSoComTudoPronto: true }).finalizacaoSoComTudoPronto, true);
  confere("texto não liga", kds.lerKdsConfig({ finalizacaoSoComTudoPronto: "sim" }).finalizacaoSoComTudoPronto, false);
  confere("NIK ligada, duas telas de produção: espera", kds.esperaTodaAProducao(TELAS_NIK as any, kds.lerKdsConfig(LIGADO)), true);
  confere("ligada com UMA tela de produção: não espera (igual a hoje)", kds.esperaTodaAProducao(SO_UMA_PRODUCAO as any, kds.lerKdsConfig(LIGADO)), false);
  confere("ligada sem telas: não espera", kds.esperaTodaAProducao([], kds.lerKdsConfig(LIGADO)), false);
  confere("desligada: não espera", kds.esperaTodaAProducao(TELAS_NIK as any, kds.lerKdsConfig(DESLIGADO)), false);
  confere(
    "item órfão (sem categoria) sem pronto não segura o pedido",
    kds.producaoLiberouAFinalizacao(TELAS_NIK as any, { items: [{ ...pizza(), prontoEm: new Date() }, orfao()] }, kds.lerKdsConfig(LIGADO)),
    true,
  );

  console.log("\n— #22 com a regra ligada: esfiha + pizza + Coca —");
  montar([pizza(), coca(), esfiha("e1"), esfiha("e2")], LIGADO);
  let r = await acao({ action: "finish_production", tela: P_ESFIHA.id });
  confere("a Produção Esfiha dá baixa: as esfihas ficam prontas", [!!prontoDe("e1"), !!prontoDe("e2"), prontoDe("z1")], [true, true, null]);
  confere("o pedido já está na etapa de finalização (para a Produção Pizza achá-lo)", db.order.kdsStage, "FINISHING");
  confere("NÃO aparece na Finalização Pizza", await tv("finishing", F_PIZZA.id), []);
  confere("NÃO aparece na Finalização Esfihas", await tv("finishing", F_ESFIHA.id), []);
  confere("NÃO aparece na finalização aberta sem tela (link antigo)", await tv("finishing"), []);
  confere("continua na Produção Pizza", await tv("production", P_PIZZA.id), ["o22"]);
  confere("saiu da Produção Esfiha", await tv("production", P_ESFIHA.id), []);
  const primeira = relogio();

  r = await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("a Produção Pizza dá baixa: agora aparece na Finalização Pizza", await tv("finishing", F_PIZZA.id), ["o22"]);
  confere("e na Finalização Esfihas", await tv("finishing", F_ESFIHA.id), ["o22"]);
  confere("saiu da Produção Pizza", await tv("production", P_PIZZA.id), []);
  confere("o relógio da finalização conta da ÚLTIMA baixa (a da pizza)", relogio(), prontoDe("z1"));
  confere("e não da primeira (a da esfiha)", relogio() !== primeira, true);

  r = await acao({ action: "finish_order", tela: F_ESFIHA.id });
  confere("a Finalização Esfihas fecha a parte dela e espera a de pizza", r.corpo.aguardandoOutraTela, true);
  r = await acao({ action: "finish_order", tela: F_PIZZA.id });
  confere("a Finalização Pizza encerra, sem pedir confirmação pela Coca", [r.corpo.precisaConfirmar ?? false, db.order.kdsStage], [false, "FINISHED"]);

  console.log("\n— Desfazer a pizza depois de liberada: sai da finalização; refazer reinicia o relógio —");
  montar([pizza(), esfiha("e1")], LIGADO);
  await acao({ action: "finish_production", tela: P_ESFIHA.id });
  r = await acao({ action: "finish_production", tela: P_PIZZA.id });
  const liberadoEm = relogio();
  await acao({ action: "revert_production", tela: P_PIZZA.id, itens: r.corpo.carimbados });
  confere("desfeita a pizza, some da finalização", await tv("finishing", F_PIZZA.id), []);
  confere("e volta para a Produção Pizza", await tv("production", P_PIZZA.id), ["o22"]);
  await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("refeita, volta para a finalização", await tv("finishing", F_PIZZA.id), ["o22"]);
  confere("com o relógio da baixa nova", [relogio() === prontoDe("z1"), relogio() !== liberadoEm], [true, true]);

  console.log("\n— Só pizza, com a regra ligada: igual a hoje —");
  montar([pizza()], LIGADO);
  await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("aparece na Finalização Pizza na baixa da pizza", await tv("finishing", F_PIZZA.id), ["o22"]);
  confere("relógio na baixa da pizza", relogio(), prontoDe("z1"));

  console.log("\n— Pizza + bebida que nenhuma tela de produção carimba —");
  montar([pizza(), coca()], LIGADO);
  await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("a Coca sem pronto não segura: entra quando a pizza fica pronta", await tv("finishing", F_PIZZA.id), ["o22"]);
  confere("a Coca continua sem carimbo", prontoDe("b1"), null);

  console.log("\n— Pizza + item órfão (iFood sem categoria) + esfiha —");
  montar([pizza(), orfao(), esfiha()], LIGADO);
  await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("a pizza (e o órfão, que aparece em toda tela) prontos; a esfiha segura", await tv("finishing", F_PIZZA.id), []);
  await acao({ action: "finish_production", tela: P_ESFIHA.id });
  confere("a esfiha pronta: entra", await tv("finishing", F_PIZZA.id), ["o22"]);

  console.log("\n— Combo de pizza com as esfihas doces feitas na Produção Esfiha —");
  montar([comboPizzaEsfihas()], COM_COMBO);
  r = await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("a Pizza carimba o combo e o pedido vai para a etapa de finalização", [!!prontoDe("c1"), db.order.kdsStage], [true, "FINISHING"]);
  confere("as doces ainda na Produção Esfiha: não aparece na finalização", await tv("finishing", F_PIZZA.id), []);
  confere("a Produção Esfiha vê o pedido (as doces)", await tv("production", P_ESFIHA.id), ["o22"]);
  r = await acao({ action: "finish_production", tela: P_ESFIHA.id });
  confere("a Produção Esfiha dá baixa nas doces", r.corpo.carimbados, ["c1#op0"]);
  confere("agora entra na finalização", await tv("finishing", F_PIZZA.id), ["o22"]);
  const baixaDaEsfiha = db.order.kdsBaixas.find((b: any) => b.tela === P_ESFIHA.id)?.em;
  confere("o relógio conta da baixa das doces (a última)", relogio(), baixaDaEsfiha);

  montar([comboPizzaEsfihas()], COM_COMBO);
  await acao({ action: "finish_production", tela: P_ESFIHA.id });
  confere("doces primeiro: o pedido não sai da produção (o combo segue na Pizza)", db.order.kdsStage, "PRODUCTION");
  await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("a Pizza fecha: entra na finalização", await tv("finishing", F_PIZZA.id), ["o22"]);
  confere("relógio na baixa da pizza", relogio(), prontoDe("c1"));

  console.log("\n— Regra desligada (como a NIK está hoje): a primeira baixa leva —");
  montar([pizza(), esfiha()], DESLIGADO);
  await acao({ action: "finish_production", tela: P_ESFIHA.id });
  confere("aparece na Finalização Pizza já na baixa da esfiha", await tv("finishing", F_PIZZA.id), ["o22"]);
  const daEsfiha = relogio();
  confere("relógio na primeira baixa", daEsfiha, prontoDe("e1"));
  await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("a baixa da pizza não mexe no relógio", relogio(), daEsfiha);

  console.log("\n— Regra ligada com UMA tela de produção: igual a hoje —");
  montar([pizza(), esfiha()], LIGADO, SO_UMA_PRODUCAO);
  await acao({ action: "finish_production", tela: P_PIZZA.id });
  confere("a baixa da pizza já leva para a finalização", await tv("finishing", F_PIZZA.id), ["o22"]);

  console.log("\n— Ordem da finalização com a regra: pela chegada nela (a última baixa) —");
  const cedo = { id: "a", createdAt: "2026-10-28T22:00:00Z", kdsFinishingAt: "2026-10-28T22:20:00Z", items: [] };
  const tarde = { id: "b", createdAt: "2026-10-28T22:05:00Z", kdsFinishingAt: "2026-10-28T22:10:00Z", items: [] };
  confere("ligada: quem terminou a produção antes vem antes", kds.ordenarPelaPrioridade([cedo, tarde], kds.lerKdsConfig(LIGADO), "finishing", TELAS_NIK as any).map((p) => p.id), ["b", "a"]);
  confere("desligada: ordem de chegada do pedido, como antes", kds.ordenarPelaPrioridade([cedo, tarde], kds.lerKdsConfig(DESLIGADO), "finishing", TELAS_NIK as any).map((p) => p.id), ["a", "b"]);
  confere("ligada, na produção: nada muda", kds.ordenarPelaPrioridade([cedo, tarde], kds.lerKdsConfig(LIGADO), "production", TELAS_NIK as any).map((p) => p.id), ["a", "b"]);

  console.log("\n— Salvar a prioridade na TV não apaga a regra —");
  montar([], { soNaFinalizacao: ["Bebidas"], finalizacaoSoComTudoPronto: true });
  await kdsConfigRota.PUT(new NextRequest("http://localhost/api/store/kds-config", { method: "PUT", body: JSON.stringify({ prioridade: ["MESA"] }) }));
  confere("continua ligada, com a bebida e a prioridade", [db.user.kdsConfig.finalizacaoSoComTudoPronto, db.user.kdsConfig.soNaFinalizacao, db.user.kdsConfig.prioridade], [true, ["Bebidas"], ["MESA"]]);
  await kdsConfigRota.PUT(new NextRequest("http://localhost/api/store/kds-config", { method: "PUT", body: JSON.stringify({ finalizacaoSoComTudoPronto: false }) }));
  confere("desliga pelo mesmo PUT", db.user.kdsConfig.finalizacaoSoComTudoPronto, false);

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
