/**
 * "Emitir nota fiscal?" no app do garçom na maquininha (lib/nota-pelo-garcom).
 *
 *   npx tsx scripts/teste-nota-pelo-garcom.ts
 *
 * O que trava:
 *  - só o titular liga; o STAFF é recusado; ligar carimba quem e quando, e
 *    mandar o mesmo valor de novo não troca o carimbo;
 *  - desligado (ou com a NFC-e desligada), a rota da cobrança recusa o pedido
 *    de nota, e a emissão da conta ignora uma cobrança marcada antes;
 *  - ligado: a conta paga em forma FORA da emissão automática (e no modo
 *    manual) sai com UMA nota, e a segunda chamada não emite outra;
 *  - a forma já na emissão automática: o pedido do garçom não dá segunda nota;
 *  - o DANFE sai mesmo com a impressão automática da loja desligada.
 *
 * A emissão roda de verdade (lib/fiscal-automatico → emitirNfceDaMesa) contra
 * um banco FALSO em memória e um provedor FALSO (fetch interceptado), no
 * mesmo desenho de scripts/teste-fiscal-retentativa.ts. Nada vai ao banco.
 */
import { Prisma } from "@prisma/client";

// ── Banco falso ──────────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; tableSession: Linha[]; cobranca: Linha[] } = {
  user: [],
  customerOrder: [],
  tableSession: [],
  cobranca: [],
};
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ehAnyNull = (v: unknown) => v === Prisma.AnyNull || v === Prisma.DbNull || v === Prisma.JsonNull;
function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (filtro instanceof Date) return valor instanceof Date && valor.getTime() === filtro.getTime();
  if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
  if (ehAnyNull(filtro)) return valor == null;
  if ("path" in filtro) {
    const noCaminho = (filtro.path as string[]).reduce((v: any, k) => (v == null ? undefined : v[k]), valor);
    if ("equals" in filtro) return ehAnyNull(filtro.equals) ? noCaminho == null : igual(noCaminho, filtro.equals);
    throw new Error(`filtro de caminho não suportado: ${JSON.stringify(filtro)}`);
  }
  for (const [op, alvo] of Object.entries(filtro)) {
    if (op === "equals") { if (ehAnyNull(alvo) ? valor != null : !igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if (valor == null || (alvo as unknown[]).includes(valor)) return false; }
    else if (op === "not") { if (valor == null || igual(valor, alvo)) return false; }
    else throw new Error(`operador não suportado: ${op}`);
  }
  return true;
}
function casa(linha: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") { if (!(v as any[]).every((w) => casa(linha, w))) return false; }
    else if (k === "OR") { if (!(v as any[]).some((w) => casa(linha, w))) return false; }
    else if (k === "NOT") { if (casa(linha, v)) return false; }
    else if (!casaCampo(linha[k], v)) return false;
  }
  return true;
}
const copia = <T>(v: T): T => (v == null ? v : structuredClone(v));
function projetar(linha: Linha, args: any, modelo: "user" | "customerOrder" | "tableSession"): Linha {
  const saida: Linha = { ...linha };
  if (modelo === "tableSession" && args?.select?.orders) {
    saida.orders = db.customerOrder
      .filter((o) => o.tableSessionId === linha.id)
      .map((o) => ({ ...o, fiscalInfo: copia(o.fiscalInfo) }));
  }
  if (modelo === "customerOrder") saida.fiscalInfo = copia(linha.fiscalInfo);
  return saida;
}
const delegado = (modelo: "user" | "customerOrder" | "tableSession") => ({
  findUnique: async (args: any) => {
    const l = db[modelo].find((x) => casa(x, args.where));
    return l ? projetar(l, args, modelo) : null;
  },
  findFirst: async (args: any) => {
    const l = db[modelo].find((x) => casa(x, args.where));
    return l ? projetar(l, args, modelo) : null;
  },
  findMany: async (args: any = {}) => db[modelo].filter((x) => casa(x, args.where)).map((l) => projetar(l, args, modelo)),
  updateMany: async (args: any) => {
    const alvos = db[modelo].filter((x) => casa(x, args.where));
    for (const a of alvos) Object.assign(a, copia(args.data), modelo === "customerOrder" ? { updatedAt: new Date() } : {});
    return { count: alvos.length };
  },
});
/**
 * O único SQL cru deste caminho: "alguma cobrança PAGA desta conta pediu
 * nota?" (lib/fiscal-automatico → notaPedidaPeloGarcom). Confere o texto para
 * o teste quebrar se a consulta mudar de forma.
 */
