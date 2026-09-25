/**
 * /api/store-settings (GET e PUT) numa conta de FUNCIONÁRIO (User com
 * ownerId): a entrega é da loja — a linha do dono —, como em
 * /api/delivery-fee e /api/store/orders/presencial (`ownerId || id`).
 *
 *   npx tsx scripts/teste-loja-do-painel.ts
 *
 * O caso da revisão do cluster D (25/09/2026): o gerente abria Minha Loja >
 * Entrega (que mostra o cadastro do DONO), cadastrava as 9 faixas da Divinos
 * e salvava. O PUT gravava na linha do gerente, o GET conferia a mesma linha e
 * a tela dizia "salvo" — o cardápio seguia cobrando pela tabela do dono.
 *
 * Sem banco e sem sessão de verdade: o Prisma é trocado por um falso
 * (globalThis.prisma, que lib/prisma.ts reaproveita fora de produção) e o
 * `getServerSession` do next-auth por um que devolve a sessão do teste.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";
process.env.NEXTAUTH_SECRET ||= "segredo-de-teste";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; return; }
  falhas++;
  console.log(`✖ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe).slice(0, 500) : ""}`);
}

const TABELA_DO_DONO = [{ km: 1, fee: 5, time: 30 }, { km: 3, fee: 8, time: 45 }, { km: 5, fee: 12, time: 60 }];
const DIVINOS = [
  [1, 5, 4], [1.5, 8, 7], [2, 10, 9], [2.5, 12, 11], [3, 15, 14],
  [3.5, 17, 16], [4, 18, 17], [4.5, 19, 18], [5, 20, 19],
].map(([km, fee, motoboyFee]) => ({ km, fee, time: 40, motoboyFee }));

type Linha = Record<string, any>;
let linhas: Map<string, Linha>;
let escritas: { id: string; data: Linha }[];
function reiniciar() {
  linhas = new Map<string, Linha>([
    ["dono", {
      id: "dono", email: "dono@divinos.test", role: "FRANCHISEE", ownerId: null, slug: "divinos", city: "Cabo Frio",
      deliveryZoneType: "ROTA", deliveryZones: TABELA_DO_DONO, storeLatLng: { lat: -22.854033, lng: -42.0296526 },
      storeAddress: "Tv Liberdade 11",
      deliveryConfig: { freeShippingActive: true, freeShippingMinValue: 80, repasseDoEntregador: { separado: true, marketplace: "FIXO", valorFixoApp: 6 } },
    }],
    ["gerente", {
      id: "gerente", email: "gerente@divinos.test", role: "FRANCHISEE", ownerId: "dono", slug: null, city: "Cabo Frio",
      deliveryZoneType: null, deliveryZones: null, storeLatLng: null, storeAddress: null, deliveryConfig: null,
    }],
  ]);
  escritas = [];
}
reiniciar();

const escolher = (linha: Linha | undefined, select?: Record<string, boolean>) => {
  if (!linha) return null;
  const copia = JSON.parse(JSON.stringify(linha));
  if (!select) return copia;
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, copia[k] ?? null]));
};
const acharPor = (where: any) =>
  where?.id ? linhas.get(where.id) : [...linhas.values()].find((l) => l.email === where?.email);

(globalThis as any).prisma = {
  user: {
    findUnique: async ({ where, select }: any) => escolher(acharPor(where), select),
    findFirst: async () => null,
    update: async ({ where, data }: any) => {
      const linha = linhas.get(where.id);
      if (!linha) throw new Error(`linha ${where.id} não existe`);
      escritas.push({ id: where.id, data: JSON.parse(JSON.stringify(data)) });
      Object.assign(linha, JSON.parse(JSON.stringify(data)));
      return linha;
    },
    updateMany: async () => ({ count: 0 }),
  },
  $transaction: async (operacoes: Promise<unknown>[]) => Promise.all(operacoes),
};

// A sessão do teste no lugar da do next-auth.
let sessao: { user: { email: string } } | null = null;
const Modulo = require("module");
const carregarOriginal = Modulo._load;
Modulo._load = function (pedido: string, ...resto: unknown[]) {
  if (pedido === "next-auth/next") return { getServerSession: async () => sessao };
  return carregarOriginal.call(this, pedido, ...resto);
};

async function main() {
  const { GET, PUT } = await import("../src/app/api/store-settings/route");
  const put = (corpo: unknown) =>
    PUT(new Request("http://teste/api/store-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }));

  // ── GET: o funcionário lê a entrega da LOJA ──────────────────────────────
  sessao = { user: { email: "gerente@divinos.test" } };
  {
    const r = await GET();
    const d: any = await r.json();
    confere("GET do gerente: a tabela do dono (não a linha vazia dele)",
      r.status === 200 && d.entrega.deliveryZoneType === "ROTA" && d.entrega.deliveryZones.length === 3, d);
    confere("GET do gerente: o repasse por faixa do dono (separado: true), não 'pelo acerto'",
      d.entrega.repasseDoEntregador.separado === true && d.entrega.repasseDoEntregador.marketplace === "FIXO", d.entrega.repasseDoEntregador);
    confere("GET do gerente: o pino do dono", d.entrega.storeLatLng?.lat === -22.854033);
  }

  // ── PUT: o gerente cadastra as 9 faixas da Divinos ───────────────────────
  {
    reiniciar();
    const r = await put({
      storePhone: "22999990000",
      deliveryZoneType: "ROTA",
      deliveryZones: DIVINOS,
      storeLatLng: { lat: -22.8541, lng: -42.0297 },
      areasDeRisco: [{ nome: "Morro", pontos: [[-22.85, -42.02], [-22.86, -42.02], [-22.86, -42.03]] }],
    });
    const d: any = await r.json();
    const dono = linhas.get("dono")!, gerente = linhas.get("gerente")!;
    confere("PUT do gerente: 200", r.status === 200, d);
    confere("as 9 faixas vão para a LINHA DO DONO (a que o cardápio lê)",
      Array.isArray(dono.deliveryZones) && dono.deliveryZones.length === 9 && dono.deliveryZones[8].motoboyFee === 19, dono.deliveryZones);
    confere("o pino vai para o dono", dono.storeLatLng?.lat === -22.8541);
    confere("a área de risco vai para o dono, sem apagar o frete grátis nem a regra do repasse",
      dono.deliveryConfig.areasDeRisco?.length === 1 && dono.deliveryConfig.freeShippingActive === true && dono.deliveryConfig.repasseDoEntregador?.separado === true,
      dono.deliveryConfig);
    confere("nada de entrega na linha do gerente",
      gerente.deliveryZones == null && gerente.storeLatLng == null && gerente.deliveryConfig == null, gerente);
    confere("o resto continua na linha de quem salvou (como sempre foi)", gerente.storePhone === "22999990000" && dono.storePhone === undefined);

    // A conferência da tela (GET depois do PUT) enxerga o que foi gravado.
    const g: any = await (await GET()).json();
    confere("a conferência do gerente vê as 9 faixas gravadas", g.entrega.deliveryZones.length === 9, g.entrega.deliveryZones?.length);
  }

  // ── PUT: a escolha "um valor por faixa" (tela de Entrega) e a regra do app (aba Motoboys)
  {
    reiniciar();
    await put({ repasseDoEntregador: { separado: false } });
    const dono = linhas.get("dono")!;
    confere("separado:false do gerente grava no dono e mantém a regra do app",
      dono.deliveryConfig.repasseDoEntregador.separado === false && dono.deliveryConfig.repasseDoEntregador.marketplace === "FIXO" && dono.deliveryConfig.repasseDoEntregador.valorFixoApp === 6,
      dono.deliveryConfig.repasseDoEntregador);
    confere("…sem apagar o frete grátis", dono.deliveryConfig.freeShippingActive === true && dono.deliveryConfig.freeShippingMinValue === 80);
    confere("…e a linha do gerente fica como estava", linhas.get("gerente")!.deliveryConfig == null);
  }

  // ── PUT: o "manter" compara com o cadastro DO DONO ───────────────────────
  {
    reiniciar();
    await put({ deliveryZoneType: "ROTA", deliveryZones: TABELA_DO_DONO, storeName: "Divinos Burger" });
    const tocouNaEntrega = escritas.some((e) => "deliveryZones" in e.data || "deliveryZoneType" in e.data);
    confere("mesma tabela do dono vinda da tela do gerente: nada é regravado", !tocouNaEntrega, escritas);
  }

  // ── PUT: cadastro inválido do gerente é recusado sem gravar nada ─────────
  {
    reiniciar();
    const r = await put({ deliveryZoneType: "ROTA", deliveryZones: [{ km: 2, fee: 5, time: 30 }, { km: 2, fee: 6, time: 30 }] });
    confere("km repetido: 400 e nenhuma escrita", r.status === 400 && escritas.length === 0, { status: r.status, escritas });
  }

  // ── O dono continua igual: uma escrita, na linha dele ────────────────────
  {
    reiniciar();
    sessao = { user: { email: "dono@divinos.test" } };
    const r = await put({ deliveryZoneType: "ROTA", deliveryZones: DIVINOS, storePhone: "22988887777" });
    const dono = linhas.get("dono")!;
    confere("dono: 200, uma escrita só, com a entrega e o resto juntos",
      r.status === 200 && escritas.length === 1 && escritas[0].id === "dono" && dono.deliveryZones.length === 9 && dono.storePhone === "22988887777",
      escritas);
    const g: any = await (await GET()).json();
    confere("GET do dono: a linha dele", g.entrega.deliveryZones.length === 9);
  }

  // ── Sem sessão ───────────────────────────────────────────────────────────
  sessao = null;
  confere("GET sem sessão: 401", (await GET()).status === 401);

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
