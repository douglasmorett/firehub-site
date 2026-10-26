/**
 * Achados de baixo risco da auditoria de 23/10/2026 (lote N6): caixinha da
 * Equipe nas rotas que faltavam, dado de outra loja que vazava e tetos de
 * tentativa. Para cada um, o funcionário sem a caixinha (ou quem chuta) é
 * barrado, e o dono e o funcionário COM a caixinha seguem como antes.
 *
 * Banco, sessão, gateway e Gemini de mentira — nada sai da máquina.
 *
 *   npx tsx scripts/teste-permissoes-n6.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.NEXTAUTH_SECRET ||= "teste";
process.env.EVOLUTION_API_KEY ||= "teste";
process.env.EVOLUTION_API_URL = "http://gateway.teste";
process.env.GEMINI_API_KEY = "teste";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const ler = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

// ── Banco, sessão e rede de mentira ────────────────────────────────────────
type Usuario = { id: string; email: string; role: string; ownerId: string | null; permissions: string | null; password?: string; name?: string; fiscalConfig?: any };
let SENHA_HASH = "";
const USUARIOS: Usuario[] = [
  { id: "dono", email: "dono@loja", role: "FRANCHISEE", ownerId: null, permissions: null, fiscalConfig: {} },
  { id: "caixa", email: "caixa@loja", role: "STAFF", ownerId: "dono", permissions: "orders,kds" },
  { id: "cozinha", email: "cozinha@loja", role: "STAFF", ownerId: "dono", permissions: "kds" },
  { id: "gerente", email: "gerente@loja", role: "STAFF", ownerId: "dono", permissions: "orders,financeiro,minha_loja,cardapio,motoboys" },
  { id: "vitrine", email: "vitrine@loja", role: "STAFF", ownerId: "dono", permissions: "minha_loja" },
  { id: "admin", email: "admin@firehub", role: "ADMIN", ownerId: null, permissions: null, name: "Admin" },
  { id: "admin2", email: "admin2@firehub", role: "ADMIN", ownerId: null, permissions: null, name: "Admin 2" },
];
let logado: string | null = null;
const naSessao = (email: string | null) => (logado = email);
const gravados: Record<string, any[]> = {};
const gravou = (onde: string, dados: any) => ((gravados[onde] ||= []).push(dados), dados);
const quantas = (onde: string) => gravados[onde]?.length ?? 0;
const envios: string[] = [];
let consultasSql: string[] = [];
let conversasNoBanco: string[] = [];
let filaNoBanco: any[] = [];

async function prepararMocks() {
  const na = require("next-auth/next");
  na.getServerSession = async () => {
    const u = USUARIOS.find((x) => x.email === logado);
    return u ? { user: { email: u.email, id: u.id, name: u.name ?? u.id, role: u.role } } : null;
  };
  require("next/cache").revalidatePath = () => {};
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/message/send")) envios.push(String(url));
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;

  const { prisma } = await import("../src/lib/prisma");
  const p = prisma as any;
  const acha = (where: any) => USUARIOS.find((u) => (where?.email ? u.email === where.email : u.id === where?.id)) ?? null;
  const recorta = (u: any, select?: any) => (u && select ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k] ?? null])) : u);
  p.user.findUnique = async ({ where, select }: any) => recorta(acha(where), select);
  p.user.findFirst = async () => null;
  p.user.update = async ({ data }: any) => gravou("user.update", data);
  p.menuCategory.create = async ({ data }: any) => ({ id: "c-nova", ...gravou("menuCategory.create", data) });
  p.menuCategory.findMany = async () => [];
  p.menuCategory.findUnique = async ({ where }: any) => (where.id === "cat1" ? { id: "cat1", name: "Lanches", franchiseeId: "dono" } : null);
  p.menuCategory.update = async ({ data }: any) => ({ id: "cat1", ...gravou("menuCategory.update", data) });
  p.menuCategory.updateMany = async () => (gravou("menuCategory.updateMany", {}), { count: 1 });
  p.menuCategory.delete = async () => gravou("menuCategory.delete", {});
  p.menuProduct.findMany = async () => [];
  p.$transaction = async (fn: any) => fn(p);
  p.motoboy.findMany = async () => [];
  p.customerOrder.findMany = async () => [];
  p.storeCustomer.findMany = async () => [];
  p.order.findUnique = async ({ where }: any) => ({ id: where.id, status: "PENDENTE", asaasPaymentId: null });
  p.order.update = async () => gravou("order.update", {});
  p.orderHistory.create = async () => ({});
  p.$executeRaw = async () => 0;
  p.$executeRawUnsafe = async () => 0;
  p.$queryRawUnsafe = async () => [];
  // O SQL de verdade é do Postgres; aqui ele faz o que o banco faria com o
  // cadastro de OUTRA loja (lojaDeOrigemId de fora) e anota o texto.
  p.$queryRaw = async (sql: any, ...valores: any[]) => {
    const texto = Array.isArray(sql) ? sql.join("?") : String(sql?.sql ?? sql?.text ?? "");
    consultasSql.push(texto);
    if (texto.includes('FROM "AtendimentoHumano"')) {
      // A fila mora no banco (lib/fila-de-atendimento-humano.ts): filtra por
      // loja e, quando a consulta pede, pelo jid — como o Postgres faria.
      const v = Array.isArray(sql) ? valores : sql?.values ?? [];
      return filaNoBanco.filter((l) => l.userId === v[0] && (v.length < 2 || l.jid === v[1]));
    }
    if (texto.includes('FROM "ChatbotConversationState"')) {
      const jid = Array.isArray(sql) ? valores[1] : sql?.values?.[1];
      return conversasNoBanco.includes(jid) ? [{ existe: 1 }] : [];
    }
    if (texto.includes('FROM "StoreCustomer"')) {
      const soDaLoja = /CASE WHEN "lojaDeOrigemId" IN/.test(texto);
      return [{ name: "Maria de Outra Loja", phone: "5522999998888", address: soDaLoja ? null : "Rua da Outra Loja, 10 - Centro" }];
    }
    return [];
  };
}

const req = (url: string, init?: { method?: string; body?: unknown; ip?: string }) => {
  const { NextRequest } = require("next/server");
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  if (init?.ip) headers["x-forwarded-for"] = init.ip;
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method || "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
};
const status = async (r: Promise<Response> | Response) => (await r).status;

async function main() {
  const bcrypt = require("bcryptjs");
  SENHA_HASH = bcrypt.hashSync("senha-certa", 4);
  for (const u of USUARIOS) u.password = SENHA_HASH;
  await prepararMocks();

  // ── F69/F142: categorias ─────────────────────────────────────────────────
  console.log("\n── /api/admin/categories ──");
  const cat = await import("../src/app/api/admin/categories/route");
  const corpo = (method: string, body: unknown) => req("/api/admin/categories", { method, body });
  naSessao("caixa@loja");
  confere("funcionário sem Cardápio não cria, renomeia, reordena nem apaga (403)", [
    await status(cat.POST(corpo("POST", { name: "Nova" }))),
    await status(cat.PUT(corpo("PUT", { id: "cat1", name: "Outro nome" }))),
    await status(cat.PATCH(corpo("PATCH", { orderedIds: ["cat1"] }))),
    await status(cat.DELETE(corpo("DELETE", { id: "cat1" }))),
  ], [403, 403, 403, 403]);
  confere("…e nada foi gravado", ["menuCategory.create", "menuCategory.update", "menuCategory.updateMany", "menuCategory.delete"].map(quantas), [0, 0, 0, 0]);
  confere("…mas continua lendo (KDS e PDV leem daqui)", await status(cat.GET(req("/api/admin/categories"))), 200);
  naSessao("gerente@loja");
  confere("funcionário com Cardápio cria e reordena", [
    await status(cat.POST(corpo("POST", { name: "Nova" }))),
    await status(cat.PATCH(corpo("PATCH", { orderedIds: ["cat1"] }))),
  ], [200, 200]);
  naSessao("dono@loja");
  confere("dono cria e troca o emoji", [
    await status(cat.POST(corpo("POST", { name: "Bebidas" }))),
    await status(cat.PUT(corpo("PUT", { id: "cat1", emoji: "🍔" }))),
  ], [200, 200]);
  naSessao("vitrine@loja");
  confere("funcionário do Totem (Minha loja) troca só a foto da categoria", await status(cat.PUT(corpo("PUT", { id: "cat1", imageUrl: "https://x/foto.jpg" }))), 200);
  confere("…mas não renomeia (403)", await status(cat.PUT(corpo("PUT", { id: "cat1", name: "Outro", imageUrl: "https://x/f.jpg" }))), 403);

  // ── F71: pacote do contador ──────────────────────────────────────────────
  console.log("\n── /api/store/fiscal/contador ──");
  const contador = await import("../src/app/api/store/fiscal/contador/route");
  const enviar = await import("../src/app/api/store/fiscal/contador/enviar/route");
  const postContador = () => contador.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ email: "x@x.com", copiaParaLoja: false, automatico: true }) }));
  const postEnviar = (body: unknown) => enviar.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));
  naSessao("caixa@loja");
  const antes = quantas("user.update");
  confere("funcionário sem Financeiro não lê, não troca o e-mail, não manda (403)", [
    await status(contador.GET()), await status(postContador()), await status(postEnviar({ de: "2026-10-01", ate: "2026-10-02" })),
  ], [403, 403, 403]);
  confere("…e o e-mail do contador não foi gravado", quantas("user.update") - antes, 0);
  naSessao("gerente@loja");
  confere("funcionário com Financeiro lê e grava", [await status(contador.GET()), await status(postContador())], [200, 200]);
  confere("…e passa da porta do Enviar agora (período vazio = 400, não 403)", await status(postEnviar({})), 400);
  naSessao("dono@loja");
  confere("dono lê", await status(contador.GET()), 200);

  // ── F135: relatório dos motoboys e despacho ──────────────────────────────
  console.log("\n── /api/motoboy-report e /api/motoboys/dispatch-whatsapp ──");
  const relatorio = await import("../src/app/api/motoboy-report/route");
  const despacho = await import("../src/app/api/motoboys/dispatch-whatsapp/route");
  const despachar = () => despacho.POST(req("/api/motoboys/dispatch-whatsapp", { method: "POST", body: {} }));
  naSessao("caixa@loja");
  confere("funcionário sem Motoboys não lê o relatório (403)", await status(relatorio.GET(new Request("http://localhost/api/motoboy-report"))), 403);
  naSessao("gerente@loja");
  confere("funcionário com Motoboys lê", await status(relatorio.GET(new Request("http://localhost/api/motoboy-report"))), 200);
  naSessao("dono@loja");
  confere("dono lê", await status(relatorio.GET(new Request("http://localhost/api/motoboy-report"))), 200);
  naSessao("cozinha@loja");
  confere("funcionário só da cozinha não despacha (403)", await status(despachar()), 403);
  // Corpo vazio: passou da porta e parou na conferência dos campos (400).
  naSessao("caixa@loja");
  confere("caixa com Pedidos continua despachando (passa da porta)", await status(despachar()), 400);
  naSessao("gerente@loja");
  confere("funcionário com Motoboys despacha", await status(despachar()), 400);
  naSessao("dono@loja");
  confere("dono despacha", await status(despachar()), 400);

  // ── F74: contatos do marketing ───────────────────────────────────────────
  console.log("\n── /api/store/marketing ──");
  (globalThis as any).__firehubTabelasDoRobo = Promise.resolve(true);
  filaNoBanco = [
    { userId: "dono", jid: "5522911110000@s.whatsapp.net", telefone: "+55 22911110000", nomeDoCliente: "Cliente da Loja", status: "PENDING", motivo: null, soPorIaForaDoAr: false, naoLidas: 0, ultimaMensagem: "", mensagens: [], atualizadoEm: new Date() },
    { userId: "outra-loja", jid: "5521977770000@s.whatsapp.net", telefone: "+55 21977770000", nomeDoCliente: "Cliente de Outra Loja", status: "PENDING", motivo: null, soPorIaForaDoAr: false, naoLidas: 0, ultimaMensagem: "", mensagens: [], atualizadoEm: new Date() },
  ];
  (globalThis as any).__whatsappActiveContacts = new Map([
    ["a", { userId: "outra-loja", phone: "5521966660000", name: "Contato de Outra Loja" }],
  ]);
  const marketing = await import("../src/app/api/store/marketing/route");
  naSessao("dono@loja");
  const lista = JSON.stringify(await (await marketing.GET(req("/api/store/marketing"))).json());
  confere("a conversa desta loja continua na lista", lista.includes("5522911110000"), true);
  confere("a conversa de outra loja não aparece", [lista.includes("5521977770000"), lista.includes("Cliente de Outra Loja")], [false, false]);
  confere("o contato de outra loja também não", lista.includes("5521966660000"), false);

  // ── F70: busca de clientes do balcão ─────────────────────────────────────
  console.log("\n── /api/store/clientes/buscar ──");
  const buscar = await import("../src/app/api/store/clientes/buscar/route");
  naSessao("caixa@loja");
  consultasSql = [];
  const achados = (await (await buscar.GET(new Request("http://localhost/x?q=22999998888"))).json()).clientes;
  const maria = achados.find((c: any) => c.telefone === "22999998888");
  confere("o número inteiro ainda traz o nome (preenche o cliente novo)", maria?.nome, "Maria de Outra Loja");
  confere("…mas sem o endereço que ele deu em outra loja", [maria?.endereco ?? null, maria?.enderecoTexto ?? ""], [null, ""]);
  const sqlDoCadastro = consultasSql.find((s) => s.includes('FROM "StoreCustomer"')) || "";
  confere("o endereço do cadastro só sai quando o cadastro é desta loja", /CASE WHEN "lojaDeOrigemId" IN \([^)]*\) THEN "address" END AS "address"/.test(sqlDoCadastro), true);

  // ── F151: responder conversa do atendimento humano ───────────────────────
  console.log("\n── /api/chatbot/human-support send_message ──");
  const atendimento = await import("../src/app/api/chatbot/human-support/route");
  const responder = (jid: string) => atendimento.POST(req("/api/chatbot/human-support", { method: "POST", body: { action: "send_message", jid, message: "oi" } }));
  conversasNoBanco = ["5522933330000@s.whatsapp.net"];
  naSessao("caixa@loja");
  envios.length = 0;
  confere("grupo, canal e número sem conversa nesta loja: 404, nada enviado", [
    await status(responder("120363000000000000@g.us")),
    await status(responder("123@newsletter")),
    await status(responder("5521900000000@s.whatsapp.net")),
    envios.length,
  ], [404, 404, 404, 0]);
  confere("a conversa que está na fila desta loja continua recebendo resposta", [await status(responder("5522911110000@s.whatsapp.net")), envios.length], [200, 1]);
  confere("a conversa que só está no banco (fila zerou no deploy) também", [await status(responder("5522933330000@s.whatsapp.net")), envios.length], [200, 2]);
  confere("a conversa de outra loja na fila não vale para esta", await status(responder("5521977770000@s.whatsapp.net")), 404);
  naSessao("cozinha@loja");
  confere("funcionário sem Pedidos continua sem acesso (403)", await status(responder("5522911110000@s.whatsapp.net")), 403);

  // ── F118: senha no cancelamento de pedido do portal ──────────────────────
  console.log("\n── cancelOrder ──");
  const { cancelOrder } = await import("../src/app/actions/cancelOrder");
  const tentar = async (senha: string) => {
    try { await cancelOrder("pedido-1", senha, "teste"); return "ok"; } catch (e: any) { return String(e?.message || e); }
  };
  naSessao("admin@firehub");
  const erradas: string[] = [];
  for (let i = 0; i < 6; i++) erradas.push(await tentar(`chute-${i}`));
  confere("as 5 primeiras senhas erradas dizem 'Senha incorreta'", erradas.slice(0, 5).every((m) => m.startsWith("Senha incorreta")), true);
  confere("a 6ª é barrada antes de conferir", erradas[5].startsWith("Muitas tentativas"), true);
  confere("…e nem a senha certa passa durante o freio", (await tentar("senha-certa")).startsWith("Muitas tentativas"), true);
  naSessao("admin2@firehub");
  const certas: string[] = [];
  for (let i = 0; i < 12; i++) certas.push(await tentar("senha-certa"));
  confere("quem acerta cancela 12 pedidos seguidos sem travar", certas.every((m) => m === "ok"), true);

  // ── F130: código da TV ───────────────────────────────────────────────────
  console.log("\n── Painel de senhas (TV) ──");
  const { tvBloqueada, contarCodigoErrado, CODIGOS_ERRADOS_POR_IP } = await import("../src/lib/codigo-errado-da-tv");
  for (let i = 0; i < 100; i++) contarCodigoErrado("10.0.0.1", "loja:AAAAAA");
  confere("o mesmo código velho repetido 100 vezes (TVs depois da troca) não trava a rede", tvBloqueada("10.0.0.1"), false);
  for (let i = 0; i < CODIGOS_ERRADOS_POR_IP; i++) contarCodigoErrado("10.0.0.2", `C${i}`);
  confere(`${CODIGOS_ERRADOS_POR_IP} códigos errados diferentes travam o IP`, tvBloqueada("10.0.0.2"), true);
  confere("…e só ele", tvBloqueada("10.0.0.3"), false);

  const p = (await import("../src/lib/prisma")).prisma as any;
  const usuarioDoTeste = p.user.findUnique;
  p.user.findUnique = async ({ where }: any) =>
    where.id === "dono" ? { storeName: "Loja", name: "Loja", storeLogo: null, slug: "loja", chatbotConfig: {}, painelDeSenhas: { codigo: "BCDEFG", balcao: true } } : null;
  const painel = await import("../src/app/api/painel-de-senhas/route");
  const tv = (codigo: string, ip: string) => painel.GET(req(`/api/painel-de-senhas?loja=dono&codigo=${codigo}`, { ip }));
  const ALFA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const chutes: number[] = [];
  for (let i = 0; i < CODIGOS_ERRADOS_POR_IP; i++) chutes.push(await status(tv(`ZZZZ${ALFA[i]}${ALFA[i + 1]}`, "10.9.9.9")));
  confere("os chutes errados levam 410", chutes.every((s) => s === 410), true);
  confere("depois deles, nem o código certo responde a esse IP (429)", await status(tv("BCDEFG", "10.9.9.9")), 429);
  confere("a TV da loja, em outra rede, segue funcionando (200)", await status(tv("BCDEFG", "10.1.1.1")), 200);
  for (let i = 0; i < 30; i++) await tv("HJKMNP", "10.2.2.2");
  confere("a TV com o código velho perguntando 30 vezes não trava a própria rede", await status(tv("BCDEFG", "10.2.2.2")), 200);
  const paginaDaTv = ler("src/app/tv/[codigo]/page.tsx");
  confere("/tv/<código> confere o teto antes de procurar e conta só quando não acha", [
    paginaDaTv.indexOf("tvBloqueada(ip)") > 0 && paginaDaTv.indexOf("tvBloqueada(ip)") < paginaDaTv.indexOf('"painelDeSenhas"->>'),
    /if \(!achada\.length\) \{\s*contarCodigoErrado\(ip, codigo\);/.test(paginaDaTv),
  ], [true, true]);

  // ── F144: tabela nutricional com IA ──────────────────────────────────────
  console.log("\n── fillNutritionWithAI ──");
  p.user.findUnique = usuarioDoTeste;
  require("@google/genai").GoogleGenAI = class {
    models = {
      generateContent: async () => ({
        text: JSON.stringify({ ingredients: "Farinha, ovo", energy: "250", highSugar: false, shelfLifeDays: 30, r: "resposta de outra tarefa", extra: { muito: "texto" } }),
      }),
    };
  };
  const { fillNutritionWithAI } = await import("../src/app/actions/kitchenItems");
  naSessao("caixa@loja");
  const tabela: any = await fillNutritionWithAI("Bolo de cenoura");
  confere("volta só as chaves da tabela nutricional", Object.keys(tabela).sort(), ["energy", "highSugar", "ingredients", "shelfLifeDays"]);
  confere("com os valores que a tela usa", [tabela.ingredients, tabela.energy, tabela.highSugar, tabela.shelfLifeDays], ["Farinha, ovo", "250", false, 30]);
  let ultima: any = null;
  for (let i = 1; i < 30; i++) ultima = await fillNutritionWithAI(`Item ${i}`);
  confere("30 itens em 10 minutos ainda passam", ultima?.error, undefined);
  const trigesimaPrimeira: any = await fillNutritionWithAI("Item 31");
  confere("a 31ª na mesma loja espera", String(trigesimaPrimeira?.error || "").startsWith("Muitos pedidos à IA"), true);
  naSessao("admin@firehub");
  confere("outra loja não é afetada", (await fillNutritionWithAI("Pão") as any)?.error, undefined);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
