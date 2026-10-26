/**
 * O SERVIDOR do EvoPDV (rotas /api/integracoes/evopdv/*) de pé numa porta
 * local, para o EvoPDV de verdade rodar contra ele — com o MESMO ambiente do
 * scripts/teste-evopdv-emissao.ts: o banco falso dos testes, a SEFAZ falsa
 * das fixtures, o cofre numa pasta temporária e o certificado de TESTE
 * (CNPJ 64.568.087/0001-80, senha "firehub-teste", UF DF).
 *
 * As rotas são os módulos de verdade (route.ts), chamados com o Request que
 * chegou — o mesmo que o Next faria. Nada vai ao banco de verdade nem à SEFAZ.
 *
 *   PORTA=4010 EVOPDV_PROVISIONAMENTO_SEGREDO=<32+> [EVOPDV_FISCAL_STATUS_URL=... EVOPDV_FISCAL_STATUS_SEGREDO=...] \
 *     npx tsx scripts/servidor-evopdv-de-teste.ts
 *
 * Controle do teste (só aqui):
 *   POST /__teste/estado { semInternet?, perderRespostas?: n, sefaz?: "saudavel"|"fora", esquecerAssinatura? }
 *     (`perderRespostas`: as próximas n respostas de POST /notas são processadas e a conexão cai antes de responder)
 *   GET  /__teste/resumo  → as vendas, o número e quantas autorizações cada uma pediu à SEFAZ
 */
export {};

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bancoFalso, metodoDo, responder, sefazFalsa, type Linha } from "./nfce-teste-apoio";
import type { PedidoHttp, RespostaHttp } from "../src/lib/nfce/sefaz";

process.env.FISCAL_CHAVE = "chave-de-teste-do-evopdv-pelo-firehub";
process.env.DATABASE_URL = "file:banco-falso-dos-testes";
process.env.NEXTAUTH_SECRET ||= "segredo-de-teste";
const COFRE = mkdtempSync(join(tmpdir(), "fh-cofre-evopdv-servidor-"));
process.env.FH_FISCAL_DIR = COFRE;
for (const k of ["FH_RESP_TEC_CNPJ", "FH_RESP_TEC_NOME", "FH_RESP_TEC_EMAIL", "FH_RESP_TEC_FONE"]) delete process.env[k];
const PORTA = Number(process.env.PORTA || 4010);

// ── Banco falso, com o que a integração usa a mais (igual ao teste) ─────────
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
const consultaGeral = banco.$queryRaw;
banco.$queryRaw = async (sql: any) => {
  if (!/fh:series-do-mesmo-cnpj/.test(String(sql?.sql ?? ""))) return consultaGeral(sql);
  const [role, cnpj] = sql.values as [string, string];
  const limpo = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return db.user.filter((u) => u.role !== role && (limpo(objetoDe(u.fiscalConfig).cnpj) === cnpj || limpo(u.cpfCnpj) === cnpj)).map((u) => ({ id: u.id, fiscalConfig: u.fiscalConfig }));
};

// ── SEFAZ falsa ──────────────────────────────────────────────────────────────
type RespostaSefaz = RespostaHttp | "timeout-antes" | "timeout-depois";
const saudavel = (p: PedidoHttp): RespostaSefaz => {
  const m = metodoDo(p);
  if (m === "nfeAutorizacaoLote") return responder("autorizacao-100.xml", p);
  if (m === "nfeConsultaNF") return responder("consulta-100.xml", p, { DIGVAL: "" });
  if (m === "nfeRecepcaoEvento") return responder("evento-135.xml", p);
  if (m === "nfeInutilizacaoNF") return responder("inutilizacao-102.xml", p);
  if (m === "nfeStatusServicoNF") return responder("status-107.xml", p);
  return { status: 500, corpo: "" };
};
let modoDaSefaz: "saudavel" | "fora" = "saudavel";
const sefaz = sefazFalsa((p) => (modoDaSefaz === "fora" ? "timeout-antes" : saudavel(p)));
let semInternet = false;
let perderRespostas = 0;

// ── Rotas ────────────────────────────────────────────────────────────────────
const BASE = "/api/integracoes/evopdv";
type Rota = { metodo: string; padrao: RegExp; modulo: () => Promise<any> };
const ROTAS: Rota[] = [
  { metodo: "POST", padrao: /^\/provisionar$/, modulo: () => import("../src/app/api/integracoes/evopdv/provisionar/route") },
  { metodo: "GET", padrao: /^\/status$/, modulo: () => import("../src/app/api/integracoes/evopdv/status/route") },
  { metodo: "PUT", padrao: /^\/config$/, modulo: () => import("../src/app/api/integracoes/evopdv/config/route") },
  { metodo: "POST", padrao: /^\/certificado$/, modulo: () => import("../src/app/api/integracoes/evopdv/certificado/route") },
  { metodo: "POST", padrao: /^\/testar-sefaz$/, modulo: () => import("../src/app/api/integracoes/evopdv/testar-sefaz/route") },
  { metodo: "POST", padrao: /^\/notas$/, modulo: () => import("../src/app/api/integracoes/evopdv/notas/route") },
  { metodo: "GET", padrao: /^\/notas$/, modulo: () => import("../src/app/api/integracoes/evopdv/notas/route") },
  { metodo: "GET", padrao: /^\/notas\/([^/]+)$/, modulo: () => import("../src/app/api/integracoes/evopdv/notas/[vendaId]/route") },
  { metodo: "POST", padrao: /^\/notas\/([^/]+)\/cancelar$/, modulo: () => import("../src/app/api/integracoes/evopdv/notas/[vendaId]/cancelar/route") },
  { metodo: "GET", padrao: /^\/notas\/([^/]+)\/danfe$/, modulo: () => import("../src/app/api/integracoes/evopdv/notas/[vendaId]/danfe/route") },
  { metodo: "GET", padrao: /^\/notas\/([^/]+)\/xml$/, modulo: () => import("../src/app/api/integracoes/evopdv/notas/[vendaId]/xml/route") },
];

