/**
 * O EvoPDV emitindo NFC-e pelo emissor do FireHub (lib/evopdv, rotas
 * /api/integracoes/evopdv/*), de ponta a ponta — as rotas de verdade, a
 * numeração, a emissão, a gravação e o cron — contra:
 *
 *  - o BANCO FALSO dos testes (scripts/nfce-teste-apoio → bancoFalso), com a
 *    VendaExterna e a IntegracaoEvopdv;
 *  - a SEFAZ FALSA das fixtures;
 *  - um cofre em pasta temporária, com o certificado de TESTE;
 *  - um stub da Vercel do EvoPDV (api/fiscal-status.js) para a assinatura.
 *
 * Os itens da fase 2 do plano (Obsidian: "EvoPDV - Plano NFC-e pelo FireHub"):
 * 2 POSTs = 1 nota; concorrência = 1 reserva; 539 e 656; contingência;
 * cancelar e reemitir como -2; pedido e venda intercalados na mesma série sem
 * repetir número; a inutilização mensal não pega número usado. E a fase 5 (só
 * servidor): 402 com o fiscal inativo, consultar/cancelar/DANFE/XML seguem.
 *
 * Nada vai ao banco de verdade, nem à SEFAZ, nem à Vercel.
 *
 *   npx tsx scripts/teste-evopdv-emissao.ts
 */
export {};

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_NIK, FIXTURES, SENHA_DO_CERTIFICADO, bancoFalso, confere, metodoDo, responder, sefazFalsa, terminar, verdade, type Linha } from "./nfce-teste-apoio";
import type { PedidoHttp, RespostaHttp } from "../src/lib/nfce/sefaz";

process.env.FISCAL_CHAVE = "chave-de-teste-do-evopdv-pelo-firehub";
// Não-Postgres de propósito: a garantia da estrutura no boot pula (o banco é o falso).
process.env.DATABASE_URL = "file:banco-falso-dos-testes";
process.env.NEXTAUTH_SECRET ||= "segredo-de-teste";
const COFRE = mkdtempSync(join(tmpdir(), "fh-cofre-evopdv-"));
process.env.FH_FISCAL_DIR = COFRE;
for (const k of ["FH_RESP_TEC_CNPJ", "FH_RESP_TEC_NOME", "FH_RESP_TEC_EMAIL", "FH_RESP_TEC_FONE", "EVOPDV_PROVISIONAMENTO_SEGREDO", "EVOPDV_FISCAL_STATUS_URL", "EVOPDV_FISCAL_STATUS_SEGREDO"]) delete process.env[k];

// ── Banco falso, com o que a integração usa a mais ───────────────────────────
const { db, banco, objetoDe } = bancoFalso();
const tabelas = db as typeof db & { integracaoEvopdv: Linha[] };
tabelas.integracaoEvopdv = [];
let ids = 0;
const novoId = (p: string) => `${p}${++ids}`;
const unico = (msg: string) => Object.assign(new Error(msg), { code: "P2002" });
const clone = <T>(v: T): T => structuredClone(v);

