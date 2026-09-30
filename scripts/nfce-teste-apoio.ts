/**
 * Apoio dos testes do emissor próprio de NFC-e (scripts/teste-nfce-*.ts):
 * contagem de falhas, a loja de teste (NIK, Brasília-DF), o certificado de
 * TESTE, a validação contra o XSD oficial (lxml, via scripts/nfce-validar-xsd.py)
 * e uma SEFAZ FALSA que responde com as fixtures de scripts/fixtures/nfce-sefaz,
 * e o BANCO FALSO dos testes de integração (`bancoFalso`).
 *
 * Nada aqui fala com a SEFAZ de verdade, nem com o banco.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import type { ConfiguracaoFiscal } from "../src/lib/fiscal-emissao";
import { carregarCertificado, digestValueDoXml } from "../src/lib/nfce/assinatura";
import type { PedidoHttp, RespostaHttp, Transporte } from "../src/lib/nfce/sefaz";
import { FalhaDeTransporte } from "../src/lib/nfce/sefaz";
import { lerXml, primeiro } from "../src/lib/nfce/xml";

let falhas = 0;
export const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
export const verdade = (oQue: string, cond: boolean, detalhe = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "✅" : "❌"} ${oQue}${cond ? "" : ` — ${detalhe}`}`);
};
export function terminar(): never {
  console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

export const RAIZ = join(__dirname, "..");
export const FIXTURES = join(__dirname, "fixtures");
export const XSD = join(FIXTURES, "nfce-xsd");
export const SENHA_DO_CERTIFICADO = "firehub-teste";
export const CPF = "52998224725";

/** O cadastro fiscal da NIK (dados públicos do CNPJ; IE e endereço de TESTE). */
export const CONFIG_NIK: ConfiguracaoFiscal = {
  provedor: "focusnfe",
  tokenDoProvedor: "token-de-teste",
  cnpj: "64.568.087/0001-80",
  inscricaoEstadual: "07.123.456/001-23",
  razaoSocial: "NIK COMERCIO DE ALIMENTOS LTDA",
  nomeFantasia: "Nik Esfiharia",
  regimeTributario: 1,
  logradouro: "QS 1 Rua 210",
  numero: "Lote 40",
  bairro: "Taguatinga Sul",
  municipio: "Brasília",
  codigoMunicipio: "5300108",
  uf: "DF",
  cep: "71950-770",
  serie: 1,
  ambiente: 2,
  cscId: "000001",
  csc: "0123456789ABCDEF0123456789ABCDEF",
  temCertificado: true,
};

export const certificadoDeTeste = (arquivo = "nfce-certificado-teste.pfx") =>
  carregarCertificado(readFileSync(join(FIXTURES, arquivo)), SENHA_DO_CERTIFICADO);

// ─── XSD ─────────────────────────────────────────────────────────────────────

export type Validacao = { ok: boolean; erros: string[]; digest?: string };

/**
 * Valida vários XML de uma vez (um processo Python só). `xsd` é o nome do
 * arquivo em scripts/fixtures/nfce-xsd (ou "evento/...").
 */
