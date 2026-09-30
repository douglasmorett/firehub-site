/**
 * O DANFE NFC-e na fila de impressão da nuvem — quem RECEBE e quem MANDA:
 *
 *  - a fila (api/store/print-queue, GET) só entrega o DANFE ao Assistente que
 *    ANUNCIA, na consulta, que sabe imprimi-lo (`&danfe=1`). Pela versão não:
 *    as 1.2.24 a 1.2.27 foram lançadas SEM o DANFE, e o trabalho entregue a
 *    elas virava comanda vazia com o `printedAt` carimbado — o DANFE nunca
 *    mais voltava;
 *  - `enfileirarDanfe` (lib/nfce/impressao-do-danfe) avisa pela MESMA régua;
 *  - o interruptor "imprimir o DANFE sozinho" é lido num lugar só
 *    (`lojaImprimeODanfe`): `false` em `fiscalConfig.imprimirDanfe` OU em
 *    `fiscalConfig.sefaz.imprimirDanfe` desliga.
 *
 *   npx tsx scripts/teste-nfce-fila-do-danfe.ts
 *
 * Roda a rota e a lib DE VERDADE contra um BANCO FALSO em memória (o
 * `globalThis.prisma` que lib/prisma usa, como scripts/teste-nfce-integracao.ts)
 * e um cofre em pasta temporária. Nada vai a banco nem a SEFAZ.
 */
export {};

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FISCAL_CHAVE = "chave-de-teste-da-fila-do-danfe";
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
const COFRE = mkdtempSync(join(tmpdir(), "fh-cofre-fila-danfe-"));
process.env.FH_FISCAL_DIR = COFRE;

import { montarCorpoDaNfce, type PedidoParaNota } from "../src/lib/fiscal-emissao";
import { digestValueDoXml } from "../src/lib/nfce/assinatura";
import { guardarArquivoFiscal } from "../src/lib/nfce/armazenamento";
import { prepararNotaAssinada } from "../src/lib/nfce/emissor";
import { montarNfeProc } from "../src/lib/nfce/sefaz";
import { CONFIG_NIK, certificadoDeTeste, confere, terminar, verdade } from "./nfce-teste-apoio";

// ── Banco falso ──────────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const LOJA = "loja_fila_danfe";
const PEDIDO = "cm_pedido_danfe_0001";
const usuarios = new Map<string, Linha>();
const pedidos = new Map<string, Linha>();
const pedidosDeImpressao: Linha[] = [];

const noCaminho = (valor: unknown, caminho: string[]) => caminho.reduce((v: any, k) => (v == null ? undefined : v[k]), valor);
function casaPedidoDeImpressao(pr: Linha, where: Linha): boolean {
  if (where.franchiseeId && pr.franchiseeId !== where.franchiseeId) return false;
  if ("printedAt" in where && where.printedAt === null && pr.printedAt != null) return false;
  if (where.createdAt?.gt && !(pr.createdAt > where.createdAt.gt)) return false;
  if (typeof where.kind === "string" && pr.kind !== where.kind) return false;
  if (where.kind && typeof where.kind === "object" && "not" in where.kind && pr.kind === where.kind.not) return false;
  if (where.payload?.path && JSON.stringify(noCaminho(pr.payload, where.payload.path)) !== JSON.stringify(where.payload.equals)) return false;
  return true;
}
const consultasDaFila: Linha[] = [];
(globalThis as any).prisma = {
  user: {
    findUnique: async ({ where }: any) => (usuarios.has(where.id) ? { ...usuarios.get(where.id) } : null),
    update: async ({ where, data }: any) => Object.assign(usuarios.get(where.id)!, structuredClone(data)),
  },
  customerOrder: {
    findUnique: async ({ where }: any) => (pedidos.has(where.id) ? structuredClone(pedidos.get(where.id)) : null),
    findMany: async () => [],
  },
  printRequest: {
    findFirst: async ({ where }: any) => pedidosDeImpressao.find((pr) => casaPedidoDeImpressao(pr, where)) ?? null,
    findMany: async ({ where }: any) => {
      consultasDaFila.push(structuredClone(where));
      return pedidosDeImpressao.filter((pr) => casaPedidoDeImpressao(pr, where)).map((pr) => ({ ...pr }));
    },
    create: async ({ data }: any) => {
      const pr = { id: `pr_danfe_${pedidosDeImpressao.length + 1}`, createdAt: new Date(), printedAt: null, ...structuredClone(data) };
      pedidosDeImpressao.push(pr);
      return { id: pr.id };
    },
    deleteMany: async () => ({ count: 0 }),
    updateMany: async () => ({ count: 0 }),
  },
};

