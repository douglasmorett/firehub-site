import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://localhost:1/firehub_test";

type Gravar = (entrada: { args: any; query: (args: any) => Promise<unknown> }) => Promise<unknown>;
const gravacoes: Record<string, Gravar> = {};
const pedidos = new Map<string, string>();
const baixas: string[] = [];
const timers: (() => void)[] = [];
let falhar = false;

function mock(path: string, exports: object) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports: { __esModule: true, ...exports } } as NodeModule;
}

class BancoFalso {
  customerOrder = {
    findUnique: async ({ where }: { where: { id: string } }) => ({ status: pedidos.get(where.id) }),
  };
  $extends(extension: { query: { customerOrder: Record<string, Gravar> } }) {
    Object.assign(gravacoes, extension.query.customerOrder);
    return this;
  }
}

async function main() {
  mock("@prisma/client", { PrismaClient: BancoFalso });
  mock("../src/lib/stock", {
    deductStockForOrder: async (id: string) => {
      if (falhar) {
        falhar = false;
        return "FALHOU";
      }
      baixas.push(id);
    },
  });
  mock("../src/lib/app-firehub/aviso-de-pedido", { avisarPedidoNovo: async () => {} });
  mock("../src/lib/acrescimo-segue-o-pai", { acrescimosSeguemOPai: async () => {} });
  mock("../src/lib/foody-no-banco", { foodyDepoisDoStatus: async () => {} });
  await import("../src/lib/prisma");

  const setTimeoutReal = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => { timers.push(fn); }) as typeof setTimeout;
  try {
    const rodada = async () => {
      timers.splice(0).forEach((fn) => fn());
      await new Promise((resolve) => setTimeoutReal(resolve, 50));
    };
    const criar = async (id: string, source: string, status: string) => {
      await gravacoes.create({
        args: { data: { source, status } },
        query: async () => { pedidos.set(id, status); return { id, status }; },
      });
    };
    await criar("site", "SITE", "NOVO");
    await criar("robo", "WHATSAPP_IA", "NOVO");
    await criar("99", "99FOOD", "ACEITO");
    await criar("totem", "TOTEM", "AGUARDANDO_PAGAMENTO");
    await criar("rascunho", "WHATSAPP_IA", "CRIANDO_IA");
    await criar("cancelado", "IFOOD", "NOVO");
    pedidos.set("cancelado", "CANCELADO");
    await rodada();
    assert.deepEqual([...baixas].sort(), ["99", "robo", "site"]);

    falhar = true;
    await gravacoes.updateMany({
      args: { where: { id: "totem" }, data: { status: "NOVO" } },
      query: async () => { pedidos.set("totem", "NOVO"); return { count: 1 }; },
    });
    await rodada();
    assert(!baixas.includes("totem"));
    await rodada();
    assert(baixas.includes("totem"));
    console.log("Entrada de site, robô e 99Food, pagamento, rascunho, cancelamento e nova tentativa verificados.");
  } finally {
    globalThis.setTimeout = setTimeoutReal;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
