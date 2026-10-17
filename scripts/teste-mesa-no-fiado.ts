/**
 * MESA NO FIADO e SENHA DO GERENTE — pedido do Allan (Delícia de Casa),
 * decidido pelo Douglas em 17/10/2026. Rodar:
 *
 *   npx tsx scripts/teste-mesa-no-fiado.ts
 *
 * Sem banco nenhum. Quatro provas:
 *
 *  1. A REGRA DA SENHA (lib/senha-do-gerente-regras.ts): o que vem desligado,
 *     quando pede, a conferência com o bcrypt de verdade e o freio de 5
 *     tentativas em 15 minutos.
 *  2. A VENDA NÃO CONTA DUAS VEZES: a mesa que vai para o fiado é UMA venda
 *     (os pedidos dela), a parte fiada sai da gaveta e cai em "fiado" no
 *     fechamento do caixa (lib/apuracao-do-turno.ts), e o saldo do cliente
 *     soma a conta da mesa sem pedido novo nenhum.
 *  3. AS ROTAS DE VERDADE, com o Prisma trocado por um falso em memória
 *     (globalThis.prisma) e a sessão do painel trocada por uma de mentira
 *     (jiti com alias de next-auth e next/headers): a senha é conferida NO
 *     SERVIDOR — sem ela, com ela errada e com ela certa — em
 *       • DELETE /api/motoboy-report/pendencias (excluir na conferência);
 *       • POST   /api/store/table-sessions/[id]/close com `fiado` (a mesa vira
 *         dívida e é liberada, sem criar pedido);
 *       • POST   /api/store/employees/[id]/debt (dívida à mão);
 *       • POST   /api/store/orders/presencial com "Conta Funcionário".
 *  4. A baixa "Fiado" solta numa mesa é recusada (só entra pelo "Lançar no fiado").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import bcrypt from "bcryptjs";
import {
  ACOES_PROTEGIDAS, FreioDaSenha, conferirSenhaDoGerenteCom, decisaoDaSenha, lerExigeSenha, problemaDaNovaSenha,
  senhaDoCabecalho, CODIGO_SENHA_ERRADA, CODIGO_SENHA_PEDIDA, CODIGO_SENHA_TRANCADA, type ConfigDaSenha,
} from "../src/lib/senha-do-gerente-regras";
import {
  FORMA_DO_FIADO_NA_MESA, descricaoDaMesaNoFiado, lerClienteDoFiado, saldoDoFiado, valorParaOFiado,
} from "../src/lib/fiado-da-mesa-regras";
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";
import { atendimentosDaVenda } from "../src/lib/relatorios/regua-da-venda";
import { formaDoTexto } from "../src/lib/relatorios/formas-de-pagamento";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createJiti } = require("jiti");

const RAIZ = resolve(__dirname, "..");
let ok = 0, falhou = 0;
const exigir = (nome: string, condicao: boolean, detalhe?: unknown) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe !== undefined ? "  → " + JSON.stringify(detalhe) : "")); }
};
const c = (v: number) => Math.round(v * 100);
const igual = (a: number, b: number) => c(a) === c(b);

async function provarARegraDaSenha() {
  console.log("\n1. A regra da senha");
  const nada = lerExigeSenha(null);
  exigir("toda ação nasce desligada", ACOES_PROTEGIDAS.every((a) => nada[a.chave] === false), nada);
  exigir("só true liga (\"sim\" e 1 não)", lerExigeSenha({ fiado: "sim", excluirPendenciaDoMotoboy: 1 }).fiado === false);
  exigir("senha curta é recusada", problemaDaNovaSenha("12") !== null && problemaDaNovaSenha("1234") === null);

  const hash = await bcrypt.hash("1234", 4);
  const ligada: ConfigDaSenha = { hash, exige: lerExigeSenha({ fiado: true }) };
  exigir("ação desligada: livre", decisaoDaSenha(ligada, "excluirPendenciaDoMotoboy", null) === "livre");
  exigir("ligada sem senha cadastrada: livre (não tranca a loja)", decisaoDaSenha({ hash: null, exige: ligada.exige }, "fiado", null) === "livre");
  exigir("ligada e sem senha na requisição: pede", decisaoDaSenha(ligada, "fiado", "") === "pedir");
  exigir("ligada e com senha: confere", decisaoDaSenha(ligada, "fiado", "9") === "conferir");
  exigir("acento no cabeçalho volta inteiro", senhaDoCabecalho(encodeURIComponent("pão123")) === "pão123");

  let agora = 1_000_000;
  const freio = new FreioDaSenha(5, 15 * 60_000, () => agora);
  const deps = { lerConfig: async () => ligada, comparar: (s: string, h: string) => bcrypt.compare(s, h), freio };
  const sem = await conferirSenhaDoGerenteCom(deps, "loja", "fiado", null);
  exigir("sem senha: 403 PEDIDA", !sem.ok && sem.status === 403 && sem.codigo === CODIGO_SENHA_PEDIDA, sem);
  const certa = await conferirSenhaDoGerenteCom(deps, "loja", "fiado", "1234");
  exigir("senha certa passa (bcrypt de verdade)", certa.ok, certa);
  let ultima: any = null;
  for (let i = 0; i < 5; i++) ultima = await conferirSenhaDoGerenteCom(deps, "loja", "fiado", "0000");
  exigir("5ª errada: ERRADA, 0 restantes", !ultima.ok && ultima.codigo === CODIGO_SENHA_ERRADA && ultima.restam === 0, ultima);
  const trancada = await conferirSenhaDoGerenteCom(deps, "loja", "fiado", "1234");
  exigir("depois de 5 erros, até a certa é barrada (429)", !trancada.ok && trancada.status === 429 && trancada.codigo === CODIGO_SENHA_TRANCADA, trancada);
  const outraLoja = await conferirSenhaDoGerenteCom(deps, "outra-loja", "fiado", "1234");
  exigir("o freio é por loja", outraLoja.ok, outraLoja);
  agora += 15 * 60_000 + 1;
  exigir("passados 15 min, destrava", (await conferirSenhaDoGerenteCom(deps, "loja", "fiado", "1234")).ok);
  await conferirSenhaDoGerenteCom(deps, "loja", "fiado", "0000");
  await conferirSenhaDoGerenteCom(deps, "loja", "fiado", "1234");
  const depoisDoAcerto = await conferirSenhaDoGerenteCom(deps, "loja", "fiado", "0000");
  exigir("acertar zera a contagem (4 restantes de novo)", !depoisDoAcerto.ok && (depoisDoAcerto as any).restam === 4, depoisDoAcerto);
}

function provarQueAVendaNaoContaDuasVezes() {
  console.log("\n2. A venda não conta duas vezes");
  exigir("valor do fiado = o que falta da conta", (() => { const v = valorParaOFiado({ totalDaConta: 63.59, jaPago: 20 }); return v.ok && igual(v.valor, 43.59); })());
  exigir("mesa já paga não vai para o fiado", !valorParaOFiado({ totalDaConta: 63.59, jaPago: 63.59 }).ok);
  exigir("cliente existente pelo id", (() => { const r = lerClienteDoFiado({ clienteId: "e1" }); return r.ok && r.cliente.tipo === "existente"; })());
  exigir("cliente novo precisa de nome", !lerClienteDoFiado({ novoCliente: { nome: " " } }).ok);
  exigir("telefone do cliente novo só com 8+ dígitos", (() => { const r = lerClienteDoFiado({ novoCliente: { nome: "Ana", telefone: "(22) 9999" } }); return r.ok && r.cliente.tipo === "novo" && r.cliente.telefone === null; })());
  exigir("a baixa \"Fiado\" da mesa é FIADO para o caixa e os relatórios", formaDoTexto(FORMA_DO_FIADO_NA_MESA) === "FIADO");
  exigir("descrição da dívida junta os itens", descricaoDaMesaNoFiado({ numero: 9, itens: [{ nome: "Pastel", quantidade: 2 }, { nome: "Coca", quantidade: 1 }, { nome: "Pastel", quantidade: 1 }] }) === "Mesa 9: 3× Pastel, 1× Coca");

  // A mesa 9 da Delícia de Casa: R$ 40 + R$ 23,59 lançados, R$ 20 pagos em
  // dinheiro na mesa, o resto (R$ 43,59) no fiado da Ana. E uma venda de
  // balcão no fiado, para comparar com o caminho que já existia.
  const h = (hhmm: string) => new Date(`2026-10-17T${hhmm}:00-03:00`);
  const base = { discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, openDeliveryChannel: null, discountDetails: null, ifoodOrderId: null, ifoodReference: null,
    openDeliveryOrderId: null, openDeliveryReference: null, paymentMethods: null, paymentPaidAt: null, gatewayProvider: null, employeeName: null, deliveryBy: null,
    motoboyId: null, motoboyFee: null, deliveryDistance: null, totemLicenseId: null, deliveryFee: 0, source: "PRESENCIAL", status: "ENTREGUE" };
  const pedidos: any[] = [
    { ...base, id: "p1", dailyOrderNumber: 1, createdAt: h("19:00"), deliveryType: "MESA", tableSessionId: "mesa-9", paymentMethod: "N/A", customerName: "Mesa 9", totalAmount: 40, items: [{ price: 20, quantity: 2 }] },
    { ...base, id: "p2", dailyOrderNumber: 2, createdAt: h("19:40"), deliveryType: "MESA", tableSessionId: "mesa-9", paymentMethod: "N/A", customerName: "Mesa 9", totalAmount: 23.59, items: [{ price: 23.59, quantity: 1 }] },
    { ...base, id: "p3", dailyOrderNumber: 3, createdAt: h("20:00"), deliveryType: "RETIRADA", tableSessionId: null, paymentMethod: "Conta Funcionário", employeeName: "Joana", customerName: "Func. Joana", totalAmount: 18, items: [{ price: 18, quantity: 1 }] },
  ];
  const mesa = {
    id: "mesa-9", closedAt: h("21:00"), serviceFee: 0, waiterTip: 0, totalPaid: 63.59,
    paymentMethods: [{ method: "Dinheiro", amount: 20 }, { method: FORMA_DO_FIADO_NA_MESA, amount: 43.59, guestName: "Ana" }],
    orders: [{ status: "ENTREGUE", totalAmount: 40, discountTotal: 0 }, { status: "ENTREGUE", totalAmount: 23.59, discountTotal: 0 }],
  };
  const a = apurarVendasDoTurno(pedidos, [mesa]);
  exigir("gaveta espera só os R$ 20 em dinheiro", igual(a.expected.cash, 20), a.expected);
  exigir("fiado fora da conferência: 43,59 da mesa + 18 do balcão", igual(a.foraDaConferencia.fiado, 61.59), a.foraDaConferencia);
  const vendas = a.retrato.vendas as { qtd: number; valor: number; mesas?: number };
  exigir("faturado do turno = 63,59 da mesa + 18 do balcão, UMA vez (2 vendas)", igual(vendas.valor, 81.59) && vendas.qtd === 2 && vendas.mesas === 1, vendas);
  exigir("recebido do turno = o mesmo 81,59 (a parte fiada conta como forma Fiado, sem dobrar)", igual(a.retrato.recebido.valor, 81.59), a.retrato.recebido);
  const at = atendimentosDaVenda(pedidos);
  exigir("régua: a mesa é UMA venda (2 lançamentos) e o balcão outra", at.vendas === 2 && at.mesas === 1 && at.lancamentos === 3, at);

  // O saldo da Ana: nenhum pedido dela, a conta da mesa, e depois a baixa.
  exigir("saldo da Ana = a conta da mesa", igual(saldoDoFiado({ pedidos: 0, mesas: 43.59, baixas: 0 }), 43.59));
  exigir("depois da baixa de R$ 43,59, zera (a baixa não é venda: não passa pela régua)", igual(saldoDoFiado({ pedidos: 0, mesas: 43.59, baixas: 43.59 }), 0));
  exigir("baixa a mais não vira crédito", igual(saldoDoFiado({ pedidos: 10, mesas: 0, baixas: 50 }), 0));
}

// ── 3. AS ROTAS ─────────────────────────────────────────────────────────────

/** O banco de mentira: o que as rotas leem, e o que elas gravaram. */
type Bd = {
  usuarios: any[]; caixaAberto: boolean; senha: { hash: string; exige: any } | null;
  mesa: any; itens: any[]; clientes: any[];
  gravado: { sql: string; valores: unknown[] }[];
  chamadas: string[];
};
const bd: Bd = { usuarios: [], caixaAberto: true, senha: null, mesa: null, itens: [], clientes: [], gravado: [], chamadas: [] };