const geral = banco.vendaExterna;
banco.vendaExterna = {
  ...geral,
  findUnique: async (args: any) => {
    const k = args.where?.franchiseeId_origem_vendaId;
    if (!k) return geral.findUnique(args);
    const l = db.vendaExterna.find((v) => v.franchiseeId === k.franchiseeId && v.origem === k.origem && v.vendaId === k.vendaId);
    return l ? clone(l) : null;
  },
  create: async ({ data }: any) => {
    const origem = data.origem ?? "evopdv";
    if (db.vendaExterna.some((v) => v.franchiseeId === data.franchiseeId && v.origem === origem && v.vendaId === data.vendaId)) throw unico("VendaExterna duplicada");
    const l = { id: novoId("ve"), origem, fiscalStatus: null, fiscalInfo: null, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
    db.vendaExterna.push(l);
    return clone(l);
  },
  count: async (args: any) => (await geral.findMany(args)).length,
};
banco.integracaoEvopdv = {
  findUnique: async ({ where }: any) => {
    const [k, v] = Object.entries(where)[0] as [string, unknown];
    const l = tabelas.integracaoEvopdv.find((x) => x[k] === v);
    return l ? clone(l) : null;
  },
  create: async ({ data }: any) => {
    if (tabelas.integracaoEvopdv.some((x) => x.cnpj === data.cnpj || x.franchiseeId === data.franchiseeId || x.chaveHash === data.chaveHash)) throw unico("IntegracaoEvopdv duplicada");
    const l = { id: novoId("int"), assinatura: null, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
    tabelas.integracaoEvopdv.push(l);
    return clone(l);
  },
  update: async ({ where, data }: any) => {
    const l = tabelas.integracaoEvopdv.find((x) => x.id === where.id);
    if (!l) throw new Error("integracao não encontrada");
    Object.assign(l, clone(data), { updatedAt: new Date() });
    return clone(l);
  },
};
banco.user.create = async ({ data }: any) => {
  if (db.user.some((u) => u.email === data.email)) throw unico("User duplicado");
  const u = { id: novoId("u"), ...clone(data) };
  db.user.push(u);
  return { id: u.id };
};
// A série das outras contas do mesmo CNPJ (lib/evopdv/conta → seriesDoMesmoCnpj).
const consultaGeral = banco.$queryRaw;
banco.$queryRaw = async (sql: any) => {
  if (!/fh:series-do-mesmo-cnpj/.test(String(sql?.sql ?? ""))) return consultaGeral(sql);
  const [role, cnpj] = sql.values as [string, string];
  const limpo = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return db.user.filter((u) => u.role !== role && (limpo(objetoDe(u.fiscalConfig).cnpj) === cnpj || limpo(u.cpfCnpj) === cnpj)).map((u) => ({ id: u.id, fiscalConfig: u.fiscalConfig }));
};

// ── SEFAZ falsa ──────────────────────────────────────────────────────────────
type Resposta = RespostaHttp | "timeout-antes" | "timeout-depois";
let roteiro: (p: PedidoHttp) => Resposta = () => ({ status: 500, corpo: "" });
const sefaz = sefazFalsa((p) => roteiro(p));
const metodos = (desde: number) => sefaz.pedidos.slice(desde).map(metodoDo);
const autorizacoes = (desde: number) => metodos(desde).filter((m) => m === "nfeAutorizacaoLote").length;
const saudavel = (p: PedidoHttp): Resposta => {
  const m = metodoDo(p);
  if (m === "nfeAutorizacaoLote") return responder("autorizacao-100.xml", p);
  if (m === "nfeConsultaNF") return responder("consulta-100.xml", p, { DIGVAL: "" });
  if (m === "nfeRecepcaoEvento") return responder("evento-135.xml", p);
  if (m === "nfeInutilizacaoNF") return responder("inutilizacao-102.xml", p);
  if (m === "nfeStatusServicoNF") return responder("status-107.xml", p);
  return { status: 500, corpo: "" };
};
/** A SEFAZ "lenta": segura a autorização até `soltar()` (para a concorrência). */
function sefazLenta() {
  let soltar!: () => void;
  const pronto = new Promise<void>((r) => (soltar = r));
  return { soltar, roteiro: async (p: PedidoHttp): Promise<Resposta> => (metodoDo(p) === "nfeAutorizacaoLote" ? (await pronto, saudavel(p)) : saudavel(p)) };
}

// ── Stub da Vercel do EvoPDV (api/fiscal-status.js) ──────────────────────────
let vercel: { ativo: boolean } | "fora" = { ativo: true };
const perguntasAVercel: string[] = [];

// ── Rotas ────────────────────────────────────────────────────────────────────
const SEGREDO = "segredo-do-provisionamento-com-mais-de-32-caracteres";
async function chamar(modulo: any, metodo: string, caminho: string, o: { chave?: string; corpo?: unknown; params?: Record<string, string>; bruto?: string } = {}) {
  const req = new Request(`https://firehub.test${caminho}`, {
    method: metodo,
    headers: { "content-type": "application/json", ...(o.chave ? { authorization: `Bearer ${o.chave}` } : {}) },
    ...(o.corpo !== undefined || o.bruto ? { body: o.bruto ?? JSON.stringify(o.corpo) } : {}),
  });
  const res: Response = await modulo[metodo](req, o.params ? { params: Promise.resolve(o.params) } : undefined);
  const texto = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(texto);
  } catch {}
  return { status: res.status, json, texto, tipo: res.headers.get("content-type") ?? "" };
}

// ── A venda ──────────────────────────────────────────────────────────────────
const item = (n: number, extra: Linha = {}): Linha => ({
  codigo: `P${n}`, descricao: `Produto ${n}`, ncm: "21069090", cfop: "5102", csosn: "102", origem: 0, unidade: "UN",
  quantidade: 2, valorUnitarioCentavos: 390, totalCentavos: 780, ...extra,
});
let vendas = 0;
function venda(extra: Linha = {}): Linha {
  vendas++;
  return {
    vendaId: `sale-${vendas}`,
    itens: [item(1), item(2, { quantidade: 1, valorUnitarioCentavos: 1000, totalCentavos: 1000 })],
    totalCentavos: 1780,
    pagamentos: [{ forma: "PIX", valorCentavos: 1780 }],
    ...extra,
  };
}

async function main() {
  const provisionar = await import("../src/app/api/integracoes/evopdv/provisionar/route");
  const status = await import("../src/app/api/integracoes/evopdv/status/route");
  const config = await import("../src/app/api/integracoes/evopdv/config/route");
  const certificado = await import("../src/app/api/integracoes/evopdv/certificado/route");
  const testar = await import("../src/app/api/integracoes/evopdv/testar-sefaz/route");
  const notas = await import("../src/app/api/integracoes/evopdv/notas/route");
  const umaNota = await import("../src/app/api/integracoes/evopdv/notas/[vendaId]/route");
  const cancelar = await import("../src/app/api/integracoes/evopdv/notas/[vendaId]/cancelar/route");
  const danfe = await import("../src/app/api/integracoes/evopdv/notas/[vendaId]/danfe/route");
  const xml = await import("../src/app/api/integracoes/evopdv/notas/[vendaId]/xml/route");
  const loja = await import("../src/lib/nfce/emissao-da-loja");
  const auto = await import("../src/lib/fiscal-automatico");
  const { lerXmlFiscal, guardarArquivoFiscal } = await import("../src/lib/nfce/armazenamento");
  const { lerChave } = await import("../src/lib/nfce/chave");
  const { cifrar } = await import("../src/lib/fiscal-credenciais");
  const { carregarCertificado } = await import("../src/lib/nfce/assinatura");
  const { lojaIsenta } = await import("../src/lib/billing");
  const { inutilizarBuracosDoMes } = await import("../src/lib/nfce/inutilizacao-da-loja");
  const { normalizarConfigFiscal } = await import("../src/lib/fiscal-config");
  const assinatura = await import("../src/lib/evopdv/assinatura");
  const conta = await import("../src/lib/evopdv/conta");
  const notasLib = await import("../src/lib/evopdv/notas");
  const { conferirVenda, vendaParaNota } = await import("../src/lib/evopdv/venda");
  const { montarCorpoDaNfce } = await import("../src/lib/fiscal-emissao");

  loja.usarTransporteDeTeste(sefaz.transporte);
  const cupons: string[] = [];
  auto.usarImpressoraDeTeste((id) => cupons.push(id));
  assinatura.usarBuscaDaAssinaturaDeTeste(async (url) => {
    perguntasAVercel.push(url);
    if (vercel === "fora") throw new Error("ECONNREFUSED");
    const corpo = vercel;
    return { ok: true, status: 200, json: async () => corpo };
  });
  roteiro = saudavel;

  const pfx = readFileSync(join(FIXTURES, "nfce-certificado-teste.pfx"));
  const CSC = "0123456789ABCDEF0123456789ABCDEF";

  // A loja do FireHub com o MESMO CNPJ (a NIK, série 7): o EvoPDV não pode usar a série dela.
  const NIK = "loja-nik";
  const cert = carregarCertificado(pfx, SENHA_DO_CERTIFICADO);
  const noCofre = await guardarArquivoFiscal({ lojaId: NIK, tipo: "certificado", identificacao: "a1", conteudo: pfx });
  const certificadoDaNik = {
    arquivo: noCofre.caminho, sha256: noCofre.sha256, senhaCifrada: cifrar(SENHA_DO_CERTIFICADO)!, cnpj: cert.cnpj!,
    titular: cert.titular, validoDe: cert.validoDe.toISOString(), validoAte: cert.validoAte.toISOString(), enviadoEm: new Date().toISOString(),
  };
  const cscDe = (id: string) => ({ id, cifrado: cifrar(CSC)!, final: CSC.slice(-4) });
  const configDaNik = (extra: Linha = {}): Linha => ({
    ...CONFIG_NIK, tokenDoProvedor: null, cscId: null, csc: null, temCertificado: false, provedor: "sefaz", enabled: true, ambiente: 2,
    inscricaoEstadual: "0712345600123", autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"], momentoDaEmissao: "saida",
    sefaz: { certificado: certificadoDaNik, csc: { homologacao: cscDe("1"), producao: cscDe("2") }, serie: 7, numeroInicial: 1, qrVersao: 2 },
    ...extra,
  });
  db.user.push({ id: NIK, role: "FRANCHISEE", ifoodMerchantId: null, food99MerchantId: null, storeName: "Nik Esfiharia", name: "Nik", cpfCnpj: null, fiscalConfig: configDaNik() });

  // ── 1. Provisionamento ─────────────────────────────────────────────────
  console.log("\n— 1. Provisionamento (servidor-a-servidor) —");
  const dadosDaEmpresa = {
    cnpj: "64.568.087/0001-80", razaoSocial: "NIK COMERCIO DE ALIMENTOS LTDA", nomeFantasia: "Nik Balcão", inscricaoEstadual: "0712345600123",
    regimeTributario: 1, logradouro: "QS 1 Rua 210", numero: "Lote 40", bairro: "Taguatinga Sul", municipio: "Brasília", codigoMunicipio: "5300108",
    uf: "DF", cep: "71950-770", email: "Lojista@EvoPDV.com.br",
  };
  let chave = "";
  let lojaEvo = "";
  {
    confere("sem EVOPDV_PROVISIONAMENTO_SEGREDO: 503 (desligado)", (await chamar(provisionar, "POST", "/api/integracoes/evopdv/provisionar", { chave: SEGREDO, corpo: dadosDaEmpresa })).status, 503);
    process.env.EVOPDV_PROVISIONAMENTO_SEGREDO = SEGREDO;
    confere("segredo errado: 401", (await chamar(provisionar, "POST", "/api/integracoes/evopdv/provisionar", { chave: "x".repeat(40), corpo: dadosDaEmpresa })).status, 401);
    const invalido = await chamar(provisionar, "POST", "/api/integracoes/evopdv/provisionar", { chave: SEGREDO, corpo: { ...dadosDaEmpresa, cnpj: "11.111.111/1111-11" } });
    confere("CNPJ inválido: 422", [invalido.status, invalido.json?.error], [422, "cnpj_invalido"]);
    const serie7 = await chamar(provisionar, "POST", "/api/integracoes/evopdv/provisionar", { chave: SEGREDO, corpo: { ...dadosDaEmpresa, serie: 7 } });
    confere("série 7 = a da loja do FireHub com o mesmo CNPJ: 409 (seria 539)", [serie7.status, serie7.json?.error, serie7.json?.seriesEmUso], [409, "serie_em_uso", [7]]);
    const r = await chamar(provisionar, "POST", "/api/integracoes/evopdv/provisionar", { chave: SEGREDO, corpo: dadosDaEmpresa });
    confere("criada: 201, com a chave da loja e a série 2 (a sugerida; a 7 é da NIK)", [r.status, r.json?.criada, /^evo_[0-9a-f]{64}$/.test(r.json?.chave), r.json?.serie], [201, true, true, 2]);
    chave = r.json.chave;
    lojaEvo = r.json.contaId;
    const u = db.user.find((x) => x.id === lojaEvo)!;
    confere("a conta: role EVOPDV, planPercent 0, e-mail interno .invalid, sem login possível", [u.role, u.planPercent, u.email, /^\$2[aby]\$/.test(u.password)], ["EVOPDV", 0, "evopdv-64568087000180@evopdv.invalid", true]);
    confere("isenta pelo lojaIsenta (mensalidade)", lojaIsenta(u), true);
    confere("fiscalConfig: emissor próprio, homologação, contingência ligada, origem evopdv, nada automático", [u.fiscalConfig.provedor, u.fiscalConfig.ambiente, u.fiscalConfig.sefaz.contingenciaOffline, u.fiscalConfig.origem, u.fiscalConfig.autoEmitPaymentMethods], ["sefaz", 2, true, "evopdv", []]);
    const integ = tabelas.integracaoEvopdv.find((x) => x.franchiseeId === lojaEvo)!;
    verdade("guarda só o sha256 da chave", integ.chaveHash === conta.hashDaChave(chave) && !JSON.stringify(tabelas.integracaoEvopdv).includes(chave));
    confere("e-mail da licença guardado em minúsculas", integ.email, "lojista@evopdv.com.br");
    const de2 = await chamar(provisionar, "POST", "/api/integracoes/evopdv/provisionar", { chave: SEGREDO, corpo: { ...dadosDaEmpresa, nomeFantasia: "Nik Balcão 2" } });
    confere("de novo com o mesmo CNPJ: 200, a mesma conta, chave nova", [de2.status, de2.json?.criada, de2.json?.chave !== chave, tabelas.integracaoEvopdv.length], [200, false, true, 1]);
    confere("a chave antiga para de valer (401) e a nova vale", [(await chamar(status, "GET", "/api/integracoes/evopdv/status", { chave })).status, (await chamar(status, "GET", "/api/integracoes/evopdv/status", { chave: de2.json.chave })).status], [401, 200]);
    chave = de2.json.chave;
    confere("os dados da empresa foram atualizados", db.user.find((x) => x.id === lojaEvo)!.fiscalConfig.nomeFantasia, "Nik Balcão 2");
    confere("sem chave: 401", (await chamar(status, "GET", "/api/integracoes/evopdv/status")).status, 401);
  }

  // ── 2. A1, CSC e teste da SEFAZ pela API ───────────────────────────────
  console.log("\n— 2. Certificado, CSC e teste da SEFAZ pela API —");
  {
    const antes = await chamar(status, "GET", "/api/integracoes/evopdv/status", { chave });
    confere("antes: pendências do certificado e do CSC, não está pronta", [antes.json.prontaParaEmitir, antes.json.pendencias.map((p: Linha) => p.campo).sort()], [false, ["certificado", "csc", "cscId"]]);
    const errada = await chamar(certificado, "POST", "/api/integracoes/evopdv/certificado", { chave, corpo: { certificadoBase64: pfx.toString("base64"), senha: "errada" } });
    confere("senha errada: 400, sem guardar", [errada.status, db.user.find((x) => x.id === lojaEvo)!.fiscalConfig.sefaz.certificado ?? null], [400, null]);
    const ok = await chamar(certificado, "POST", "/api/integracoes/evopdv/certificado", { chave, corpo: { certificadoBase64: pfx.toString("base64"), senha: SENHA_DO_CERTIFICADO } });
    confere("A1 guardado: 200, titular e validade", [ok.status, ok.json?.certificado?.cnpj], [200, "64568087000180"]);
    verdade("a resposta não devolve o .pfx nem a senha", !ok.texto.includes(pfx.toString("base64").slice(0, 40)) && !ok.texto.includes(SENHA_DO_CERTIFICADO));
    const csc = await chamar(config, "PUT", "/api/integracoes/evopdv/config", { chave, corpo: { csc: { homologacao: { id: "1", codigo: CSC }, producao: { id: "2", codigo: CSC } } } });
    confere("CSC dos dois ambientes: 200", csc.status, 200);
    const sefazGravada = db.user.find((x) => x.id === lojaEvo)!.fiscalConfig.sefaz;
    verdade("o CSC fica cifrado (só o final em claro)", !JSON.stringify(sefazGravada).includes(CSC) && sefazGravada.csc.homologacao.final === CSC.slice(-4));
    const depois = await chamar(status, "GET", "/api/integracoes/evopdv/status", { chave });
    confere("pronta para emitir: sem pendência, homologação, série 2", [depois.json.prontaParaEmitir, depois.json.pendencias, depois.json.ambiente, depois.json.serie], [true, [], "homologacao", 2]);
    const t = await chamar(testar, "POST", "/api/integracoes/evopdv/testar-sefaz", { chave, corpo: {} });
    confere("teste da SEFAZ: status 107 em homologação, com o A1 da loja", [t.status, t.json?.ok, t.json?.cStat, t.json?.ambiente], [200, true, "107", "homologacao"]);
  }

  // ── 3. Validação em centavos ───────────────────────────────────────────
  console.log("\n— 3. A venda conferida em centavos —");
  {
    const erroDe = (v: Linha) => (conferirVenda(v) as any).erros?.map((e: Linha) => e.campo) ?? [];
    confere("venda certa: sem erro", erroDe(venda()), []);
    confere("Σ itens − desconto + acréscimo ≠ total", erroDe(venda({ totalCentavos: 1700, pagamentos: [{ forma: "PIX", valorCentavos: 1700 }] })), ["totalCentavos"]);
    confere("com desconto e acréscimo que fecham: sem erro", erroDe(venda({ descontoCentavos: 80, acrescimoCentavos: 300, totalCentavos: 2000, pagamentos: [{ forma: "CREDITO", valorCentavos: 2000, bandeira: "VISA" }] })), []);
    confere("Σ pagamentos − troco ≠ total", erroDe(venda({ pagamentos: [{ forma: "PIX", valorCentavos: 1000 }] })), ["pagamentos"]);
    confere("troco sem dinheiro: recusado", erroDe(venda({ pagamentos: [{ forma: "PIX", valorCentavos: 2000 }], trocoCentavos: 220 })), ["trocoCentavos"]);
    confere("troco com duas linhas em dinheiro: recusado", erroDe(venda({ pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }, { forma: "DINHEIRO", valorCentavos: 1000 }], trocoCentavos: 220 })), ["trocoCentavos"]);
    confere("troco com uma linha em dinheiro: aceito", erroDe(venda({ pagamentos: [{ forma: "PIX", valorCentavos: 780 }, { forma: "DINHEIRO", valorCentavos: 2000 }], trocoCentavos: 1000 })), []);
    confere("quantidade × unitário ≠ total do item", erroDe(venda({ itens: [item(1, { totalCentavos: 700 })], totalCentavos: 700, pagamentos: [{ forma: "PIX", valorCentavos: 700 }] })), ["itens[0].totalCentavos"]);
    confere("NCM, CFOP de entrada e forma desconhecida", erroDe(venda({ itens: [item(1, { ncm: "123", cfop: "1102" })], totalCentavos: 780, pagamentos: [{ forma: "BOLETO", valorCentavos: 780 }] })), ["itens[0].ncm", "itens[0].cfop", "pagamentos[0].forma"]);
    confere("OUTRO sem descrição", erroDe(venda({ pagamentos: [{ forma: "OUTRO", valorCentavos: 1780 }] })), ["pagamentos[0].descricao"]);
    confere("CPF inválido", erroDe(venda({ cpf: "123.456.789-00" })), ["cpf"]);
    // As formas viram os códigos certos (tPag) pelo mesmo montarCorpoDaNfce.
    const cfg = normalizarConfigFiscal(db.user.find((x) => x.id === lojaEvo)!.fiscalConfig) as any;
    const tpag = (v: Linha) => {
      const c = conferirVenda(v) as any;
      const m = montarCorpoDaNfce(vendaParaNota("x", c.venda), cfg) as any;
      return m.ok ? [m.corpo.formas_pagamento.map((f: Linha) => [f.forma_pagamento, f.descricao_pagamento ?? f.bandeira_operadora ?? null]), m.corpo.valor_troco ?? 0] : m.mensagem;
    };
    confere("PIX 17, crédito Visa 03 bandeira 01, débito 04, VR 11, VA 10, crediário 99, OUTRO 99 com o nome", tpag(venda({
      totalCentavos: 1780,
      pagamentos: [
        { forma: "PIX", valorCentavos: 100 }, { forma: "CREDITO", valorCentavos: 100, bandeira: "VISA" }, { forma: "DEBITO", valorCentavos: 100 },
        { forma: "VR", valorCentavos: 100 }, { forma: "VA", valorCentavos: 100 }, { forma: "CREDIARIO", valorCentavos: 100 }, { forma: "OUTRO", valorCentavos: 1180, descricao: "Cheque" },
      ],
    })), [[["17", null], ["03", "01"], ["04", null], ["11", null], ["10", null], ["99", "Crediário (a prazo)"], ["99", "Cheque"]], 0]);
    confere("dinheiro com troco: vPag = o entregue, vTroco à parte", tpag(venda({ pagamentos: [{ forma: "DINHEIRO", valorCentavos: 2000 }], trocoCentavos: 220 })), [[["01", null]], 2.2]);
    confere("dividido com troco no dinheiro", tpag(venda({ pagamentos: [{ forma: "PIX", valorCentavos: 780 }, { forma: "DINHEIRO", valorCentavos: 2000 }], trocoCentavos: 1000 })), [[["17", null], ["01", null]], 10]);
    const r = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: venda({ totalCentavos: 1 }) });
    confere("a rota responde 422 com a lista", [r.status, r.json?.error, Array.isArray(r.json?.erros)], [422, "venda_invalida", true]);
  }

  // ── 4. Emitir: 2 POSTs = 1 nota ────────────────────────────────────────
  console.log("\n— 4. Emissão idempotente por vendaId —");
  const V1 = venda({ cpf: "529.982.247-25" });
  {
    const antes = sefaz.pedidos.length;
    const r1 = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V1 });
    confere("autorizada: 200, nº 1 da série 2, homologação", [r1.status, r1.json?.nota?.situacao, r1.json?.nota?.numero, r1.json?.nota?.serie, r1.json?.nota?.ambiente], [200, "autorizada", 1, 2, "homologacao"]);
    const r2 = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V1 });
    confere("o MESMO POST de novo: 200, repetida, a mesma chave", [r2.status, r2.json?.repetida, r2.json?.nota?.chave], [200, true, r1.json.nota.chave]);
    confere("uma autorização só na SEFAZ e uma linha só", [autorizacoes(antes), db.vendaExterna.filter((v) => v.vendaId === V1.vendaId).length], [1, 1]);
    const outro = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: { ...V1, cpf: null } });
    confere("mesmo vendaId com outro conteúdo: 409 venda_diferente", [outro.status, outro.json?.error], [409, "venda_diferente"]);
    confere("não é pedido: nada em CustomerOrder, nenhum cupom na fila de impressão", [db.customerOrder.length, cupons.length], [0, 0]);
    const ve = db.vendaExterna.find((v) => v.vendaId === V1.vendaId)!;
    const nfe = await lerXmlFiscal(objetoDe(ve.fiscalInfo).xmlNoCofre.caminho, objetoDe(ve.fiscalInfo).xmlNoCofre.sha256);
    verdade("o XML diz o verProc do EvoPDV e leva o CPF", nfe.includes("<verProc>EvoPDV NFC-e 1.0</verProc>") && nfe.includes("<CPF>52998224725</CPF>"));
    const g = await chamar(umaNota, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}`, { chave, params: { vendaId: V1.vendaId } });
    confere("GET da nota: autorizada, com os links do DANFE e do XML", [g.status, g.json?.nota?.situacao, g.json?.nota?.danfe, g.json?.nota?.xml], [200, "autorizada", `/api/integracoes/evopdv/notas/${V1.vendaId}/danfe`, `/api/integracoes/evopdv/notas/${V1.vendaId}/xml`]);
    confere("GET de venda que não existe: 404", (await chamar(umaNota, "GET", "/api/integracoes/evopdv/notas/nada", { chave, params: { vendaId: "nada" } })).status, 404);
  }

  // ── 5. DANFE e XML sem FireHub ─────────────────────────────────────────
  console.log("\n— 5. DANFE (80/58 mm, texto) e XML —");
  {
    const h = await chamar(danfe, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/danfe`, { chave, params: { vendaId: V1.vendaId } });
    confere("DANFE em HTML, 80 mm por padrão", [h.status, h.tipo.startsWith("text/html"), h.texto.includes('class="l80"')], [200, true, true]);
    verdade("nenhuma marca nem URL do FireHub no DANFE; a consulta é a da SEFAZ do DF", !/firehub/i.test(h.texto) && h.texto.includes("fazenda.df.gov.br"));
    const h58 = await chamar(danfe, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/danfe?largura=58`, { chave, params: { vendaId: V1.vendaId } });
    verdade("58 mm", h58.texto.includes('class="l58"'));
    const t = await chamar(danfe, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/danfe?formato=texto&largura=58`, { chave, params: { vendaId: V1.vendaId } });
    confere("texto para a bobina: 32 colunas, uma via, com o lugar do QR", [t.status, t.json?.colunas, t.json?.vias?.length, t.json?.vias?.[0]?.linhas?.some((l: Linha) => l.qr === true), Boolean(t.json?.vias?.[0]?.qr?.conteudo)], [200, 32, 1, true, true]);
    verdade("…e sem FireHub no texto", !/firehub/i.test(JSON.stringify(t.json)));
    const x = await chamar(xml, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/xml`, { chave, params: { vendaId: V1.vendaId } });
    confere("XML: o nfeProc autorizado", [x.status, x.tipo.startsWith("application/xml"), x.texto.includes("<nfeProc")], [200, true, true]);
  }

  // ── 6. Concorrência: 1 reserva ─────────────────────────────────────────
  console.log("\n— 6. Dois POSTs da mesma venda ao mesmo tempo —");
  {
    const V = venda();
    const lenta = sefazLenta();
    roteiro = (p) => lenta.roteiro(p) as any;
    const antes = sefaz.pedidos.length;
    const p1 = chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V });
    const p2 = chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V });
    await new Promise((r) => setTimeout(r, 300));
    lenta.soltar();
    const [a, b] = await Promise.all([p1, p2]);
    roteiro = saudavel;
    confere("um autorizou (200) e o outro soube que estava saindo (202)", [a.status, b.status].sort(), [200, 202]);
    confere("uma autorização só, uma linha, um número (o 2)", [autorizacoes(antes), db.vendaExterna.filter((v) => v.vendaId === V.vendaId).length, objetoDe(db.vendaExterna.find((v) => v.vendaId === V.vendaId)!.fiscalInfo).nfceNumber], [1, 1, 2]);
    const depois = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V });
    confere("o POST seguinte devolve a nota", [depois.status, depois.json?.repetida, depois.json?.nota?.numero], [200, true, 2]);
  }

  // ── 7. 539 e 656 ───────────────────────────────────────────────────────
  console.log("\n— 7. 539 (número de outra chave) e 656 (consumo indevido) —");
  {
    const V = venda();
    const antes = sefaz.pedidos.length;
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-539.xml", p, { DUPLICADA: "53260964568087000180650020000000031000000031" }) : saudavel(p));
    const r = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V });
    const i = objetoDe(db.vendaExterna.find((v) => v.vendaId === V.vendaId)!.fiscalInfo);
    confere("539: 422 falhou/rejeitada, o nº 3 queimado e a reserva solta", [r.status, r.json?.nota?.situacao, r.json?.nota?.falha?.cStat, (i.numerosQueimados ?? []).map((q: Linha) => q.numero), i.numeroReservado ?? null], [422, "falhou", "539", [3], null]);
    roteiro = saudavel;
    const de2 = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V });
    confere("o EvoPDV manda de novo: autorizada com o nº 4 (o 3 não volta)", [de2.status, de2.json?.nota?.numero, autorizacoes(antes)], [200, 4, 2]);

    loja.esquecerBloqueiosDaSefaz();
    const B = venda();
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-lote-656.xml", p) : saudavel(p));
    const antes656 = sefaz.pedidos.length;
    const b = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: B });
    const fc = db.user.find((x) => x.id === lojaEvo)!.fiscalConfig;
    confere("656: a venda sai em CONTINGÊNCIA com o mesmo número (o 5), e o bloqueio fica gravado", [b.status, b.json?.nota?.situacao, b.json?.nota?.numero, lerChave(b.json?.nota?.chave).tipoDeEmissao, Boolean(fc.sefaz?.bloqueadoAte)], [200, "contingencia", 5, 9, true]);
    const C = venda();
    const antesC = sefaz.pedidos.length;
    const c = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: C });
    confere("bloqueada: a venda seguinte sai em contingência SEM chamar a SEFAZ", [c.status, c.json?.nota?.situacao, c.json?.nota?.numero, sefaz.pedidos.length - antesC], [200, "contingencia", 6, 0]);
    confere("uma chamada só durante o bloqueio inteiro", autorizacoes(antes656), 1);
    const st = await chamar(status, "GET", "/api/integracoes/evopdv/status", { chave });
    verdade("o status mostra até quando a SEFAZ está bloqueada", Boolean(st.json?.sefazBloqueadaAte));
    const cancelaBloqueada = await chamar(cancelar, "POST", `/api/integracoes/evopdv/notas/${C.vendaId}/cancelar`, { chave, corpo: { justificativa: "Venda lançada errada no caixa" }, params: { vendaId: C.vendaId } });
    confere("cancelar a contingência ainda não transmitida: 409", [cancelaBloqueada.status, cancelaBloqueada.json?.error], [409, "em_contingencia"]);

    // O bloqueio passa: o cron transmite as duas contingências (a tabela VendaExterna também).
    roteiro = saudavel;
    const depois = new Date(Date.now() + 70 * 60_000);
    loja.usarRelogioDeTeste(() => depois);
    loja.esquecerBloqueiosDaSefaz();
    const antesCron = sefaz.pedidos.length;
    await auto.retentarNotasFiscais({ orcamentoMs: 60_000, agora: depois });
    loja.usarRelogioDeTeste(null);
    const sit = (vid: string) => notasLib.notaParaOEvopdv(db.vendaExterna.find((v) => v.vendaId === vid) as any).situacao;
    confere("o cron transmitiu as duas: autorizadas", [sit(B.vendaId), sit(C.vendaId), autorizacoes(antesCron)], ["autorizada", "autorizada", 2]);
    // A hora do bloqueio passou de verdade (o relógio de volta ao normal): a marca gravada sai.
    delete db.user.find((x) => x.id === lojaEvo)!.fiscalConfig.sefaz.bloqueadoAte;
  }

  // ── 8. Contingência por timeout e a venda feita sem internet ───────────
  console.log("\n— 8. Contingência (SEFAZ sem resposta) e a fila sem internet do EvoPDV —");
  {
    const V = venda();
    let jaFoi = false;
    roteiro = (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote" && !jaFoi) {
        jaFoi = true;
        return "timeout-depois";
      }
      return saudavel(p);
    };
    const r = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V });
    const i = objetoDe(db.vendaExterna.find((v) => v.vendaId === V.vendaId)!.fiscalInfo);
    confere("sem resposta: contingência com OUTRO número (o tentado 7 vai ser conferido)", [r.status, r.json?.nota?.situacao, i.numeroTentado?.numero, i.numeroTentado?.situacao, r.json?.nota?.numero], [200, "contingencia", 7, "a_conferir", 8]);
    verdade("o prazo de transmissão vai na resposta", Number.isFinite(Date.parse(r.json?.nota?.contingenciaPrazo)));
    const d = await chamar(danfe, "GET", `/api/integracoes/evopdv/notas/${V.vendaId}/danfe?formato=texto`, { chave, params: { vendaId: V.vendaId } });
    confere("DANFE da contingência: as DUAS vias", d.json?.vias?.map((v: Linha) => v.via), ["consumidor", "estabelecimento"]);

    // A venda feita sem internet há 2 horas (a fila do EvoPDV).
    const vendaEm = new Date(Date.now() - 2 * 60 * 60_000);
    vendaEm.setUTCMilliseconds(0);
    const F = venda({ dataEmissao: vendaEm.toISOString() });
    const antesF = sefaz.pedidos.length;
    const f = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: F });
    const iF = objetoDe(db.vendaExterna.find((v) => v.vendaId === F.vendaId)!.fiscalInfo);
    const xmlF = await lerXmlFiscal(iF.xmlDaContingencia.caminho, iF.xmlDaContingencia.sha256);
    const dhEmi = /<dhEmi>([^<]+)<\/dhEmi>/.exec(xmlF)?.[1] ?? "";
    const dhCont = /<dhCont>([^<]+)<\/dhCont>/.exec(xmlF)?.[1] ?? "";
    confere("venda de 2 h atrás: contingência direta, sem chamar a SEFAZ", [f.status, f.json?.nota?.situacao, sefaz.pedidos.length - antesF], [200, "contingencia", 0]);
    confere("dhEmi = dhCont = a hora da VENDA, tpEmis 9, com a justificativa", [Date.parse(dhEmi) === vendaEm.getTime(), Date.parse(dhCont) === vendaEm.getTime(), xmlF.includes("<tpEmis>9</tpEmis>"), /<xJust>Sem conexao com a internet no ponto de venda/.test(xmlF)], [true, true, true, true]);
    const velha = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: venda({ dataEmissao: new Date(Date.now() - 6 * 24 * 60 * 60_000).toISOString() }) });
    confere("venda de 6 dias atrás: 422 fora do prazo da contingência (nada reservado)", [velha.status, velha.json?.error], [422, "fora_do_prazo"]);
    const recente = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: venda({ dataEmissao: new Date(Date.now() - 2 * 60_000).toISOString() }) });
    confere("venda de 2 min atrás: nota normal (dentro dos 5 min da SEFAZ)", [recente.status, recente.json?.nota?.situacao], [200, "autorizada"]);

    // O cron: transmite a contingência e confere o tentado (217 → inutiliza), na VendaExterna.
    roteiro = (p) => (metodoDo(p) === "nfeConsultaNF" ? responder("consulta-217.xml", p) : saudavel(p));
    const mais = new Date(Date.now() + 11 * 60_000);
    loja.usarRelogioDeTeste(() => mais);
    await auto.retentarNotasFiscais({ orcamentoMs: 60_000, agora: mais });
    loja.usarRelogioDeTeste(null);
    roteiro = saudavel;
    const iV = objetoDe(db.vendaExterna.find((v) => v.vendaId === V.vendaId)!.fiscalInfo);
    confere("o cron efetivou as contingências e INUTILIZOU o tentado 7 (gravado na venda)", [
      notasLib.notaParaOEvopdv(db.vendaExterna.find((v) => v.vendaId === V.vendaId) as any).situacao,
      notasLib.notaParaOEvopdv(db.vendaExterna.find((v) => v.vendaId === F.vendaId) as any).situacao,
      iV.numeroTentado?.situacao,
    ], ["autorizada", "autorizada", "inutilizado"]);
  }

  // ── 9. Cancelar e reemitir como -2 ─────────────────────────────────────
  console.log("\n— 9. Cancelar e reemitir —");
  {
    const curta = await chamar(cancelar, "POST", `/api/integracoes/evopdv/notas/${V1.vendaId}/cancelar`, { chave, corpo: { justificativa: "curta" }, params: { vendaId: V1.vendaId } });
    confere("justificativa curta: 422", curta.status, 422);
    const antes = sefaz.pedidos.length;
    const c = await chamar(cancelar, "POST", `/api/integracoes/evopdv/notas/${V1.vendaId}/cancelar`, { chave, corpo: { justificativa: "Cliente desistiu da compra no caixa" }, params: { vendaId: V1.vendaId } });
    const iC = objetoDe(db.vendaExterna.find((v) => v.vendaId === V1.vendaId)!.fiscalInfo);
    confere("cancelada na SEFAZ (110111), com o evento no cofre", [c.status, c.json?.nota?.situacao, metodos(antes), Boolean(iC.xmlCancelamentoNoCofre?.caminho)], [200, "cancelada", ["nfeRecepcaoEvento"], true]);
    const xc = await chamar(xml, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/xml?evento=cancelamento`, { chave, params: { vendaId: V1.vendaId } });
    confere("XML do cancelamento", [xc.status, xc.texto.includes("procEventoNFe") || xc.texto.includes("retEvento")], [200, true]);
    const d = await chamar(danfe, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/danfe`, { chave, params: { vendaId: V1.vendaId } });
    confere("DANFE da cancelada: 410 (o cupom não vale mais)", d.status, 410);
    const sem = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: V1 });
    confere("o POST da venda cancelada sem `reemitir`: 409 (a fila não reemite sozinha)", [sem.status, sem.json?.error], [409, "nota_cancelada"]);
    const chaveVelha = iC.nfceKey;
    const re = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: { ...V1, reemitir: true } });
    const iR = objetoDe(db.vendaExterna.find((v) => v.vendaId === V1.vendaId)!.fiscalInfo);
    const veId = db.vendaExterna.find((v) => v.vendaId === V1.vendaId)!.id;
    confere("reemitida: autorizada, número novo, ref <id>-2, a cancelada em notasAnteriores", [
      re.status, re.json?.nota?.situacao, re.json?.nota?.chave !== chaveVelha, iR.idDaNota, re.json?.nota?.notasAnteriores?.map((n: Linha) => n.chave),
    ], [200, "autorizada", true, `${veId}-2`, [chaveVelha]]);
    const re2 = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: { ...V1, reemitir: true } });
    confere("reemitir de novo com a nota viva: devolve a mesma (idempotente)", [re2.status, re2.json?.repetida, re2.json?.nota?.chave], [200, true, re.json.nota.chave]);
    // Produção: 30 minutos.
    const P = db.vendaExterna.find((v) => v.vendaId === V1.vendaId)!;
    const guardado = clone(P.fiscalInfo);
    P.fiscalInfo = { ...objetoDe(P.fiscalInfo), ambiente: 1, emittedAt: new Date(Date.now() - 31 * 60_000).toISOString() };
    const tarde = await chamar(cancelar, "POST", `/api/integracoes/evopdv/notas/${V1.vendaId}/cancelar`, { chave, corpo: { justificativa: "Cliente desistiu da compra no caixa" }, params: { vendaId: V1.vendaId } });
    confere("produção depois de 30 min: 409 prazo_encerrado, sem ir à SEFAZ", [tarde.status, tarde.json?.error], [409, "prazo_encerrado"]);
    P.fiscalInfo = guardado;
  }

  // ── 10. Pedido do FireHub e venda do EvoPDV na MESMA série ─────────────
  console.log("\n— 10. Pedido e venda intercalados na mesma série —");
  {
    let seq = 0;
    const produto = { id: "esf", name: "Esfiha de carne", ncm: "21069090", cfop: "5102", csosn: "102", origem: "0" };
    const pedido = (): Linha => {
      const n = ++seq;
      const o: Linha = {
        id: `p${n}`, franchiseeId: NIK, dailyOrderNumber: n, status: "ENTREGUE", deliveryType: "RETIRADA", tableSessionId: null,
        paymentMethod: "Pix", paymentMethods: null, gatewayPaymentId: null, totalAmount: 15.6, customerCpfCnpj: null, customerName: "Cliente",
        customerAddress: null, source: "BALCAO", fiscalStatus: "PENDING", fiscalInfo: null, createdAt: new Date(Date.now() - 180 * 60_000),
        items: [{ id: `i${n}`, productName: "Esfiha de carne", quantity: 4, price: 3.9, menuProduct: produto }],
      };
      o.updatedAt = o.createdAt;
      db.customerOrder.push(o);
      return o;
    };
    // A loja do FireHub emitindo pelo painel E vendas de fora (o caminho é o mesmo; a tabela é outra).
    const contaDaNik = { integracaoId: "nenhuma", lojaId: NIK, cnpj: "64568087000180", email: null, assinatura: null, config: normalizarConfigFiscal(db.user.find((u) => u.id === NIK)!.fiscalConfig) as any };
    const A = pedido();
    await auto.emitirNfceAutomatica(A.id);
    const v1 = await notasLib.emitirNotaDaVenda(contaDaNik, venda());
    const B = pedido();
    await auto.emitirNfceAutomatica(B.id);
    const v2 = await notasLib.emitirNotaDaVenda(contaDaNik, venda());
    // E ao mesmo tempo: um pedido e uma venda disputando a trava da série.
    const C = pedido();
    const [, v3] = await Promise.all([auto.emitirNfceAutomatica(C.id), notasLib.emitirNotaDaVenda(contaDaNik, venda())]);
    const nPedido = (id: string) => objetoDe(db.customerOrder.find((o) => o.id === id)!.fiscalInfo).nfceNumber;
    const todos = [nPedido(A.id), (v1.corpo as any).nota.numero, nPedido(B.id), (v2.corpo as any).nota.numero, nPedido(C.id), (v3.corpo as any).nota.numero];
    confere("série 7 da NIK: 1 (pedido), 2 (venda), 3 (pedido), 4 (venda) e 5/6 juntos — nenhum repetido", [todos.slice(0, 4), [...todos.slice(4)].sort(), new Set(todos).size], [[1, 2, 3, 4], [5, 6], 6]);
    confere("a venda não imprimiu cupom; os pedidos, sim", [cupons.filter((x) => x.startsWith("ve")).length, cupons.filter((x) => x.startsWith("p")).length], [0, 3]);
    // Sem a marca de maior número (lib/nfce/numeracao → sqlMarcarMaiorNumero), quem
    // segura a sequência é a leitura das DUAS tabelas: a venda nº 7 tem de contar.
    const v7 = await notasLib.emitirNotaDaVenda(contaDaNik, venda());
    delete db.user.find((u) => u.id === NIK)!.fiscalConfig.sefaz.maiorNumero;
    const D = pedido();
    await auto.emitirNfceAutomatica(D.id);
    confere("sem a marca: a venda nº 7 é a última, e o pedido seguinte sai com o 8 (não repete o 7)", [(v7.corpo as any).nota.numero, nPedido(D.id)], [7, 8]);
  }

  // ── 11. Inutilização mensal: número de venda de fora não é buraco ──────
  console.log("\n— 11. Inutilização mensal com pedidos e vendas de fora —");
  {
    const LOJA_P = "loja-producao";
    db.user.push({ id: LOJA_P, role: "FRANCHISEE", fiscalConfig: configDaNik({ ambiente: 1 }) });
    const setembro = (dia: number) => new Date(Date.UTC(2026, 8, dia, 15)).toISOString();
    const antigo = new Date("2026-08-15T15:00:00.000Z");
    const nota = (n: number, dia: number) => ({ nfceKey: `K${n}`, nfceNumber: n, serie: 7, ambiente: 1, emittedAt: setembro(dia), provedor: "sefaz" });
    db.customerOrder.push({ id: "pp1", franchiseeId: LOJA_P, createdAt: antigo, updatedAt: antigo, fiscalStatus: "EMITTED", fiscalInfo: nota(1, 2) });
    db.vendaExterna.push({ id: "vp2", franchiseeId: LOJA_P, origem: "evopdv", vendaId: "s2", createdAt: antigo, updatedAt: antigo, fiscalStatus: "EMITTED", fiscalInfo: nota(2, 3) });
    db.vendaExterna.push({ id: "vp3", franchiseeId: LOJA_P, origem: "evopdv", vendaId: "s3", createdAt: antigo, updatedAt: antigo, fiscalStatus: "FAILED", fiscalInfo: { motivo: "rejeitada", provedor: "sefaz", ambiente: 1, numeroReservado: { serie: 7, numero: 3, ambiente: 1, em: setembro(10) } } });
    // nº 4: nenhum registro.
    db.vendaExterna.push({ id: "vp5", franchiseeId: LOJA_P, origem: "evopdv", vendaId: "s5", createdAt: antigo, updatedAt: antigo, fiscalStatus: "EMITTED", fiscalInfo: { ...nota(5, 20), contingencia: true } });
    db.customerOrder.push({ id: "pp6", franchiseeId: LOJA_P, createdAt: antigo, updatedAt: antigo, fiscalStatus: "EMITTED", fiscalInfo: nota(6, 25) });
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    const r = await inutilizarBuracosDoMes({ lojaId: LOJA_P, config: normalizarConfigFiscal(db.user.find((u) => u.id === LOJA_P)!.fiscalConfig) as any, agora: new Date("2026-10-02T13:00:00.000Z") });
    confere("inutiliza só 3 (reserva vencida da venda) e 4 (sem registro): o 2 e o 5 (contingência) são de vendas de fora", r.faixas.map((f) => [f.numeroInicial, f.numeroFinal]), [[3, 4]]);
    const pedidoInut = sefaz.pedidos.slice(antes).find((p) => metodoDo(p) === "nfeInutilizacaoNF");
    verdade("o pedido à SEFAZ foi a faixa 3–4", Boolean(pedidoInut?.corpo.includes("<nNFIni>3</nNFIni>") && pedidoInut?.corpo.includes("<nNFFin>4</nNFFin>")));
    confere("a reserva vencida foi solta NA VENDA (VendaExterna)", [objetoDe(db.vendaExterna.find((v) => v.id === "vp3")!.fiscalInfo).numeroReservado ?? null, objetoDe(db.vendaExterna.find((v) => v.id === "vp3")!.fiscalInfo).reservaLiberada?.numero, r.reservasSoltas], [null, 3, 1]);
  }

  // ── 12. Assinatura fiscal (fase 5, só servidor) ────────────────────────
  console.log("\n— 12. Assinatura fiscal: 402, cache de 1 h e folga de 72 h —");
  {
    const agora = new Date("2026-10-26T12:00:00.000Z");
    const h = (n: number) => new Date(agora.getTime() + n * 60 * 60_000);
    const env = { EVOPDV_FISCAL_STATUS_URL: "https://evopdv.test/api/fiscal-status", EVOPDV_FISCAL_STATUS_SEGREDO: "s" };
    perguntasAVercel.length = 0;
    vercel = { ativo: true };
    const a = await assinatura.situacaoDaAssinatura("x@y.com", null, agora, env);
    confere("ativa na Vercel: ativa, grava o cache", [a.ativa, a.fonte, Boolean(a.gravar?.conferidaEm), perguntasAVercel.length], [true, "vercel", true, 1]);
    verdade("pergunta com o e-mail da licença", perguntasAVercel[0] === "https://evopdv.test/api/fiscal-status?email=x%40y.com");
    const b = await assinatura.situacaoDaAssinatura("x@y.com", a.gravar, h(0.5), env);
    confere("dentro de 1 h: cache, sem perguntar", [b.ativa, b.fonte, perguntasAVercel.length], [true, "cache", 1]);
    vercel = "fora";
    const c = await assinatura.situacaoDaAssinatura("x@y.com", a.gravar, h(2), env);
    confere("Vercel fora 2 h depois: vale a folga (ativa)", [c.ativa, c.fonte], [true, "folga"]);
    const d = await assinatura.situacaoDaAssinatura("x@y.com", c.gravar, h(73), env);
    confere("Vercel fora 73 h depois da última confirmação: inativa", [d.ativa, d.fonte], [false, "sem_resposta"]);
    vercel = { ativo: false };
    const e = await assinatura.situacaoDaAssinatura("x@y.com", a.gravar, h(2), env);
    confere("a Vercel diz inativa: inativa na hora (folga é só para a Vercel fora)", [e.ativa, e.fonte], [false, "vercel"]);
    confere("sem EVOPDV_FISCAL_STATUS_URL: conferência desligada (ativa)", (await assinatura.situacaoDaAssinatura("x@y.com", null, agora, {})).fonte, "desligada");

    // Pelas rotas: o fiscal inativo bloqueia só nota NOVA.
    Object.assign(process.env, env);
    const integ = tabelas.integracaoEvopdv.find((x) => x.franchiseeId === lojaEvo)!;
    integ.assinatura = null;
    vercel = { ativo: false };
    const nova = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: venda() });
    confere("fiscal inativo: POST de venda nova = 402", [nova.status, nova.json?.error], [402, "assinatura_inativa"]);
    const repetida = await chamar(notas, "POST", "/api/integracoes/evopdv/notas", { chave, corpo: { ...V1, reemitir: true } });
    confere("…mas a nota que já existe volta (200)", [repetida.status, repetida.json?.repetida], [200, true]);
    confere("consultar: 200", (await chamar(umaNota, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}`, { chave, params: { vendaId: V1.vendaId } })).status, 200);
    confere("DANFE: 200", (await chamar(danfe, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/danfe`, { chave, params: { vendaId: V1.vendaId } })).status, 200);
    confere("XML: 200", (await chamar(xml, "GET", `/api/integracoes/evopdv/notas/${V1.vendaId}/xml`, { chave, params: { vendaId: V1.vendaId } })).status, 200);
    const lista = await chamar(notas, "GET", "/api/integracoes/evopdv/notas?limite=3", { chave });
    confere("listar: 200, a mais recente primeiro, com paginação", [lista.status, lista.json?.notas?.length, Boolean(lista.json?.proxima)], [200, 3, true]);
    const canc = await chamar(cancelar, "POST", `/api/integracoes/evopdv/notas/${V1.vendaId}/cancelar`, { chave, corpo: { justificativa: "Cliente desistiu da compra no caixa" }, params: { vendaId: V1.vendaId } });
    confere("cancelar com o fiscal inativo: 200", [canc.status, canc.json?.nota?.situacao], [200, "cancelada"]);
    const st = await chamar(status, "GET", "/api/integracoes/evopdv/status", { chave });
    confere("o status diz que a assinatura está inativa", st.json?.assinatura, { ativa: false, fonte: "cache" });
    for (const k of Object.keys(env)) delete process.env[k];
  }

  // ── 13. Config: série travada depois da primeira nota; ambiente com nota em andamento ──
  console.log("\n— 13. Config pela API —");
  {
    const s = await chamar(config, "PUT", "/api/integracoes/evopdv/config", { chave, corpo: { serie: 9 } });
    confere("trocar a série depois de emitir: 409", s.status, 409);
    const p = await chamar(config, "PUT", "/api/integracoes/evopdv/config", { chave, corpo: { ambiente: "producao" } });
    confere("passar para produção sem nota em andamento: 200", [p.status, db.user.find((x) => x.id === lojaEvo)!.fiscalConfig.ambiente], [200, 1]);
    const lixo = await chamar(config, "PUT", "/api/integracoes/evopdv/config", { chave, corpo: { uf: "Distrito Federal" } });
    confere("UF torta: 422", lixo.status, 422);
  }

  rmSync(COFRE, { recursive: true, force: true });
  terminar();
}

main().catch((e) => {
  console.error("❌ exceção:", e);
  rmSync(COFRE, { recursive: true, force: true });
  process.exit(1);
});