// ── Uma NFC-e autorizada no cofre ────────────────────────────────────────────
const AGORA = new Date();
function notaAutorizada(): { xml: string; chave: string } {
  const pedido: PedidoParaNota = {
    id: PEDIDO,
    numero: 7,
    canal: "PDV",
    itens: [{ codigo: "esfiha", descricao: "Esfiha de carne", ncm: "19059090", cfop: "5102", unidadeComercial: "UN", quantidade: 4, valorUnitario: 3.9, valorTotal: 15.6, origem: 0, csosn: "102" }],
    valorTotal: 15.6,
    formaDePagamento: "Dinheiro",
  };
  const m = montarCorpoDaNfce(pedido, CONFIG_NIK, AGORA);
  if (!m.ok) throw new Error(`corpo: ${JSON.stringify(m.pendencias)}`);
  const r = prepararNotaAssinada(
    m.corpo,
    { uf: "DF", ambiente: 2, serie: 1, numero: 31, qrCode: { versao: 2, idCsc: "000001", csc: "0123456789ABCDEF0123456789ABCDEF" } },
    certificadoDeTeste(),
    { tipoDeEmissao: 1, agora: AGORA }
  );
  if (!r.ok) throw new Error(`XML: ${JSON.stringify(r.pendencias)}`);
  const prot =
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS202609</verAplic><chNFe>${r.nota.chave}</chNFe>` +
    `<dhRecbto>2026-09-29T12:00:05-03:00</dhRecbto><nProt>353260000000777</nProt><digVal>${digestValueDoXml(r.nota.xml)}</digVal>` +
    `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  return { xml: montarNfeProc(r.nota.xml, prot), chave: r.nota.chave };
}