let semTabelaDeCobranca = false;
async function consultarSql(sql: string, ...valores: unknown[]): Promise<Linha[]> {
  if (!/FROM "CobrancaDaMesaNaMaquininha"/.test(sql) || !/"status" = 'PAGO'/.test(sql) || !/"dados"->>'emitirNota'\) = 'true'/.test(sql)) {
    throw new Error(`SQL cru não previsto no banco falso: ${sql}`);
  }
  if (semTabelaDeCobranca) throw new Error('relation "CobrancaDaMesaNaMaquininha" does not exist');
  return db.cobranca
    .filter((c) => c.tableSessionId === valores[0] && c.status === "PAGO" && c.dados?.emitirNota === true)
    .map((c) => ({ id: c.id, criadoPor: c.criadoPor }));
}
(globalThis as any).prisma = {
  user: delegado("user"),
  customerOrder: delegado("customerOrder"),
  tableSession: delegado("tableSession"),
  $queryRawUnsafe: consultarSql,
  $executeRaw: async () => {
    throw new Error("SQL cru não previsto no banco falso ($executeRaw)");
  },
};
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Provedor falso (Focus): autoriza tudo e conta os envios ──────────────────
const envios: string[] = [];
let numero = 100;
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const metodo = String(init.method || "GET");
  const ref = decodeURIComponent(String(url).match(/nfce(?:\?ref=|\/)([^?&]+)/)?.[1] || "");
  if (metodo === "POST") envios.push(ref);
  numero++;
  return new Response(
    JSON.stringify({
      status: "autorizado", chave_nfe: "NFe" + String(numero).padStart(44, "3"), numero, serie: 1,
      protocolo: "1330000" + numero, data_emissao: new Date().toISOString(),
      caminho_danfe: `/arquivos/danfe-${numero}.html`, caminho_xml_nota_fiscal: `/arquivos/${numero}.xml`,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
};

// ── Cenário ──────────────────────────────────────────────────────────────────
const LOJA = "loja-1";
const agora = new Date();
const haMin = (min: number) => new Date(agora.getTime() - min * 60_000);
const CADASTRO = {
  enabled: true, provedor: "focusnfe", tokenDoProvedor: "token-de-teste", ambiente: 2, serie: 1,
  cnpj: "11.222.333/0001-81", inscricaoEstadual: "12.345.678", razaoSocial: "LOJA TESTE LTDA", regimeTributario: 1,
  logradouro: "Rua A", numero: "100", bairro: "Centro", municipio: "Rio das Ostras", codigoMunicipio: "3304524",
  uf: "RJ", cep: "28890-000", cscId: "1", csc: "abc", temCertificado: true,
  // Dinheiro FORA da emissão automática; crédito dentro.
  autoEmitPaymentMethods: ["PIX", "CREDIT_CARD"], momentoDaEmissao: "saida",
};
db.user.push({ id: LOJA, ifoodMerchantId: null, food99MerchantId: null, fiscalConfig: { ...CADASTRO } });
const loja = () => db.user[0];
const produto = { id: "pz", name: "Pastel", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" };
let seq = 0;
function conta(id: string, forma: string, opcoes: { pediuNota: boolean }) {
  db.tableSession.push({
    id, franchiseeId: LOJA, status: "CLOSED", closedAt: haMin(1), customerName: "Mesa 4",
    serviceFee: 0, waiterTip: 0, paymentMethods: [{ method: forma, amount: 30 }],
  });
  const o: Linha = {
    id: `p${++seq}`, franchiseeId: LOJA, status: "ENTREGUE", deliveryType: "MESA", tableSessionId: id,
    paymentMethod: "N/A", totalAmount: 30, customerCpfCnpj: null, fiscalStatus: "PENDING", fiscalInfo: null,
    createdAt: haMin(30), updatedAt: haMin(30),
    items: [{ id: `i-${seq}`, productName: "Pastel", quantity: 1, price: 30, menuProduct: produto }],
  };
  db.customerOrder.push(o);
  db.cobranca.push({
    id: `cb-${id}`, tableSessionId: id, status: "PAGO", criadoPor: "Garçom Teste",
    dados: { mesa: 4, ...(opcoes.pediuNota ? { emitirNota: true } : {}) },
  });
  return o;
}
const doPedido = (id: string) => db.customerOrder.find((o) => o.id === id)!;
const enviosDa = (sessao: string) => envios.filter((r) => r.includes(`mesa-${sessao}`)).length;

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

async function main() {
  const { aplicarFormularioFiscal } = await import("../src/lib/fiscal-config");
  const { garcomPodePedirNota, recusaDaNotaPeloGarcom, lerNotaPeloGarcom, impressaoDaNotaDaConta } = await import("../src/lib/nota-pelo-garcom");
  const { emitirNfceDaMesa, usarImpressoraDeTeste } = await import("../src/lib/fiscal-automatico");

  // ── 1. Quem liga ─────────────────────────────────────────────────────────
  console.log("\n— Quem liga —");
  const opcoes = (papel: string, quem: string | null = null) => ({
    papel, cifrar: (s: string) => `cifrado:${s}`, conferir: () => [], agora: new Date("2026-11-13T15:00:00Z"), quem,
  });
  const peloStaff = aplicarFormularioFiscal(CADASTRO, { notaPeloGarcom: true }, opcoes("STAFF", "Caixa (caixa@loja)"));
  confere(
    "STAFF não liga: o campo volta em camposIgnorados e nada muda",
    peloStaff.ok && [peloStaff.recusados.includes("notaPeloGarcom"), lerNotaPeloGarcom(peloStaff.config).ligado],
    [true, false]
  );
  const peloDono = aplicarFormularioFiscal(CADASTRO, { notaPeloGarcom: true }, opcoes("FRANCHISEE", "Douglas (dono@loja)"));
  confere(
    "o titular liga, com quem e quando",
    peloDono.ok && [peloDono.recusados.length, peloDono.config.notaPeloGarcom],
    [0, { ligado: true, por: "Douglas (dono@loja)", em: "2026-11-13T15:00:00.000Z" }]
  );
  const ligadoAntes = peloDono.ok ? peloDono.config : {};
  const deNovo = aplicarFormularioFiscal(ligadoAntes, { notaPeloGarcom: true }, { ...opcoes("FRANCHISEE", "Outro (outro@loja)"), agora: new Date("2026-11-14T10:00:00Z") });
  confere("mandar o mesmo valor de novo não troca o carimbo", deNovo.ok && deNovo.config.notaPeloGarcom, { ligado: true, por: "Douglas (dono@loja)", em: "2026-11-13T15:00:00.000Z" });
  const retrato = aplicarFormularioFiscal(ligadoAntes, { notaPeloGarcom: { ligado: false } }, opcoes("FRANCHISEE", "x"));
  confere("o retrato do GET mandado de volta (objeto) não desliga", retrato.ok && lerNotaPeloGarcom(retrato.config).ligado, true);
  const staffSemMudar = aplicarFormularioFiscal(ligadoAntes, { notaPeloGarcom: true }, opcoes("STAFF"));
  confere("STAFF mandando o valor que já está não vira 'recusado'", staffSemMudar.ok && staffSemMudar.recusados, []);
  const desligado = aplicarFormularioFiscal(ligadoAntes, { notaPeloGarcom: false }, { ...opcoes("FRANCHISEE", "Douglas (dono@loja)"), agora: new Date("2026-11-15T12:00:00Z") });
  confere("o titular desliga, e fica quem desligou", desligado.ok && desligado.config.notaPeloGarcom, { ligado: false, por: "Douglas (dono@loja)", em: "2026-11-15T12:00:00.000Z" });

  // ── 2. Desligado recusa ──────────────────────────────────────────────────
  console.log("\n— Desligado recusa —");
  confere("começa desligado: o app não pergunta", garcomPodePedirNota(CADASTRO), false);
  confere("desligado: a rota da cobrança recusa (403)", recusaDaNotaPeloGarcom(CADASTRO)?.codigo, "NOTA_PELO_GARCOM_DESLIGADA");
  const ligadoSemNfce = { ...CADASTRO, enabled: false, notaPeloGarcom: { ligado: true } };
  confere("ligado com a NFC-e desligada: não pergunta e recusa", [garcomPodePedirNota(ligadoSemNfce), recusaDaNotaPeloGarcom(ligadoSemNfce)?.codigo], [false, "NOTA_FISCAL_DESLIGADA"]);
  const ligadoComNfce = { ...CADASTRO, notaPeloGarcom: { ligado: true } };
  confere("ligado com a NFC-e ligada: pergunta e aceita", [garcomPodePedirNota(ligadoComNfce), recusaDaNotaPeloGarcom(ligadoComNfce)], [true, null]);

  // A cobrança pediu nota, mas a loja desligou antes de a conta fechar.
  const sD = conta("SD", "Dinheiro", { pediuNota: true });
  const rD = await emitirNfceDaMesa("SD", { desconto: 0 });
  confere(
    "desligado: a cobrança marcada não fura a lista de formas (nada vai ao provedor)",
    [rD.acao, enviosDa("SD"), doPedido(sD.id).fiscalStatus],
    ["ignorado", 0, "PENDING"]
  );

  // ── 3. Ligado emite uma vez ──────────────────────────────────────────────
  console.log("\n— Ligado: uma nota —");
  loja().fiscalConfig = { ...CADASTRO, notaPeloGarcom: { ligado: true, por: "Douglas", em: agora.toISOString() } };
  const impressos: string[] = [];
  usarImpressoraDeTeste((pedidoId, op) => impressos.push(`${pedidoId}${op?.forcar ? ":forcado" : ""}`));

  const sSem = conta("SSEM", "Dinheiro", { pediuNota: false });
  const rSem = await emitirNfceDaMesa("SSEM", { desconto: 0 });
  confere("ligado, mas o garçom disse Não: dinheiro segue sem nota", [rSem.acao, enviosDa("SSEM"), doPedido(sSem.id).fiscalStatus], ["ignorado", 0, "PENDING"]);

  const sSim = conta("SSIM", "Dinheiro", { pediuNota: true });
  const r1 = await emitirNfceDaMesa("SSIM", { desconto: 0 });
  confere(
    "garçom disse Sim: a conta em dinheiro (fora da automática) sai com nota",
    [r1.acao, enviosDa("SSIM"), doPedido(sSim.id).fiscalStatus, doPedido(sSim.id).fiscalInfo.notaPedidaPeloGarcom],
    ["emitida", 1, "EMITTED", { cobrancaId: "cb-SSIM", por: "Garçom Teste" }]
  );
  const r2 = await emitirNfceDaMesa("SSIM", { desconto: 0 });
  confere("chamada repetida (cron, reenvio): nenhuma segunda nota", [r2.acao, r2.motivo, enviosDa("SSIM")], ["ignorado", "a conta já tem nota", 1]);

  // Modo manual: a pessoa emite pelo pedido — mas o garçom já pediu.
  loja().fiscalConfig = { ...loja().fiscalConfig, modoDaEmissao: "manual" };
  conta("SMAN", "Dinheiro", { pediuNota: true });
  const rMan = await emitirNfceDaMesa("SMAN", { desconto: 0 });
  confere("modo manual: o Sim do garçom emite (uma vez)", [rMan.acao, enviosDa("SMAN")], ["emitida", 1]);
  loja().fiscalConfig = { ...loja().fiscalConfig, modoDaEmissao: "automatico" };

  // ── 4. Sem emissão dobrada ───────────────────────────────────────────────
  console.log("\n— Forma já na automática —");
  const sCred = conta("SCRED", "Crédito", { pediuNota: true });
  const rc1 = await emitirNfceDaMesa("SCRED", { desconto: 0 });
  const rc2 = await emitirNfceDaMesa("SCRED", { desconto: 0 });
  confere(
    "crédito (já automática) + Sim do garçom: UMA nota, não duas",
    [rc1.acao, rc2.acao, enviosDa("SCRED"), doPedido(sCred.id).fiscalStatus],
    ["emitida", "ignorado", 1, "EMITTED"]
  );

  // ── 5. O cupom no caixa ──────────────────────────────────────────────────
  console.log("\n— DANFE no caixa —");
  confere("loja imprime sozinha: imprime sem forçar", impressaoDaNotaDaConta(true, true), { imprimir: true, forcar: false });
  confere("loja desligou a impressão + Sim do garçom: imprime forçado", impressaoDaNotaDaConta(false, true), { imprimir: true, forcar: true });
  confere("loja desligou a impressão, sem pedido do garçom: não imprime", impressaoDaNotaDaConta(false, false), { imprimir: false, forcar: false });
  // A impressão automática só existe no emissor próprio (a Focus tem o dela):
  // com a Focus deste teste nada vai para a fila — o que trava é a decisão acima.
  confere("Focus: nenhum cupom na fila do emissor próprio", impressos, []);

  // ── 6. Loja sem a tabela de cobranças ────────────────────────────────────
  console.log("\n— Loja que nunca cobrou mesa na maquininha —");
  semTabelaDeCobranca = true;
  conta("SNOVA", "Dinheiro", { pediuNota: false });
  const rNova = await emitirNfceDaMesa("SNOVA", { desconto: 0 });
  confere("sem a tabela: ninguém pediu, segue a regra de sempre", [rNova.acao, enviosDa("SNOVA")], ["ignorado", 0]);
  semTabelaDeCobranca = false;
  usarImpressoraDeTeste(null);

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
