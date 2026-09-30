/**
 * Trava as correções de SEGURANÇA da revisão cética (branch fix-seguranca):
 *
 *   5  A chave fiscal: FISCAL_CHAVE obrigatória em produção, subchaves por uso
 *      (HKDF), id da chave no cabeçalho e FISCAL_CHAVES_ANTIGAS (rotação); o
 *      selo do link do DANFE segue a mesma regra.
 *   8  DoS do .pfx forjado: carregarCertificado recusa iterações demais, rápido.
 *  10  Nota em andamento trava a troca de emissor/ambiente (função + banco falso).
 *   1  /api/customer-order/status: a resposta NUNCA leva a linha da loja.
 *   2  IDOR: dispatch-whatsapp filtra os pedidos pela loja da sessão.
 *   9  /api/store/fiscal/products: produto avulso também é só do titular.
 *   6  /api/store/fiscal/testar-conexao: só POST, só titular, 1/min.
 *  11  taxa-de-entrega respeita a trava da NFC-e autorizada (conferência estática).
 *
 * Sem banco nem SEFAZ de verdade: funções puras, o .pfx forjado na hora, e as
 * rotas rodando contra um banco falso (globalThis.prisma) com a sessão do
 * next-auth e as libs de rede trocadas no cache do require — o mesmo molde de
 * scripts/teste-fiscal-cadastro.ts.
 *
 *   npx tsx scripts/teste-seguranca-fiscal.ts
 */
export {};