export function validarNoXsd(lote: Array<{ xsd: string; xml: string; digest?: string }>): Validacao[] {
  const pasta = join(tmpdir(), `nfce-xsd-${process.pid}-${Date.now()}`);
  mkdirSync(pasta, { recursive: true });
  try {
    const pedidos = lote.map((p, i) => {
      const arquivo = join(pasta, `${i}.xml`);
      writeFileSync(arquivo, p.xml, "utf8");
      return { xsd: join(XSD, p.xsd), xml: arquivo, ...(p.digest ? { digest: p.digest } : {}) };
    });
    const loteJson = join(pasta, "lote.json");
    writeFileSync(loteJson, JSON.stringify(pedidos), "utf8");
    const python = process.env.PYTHON || (process.platform === "win32" ? "py" : "python3");
    const saida = execFileSync(python, [join(__dirname, "nfce-validar-xsd.py"), loteJson], { encoding: "utf8" });
    return JSON.parse(saida);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

// ─── SEFAZ falsa ─────────────────────────────────────────────────────────────

export const fixture = (nome: string) => readFileSync(join(FIXTURES, "nfce-sefaz", nome), "utf8");

/** Tira a mensagem de dentro do envelope que o emissor mandou. */
export function mensagemDoEnvelope(corpo: string): Element {
  const dados = primeiro(lerXml(corpo), "nfeDadosMsg");
  if (!dados) throw new Error("envelope sem nfeDadosMsg");
  for (let c = dados.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) return c as Element;
  throw new Error("nfeDadosMsg vazio");
}

type RespostaDoRoteiro = RespostaHttp | "timeout-antes" | "timeout-depois";
export type Roteiro = (pedido: PedidoHttp, n: number) => RespostaDoRoteiro | Promise<RespostaDoRoteiro>;

/**
 * Uma SEFAZ que responde com fixture, preenchendo {{CHAVE}}, {{DIGVAL}} etc.
 * com o que veio no pedido. Guarda os pedidos para o teste olhar.
 */
export function sefazFalsa(roteiro: Roteiro) {
  const pedidos: PedidoHttp[] = [];
  const transporte: Transporte = async (pedido) => {
    pedidos.push(pedido);
    const r = await roteiro(pedido, pedidos.length);
    if (r === "timeout-antes") throw new FalhaDeTransporte("Falha de conexão com a SEFAZ: connect ECONNREFUSED", false, "ECONNREFUSED");
    if (r === "timeout-depois") throw new FalhaDeTransporte("A SEFAZ não respondeu em 20 s.", true, "ETIMEDOUT");
    return r;
  };
  return { transporte, pedidos };
}

/** Preenche uma fixture a partir do pedido recebido. */
export function responder(nomeDaFixture: string, pedido: PedidoHttp, extra: Record<string, string> = {}): RespostaHttp {
  const msg = mensagemDoEnvelope(pedido.corpo);
  const texto = (nome: string) => primeiro(msg, nome)?.textContent ?? "";
  let chave = texto("chNFe");
  let digVal = "";
  const infNFe = primeiro(msg, "infNFe");
  if (infNFe) {
    chave = (infNFe.getAttribute("Id") ?? "").replace(/^NFe/, "");
    digVal = digestValueDoXml(pedido.corpo);
  }
  const valores: Record<string, string> = {
    CHAVE: chave,
    DIGVAL: digVal,
    DHRECBTO: "2026-09-29T12:00:05-03:00",
    IDLOTE: texto("idLote"),
    NINI: texto("nNFIni"),
    NFIM: texto("nNFFin"),
    ...extra,
  };
  const corpo = fixture(nomeDaFixture).replace(/\{\{(\w+)\}\}/g, (_, k) => valores[k] ?? "");
  return { status: 200, corpo };
}

/** O método SOAP pedido (pelo action do Content-Type). */
export const metodoDo = (pedido: PedidoHttp) => /action="[^"]*\/(\w+)"/.exec(pedido.cabecalhos["Content-Type"] ?? "")?.[1] ?? "";

// ─── Banco falso (Prisma em memória) ─────────────────────────────────────────

export type Linha = Record<string, any>;

/**
 * O BANCO FALSO dos testes de integração do emissor próprio: o
 * `globalThis.prisma` que lib/prisma usa, em memória, com a transação
 * interativa, a trava pg_advisory_xact_lock simulada e o SQL cru interpretado
 * pelo marcador ("fh:..." no comentário do SQL) — os valores vêm na ordem em
 * que o Prisma.sql os junta. A leitura dos números é a MESMA de referência
 * (lib/nfce/numeracao → numerosDoFiscalInfo); o SQL em si é conferido contra
 * um Postgres de verdade, só lendo, por scripts/nfce-conferir-sql-da-numeracao.ts.
 *
 * Tem de ser criado ANTES de qualquer import que chegue a lib/prisma (ele lê
 * `globalThis.prisma` ao carregar): os testes importam o código com
 * `await import(...)` depois de `bancoFalso()`.
 */
export function bancoFalso() {
  const db: { user: Linha[]; customerOrder: Linha[]; tableSession: Linha[] } = { user: [], customerOrder: [], tableSession: [] };
  const estado = {
    travaLigada: true,
    esperasNaTrava: 0,
    /** Roda logo depois de um "marcar em emissão" (a reserva ou o envio) — para fotografar o banco. */
    depoisDeMarcar: null as ((ids: string[], dados: Linha) => void | Promise<void>) | null,
    sqlVistos: [] as string[],
    /** Leituras e escritas por modelo ("customerOrder.findMany"...): o custo de um caminho. */
    chamadas: [] as string[],
  };
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const ehAnyNull = (v: unknown) => v === Prisma.AnyNull || v === Prisma.DbNull || v === Prisma.JsonNull;
  const objetoDe = (v: unknown): Linha => (v && typeof v === "object" && !Array.isArray(v) ? (v as Linha) : {});

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
      else if (op === "gte") { if (!(valor instanceof Date) || valor.getTime() < (alvo as Date).getTime()) return false; }
      else if (op === "lte") { if (!(valor instanceof Date) || valor.getTime() > (alvo as Date).getTime()) return false; }
      else if (op === "lt") { if (!(valor instanceof Date) || valor.getTime() >= (alvo as Date).getTime()) return false; }
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
      else if (k === "franchisee") {
        // A relação do pedido com a loja (`franchisee: { is: {...} }`).
        const loja = db.user.find((u) => u.id === linha.franchiseeId);
        const filtro = (v as any)?.is ?? v;
        if (!loja || !casa(loja, filtro)) return false;
      }
      else if (!casaCampo(linha[k], v)) return false;
    }
    return true;
  }
  function ordenar<T extends Linha>(linhas: T[], orderBy: any): T[] {
    if (!orderBy) return linhas;
    const [[campo, dir]] = Object.entries(orderBy) as [string, string][];
    return [...linhas].sort((a, b) => (a[campo].getTime() - b[campo].getTime()) * (dir === "desc" ? -1 : 1));
  }
  const copia = <T>(v: T): T => (v == null ? v : structuredClone(v));
  function projetar(linha: Linha, args: any, modelo: keyof typeof db): Linha {
    const saida: Linha = { ...linha };
    if (modelo === "tableSession" && args?.select?.orders) {
      estado.chamadas.push("tableSession.orders");
      saida.orders = ordenar(db.customerOrder.filter((o) => o.tableSessionId === linha.id), args.select.orders.orderBy).map((o) => ({ ...o, fiscalInfo: copia(o.fiscalInfo) }));
    }
    if (modelo === "customerOrder") saida.fiscalInfo = copia(linha.fiscalInfo);
    if (modelo === "user") saida.fiscalConfig = copia(linha.fiscalConfig);
    return saida;
  }
  const delegado = (modelo: keyof typeof db) => ({
    findUnique: async (args: any) => {
      estado.chamadas.push(`${modelo}.findUnique`);
      const l = db[modelo].find((x) => casa(x, args.where));
      return l ? projetar(l, args, modelo) : null;
    },
    findFirst: async (args: any) => {
      estado.chamadas.push(`${modelo}.findFirst`);
      const l = db[modelo].find((x) => casa(x, args.where));
      return l ? projetar(l, args, modelo) : null;
    },
    findMany: async (args: any = {}) => {
      estado.chamadas.push(`${modelo}.findMany`);
      const achados = ordenar(db[modelo].filter((x) => casa(x, args.where)), args.orderBy);
      return achados.slice(0, args.take ?? achados.length).map((l) => projetar(l, args, modelo));
    },
    updateMany: async (args: any) => {
      estado.chamadas.push(`${modelo}.updateMany`);
      const alvos = db[modelo].filter((x) => casa(x, args.where));
      for (const a of alvos) Object.assign(a, copia(args.data), modelo === "customerOrder" ? { updatedAt: new Date() } : {});
      return { count: alvos.length };
    },
    update: async (args: any) => {
      estado.chamadas.push(`${modelo}.update`);
      const a = db[modelo].find((x) => casa(x, args.where));
      if (!a) throw new Error(`update: ${modelo} não encontrado`);
      Object.assign(a, copia(args.data), modelo === "customerOrder" ? { updatedAt: new Date() } : {});
      return projetar(a, {}, modelo);
    },
  });

  // ── SQL cru: a trava e as gravações de JSON ──
  let numerosDoFiscalInfo: ((p: { id: string; fiscalStatus?: string | null; fiscalInfo?: unknown }) => Array<Record<string, any>>) | null = null;
  const numeros = async () => {
    if (!numerosDoFiscalInfo) numerosDoFiscalInfo = (await import("../src/lib/nfce/numeracao")).numerosDoFiscalInfo as any;
    return numerosDoFiscalInfo!;
  };
  // A pausa é o que deixa duas transações se intercalarem: sem a trava, as
  // duas leem o mesmo "maior".
  const pausa = () => new Promise((r) => setTimeout(r, 3));
  const travas = new Map<string, Promise<void>>();
  async function travar(chave: string): Promise<() => void> {
    if (!estado.travaLigada) return () => {};
    while (travas.has(chave)) {
      estado.esperasNaTrava++;
      await travas.get(chave);
    }
    let soltar!: () => void;
    travas.set(chave, new Promise<void>((r) => (soltar = r)));
    return () => {
      travas.delete(chave);
      soltar();
    };
  }
  const marcador = (sql: any) => /fh:([a-z-]+)/.exec(String(sql?.sql ?? ""))?.[1] ?? "";
  const comoNumero = (v: unknown) => (typeof v === "number" ? v : /^[0-9]{1,9}$/.test(String(v ?? "")) ? Number(v) : 0);

  async function executar(sql: any, soltas: Array<() => void>): Promise<number> {
    const v = sql.values as any[];
    const m = marcador(sql);
    estado.sqlVistos.push(m);
    if (m === "trava") {
      soltas.push(await travar(String(v[0])));
      return 1;
    }
    await pausa();
    if (m === "mesclar-fiscal-info") {
      const [remover, dados, ids] = v as [string[], string, string[]];
      let n = 0;
      for (const o of db.customerOrder.filter((x) => ids.includes(x.id))) {
        const base = { ...objetoDe(o.fiscalInfo) };
        for (const k of remover) delete base[k];
        o.fiscalInfo = { ...base, ...JSON.parse(dados) };
        o.updatedAt = new Date();
        n++;
      }
      return n;
    }
    if (m === "marcar-em-emissao") {
      const [dados, ids] = v as [string, string[]];
      const alvos = db.customerOrder.filter((x) => ids.includes(x.id));
      if (alvos.some((o) => o.fiscalStatus === "EMITTED")) return 0;
      for (const o of alvos) {
        o.fiscalStatus = "PENDING";
        o.fiscalInfo = { ...objetoDe(o.fiscalInfo), ...JSON.parse(dados) };
        o.updatedAt = new Date();
      }
      await estado.depoisDeMarcar?.(ids, JSON.parse(dados));
      return alvos.length;
    }
    if (m === "liberar-reserva") {
      const [registro, pedido, numero, serie, ambiente, em] = v;
      const o = db.customerOrder.find((x) => x.id === pedido);
      const r = objetoDe(objetoDe(o?.fiscalInfo).numeroReservado);
      const mesmaData = v.length >= 6 ? r.em != null && String(r.em) === String(em) : r.em == null;
      if (!o || String(r.numero) !== numero || String(r.serie) !== serie || String(r.ambiente) !== ambiente || !mesmaData) return 0;
      const base = { ...objetoDe(o.fiscalInfo) };
      delete base.numeroReservado;
      o.fiscalInfo = { ...base, ...JSON.parse(registro) };
      o.updatedAt = new Date();
      return 1;
    }
    if (m === "anexar-inutilizacao" || m === "mesclar-sefaz") {
      const [dados, lojaId] = v as [string, string];
      const u = db.user.find((x) => x.id === lojaId);
      if (!u) return 0;
      const c = objetoDe(u.fiscalConfig);
      const s = objetoDe(c.sefaz);
      u.fiscalConfig =
        m === "anexar-inutilizacao"
          ? { ...c, inutilizacoes: [...(Array.isArray(c.inutilizacoes) ? c.inutilizacoes : []), ...JSON.parse(dados)] }
          : { ...c, sefaz: { ...s, ...JSON.parse(dados) } };
      return 1;
    }
    if (m === "marcar-maior-numero") {
      // GREATEST no bloco sefaz.maiorNumero[ambiente][série].
      const [a, s, n, lojaId] = v as [string, string, number, string];
      const u = db.user.find((x) => x.id === lojaId);
      if (!u) return 0;
      const c = objetoDe(u.fiscalConfig);
      const bloco = objetoDe(c.sefaz);
      const maior = objetoDe(bloco.maiorNumero);
      const doAmbiente = objetoDe(maior[a]);
      u.fiscalConfig = { ...c, sefaz: { ...bloco, maiorNumero: { ...maior, [a]: { ...doAmbiente, [s]: Math.max(Number(n), comoNumero(doAmbiente[s])) } } } };
      return 1;
    }
    if (m === "pegar-concessao-da-rodada") {
      // Compare-and-set: só pega a vaga livre, vencida ou já sua.
      const [dados, lojaId, agoraMs, dono] = v as [string, string, number, string];
      const u = db.user.find((x) => x.id === lojaId);
      if (!u) return 0;
      const c = objetoDe(u.fiscalConfig);
      const atual = objetoDe(c.rodadaFiscal);
      const livre = !(Number(atual.ate) >= Number(agoraMs)) || atual.dono === dono;
      if (!livre) return 0;
      u.fiscalConfig = { ...c, rodadaFiscal: JSON.parse(dados) };
      return 1;
    }
    if (m === "soltar-concessao-da-rodada") {
      const [lojaId, dono] = v as [string, string];
      const u = db.user.find((x) => x.id === lojaId);
      const c = objetoDe(u?.fiscalConfig);
      if (!u || objetoDe(c.rodadaFiscal).dono !== dono) return 0;
      const { rodadaFiscal, ...resto } = c;
      void rodadaFiscal;
      u.fiscalConfig = resto;
      return 1;
    }
    throw new Error(`SQL cru não previsto no banco falso: "${m}" ${String(sql?.sql ?? "").slice(0, 80)}`);
  }
  async function consultar(sql: any): Promise<any[]> {
    const v = sql.values as any[];
    const m = marcador(sql);
    estado.sqlVistos.push(m);
    await pausa();
    const ler = await numeros();
    const daLoja = (lojaId: string, desde?: Date) =>
      db.customerOrder
        .filter((o) => o.franchiseeId === lojaId && o.fiscalInfo != null && (!desde || o.createdAt.getTime() >= desde.getTime()))
        .flatMap((o) => ler(o as any));
    if (m === "maior-numero" || m === "maior-numero-recente") {
      const [lojaId, desde, serie, ambiente] = m === "maior-numero" ? [v[0], undefined, v[1], v[2]] : v;
      const nums = daLoja(lojaId, desde).filter((t) => t.serie === Number(serie) && t.ambiente === Number(ambiente)).map((t) => t.numero as number);
      return [{ maior: nums.length ? BigInt(Math.max(...nums)) : null }];
    }
    if (m === "numeros-da-loja") {
      return daLoja(v[0]).map((t) => ({ ...t, numero: String(t.numero), serie: String(t.serie), ambiente: String(t.ambiente) }));
    }
    throw new Error(`SQL cru não previsto no banco falso: "${m}"`);
  }
  const banco: any = {
    user: delegado("user"),
    customerOrder: delegado("customerOrder"),
    tableSession: delegado("tableSession"),
    $executeRaw: (sql: any) => executar(sql, []),
    $queryRaw: (sql: any) => consultar(sql),
    $transaction: async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const soltas: Array<() => void> = [];
      const tx = { ...banco, $executeRaw: (sql: any) => executar(sql, soltas), $queryRaw: (sql: any) => consultar(sql) };
      try {
        return await arg(tx);
      } finally {
        for (const s of soltas.reverse()) s();
      }
    },
  };
  (globalThis as any).prisma = banco;
  return { db, banco, estado, objetoDe };
}