async function principal() {
  const { enfileirarDanfe, lojaImprimeODanfe } = await import("../src/lib/nfce/impressao-do-danfe");
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");

  const nota = notaAutorizada();
  const guardado = await guardarArquivoFiscal({ lojaId: LOJA, tipo: "nota", identificacao: nota.chave, conteudo: nota.xml, mes: "202609" });
  pedidos.set(PEDIDO, {
    id: PEDIDO,
    franchiseeId: LOJA,
    fiscalStatus: "EMITTED",
    fiscalInfo: { nfceKey: nota.chave, provedor: "sefaz", xmlNoCofre: { caminho: guardado.caminho, sha256: guardado.sha256, tipo: "nota" } },
  });
  const loja = (x: Linha = {}) =>
    usuarios.set(LOJA, {
      id: LOJA,
      storeName: "NIK",
      name: "NIK",
      slug: "nik",
      storeLoyalty: null,
      printerConfig: { printers: [{ id: "p1", name: "CAIXA", categories: [], copies: 2, paperWidth: "80mm" }] },
      printQueuePolledAt: new Date(Date.now() - 10 * 60_000),
      printQueueEstado: null,
      fiscalConfig: { provedor: "sefaz" },
      ...x,
    });

  // ── 1. O interruptor: um lugar só, qualquer `false` desliga ──────────────
  console.log("\n— lojaImprimeODanfe: os dois campos do interruptor —");
  confere(
    "ausente = ligado; false no cadastro OU no bloco sefaz = desligado",
    [lojaImprimeODanfe(null), lojaImprimeODanfe({}), lojaImprimeODanfe({ imprimirDanfe: true, sefaz: { imprimirDanfe: true } }), lojaImprimeODanfe({ imprimirDanfe: false }), lojaImprimeODanfe({ sefaz: { imprimirDanfe: false } }), lojaImprimeODanfe({ imprimirDanfe: true, sefaz: { imprimirDanfe: false } })],
    [true, true, true, false, false, false]
  );
  loja({ fiscalConfig: { provedor: "sefaz", imprimirDanfe: false }, printQueueEstado: { versao: "1.2.28", imprimeDanfe: true } });
  const desligadoNoCadastro = await enfileirarDanfe(PEDIDO);
  confere("fiscalConfig.imprimirDanfe = false: não entra na fila (era lido só o do bloco sefaz)", [desligadoNoCadastro.ok, !desligadoNoCadastro.ok && desligadoNoCadastro.motivo], [false, "desligado"]);
  loja({ fiscalConfig: { provedor: "sefaz", sefaz: { imprimirDanfe: false } }, printQueueEstado: { versao: "1.2.28", imprimeDanfe: true } });
  const desligadoNoBloco = await enfileirarDanfe(PEDIDO);
  confere("fiscalConfig.sefaz.imprimirDanfe = false: não entra na fila", !desligadoNoBloco.ok && desligadoNoBloco.motivo, "desligado");
  const forcado = await enfileirarDanfe(PEDIDO, { forcar: true, operador: "teste" });
  confere("desligado, mas pedido na mão (forcar): entra", [forcado.ok, pedidosDeImpressao.length], [true, 1]);

  // ── 2. O aviso da versão: pela capacidade anunciada ─────────────────────
  console.log("\n— enfileirarDanfe: o aviso de Assistente sem DANFE —");
  const avisoDeVersao = (r: Awaited<ReturnType<typeof enfileirarDanfe>>) => (r.ok ? r.avisos.some((a) => /ainda não imprime o DANFE — precisa da 1\.2\.28/.test(a)) : null);
  loja({ printQueueEstado: { versao: "1.2.28", imprimeDanfe: true } });
  confere("Assistente que anunciou (imprimeDanfe): sem aviso", avisoDeVersao(await enfileirarDanfe(PEDIDO, { forcar: true })), false);
  loja({ printQueueEstado: { versao: "1.2.28" } });
  confere("1.2.28 que NÃO anunciou: aviso (a versão sozinha não prova)", avisoDeVersao(await enfileirarDanfe(PEDIDO, { forcar: true })), true);
  loja({ printQueueEstado: { versao: "1.2.25" } });
  confere("1.2.25 (lançada sem o DANFE): aviso — a regra antiga (versão ≥ 1.2.24) calava", avisoDeVersao(await enfileirarDanfe(PEDIDO, { forcar: true })), true);
  loja({ printQueueEstado: null });
  confere("Assistente que nunca contou o estado: aviso", avisoDeVersao(await enfileirarDanfe(PEDIDO, { forcar: true })), true);
  loja({ printQueueEstado: { versao: "1.2.28", imprimeDanfe: true }, printerConfig: { printers: [{ id: "p1", name: "CAIXA", categories: [], copies: 1, paperWidth: "80mm", escposProfile: "legacy" }] } });
  const legado = await enfileirarDanfe(PEDIDO, { forcar: true });
  confere("impressora do caixa no perfil legacy: sem aviso de 'sem QR' (o Assistente desenha o QR em imagem)", legado.ok && legado.avisos.filter((a) => /legacy|QR/.test(a)), []);

  // ── 3. A fila da nuvem: o DANFE só vai a quem anunciou ─────────────────
  console.log("\n— GET /api/store/print-queue: o DANFE pela capacidade —");
  loja({ printQueueEstado: null });
  const consultar = async (query: string) => {
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}${query}`, { headers: { "x-forwarded-for": "10.9.8.7" } }));
    const corpo = (await res.json()) as { jobs: Array<Record<string, any>> };
    await new Promise((r) => setTimeout(r, 5)); // o carimbo do estado é gravado sem esperar
    return corpo.jobs.filter((j) => j.order?.kind === "DANFE_NFCE");
  };
  const semNada = await consultar("");
  confere("Assistente antigo, sem estado nenhum (< 1.2.7): nada de DANFE", semNada.length, 0);
  const antigo = await consultar("&v=1.2.27&pendentes=0");
  confere("1.2.27 (lançada sem o DANFE): nada de DANFE", antigo.length, 0);
  verdade("…e o DANFE nem sai do banco para quem não imprime (kind ≠ DANFE_NFCE na consulta)", consultasDaFila.at(-1)?.kind?.not === "DANFE_NFCE", JSON.stringify(consultasDaFila.at(-1)));
  const soVersao = await consultar("&v=1.2.28&pendentes=0");
  confere("1.2.28 que não anunciou: nada de DANFE (pela versão, a fila entregaria)", soVersao.length, 0);
  const anunciou = await consultar("&v=1.2.28&pendentes=0&danfe=1");
  confere("anunciou &danfe=1: os DANFEs da fila vão para ele", anunciou.length, pedidosDeImpressao.length);
  confere(
    "o trabalho do DANFE: a chave da nota, na impressora do caixa, UMA cópia",
    anunciou.length > 0 && [anunciou[0].order.danfe.chave, anunciou[0].destinos.map((d: any) => [d.printer, d.copies])],
    [nota.chave, [["CAIXA", 1]]]
  );
  confere("o estado gravado diz que este Assistente imprime o DANFE", usuarios.get(LOJA)!.printQueueEstado?.imprimeDanfe, true);
  loja({ printQueueEstado: { versao: "1.2.28", imprimeDanfe: true } });
  const pc2 = await consultar("&v=1.2.28&pendentes=0");
  confere("outro Assistente da loja, que não anunciou, não herda a capacidade do estado gravado", pc2.length, 0);
}

principal()
  .then(() => {
    rmSync(COFRE, { recursive: true, force: true });
    terminar();
  })
  .catch((e) => {
    rmSync(COFRE, { recursive: true, force: true });
    console.error("❌ exceção:", e);
    process.exit(1);
  });