const lerCorpo = (req: IncomingMessage) =>
  new Promise<Buffer>((ok, erro) => {
    const partes: Buffer[] = [];
    req.on("data", (p) => partes.push(p));
    req.on("end", () => ok(Buffer.concat(partes)));
    req.on("error", erro);
  });

function json(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

async function main() {
  const loja = await import("../src/lib/nfce/emissao-da-loja");
  const auto = await import("../src/lib/fiscal-automatico");
  loja.usarTransporteDeTeste(sefaz.transporte);
  auto.usarImpressoraDeTeste(() => {});

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORTA}`);
      const corpo = await lerCorpo(req);

      if (url.pathname === "/__teste/estado" && req.method === "POST") {
        const e = JSON.parse(corpo.toString("utf8") || "{}");
        if (typeof e.semInternet === "boolean") semInternet = e.semInternet;
        if (typeof e.perderRespostas === "number") perderRespostas = e.perderRespostas;
        if (e.sefaz === "saudavel" || e.sefaz === "fora") modoDaSefaz = e.sefaz;
        if (e.esquecerAssinatura) for (const i of tabelas.integracaoEvopdv) i.assinatura = null;
        return json(res, 200, { semInternet, sefaz: modoDaSefaz });
      }
      if (url.pathname === "/__teste/resumo") {
        const autorizacoes: Record<string, number> = {};
        for (const p of sefaz.pedidos) {
          if (metodoDo(p) !== "nfeAutorizacaoLote") continue;
          const id = /<nNF>(\d+)<\/nNF>/.exec(p.corpo)?.[1] ?? "?";
          autorizacoes[id] = (autorizacoes[id] ?? 0) + 1;
        }
        return json(res, 200, {
          autorizacoesPorNumero: autorizacoes,
          vendas: db.vendaExterna.map((v) => ({ vendaId: v.vendaId, status: v.fiscalStatus, numero: objetoDe(v.fiscalInfo).nfceNumber ?? null, chave: objetoDe(v.fiscalInfo).nfceKey ?? null })),
          pedidosDeAutorizacao: sefaz.pedidos.filter((p) => metodoDo(p) === "nfeAutorizacaoLote").length,
          contas: tabelas.integracaoEvopdv.map((i) => ({ cnpj: i.cnpj, email: i.email })),
        });
      }

      if (!url.pathname.startsWith(BASE + "/")) return json(res, 404, { error: "rota" });
      // "Sem internet": a conexão cai sem resposta.
      if (semInternet) return void req.socket.destroy();

      const caminho = url.pathname.slice(BASE.length);
      const rota = ROTAS.find((r) => r.metodo === req.method && r.padrao.test(caminho));
      if (!rota) return json(res, 404, { error: "rota" });
      const m = rota.padrao.exec(caminho)!;
      const modulo = await rota.modulo();
      const pedido = new Request(url.toString(), {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string") as Array<[string, string]>),
        ...(req.method !== "GET" && corpo.length ? { body: corpo } : {}),
      });
      const resposta: Response = await modulo[req.method!](pedido, m[1] ? { params: Promise.resolve({ vendaId: m[1] }) } : undefined);
      if (perderRespostas > 0 && req.method === "POST" && caminho === "/notas") {
        perderRespostas--;
        console.log(`POST ${caminho} → ${resposta.status} (resposta perdida de propósito)`);
        return void req.socket.destroy();
      }
      const cabecalhos: Record<string, string> = {};
      resposta.headers.forEach((v, k) => (cabecalhos[k] = v));
      res.writeHead(resposta.status, cabecalhos);
      res.end(Buffer.from(await resposta.arrayBuffer()));
      console.log(`${req.method} ${caminho} → ${resposta.status}`);
    } catch (e: any) {
      console.error("erro no servidor de teste:", e);
      json(res, 500, { error: "servidor_de_teste", mensagem: String(e?.message ?? e) });
    }
  });
  servidor.listen(PORTA, "127.0.0.1", () => console.log(`servidor EvoPDV de teste em http://127.0.0.1:${PORTA}${BASE}`));
  const sair = () => {
    rmSync(COFRE, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", sair);
  process.on("SIGTERM", sair);
}

main().catch((e) => {
  console.error("❌", e);
  rmSync(COFRE, { recursive: true, force: true });
  process.exit(1);
});
