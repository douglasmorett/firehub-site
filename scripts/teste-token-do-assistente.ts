/**
 * scripts/teste-token-do-assistente.ts — o token da loja na fila da nuvem
 * (lib/token-do-assistente.ts), fase 1: token certo passa, de outra loja ou
 * adulterado é 403, sem token passa como sempre (Assistente 1.2.45 e antes).
 *
 *   npx tsx scripts/teste-token-do-assistente.ts
 *
 * Roda também as ROTAS de verdade (GET e POST /api/store/print-queue e o
 * /ack) contra um banco falso em memória, como scripts/teste-fila-tem-algo.ts.
 * Não toca em banco nenhum.
 */
import { createRequire } from "module";
export {};

process.env.DATABASE_URL = "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET = "segredo-so-do-teste-do-token";
delete process.env.FIREHUB_LOCAL;

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

const LOJA = "loja_token_teste";
const OUTRA = "loja_token_outra";

// ── Banco falso (o mesmo desenho de teste-fila-tem-algo.ts) ────────────────
const pedidoNovo = {
  id: "pedido_do_token", franchiseeId: LOJA, dailyOrderNumber: 3, source: "SITE", status: "NOVO",
  createdAt: new Date(), printedAt: null, parentOrderId: null, kdsFinishedAt: null, deliveryType: "DELIVERY",
  customerName: "Cliente", customerPhone: "22999999999", customerAddress: "Rua A, 1 - Centro - Macaé",
  paymentMethod: "Pix", totalAmount: 40, deliveryFee: 5, discountTotal: 0, notes: null,
  franchisee: { storeName: "Loja do Token", name: "Dono" }, tableSession: null,
  items: [{ id: "i1", orderId: "pedido_do_token", menuProductId: null, menuProduct: null, notes: null, quantity: 1, price: 35, productName: "X-Burger", comboSelections: null }],
};
const dono = () => ({
  id: LOJA,
  printerConfig: { printers: [{ id: "1", name: "ELGIN i9", label: "Cozinha", copies: 1, modulos: ["salao", "delivery"], categories: [], paperWidth: "80mm" }], autoprint: true },
  storeName: "Loja do Token", name: "Dono", slug: "loja-do-token", storeLoyalty: null, city: "MACAE",
  printQueuePolledAt: new Date(), printQueueEstado: { versao: "1.2.45" },
});
const chamadas = { ack: 0, reimpressao: 0 };
const vazio = (metodo: string) => async () =>
  metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