import forge from "node-forge";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const verdade = (oQue: string, cond: boolean, detalhe = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "✅" : "❌"} ${oQue}${cond ? "" : ` — ${detalhe}`}`);
};

const RAIZ = join(__dirname, "..");
const FIXTURES = join(__dirname, "fixtures");
const SENHA_PFX = "firehub-teste";
const PFX_NIK = readFileSync(join(FIXTURES, "nfce-certificado-teste.pfx"));
const leRota = (rel: string) => readFileSync(join(RAIZ, "src", "app", "api", ...rel.split("/")), "utf8");

const CHAVE_A = "chave-fiscal-de-teste-seguranca-A-com-tamanho-suficiente";
const CHAVE_B = "chave-fiscal-de-teste-seguranca-B-com-tamanho-suficiente";
Object.assign(process.env, { NODE_ENV: "development" });
process.env.FISCAL_CHAVE = CHAVE_A;
delete process.env.FISCAL_CHAVES_ANTIGAS;
delete process.env.NEXTAUTH_SECRET;
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Banco falso e stubs (instalados ANTES de importar qualquer rota) ─────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; routeSchedule: Linha[]; motoboy: Linha[] } = { user: [], customerOrder: [], routeSchedule: [], motoboy: [] };
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copia = <T,>(v: T): T => (v == null ? v : structuredClone(v));

function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
  for (const [op, alvo] of Object.entries(filtro)) {
    if (op === "equals") { if (!igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if ((alvo as unknown[]).includes(valor)) return false; }
    else return false; // operador não previsto no banco falso deste teste
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
    else if (k === "franchisee") { return false; }
    else if (!casaCampo(linha[k], v)) return false;
  }
  return true;
}
const projetar = (linha: Linha, select?: Record<string, any>): Linha => {
  const c = copia(linha);
  if (!select) return c;
  const saida: Linha = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) saida[k] = c[k] ?? null;
    else if (v && typeof v === "object" && "select" in v) saida[k] = c[k] ?? null; // relação: o teste não precisa do conteúdo
    else if (v && typeof v === "object") saida[k] = c[k] ?? null;
  }
  return saida;
};
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findFirst: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findMany: async (a: any = {}) => db[modelo].filter((x) => casa(x, a.where)).map((l) => projetar(l, a.select)),
  update: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); if (!l) throw new Error(`update ${modelo} não achou`); Object.assign(l, copia(a.data)); return projetar(l, a.select); },
  updateMany: async (a: any) => { const alvos = db[modelo].filter((x) => casa(x, a.where)); for (const l of alvos) Object.assign(l, copia(a.data)); return { count: alvos.length }; },
});
(globalThis as any).prisma = {
  user: delegado("user"), customerOrder: delegado("customerOrder"),
  routeSchedule: delegado("routeSchedule"), motoboy: delegado("motoboy"),
  $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg((globalThis as any).prisma)),
};

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  // `__esModule: true`: sem isto, o `await import()` de um módulo do
  // require.cache devolve só `default`, e os `const { x } = await import()`
  // das rotas viriam undefined (conferido com uma sonda).
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessaoEmail: string | null = null;
stub("next-auth/next", { getServerSession: async () => (sessaoEmail ? { user: { email: sessaoEmail } } : null) });
stub("../src/lib/auth", { authOptions: {} });
// Nada de rede: o WhatsApp e as notificações viram no-op.
let whatsappEnviou = 0;
stub("../src/lib/whatsapp-evolution", { sendEvolutionMessage: async () => { whatsappEnviou++; return true; } });
stub("../src/lib/order-notifications", { sendOrderNotification: async () => {} });
// Os ganchos fiscais fire-and-forget: registram os ids que receberiam nota.
const nfceDisparada: any[] = [];
stub("../src/lib/fiscal-automatico", { emitirNfceDosPedidos: async (w: any) => { nfceDisparada.push(w); }, emitirNfceAutomatica: async () => {} });

async function main() {
  // ════════════════════════════════════════════════════════════════════════
  // 5. A CHAVE FISCAL
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n[5] A chave fiscal (FISCAL_CHAVE, subchaves, rotação)");
  const cred = await import("../src/lib/fiscal-credenciais");
  const { cifrar, decifrar, cifrarBytes, decifrarBytes, nomeOpaco, subchaveFiscal, subchavesQueConferem, idDaChaveFiscal, ErroDaChaveFiscal, TAMANHO_MINIMO_DA_FISCAL_CHAVE } = cred;

  const token = "TOKEN-DA-FOCUS-1234567890";
  const c1 = cifrar(token)!;
  confere("cifra e decifra de volta", decifrar(c1), token);
  verdade("cifrado leva prefixo fh2: e id da chave (8 hex)", /^fh2:[0-9a-f]{8}:/.test(c1));
  verdade("o id do cifrado é o da chave atual", c1.startsWith(`fh2:${idDaChaveFiscal()}:`));
  verdade("não contém o segredo em claro", !c1.includes(token));
  confere("IV novo a cada vez", cifrar(token) === c1, false);

  const kCifra = subchaveFiscal("cifra").toString("hex");
  const kNome = subchaveFiscal("nome-de-arquivo").toString("hex");
  const kSelo = subchaveFiscal("selo-do-link").toString("hex");
  confere("três subchaves distintas (cifra, nome, selo)", new Set([kCifra, kNome, kSelo]).size, 3);
  verdade("cada subchave tem 32 bytes", kCifra.length === 64 && kNome.length === 64 && kSelo.length === 64);
  confere("cifrado com id trocado no cabeçalho não abre (AAD)", decifrar(c1.replace(/^fh2:[0-9a-f]{8}:/, "fh2:00000000:")), null);

  const claro = Buffer.from("XML da nota, com CPF e endereço");
  const cb = cifrarBytes(claro);
  confere("cifrarBytes marca FHC2", cb.subarray(0, 4).toString(), "FHC2");
  verdade("o id da chave vai nos 4 bytes seguintes", cb.subarray(4, 8).toString("hex") === idDaChaveFiscal());
  confere("decifrarBytes volta igual", decifrarBytes(cb).equals(claro), true);

  const nomeComA = nomeOpaco("53260964568087000180650070000000011234567890");
  process.env.FISCAL_CHAVE = CHAVE_B;
  process.env.FISCAL_CHAVES_ANTIGAS = CHAVE_A;
  verdade("depois da troca, o id da chave atual muda", idDaChaveFiscal() !== c1.slice(4, 12));
  confere("token cifrado com a antiga ainda abre (FISCAL_CHAVES_ANTIGAS)", decifrar(c1), token);
  confere("bytes cifrados com a antiga ainda abrem", decifrarBytes(cb).equals(claro), true);
  verdade("o que cifra agora sai com o id da chave NOVA", cifrar(token)!.startsWith(`fh2:${idDaChaveFiscal()}:`));
  verdade("nomeOpaco muda com a chave (subchave de nome mudou)", nomeOpaco("53260964568087000180650070000000011234567890") !== nomeComA);

  delete process.env.FISCAL_CHAVES_ANTIGAS;
  confere("sem a antiga na lista, token antigo não abre (não devolve lixo)", decifrar(c1), null);
  let erroBytes = "";
  try { decifrarBytes(cb); } catch (e: any) { erroBytes = String(e?.message ?? e); }
  verdade("decifrarBytes com id ausente: erro claro citando FISCAL_CHAVE", /FISCAL_CHAVE/.test(erroBytes), erroBytes);

  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.FISCAL_CHAVE;
  delete process.env.NEXTAUTH_SECRET;
  let erroProd = "";
  try { cifrar("x"); } catch (e: any) { erroProd = String(e?.message ?? e); }
  verdade("produção sem FISCAL_CHAVE: \"Configure FISCAL_CHAVE\"", /Configure FISCAL_CHAVE/.test(erroProd), erroProd);
  process.env.NEXTAUTH_SECRET = "segredo-de-sessao-qualquer-bem-comprido";
  let erroReserva = "";
  try { cifrar("x"); } catch (e: any) { erroReserva = String(e?.message ?? e); }
  verdade("produção: NEXTAUTH_SECRET não cobre a falta", /Configure FISCAL_CHAVE/.test(erroReserva), erroReserva);
  process.env.FISCAL_CHAVE = "curta";
  let erroCurta = "";
  try { cifrar("x"); } catch (e: any) { erroCurta = String(e?.message ?? e); }
  verdade(`produção: chave < ${TAMANHO_MINIMO_DA_FISCAL_CHAVE} caracteres recusada`, erroCurta.includes(String(TAMANHO_MINIMO_DA_FISCAL_CHAVE)), erroCurta);
  verdade("ErroDaChaveFiscal exportado", typeof ErroDaChaveFiscal === "function");

  Object.assign(process.env, { NODE_ENV: "development" });
  delete process.env.FISCAL_CHAVE;
  process.env.NEXTAUTH_SECRET = "segredo-de-dev-comprido-o-suficiente-aqui";
  confere("dev: sem FISCAL_CHAVE, o NEXTAUTH_SECRET cifra/decifra", decifrar(cifrar("y")!), "y");

  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.FISCAL_CHAVE = CHAVE_A;
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.FISCAL_CHAVES_ANTIGAS;

  // O selo do link do DANFE
  console.log("\n[5] O selo do link do DANFE");
  const link = await import("../src/lib/nfce/link-do-danfe");
  const PEDIDO = "cmpedidodeteste0001";
  const CHAVE_NFE = "53260964568087000180650070000000011912518779";
  const tok = link.tokenDoDanfe(PEDIDO, CHAVE_NFE);
  verdade("token confere com a chave da nota", link.tokenConfere(tok, CHAVE_NFE));
  confere("token de outra chave não confere", link.tokenConfere(tok, "53260964568087000180650070000000019999999999"), false);
  verdade("o selo usa a subchave de selo (não a de cifra)", link.seloDoDanfe(PEDIDO, CHAVE_NFE) === createHmac("sha256", subchaveFiscal("selo-do-link")).update(`danfe-nfce:${PEDIDO}:${CHAVE_NFE}`).digest("hex").slice(0, 32));
  process.env.FISCAL_CHAVE = CHAVE_B;
  process.env.FISCAL_CHAVES_ANTIGAS = CHAVE_A;
  verdade("link enviado antes da troca ainda confere", link.tokenConfere(tok, CHAVE_NFE));
  verdade("o link novo sai com a chave nova", link.tokenDoDanfe(PEDIDO, CHAVE_NFE) !== tok);
  confere("subchavesQueConferem: atual + 1 antiga", subchavesQueConferem("selo-do-link").length, 2);
  // Agora só a CHAVE_B, sem a antiga: o `tok` (feito com a CHAVE_A) não confere.
  delete process.env.FISCAL_CHAVES_ANTIGAS; // FISCAL_CHAVE segue = CHAVE_B
  verdade("sem a antiga, o link antigo (chave A) não confere mais", !link.tokenConfere(tok, CHAVE_NFE));
  process.env.FISCAL_CHAVE = CHAVE_A; // restaura para as próximas seções

  // ════════════════════════════════════════════════════════════════════════
  // 8. O .pfx FORJADO
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n[8] O .pfx forjado (iterações da senha)");
  const { carregarCertificado, ErroDoCertificado, MAXIMO_DE_ITERACOES_DO_PFX } = await import("../src/lib/nfce/assinatura");
  verdade("o .pfx legítimo abre", carregarCertificado(PFX_NIK, SENHA_PFX).cnpj === "64568087000180");

  const comIteracoesDoMac = (pfx: Buffer, iteracoes: number): Buffer => {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
    const macData = (asn1.value as forge.asn1.Asn1[])[2];
    (macData.value as forge.asn1.Asn1[])[2] = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.asn1.integerToDer(iteracoes).getBytes());
    return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
  };

  const forjado = comIteracoesDoMac(PFX_NIK, 2_147_483_647);
  const ini = Date.now();
  let erroForjado = "";
  try { carregarCertificado(forjado, SENHA_PFX); } catch (e: any) { erroForjado = e instanceof ErroDoCertificado ? e.message : `outro: ${e?.message}`; }
  const ms = Date.now() - ini;
  confere("MAC com 2^31 iterações: recusado com \"Certificado inválido.\"", erroForjado, "Certificado inválido.");
  verdade(`…e rápido, sem derivar (${ms} ms)`, ms < 1000, `${ms} ms`);
  const acima = comIteracoesDoMac(PFX_NIK, MAXIMO_DE_ITERACOES_DO_PFX + 1);
  let erroAcima = "";
  try { carregarCertificado(acima, SENHA_PFX); } catch (e: any) { erroAcima = e instanceof ErroDoCertificado ? e.message : "outro"; }
  confere("100.001 iterações no MAC: recusado", erroAcima, "Certificado inválido.");
  const noLimite = comIteracoesDoMac(PFX_NIK, MAXIMO_DE_ITERACOES_DO_PFX);
  let erroLimite = "";
  try { carregarCertificado(noLimite, SENHA_PFX); } catch (e: any) { erroLimite = e?.message ?? String(e); }
  verdade("no teto (100.000) a guarda não barra (é a senha que não confere)", erroLimite !== "Certificado inválido.", erroLimite);

  // ════════════════════════════════════════════════════════════════════════
  // 10. NOTA EM ANDAMENTO trava a troca (função + banco falso)
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n[10] Nota em andamento trava a troca de emissor/ambiente");
  const andamento = await import("../src/lib/fiscal-notas-em-andamento");
  const { notaEmAndamento, notasEmAndamentoDaLoja } = andamento;
  confere("PENDING + processando = emitindo", notaEmAndamento({ fiscalStatus: "PENDING", fiscalInfo: { processando: true } }), "emitindo");
  confere("EMITTED + contingencia = contingencia", notaEmAndamento({ fiscalStatus: "EMITTED", fiscalInfo: { contingencia: true } }), "contingencia");
  confere("numeroTentado a_conferir", notaEmAndamento({ fiscalStatus: "FAILED", fiscalInfo: { numeroTentado: { situacao: "a_conferir" } } }), "numero_a_conferir");
  confere("PENDING + envioSefaz = envio_a_conferir", notaEmAndamento({ fiscalStatus: "PENDING", fiscalInfo: { envioSefaz: { chave: "x" } } }), "envio_a_conferir");
  confere("EMITTED autorizada (sem contingência): não está em andamento", notaEmAndamento({ fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "x" } }), null);
  confere("sem nota: null", notaEmAndamento({ fiscalStatus: "PENDING", fiscalInfo: null }), null);

  db.customerOrder.length = 0;
  const agora = new Date();
  const linhas = [
    { id: "a1", franchiseeId: "L", dailyOrderNumber: 10, createdAt: agora, fiscalStatus: "PENDING", fiscalInfo: { processando: true } },
    { id: "a2", franchiseeId: "L", dailyOrderNumber: 11, createdAt: agora, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "ok" } },
    { id: "a3", franchiseeId: "OUTRA", dailyOrderNumber: 1, createdAt: agora, fiscalStatus: "PENDING", fiscalInfo: { processando: true } },
  ];
  // Banco próprio: o `where` real (JSON path, gte, AnyNull) é muito para o
  // matcher genérico deste teste; aqui aplico só loja + janela, e a própria
  // `notasEmAndamentoDaLoja` refiltra por `notaEmAndamento`. O `where` completo
  // é conferido pela lib e pela seção estática do PUT.
  const bancoDasNotas = {
    customerOrder: {
      findMany: async () => linhas.filter((o) => o.franchiseeId === "L").map((o) => ({ id: o.id, dailyOrderNumber: o.dailyOrderNumber, fiscalStatus: o.fiscalStatus, fiscalInfo: o.fiscalInfo })),
    },
  } as any;
  const emAndamento = await notasEmAndamentoDaLoja("L", { agora, banco: bancoDasNotas });
  confere("notasEmAndamentoDaLoja: só a nota viva DA LOJA", emAndamento.map((p) => p.id), ["a1"]);

  await secaoStatus();
  await secaoDispatch();
  await secaoProdutosFiscais();
  await secaoTestarConexao();
  secaoEstatica();

  console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

// ── 1. /api/customer-order/status: a resposta não leva a linha da loja ───────
async function secaoStatus() {
  console.log("\n[1] /api/customer-order/status não vaza a linha da loja");
  db.user.length = 0; db.customerOrder.length = 0;
  db.user.push({ id: "dono", email: "dono@loja.teste", ownerId: null });
  // O pedido do banco falso carrega o que o include ANTIGO traria: se o handler
  // ecoasse a linha, estes campos apareceriam. Como o SELECT novo nem os pede,
  // eles nunca chegam ao handler — e a resposta do "sem mudança" só tem status.
  db.customerOrder.push({
    id: "p1", franchiseeId: "dono", status: "ENTREGUE", source: "ONLINE", deliveryType: "DELIVERY",
    paymentMethod: "PIX", fiscalStatus: "PENDING", fiscalInfo: null,
    franchisee: { password: "$2b$hash", resetToken: "TOKEN-DE-RESET", mpAccessToken: "MP", ifoodAccessToken: "IF", food99SecretKey: "99", jotajaClientSecret: "JJ", fiscalConfig: { tokens: {} }, ownerId: null },
  });
  sessaoEmail = "dono@loja.teste";
  const { PUT } = await import("../src/app/api/customer-order/status/route");
  const res = await PUT(new Request("http://teste/api/customer-order/status", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: "p1", status: "ENTREGUE" }), // = ao atual → "sem mudança"
  }) as any);
  const txt = await res.json();
  confere("sem mudança: responde { success, semMudanca, status }", [txt.success, txt.semMudanca, txt.status], [true, true, "ENTREGUE"]);
  verdade("a resposta NÃO traz a chave `order`", !("order" in txt));
  const bruto = JSON.stringify(txt);
  const vazou = ["password", "$2b$hash", "resetToken", "TOKEN-DE-RESET", "mpAccessToken", "ifoodAccessToken", "food99SecretKey", "jotajaClientSecret", "fiscalConfig", "franchisee"].filter((k) => bruto.includes(k));
  confere("nenhum campo da loja na resposta", vazou, []);
  const fonte = leRota("customer-order/status/route.ts");
  // O findUnique usa SELECT, e o CAMPOS_DO_PEDIDO recorta a loja a `ownerId`.
  verdade("o findUnique usa SELECT (não include da loja)", fonte.includes("select: CAMPOS_DO_PEDIDO") && /franchisee:\s*\{\s*select:\s*\{\s*ownerId:\s*true\s*\}\s*\}/.test(fonte));
  // Nenhum NextResponse.json devolve a variável `order` como valor (bare
  // `order` cercado por `{`/`,` e `,`/`}`); `order.status` não casa.
  verdade("nenhum retorno devolve a variável `order`", !/NextResponse\.json\([^)]*[,{]\s*order\s*[,}]/.test(fonte));
}

// ── 2. IDOR: dispatch-whatsapp filtra por loja ───────────────────────────────
async function secaoDispatch() {
  console.log("\n[2] dispatch-whatsapp: IDOR (pedido de outra loja)");
  db.user.length = 0; db.customerOrder.length = 0; nfceDisparada.length = 0;
  db.user.push({ id: "dono", email: "dono@loja.teste", ownerId: null });
  db.customerOrder.push(
    { id: "meu", franchiseeId: "dono", status: "ACEITO" },
    { id: "alheio", franchiseeId: "OUTRA_LOJA", status: "ACEITO" },
  );
  sessaoEmail = "dono@loja.teste";
  const { POST } = await import("../src/app/api/motoboys/dispatch-whatsapp/route");
  const res = await POST(new Request("http://teste/api/motoboys/dispatch-whatsapp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motoboyPhone: "22998887766", routeText: "rota", orderIds: ["meu", "alheio"] }),
  }) as any);
  verdade("respondeu 200", res.status === 200);
  // O gancho fiscal é fire-and-forget (import().then): deixa o microtask rodar.
  await new Promise((r) => setTimeout(r, 20));
  const meu = db.customerOrder.find((o) => o.id === "meu")!;
  const alheio = db.customerOrder.find((o) => o.id === "alheio")!;
  confere("o pedido DA LOJA foi para SAIU_ENTREGA", meu.status, "SAIU_ENTREGA");
  confere("o pedido de OUTRA loja NÃO foi tocado", alheio.status, "ACEITO");
  // O gancho fiscal recebe só os ids da loja.
  const idsFiscais = nfceDisparada.flatMap((w) => (w?.id?.in ?? []));
  confere("a NFC-e só é disparada para os ids da loja", idsFiscais, ["meu"]);
  const fonteDispatch = leRota("motoboys/dispatch-whatsapp/route.ts");
  verdade("o updateMany filtra por franchiseeId/OR da loja", /updateMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*idsDaLoja\s*\},\s*\.\.\.daLojaEDespachavel/.test(fonteDispatch));
  const fonteRota = leRota("store/routes/dispatch/route.ts");
  verdade("routes/dispatch carrega o usuário e exige a rota da loja", fonteRota.includes("user.ownerId || user.id") && fonteRota.includes("routeSchedule.findFirst") && fonteRota.includes("...daLoja"));
  verdade("routes/dispatch exige o motoboy da loja", fonteRota.includes("motoboy.findFirst") && fonteRota.includes("String(finalMotoboyId), ...daLoja"));
}

// ── 9. produto avulso é só do titular ────────────────────────────────────────
async function secaoProdutosFiscais() {
  console.log("\n[9] fiscal/products: produto avulso é só do titular");
  db.user.length = 0;
  db.user.push({ id: "dono", email: "dono@loja.teste", ownerId: null, role: "FRANCHISEE" });
  db.user.push({ id: "func", email: "func@loja.teste", ownerId: "dono", role: "STAFF" });
  const { PUT } = await import("../src/app/api/store/fiscal/products/route");
  const chamar = async (email: string): Promise<any> => {
    sessaoEmail = email;
    return PUT(new Request("http://teste/api/store/fiscal/products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "pz", ncm: "19059090", cfop: "5102", csosn: "102" }),
    }) as any);
  };
  const staff: any = await chamar("func@loja.teste");
  confere("STAFF: 403 no produto avulso", staff.status, 403);
  const corpoStaff = await staff.json();
  verdade("mensagem cita o responsável pela loja", /responsável pela loja/.test(corpoStaff.mensagem ?? ""), JSON.stringify(corpoStaff));
  const fonte = leRota("store/fiscal/products/route.ts");
  verdade("o caminho avulso chama soTitular antes de gravar", fonte.includes("const bloqueio = soTitular(user.role, \"Alterar a classificação fiscal de um produto\");"));
}

// ── 6. testar-conexao: só POST, só titular, 1/min ────────────────────────────
async function secaoTestarConexao() {
  console.log("\n[6] fiscal/testar-conexao: só POST, só titular, 1/min");
  const mod = await import("../src/app/api/store/fiscal/testar-conexao/route");
  confere("não exporta GET (não responde a GET com efeito)", typeof (mod as any).GET, "undefined");
  verdade("exporta POST", typeof (mod as any).POST === "function");
  db.user.length = 0;
  db.user.push({ id: "dono", email: "dono@loja.teste", ownerId: null, role: "FRANCHISEE", fiscalConfig: { provedor: "focusnfe" } });
  db.user.push({ id: "func", email: "func@loja.teste", ownerId: "dono", role: "STAFF" });
  const post = (email: string) => { sessaoEmail = email; return (mod as any).POST(new Request("http://teste/api/store/fiscal/testar-conexao", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })); };

  const staff = await post("func@loja.teste");
  confere("STAFF: 403", staff.status, 403);

  // Titular: o primeiro passa do rate-limit; o segundo em seguida é 429.
  // (a chamada real ao provedor pode falhar por rede — o que importa aqui é o
  // status do rate-limit, então usamos uma loja cujo provedor nem chega a rede
  // no 429.)
  const um = await post("dono@loja.teste");
  verdade("titular: o 1º teste não é 429", um.status !== 429, String(um.status));
  const dois = await post("dono@loja.teste");
  confere("titular: o 2º teste no mesmo minuto é 429", dois.status, 429);
  const corpo429 = await dois.json();
  confere("429 com a mensagem pt-BR", corpo429.mensagem, "Aguarde um minuto para testar de novo.");
  const fonte = leRota("store/fiscal/testar-conexao/route.ts");
  verdade("a rota exige FRANCHISEE/ADMIN", fonte.includes('user.role !== "FRANCHISEE" && user.role !== "ADMIN"'));
  verdade("o corpo é JSON { ambiente }", fonte.includes("body?.ambiente"));
}

// ── 3, 4, 11: conferência estática (o handler exigiria banco/rede completos) ──
function secaoEstatica() {
  console.log("\n[3,4,11] Conferências estáticas");
  const servidor = readFileSync(join(RAIZ, "src", "lib", "relatorios", "servidor.ts"), "utf8");
  verdade("[3] o grupo sai de usuario.accountGroupId || donoId (regra do switch)", servidor.includes("usuario.accountGroupId || donoId"));
  verdade("[4] STAFF precisa da caixinha (funcionarioAbre /store/relatorios)", servidor.includes('funcionarioAbre("/store/relatorios", usuario.permissions)'));
  const invoices = leRota("store/fiscal/invoices/route.ts");
  verdade("[4] invoices: STAFF precisa de Financeiro", invoices.includes('funcionarioAbre("/store/fiscal", user.permissions)'));
  const danfe = leRota("store/fiscal/danfe/route.ts");
  verdade("[4] danfe: STAFF precisa de Financeiro", danfe.includes('funcionarioAbre("/store/fiscal", user.permissions)'));
  const fiscalPut = leRota("store/fiscal/route.ts");
  verdade("[10] o PUT trava troca com nota em andamento", fiscalPut.includes("notasEmAndamentoDaLoja(lojaId)") && fiscalPut.includes("respostaDeNotasEmAndamento(emAndamento"));
  verdade("[10] a trava vale para emissor E ambiente", fiscalPut.includes("trocouDeEmissor || trocouDeAmbiente"));
  const provisionar = leRota("store/fiscal/provisionar/route.ts");
  verdade("[7] provisionar barra se o emissor efetivo é sefaz e a emissão está ligada (409)", provisionar.includes("provedorEfetivo(config).provedor !== \"sefaz\"") && provisionar.includes("emissao_ligada_no_emissor_do_firehub"));
  verdade("[7] provisionar também trava com nota em andamento", provisionar.includes("notasEmAndamentoDaLoja(lojaId)"));
  const taxa = leRota("store/orders/[id]/taxa-de-entrega/route.ts");
  verdade("[11] taxa-de-entrega lê fiscalStatus/fiscalInfo e aplica travaDaNotaFiscal", taxa.includes("fiscalStatus: true, fiscalInfo: true") && taxa.includes('travaDaNotaFiscal(order, "corrigir a taxa de entrega")'));
  verdade("[11] o UPDATE só passa com o mesmo fiscalStatus (nota emitida no meio)", taxa.includes("fiscalStatus: order.fiscalStatus,"));
}

main().catch((e) => { console.error(e); process.exit(1); });