function prismaFalso(): any {
  const padrao = (modelo: string) => new Proxy({}, {
    get: (_a, metodo: string) => async (args: any) => {
      bd.chamadas.push(`${modelo}.${metodo}`);
      if (metodo === "findMany") return [];
      if (metodo === "count") return 0;
      if (metodo === "aggregate") return { _sum: { totalAmount: 0, amount: 0 }, _count: { id: 0 } };
      if (metodo === "updateMany" || metodo === "deleteMany") return { count: 0 };
      if (metodo === "create" || metodo === "update" || metodo === "upsert") return { id: `${modelo}-novo`, ...(args?.data || {}) };
      return null;
    },
  });
  const modelos: Record<string, any> = {
    user: {
      findUnique: async ({ where }: any) => bd.usuarios.find((u) => (where.email ? u.email === where.email : u.id === where.id)) || null,
      findFirst: async () => null,
      findMany: async ({ where }: any) => {
        const ids = (where?.OR || []).map((o: any) => o.id || o.accountGroupId).filter(Boolean);
        return bd.usuarios.filter((u) => ids.includes(u.id) || ids.includes(u.accountGroupId)).map((u) => ({ id: u.id }));
      },
    },
    cashSession: { findFirst: async () => (bd.caixaAberto ? { id: "caixa-1" } : null) },
    tableSession: {
      findUnique: async () => (bd.mesa ? JSON.parse(JSON.stringify(bd.mesa)) : null),
      update: async (args: any) => { bd.chamadas.push("tableSession.update"); bd.gravado.push({ sql: "tableSession.update", valores: [args.data] }); bd.mesa.status = args.data.status; return bd.mesa; },
    },
    storeEmployee: {
      findUnique: async ({ where }: any) => bd.clientes.find((c) => c.id === where.id) || null,
      findMany: async () => bd.clientes,
      create: async ({ data }: any) => { bd.chamadas.push("storeEmployee.create"); const novo = { id: `cliente-${bd.clientes.length + 1}`, ...data }; bd.clientes.push(novo); return novo; },
    },
    customerOrderItem: { findMany: async () => bd.itens },
  };
  const falso: any = new Proxy({}, {
    get: (_a, nome: string) => {
      if (nome === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(falso) : Promise.all(fn));
      if (nome === "$executeRawUnsafe") return async () => 0;
      if (nome === "$executeRaw") return async (q: any) => {
        const sql = String(q?.sql || q);
        const v: any[] = q?.values || [];
        bd.gravado.push({ sql, valores: v });
        // A configuração da senha fica "gravada" para a leitura seguinte.
        if (sql.includes('INTO "SenhaDoGerente"')) {
          const semHash = /VALUES \((\$1|\?), NULL,/.test(sql);
          bd.senha = semHash
            ? { hash: bd.senha?.hash ?? (null as any), exige: JSON.parse(v[1]) }
            : { hash: v[1], exige: JSON.parse(v[2]) };
        }
        return 1;
      };
      if (nome === "$queryRaw") return async (q: any) => {
        const sql = String(q?.sql || "");
        if (sql.includes('"SenhaDoGerente"')) return bd.senha ? [{ hash: bd.senha.hash, exige: bd.senha.exige }] : [];
        return [];
      };
      if (nome === "then") return undefined;
      if (!modelos[nome]) modelos[nome] = padrao(nome);
      return new Proxy(modelos[nome], { get: (alvo, metodo: string) => alvo[metodo] ?? (padrao(nome) as any)[metodo] });
    },
  });
  return falso;
}

const resetar = () => {
  bd.gravado = []; bd.chamadas = [];
  // O freio é do processo: cada cenário começa sem erros contados.
  (globalThis as any).__freioDaSenhaDoGerente = new FreioDaSenha();
};
const gravouNaTabela = (tabela: string) => bd.gravado.some((g) => g.sql.includes(`"${tabela}"`));
const pedidoCriado = () => bd.chamadas.includes("customerOrder.create");

async function provarAsRotas() {
  console.log("\n3. As rotas, com a senha conferida no servidor");
  process.env.DATABASE_URL = "postgresql://teste@localhost/sem-banco"; // só para os CREATE TABLE "rodarem" no falso
  process.env.NEXTAUTH_SECRET ||= "segredo-so-do-teste"; // lib/auth.ts recusa carregar sem
  (globalThis as any).prisma = prismaFalso();

  // next-auth e next/headers de mentira: a sessão é a que o teste mandar.
  const dir = join(tmpdir(), `teste-mesa-no-fiado-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const falsoAuth = join(dir, "next-auth.js");
  writeFileSync(falsoAuth, `exports.getServerSession = async () => globalThis.__sessaoDoTeste || null; exports.default = () => null;`);
  const falsoHeaders = join(dir, "next-headers.js");
  writeFileSync(falsoHeaders, `exports.headers = async () => new Headers(globalThis.__cabecalhosDoTeste || {}); exports.cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`);
  const falsoFiscal = join(dir, "fiscal.js");
  writeFileSync(falsoFiscal, `exports.emitirNfceDaMesa = async () => null; exports.emitirNfceDoPedido = async () => null;`);
  const jiti = createJiti(__filename, {
    alias: {
      "next-auth/next": falsoAuth,
      "next-auth/jwt": require.resolve("next-auth/jwt"),
      "next-auth/providers/credentials": require.resolve("next-auth/providers/credentials"),
      "next-auth": falsoAuth,
      "next/headers": falsoHeaders,
      "@/lib/fiscal-automatico": falsoFiscal,
      "@": join(RAIZ, "src"),
    },
    interopDefault: true,
    moduleCache: true,
    fsCache: false,
  });
  const rota = (caminho: string) => jiti.import(join(RAIZ, "src", "app", "api", ...caminho.split("/"), "route.ts")) as Promise<any>;
  const lerJson = async (r: Response) => ({ status: r.status, corpo: await r.json().catch(() => ({})) });
  const comSenha = (senha?: string): Record<string, string> => (senha === undefined ? {} : { "x-senha-do-gerente": encodeURIComponent(senha) });

  bd.usuarios = [
    { id: "loja-1", email: "allan@delicia.test", ownerId: null, role: "FRANCHISEE", name: "Allan", permissions: null, accountGroupId: null, employeeAccountEnabled: true, password: await bcrypt.hash("login-do-dono", 4) },
  ];
  (globalThis as any).__sessaoDoTeste = { user: { email: "allan@delicia.test", role: "FRANCHISEE" } };
  let r: { status: number; corpo: any };

  // ── A configuração: só o dono, e mudar pede a senha atual ──
  const config = await rota("store-settings/senha-do-gerente");
  const salvar = (corpo: any) => config.PUT(new Request("http://teste/x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
  bd.usuarios.push({ id: "func-1", email: "caixa@delicia.test", ownerId: "loja-1", role: "STAFF", name: "Caixa", permissions: "minha_loja,financeiro" });
  resetar(); bd.senha = null;
  // Função, e não bd.senha direto: o TS estreita o campo para null depois da atribuição.
  const gravada = (): Bd["senha"] => bd.senha;
  (globalThis as any).__sessaoDoTeste = { user: { email: "caixa@delicia.test", role: "STAFF" } };
  r = await lerJson(await salvar({ novaSenha: "9999", exige: { fiado: false } }));
  exigir("config: funcionário (mesmo com Minha loja) não mexe → 403", r.status === 403 && gravada() === null, r);
  const g = await lerJson(await config.GET());
  exigir("config: funcionário lê só se há senha e o que ela protege (sem hash)", g.status === 200 && g.corpo.podeMudar === false && !("hash" in g.corpo), g);
  (globalThis as any).__sessaoDoTeste = { user: { email: "allan@delicia.test", role: "FRANCHISEE" } };
  r = await lerJson(await salvar({ exige: { fiado: true } }));
  exigir("config: ligar sem cadastrar a senha é recusado", r.status === 400 && gravada() === null, r);
  r = await lerJson(await salvar({ novaSenha: "4321", exige: { fiado: true, excluirPendenciaDoMotoboy: true } }));
  exigir("config: o dono cadastra a senha (com hash bcrypt) e liga as duas", r.status === 200 && r.corpo.temSenha === true && /^\$2[aby]\$/.test(gravada()?.hash || "") && gravada()?.exige.fiado === true, r);
  r = await lerJson(await salvar({ exige: { fiado: false } }));
  exigir("config: com senha cadastrada, mudar sem a senha atual → 403", r.status === 403 && gravada()?.exige.fiado === true, r);
  r = await lerJson(await salvar({ exige: { fiado: false, excluirPendenciaDoMotoboy: true }, senhaAtual: "1111" }));
  exigir("config: senha atual errada → 403, nada muda", r.status === 403 && gravada()?.exige.fiado === true, r);
  r = await lerJson(await salvar({ exige: { fiado: true, excluirPendenciaDoMotoboy: true }, senhaAtual: "login-do-dono" }));
  exigir("config: esqueceu a do gerente — a senha de acesso do dono serve", r.status === 200, r);
  const hashAntes = gravada()?.hash;
  r = await lerJson(await salvar({ exige: { fiado: true, excluirPendenciaDoMotoboy: true }, senhaAtual: "4321", novaSenha: "4321" }));
  exigir("config: trocar a senha regrava o hash", r.status === 200 && gravada()?.hash !== hashAntes, r);
  const hash = gravada()!.hash; // "4321", gravada pela rota

  // ── Excluir pendência na conferência do motoboy ──
  const pendencias = await rota("motoboy-report/pendencias");
  const excluir = (senha?: string) => pendencias.DELETE(new Request("http://teste/api/motoboy-report/pendencias?id=mpd_1", { method: "DELETE", headers: comSenha(senha) }));

  resetar(); bd.senha = null;
  r = await lerJson(await excluir());
  exigir("pendência: loja sem senha exclui direto", r.status === 200 && gravouNaTabela("MotoboyPendencia"), r);

  resetar(); bd.senha = { hash, exige: { excluirPendenciaDoMotoboy: true } };
  r = await lerJson(await excluir());
  exigir("pendência: senha ligada e não mandada → 403 PEDIDA, nada excluído", r.status === 403 && r.corpo.codigo === CODIGO_SENHA_PEDIDA && !gravouNaTabela("MotoboyPendencia"), r);
  r = await lerJson(await excluir("1111"));
  exigir("pendência: senha errada → 403 ERRADA, nada excluído", r.status === 403 && r.corpo.codigo === CODIGO_SENHA_ERRADA && !gravouNaTabela("MotoboyPendencia"), r);
  r = await lerJson(await excluir("4321"));
  exigir("pendência: senha certa → excluída", r.status === 200 && gravouNaTabela("MotoboyPendencia"), r);

  resetar(); bd.senha = { hash, exige: { fiado: true } };
  r = await lerJson(await excluir());
  exigir("pendência: senha ligada só para o fiado não pede aqui", r.status === 200, r);

  // ── A mesa 9 vai para o fiado ──
  const mesa9 = () => ({
    id: "sessao-9", status: "OPEN", waiterId: null, waiter: null,
    table: { id: "t9", number: 9, franchiseeId: "loja-1" },
    paymentMethods: [{ uid: "b1", method: "Dinheiro", amount: 20, guestId: null, guestName: null, at: "", por: "Allan" }],
    orders: [
      { id: "p1", status: "EM_PREPARO", totalAmount: 40 },
      { id: "p2", status: "EM_PREPARO", totalAmount: 23.59 },
    ],
  });
  bd.itens = [{ quantity: 2, productName: "Pastel", menuProduct: null }, { quantity: 1, productName: "Caldo de cana", menuProduct: null }];
  bd.clientes = [{ id: "cliente-joana", name: "Joana", franchiseeId: "loja-1", active: true }];
  const close = await rota("store/table-sessions/[id]/close");
  const fechar = (corpo: any, senha?: string) => close.POST(
    new Request("http://teste/api/store/table-sessions/sessao-9/close", { method: "POST", headers: { "Content-Type": "application/json", ...comSenha(senha) }, body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id: "sessao-9" }) },
  );
  const corpoDoFiado = { paymentMethods: [], serviceFeePercent: 0, waiterTip: 0, desconto: null, fiado: { novoCliente: { nome: "Ana da mesa 9", telefone: "22 99999-0000" } } };

  resetar(); bd.mesa = mesa9();
  r = await lerJson(await fechar(corpoDoFiado));
  exigir("mesa: senha do fiado ligada e não mandada → 403 PEDIDA", r.status === 403 && r.corpo.codigo === CODIGO_SENHA_PEDIDA, r);
  exigir("mesa: sem a senha nada foi gravado e a mesa segue aberta", bd.mesa.status === "OPEN" && !gravouNaTabela("FiadoDaMesa") && !bd.chamadas.includes("storeEmployee.create"));

  resetar(); bd.mesa = mesa9();
  r = await lerJson(await fechar(corpoDoFiado, "errada"));
  exigir("mesa: senha errada → 403 ERRADA, mesa aberta", r.status === 403 && r.corpo.codigo === CODIGO_SENHA_ERRADA && bd.mesa.status === "OPEN", r);

  resetar(); bd.mesa = mesa9();
  r = await lerJson(await fechar(corpoDoFiado, "4321"));
  const fiadoGravado = bd.gravado.find((g) => g.sql.includes('"FiadoDaMesa"'));
  const fechamento = bd.gravado.find((g) => g.sql === "tableSession.update")?.valores[0] as any;
  exigir("mesa: senha certa → 200, mesa FECHADA (liberada)", r.status === 200 && bd.mesa.status === "CLOSED", r);
  exigir("mesa: devolve quem ficou devendo e quanto (43,59)", r.corpo?.fiado?.cliente === "Ana da mesa 9" && igual(r.corpo?.fiado?.valor, 43.59), r.corpo);
  exigir("mesa: cliente novo cadastrado no fiado", bd.clientes.some((c2) => c2.name === "Ana da mesa 9" && c2.franchiseeId === "loja-1" && c2.phone === "22999990000"));
  exigir("mesa: a dívida (FiadoDaMesa) é do cliente novo, de R$ 43,59, da sessão 9", !!fiadoGravado && fiadoGravado.valores.includes(43.59) && fiadoGravado.valores.includes("sessao-9") && fiadoGravado.valores.includes("cliente-2"), fiadoGravado?.valores);
  const formas = (fechamento?.paymentMethods || []).map((p: any) => `${p.method}:${p.amount}`);
  exigir("mesa: a conta fecha com Dinheiro 20 + Fiado 43,59", JSON.stringify(formas) === JSON.stringify(["Dinheiro:20", "Fiado:43.59"]) && igual(fechamento?.totalPaid, 63.59), fechamento);
  exigir("mesa: NENHUM pedido novo criado (a venda são os pedidos da mesa, uma vez)", !pedidoCriado(), bd.chamadas);

  resetar(); bd.mesa = mesa9(); bd.mesa.paymentMethods.push({ uid: "b2", method: "Pix", amount: 43.59, guestId: null, guestName: null, at: "", por: "Allan" });
  r = await lerJson(await fechar({ ...corpoDoFiado, fiado: { clienteId: "cliente-joana" } }, "4321"));
  exigir("mesa já paga: não vai para o fiado (400)", r.status === 400 && bd.mesa.status === "OPEN" && !gravouNaTabela("FiadoDaMesa"), r);

  resetar(); bd.mesa = mesa9();
  r = await lerJson(await fechar({ ...corpoDoFiado, fiado: { clienteId: "cliente-de-outra-loja" } }, "4321"));
  exigir("mesa: cliente que não é do fiado da loja → 400", r.status === 400 && bd.mesa.status === "OPEN", r);

  resetar(); bd.mesa = mesa9(); bd.senha = null;
  r = await lerJson(await fechar({ ...corpoDoFiado, fiado: { clienteId: "cliente-joana" } }));
  exigir("mesa: loja sem senha lança direto no fiado da Joana", r.status === 200 && bd.mesa.status === "CLOSED" && !!bd.gravado.find((g) => g.sql.includes('"FiadoDaMesa"'))?.valores.includes("cliente-joana"), r);

  resetar(); bd.mesa = mesa9(); bd.mesa.paymentMethods = [];
  r = await lerJson(await fechar({ paymentMethods: [{ method: "Fiado", amount: 63.59 }], serviceFeePercent: 0 }));
  exigir("4. baixa \"Fiado\" solta no fechamento é recusada (400), mesa aberta", r.status === 400 && bd.mesa.status === "OPEN", r);

  const pagamentos = await rota("store/table-sessions/[id]/pagamentos");
  resetar(); bd.mesa = mesa9();
  const rp = await lerJson(await pagamentos.POST(
    new Request("http://teste/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valor: 10, metodo: "Conta Funcionário" }) }) as any,
    { params: Promise.resolve({ id: "sessao-9" }) },
  ));
  exigir("4. baixa \"Conta Funcionário\" na mesa aberta é recusada (400)", rp.status === 400, rp);

  // ── Dívida à mão (tela Fiado) ──
  bd.senha = { hash, exige: { fiado: true } };
  const debt = await rota("store/employees/[id]/debt");
  const lancarDivida = (senha?: string) => debt.POST(
    new Request("http://teste/x", { method: "POST", headers: { "Content-Type": "application/json", ...comSenha(senha) }, body: JSON.stringify({ amount: 15, notes: "Coca" }) }) as any,
    { params: Promise.resolve({ id: "cliente-joana" }) },
  );
  resetar();
  r = await lerJson(await lancarDivida());
  exigir("dívida à mão: sem a senha → 403, nada lançado", r.status === 403 && r.corpo.codigo === CODIGO_SENHA_PEDIDA && !pedidoCriado(), r);
  resetar();
  r = await lerJson(await lancarDivida("4321"));
  exigir("dívida à mão: com a senha → lançada", r.status === 200 && pedidoCriado(), r);

  // ── Venda no balcão em "Conta Funcionário" ──
  const presencial = await rota("store/orders/presencial");
  const vender = (senha?: string) => presencial.POST(new Request("http://teste/x", {
    method: "POST", headers: { "Content-Type": "application/json", ...comSenha(senha) },
    body: JSON.stringify({ deliveryType: "RETIRADA", paymentMethod: "Conta Funcionário", employeeId: "cliente-joana", employeeName: "Joana", totalAmount: 18, items: [{ menuProductId: "x", quantity: 1, price: 18 }] }),
  }));
  resetar();
  r = await lerJson(await vender());
  exigir("balcão no fiado: sem a senha → 403 PEDIDA, nenhum pedido criado", r.status === 403 && r.corpo.codigo === CODIGO_SENHA_PEDIDA && !pedidoCriado(), r);
  resetar();
  r = await lerJson(await vender("1"));
  exigir("balcão no fiado: senha errada → 403 ERRADA, nenhum pedido criado", r.status === 403 && r.corpo.codigo === CODIGO_SENHA_ERRADA && !pedidoCriado(), r);
  resetar(); bd.senha = { hash, exige: { fiado: true } };
  const r2 = await presencial.POST(new Request("http://teste/x", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryType: "RETIRADA", paymentMethod: "Conta Funcionário", employeeId: "cliente-de-outra-loja", totalAmount: 18, items: [{ menuProductId: "x", quantity: 1, price: 18 }] }),
  }));
  exigir("balcão no fiado: cadastro que não é da loja → 400", r2.status === 400 && !pedidoCriado(), await r2.json().catch(() => null));
}

(async () => {
  await provarARegraDaSenha();
  provarQueAVendaNaoContaDuasVezes();
  await provarAsRotas();
  console.log(`\n${falhou === 0 ? "Tudo certo" : "FALHOU"}: ${ok} ok, ${falhou} falha(s).`);
  process.exit(falhou === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