const tabela = (feitos: Record<string, any> = {}) => new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
(globalThis as any).prisma = new Proxy(
  {
    user: tabela({
      findUnique: async ({ where }: any) =>
        where?.id === LOJA ? dono() : where?.email === "garcom@loja.teste" ? { id: "func_1", ownerId: LOJA } : null,
      update: async () => dono(),
    }),
    customerOrder: tabela({
      findMany: async ({ where, include }: any) => (include?.items && where?.franchiseeId === LOJA ? [pedidoNovo] : []),
      updateMany: async () => { chamadas.ack++; return { count: 1 }; },
    }),
    printRequest: tabela({
      create: async () => { chamadas.reimpressao++; return { id: "pr_1" }; },
    }),
    $queryRaw: async () => [],
  },
  { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
);

// A sessão do painel fica fora do teste (fora de uma requisição do Next o
// getServerSession de verdade não roda): POST sem sessão, como o Assistente.
let sessao: string | null = null;
const req_ = createRequire(import.meta.url);
const sessaoArq = req_.resolve("next-auth/next");
req_.cache[sessaoArq] = { id: sessaoArq, filename: sessaoArq, loaded: true, exports: { __esModule: true, getServerSession: async () => (sessao ? { user: { email: sessao } } : null) } } as any;

async function main() {
  const lib = await import("../src/lib/token-do-assistente");
  const { criarTokenDoAssistente, conferirTokenDoAssistente, barrarChamadaDaFila, CABECALHO_DO_TOKEN_DO_ASSISTENTE: H, RECUSA_DO_TOKEN, EXIGIR_TOKEN_DO_ASSISTENTE, semTokenDoAssistente } = lib;
  const { NextRequest } = await import("next/server");
  const doAssistente = req_("../firehub-print-assistant/token-da-nuvem.js");

  const certo = criarTokenDoAssistente(LOJA);
  const daOutra = criarTokenDoAssistente(OUTRA);
  const adulterado = certo.slice(0, -1) + (certo.endsWith("0") ? "1" : "0");
  const outraLojaMesmaAssinatura = `${OUTRA}.${certo.split(".")[1]}`;

  console.log("\n[1] O token");
  confere(EXIGIR_TOKEN_DO_ASSISTENTE === false, "fase 1: a exigência está desligada");
  confere(conferirTokenDoAssistente(certo, LOJA) === "valido", "token certo da loja confere");
  confere(conferirTokenDoAssistente(daOutra, LOJA) === "invalido", "token de outra loja não vale para esta");
  confere(conferirTokenDoAssistente(outraLojaMesmaAssinatura, OUTRA) === "invalido", "assinatura de uma loja colada no id de outra não vale");
  confere(conferirTokenDoAssistente(adulterado, LOJA) === "invalido", "assinatura adulterada não vale");
  confere(conferirTokenDoAssistente(LOJA, LOJA) === "invalido", "o id cru da loja não vale como token");
  confere(conferirTokenDoAssistente(null, LOJA) === "ausente" && conferirTokenDoAssistente("  ", LOJA) === "ausente", "sem token = ausente");
  confere(conferirTokenDoAssistente(certo, null) === "invalido", "token sem loja pedida não vale");
  const { criarTokenDeExtensao } = await import("../src/lib/extensao-token");
  confere(conferirTokenDoAssistente(criarTokenDeExtensao(LOJA), LOJA) === "invalido", "o token da extensão não vale como token do Assistente");
  confere(doAssistente.tokenDaLoja(certo, LOJA) === true, "o formato que o site cria é o que o Assistente aceita guardar");

  process.env.FIREHUB_LOCAL = "1";
  confere(conferirTokenDoAssistente(daOutra, LOJA) === "local", "no FireHub local (contingência) o token é ignorado");
  confere(barrarChamadaDaFila(new Headers({ [H]: adulterado }), LOJA, "fila") === null, "no FireHub local nem token ruim barra");
  delete process.env.FIREHUB_LOCAL;

  console.log("\n[2] A porta das rotas");
  confere(barrarChamadaDaFila(new Headers({ [H]: certo }), LOJA, "fila") === null, "token certo passa");
  const recusa = barrarChamadaDaFila(new Headers({ [H]: daOutra }), LOJA, "fila");
  confere(recusa?.status === 403, "token de outra loja: 403");
  confere((await recusa?.json())?.motivo === RECUSA_DO_TOKEN, "o 403 leva a marca que o Assistente reconhece");
  confere(barrarChamadaDaFila(new Headers(), LOJA, "fila") === null, "sem token passa (fase 1)");
  confere(barrarChamadaDaFila(new Headers({ cookie: "__Secure-next-auth.session-token=abc" }), LOJA, "ack") === null, "navegador com sessão e sem token passa");
  confere((semTokenDoAssistente().get(`fila|${LOJA}|nao`)?.vezes || 0) >= 1, "chamada sem token do Assistente fica contada");
  confere((semTokenDoAssistente().get(`ack|${LOJA}|sim`)?.vezes || 0) >= 1, "chamada sem token do navegador fica contada à parte");

  console.log("\n[3] GET /api/store/print-queue (rota de verdade, banco falso)");
  const { GET, POST } = await import("../src/app/api/store/print-queue/route");
  const { POST: ACK } = await import("../src/app/api/store/print-queue/ack/route");
  const { esquecerTudo } = await import("../src/lib/cache-curto");
  const { marcarNovidade } = await import("../src/lib/novidade-da-loja");
  const consultar = async (headers: Record<string, string>, ip: string) => {
    esquecerTudo(); marcarNovidade(LOJA);
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.46&pendentes=0&abertoHaSeg=7200`, { headers: { "x-forwarded-for": ip, ...headers } }));
    return { status: res.status, corpo: await res.json().catch(() => null) as any };
  };
  const semToken = await consultar({}, "10.8.8.1");
  confere(semToken.status === 200 && semToken.corpo?.jobs?.some((j: any) => j?.order?.id === "pedido_do_token"), "Assistente antigo (sem token): recebe o pedido como sempre");
  const comToken = await consultar({ [H]: certo }, "10.8.8.2");
  confere(comToken.status === 200 && comToken.corpo?.jobs?.some((j: any) => j?.order?.id === "pedido_do_token"), "Assistente com o token da loja: recebe o pedido");
  const comOutro = await consultar({ [H]: daOutra }, "10.8.8.3");
  confere(comOutro.status === 403 && !comOutro.corpo?.jobs, "token de outra loja: 403 e nenhum pedido");
  const comAdulterado = await consultar({ [H]: adulterado }, "10.8.8.4");
  confere(comAdulterado.status === 403, "token adulterado: 403");

  console.log("\n[4] POST /api/store/print-queue/ack");
  const confirmar = async (headers: Record<string, string>) => {
    const antes = chamadas.ack;
    const res = await ACK(new NextRequest("https://firehubfood.com.br/api/store/print-queue/ack", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ franchiseeId: LOJA, ids: ["job_pedido_do_token"] }),
    }));
    return { status: res.status, gravou: chamadas.ack > antes };
  };
  const ackSem = await confirmar({});
  confere(ackSem.status === 200 && ackSem.gravou, "sem token: carimba como sempre");
  const ackCerto = await confirmar({ [H]: certo });
  confere(ackCerto.status === 200 && ackCerto.gravou, "token certo: carimba");
  const ackOutro = await confirmar({ [H]: daOutra });
  confere(ackOutro.status === 403 && !ackOutro.gravou, "token de outra loja: 403 e nada carimbado");

  console.log("\n[5] POST /api/store/print-queue (reimpressão)");
  const reimprimir = async (headers: Record<string, string>) => {
    const antes = chamadas.reimpressao;
    const res = await POST(new NextRequest("https://firehubfood.com.br/api/store/print-queue", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ franchiseeId: LOJA, order: { id: "x", items: [] } }),
    }));
    return { status: res.status, gravou: chamadas.reimpressao > antes, corpo: await res.json().catch(() => null) as any };
  };
  const reSem = await reimprimir({});
  confere(reSem.status === 200 && reSem.gravou, `sem token: enfileira como sempre (${reSem.status} ${reSem.corpo?.error || ""})`);
  const reCerto = await reimprimir({ [H]: certo });
  confere(reCerto.status === 200 && reCerto.gravou, "token certo: enfileira");
  const reOutro = await reimprimir({ [H]: daOutra });
  confere(reOutro.status === 403 && !reOutro.gravou, "token de outra loja: 403 e nada enfileirado");

  console.log("\n[6] O lado do Assistente (firehub-print-assistant/token-da-nuvem.js)");
  const A = doAssistente;
  confere(A.tokenDepoisDoConfig(undefined, certo, LOJA) === certo, "/config com token da loja: guarda");
  confere(A.tokenDepoisDoConfig(certo, undefined, LOJA) === certo, "/config sem token (tela antiga, rota falhou): fica o que tinha");
  confere(A.tokenDepoisDoConfig(certo, undefined, OUTRA) === undefined, "trocou a loja sem token novo: o velho sai");
  confere(A.tokenDepoisDoConfig(certo, daOutra, LOJA) === certo, "token de outra loja no /config: não troca o certo");
  confere(A.tokenDepoisDoConfig(undefined, "x".repeat(5000), LOJA) === undefined, "lixo no /config não entra");
  confere(A.cabecalhosDaFila({ franchiseeId: LOJA, token: certo })[H] === certo, "manda o token no cabeçalho da fila");
  confere(Object.keys(A.cabecalhosDaFila({ franchiseeId: LOJA })).length === 0, "sem token: chamada como a do Assistente antigo");
  confere(Object.keys(A.cabecalhosDaFila({ franchiseeId: OUTRA, token: certo })).length === 0, "token de outra loja guardado: não vai");
  confere(Object.keys(A.cabecalhosDaFila({ franchiseeId: LOJA, token: certo }, { naContingencia: true })).length === 0, "contingência (fila do computador): não vai");
  confere(Object.keys(A.cabecalhosDaFila({ franchiseeId: LOJA, token: certo }, { recusado: true })).length === 0, "depois da recusa: não vai");
  const r403 = barrarChamadaDaFila(new Headers({ [H]: daOutra }), LOJA, "fila")!;
  confere(await A.ehRecusaDoToken(r403) === true, "reconhece o 403 da recusa do token");
  confere(await A.ehRecusaDoToken(new Response("<html>bloqueado</html>", { status: 403 })) === false, "403 qualquer do caminho não larga o token");
  confere(await A.ehRecusaDoToken(new Response("{}", { status: 500 })) === false, "500 não larga o token");

  console.log("\n[7] GET /api/store/token-do-assistente");
  const { GET: TOKEN } = await import("../src/app/api/store/token-do-assistente/route");
  sessao = null;
  confere((await TOKEN()).status === 401, "sem sessão: 401");
  sessao = "garcom@loja.teste";
  const j = await (await TOKEN()).json();
  confere(j.franchiseeId === LOJA && conferirTokenDoAssistente(j.token, LOJA) === "valido", "com sessão (funcionário): o token é o da loja do dono");
  process.env.FIREHUB_LOCAL = "1";
  confere((await (await TOKEN()).json()).token === null, "no FireHub local: sem token");
  delete process.env.FIREHUB_LOCAL;
  sessao = null;
}

main()
  .then(() => { console.log(`\n${ok} ok, ${falhas} falha(s)`); process.exit(falhas ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
