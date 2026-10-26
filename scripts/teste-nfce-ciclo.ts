/**
 * O CICLO DE VIDA da NFC-e do emissor próprio depois que ela sai — o que a
 * auditoria de 30/09/2026 achou e as correções travam. Roda o código de
 * verdade (lib/fiscal-automatico → lib/nfce/*) contra o BANCO FALSO e a SEFAZ
 * FALSA de scripts/nfce-teste-apoio, com um cofre em pasta temporária. Nada
 * vai à rede: http, https e tls ficam bloqueados.
 *
 *   npx tsx scripts/teste-nfce-ciclo.ts
 *
 * O que trava (cada seção diz o defeito que existia):
 *  1. o pós-emissão (contingência, número tentado, inutilização mensal, nota
 *     "processando") roda com a emissão desligada, com pendência de cadastro e
 *     depois de 48 h sem gravação; nota em recuo não tira a vez das outras.
 */
export {};

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_NIK, FIXTURES, SENHA_DO_CERTIFICADO, bancoFalso, confere, metodoDo, responder, sefazFalsa, terminar, verdade, type Linha } from "./nfce-teste-apoio";
import type { PedidoHttp, RespostaHttp } from "../src/lib/nfce/sefaz";

// ── Rede bloqueada: se algum caminho escapar da SEFAZ falsa, o teste quebra aqui ──
const semRede = () => {
  throw new Error("REDE BLOQUEADA NO TESTE");
};
for (const m of [http, https] as any[]) {
  m.request = semRede;
  m.get = semRede;
}
(tls as any).connect = semRede;

process.env.FISCAL_CHAVE = "chave-de-teste-do-ciclo-da-nfce-0001";
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
const COFRE = mkdtempSync(join(tmpdir(), "fh-cofre-ciclo-"));
process.env.FH_FISCAL_DIR = COFRE;
for (const k of ["FH_RESP_TEC_CNPJ", "FH_RESP_TEC_NOME", "FH_RESP_TEC_EMAIL", "FH_RESP_TEC_FONE"]) delete process.env[k];

const { db } = bancoFalso();

// ── SEFAZ falsa com roteiro trocável ──
type Resposta = RespostaHttp | "timeout-antes" | "timeout-depois";
let roteiro: (p: PedidoHttp) => Resposta = () => ({ status: 500, corpo: "" });
const sefaz = sefazFalsa((p) => roteiro(p));
const saudavel = (p: PedidoHttp): Resposta => {
  const m = metodoDo(p);
  if (m === "nfeAutorizacaoLote") return responder("autorizacao-100.xml", p);
  if (m === "nfeConsultaNF") return responder("consulta-100.xml", p, { DIGVAL: "" });
  if (m === "nfeRecepcaoEvento") return responder(p.corpo.includes("<tpEvento>110112</tpEvento>") ? "evento-135-substituicao.xml" : "evento-135.xml", p);
  if (m === "nfeInutilizacaoNF") return responder("inutilizacao-102.xml", p);
  if (m === "nfeStatusServicoNF") return responder("status-107.xml", p);
  return { status: 500, corpo: "" };
};
const metodosDesde = (n: number) => sefaz.pedidos.slice(n).map(metodoDo);

const MIN = 60_000;
const HORA = 60 * MIN;
const produto = { id: "esf", name: "Esfiha de carne", ncm: "21069090", cfop: "5102", csosn: "102", origem: "0" };
let seq = 0;
function pedido(lojaId: string, p: Linha = {}): Linha {
  const n = ++seq;
  // 3 h atrás: fora da varredura dos esquecidos (2 h) — cada caso emite o seu.
  const criado = new Date(Date.now() - 3 * HORA);
  const o: Linha = {
    id: `c${n}`, franchiseeId: lojaId, dailyOrderNumber: n, status: "ENTREGUE", deliveryType: "RETIRADA", tableSessionId: null,
    paymentMethod: "Pix", paymentMethods: null, gatewayPaymentId: null, totalAmount: 15.6, customerCpfCnpj: null,
    customerName: "Cliente", customerAddress: null, source: "BALCAO", fiscalStatus: "PENDING", fiscalInfo: null,
    createdAt: criado, updatedAt: criado,
    items: [{ id: `i${n}`, productName: "Esfiha de carne", quantity: 4, price: 3.9, menuProduct: produto }],
    ...p,
  };
  db.customerOrder.push(o);
  return o;
}
const doPedido = (id: string) => db.customerOrder.find((o) => o.id === id)!;
const info = (id: string): Linha => {
  const f = doPedido(id).fiscalInfo;
  return f && typeof f === "object" ? (f as Linha) : {};
};

/** Um caso: exceção dentro dele conta como falha e não derruba os outros. */
async function caso(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    verdade(`o caso rodou até o fim (${String(e?.message ?? e).slice(0, 200)})`, false, String(e?.stack ?? "").slice(0, 600));
  }
}

async function main() {
  const { guardarArquivoFiscal } = await import("../src/lib/nfce/armazenamento");
  const { cifrar } = await import("../src/lib/fiscal-credenciais");
  const { carregarCertificado } = await import("../src/lib/nfce/assinatura");
  const { normalizarConfigFiscal } = await import("../src/lib/fiscal-config");
  const { pendenciasParaEmitir } = await import("../src/lib/fiscal-emissao");
  const loja = await import("../src/lib/nfce/emissao-da-loja");
  const credenciais = await import("../src/lib/nfce/credenciais-da-loja");
  const { inutilizarBuracosDoMes } = await import("../src/lib/nfce/inutilizacao-da-loja");
  const auto = await import("../src/lib/fiscal-automatico");
  loja.usarTransporteDeTeste(sefaz.transporte);
  const cupons: string[] = [];
  auto.usarImpressoraDeTeste((id) => cupons.push(id));

  // O certificado de TESTE (CNPJ da NIK) no cofre de cada loja, como a tela guarda.
  const pfx = readFileSync(join(FIXTURES, "nfce-certificado-teste.pfx"));
  const cert = carregarCertificado(pfx, SENHA_DO_CERTIFICADO);
  const CSC = "0123456789ABCDEF0123456789ABCDEF";
  const cscDe = (id: string) => ({ id, cifrado: cifrar(CSC)!, final: CSC.slice(-4) });
  const certificados = new Map<string, Linha>();
  async function novaLoja(id: string, extra: Linha = {}): Promise<string> {
    const noCofre = await guardarArquivoFiscal({ lojaId: id, tipo: "certificado", identificacao: "a1", conteudo: pfx });
    const certificado = {
      arquivo: noCofre.caminho, sha256: noCofre.sha256, senhaCifrada: cifrar(SENHA_DO_CERTIFICADO)!, cnpj: cert.cnpj!,
      titular: cert.titular, validoDe: cert.validoDe.toISOString(), validoAte: cert.validoAte.toISOString(), enviadoEm: new Date().toISOString(),
    };
    certificados.set(id, certificado);
    db.user.push({
      id, ifoodMerchantId: null, food99MerchantId: null, storeName: id, name: id,
      fiscalConfig: {
        ...CONFIG_NIK, tokenDoProvedor: null, cscId: null, csc: null, temCertificado: false,
        provedor: "sefaz", enabled: true, ambiente: 2, inscricaoEstadual: "0712345600123",
        autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"], momentoDaEmissao: "saida",
        sefaz: { certificado, csc: { homologacao: cscDe("1"), producao: cscDe("2") }, serie: 7, numeroInicial: 1, qrVersao: 2 },
        ...extra,
      },
    });
    loja.esquecerBloqueiosDaSefaz();
    return id;
  }
  const daLoja = (id: string) => db.user.find((u) => u.id === id)!;
  const configDe = (id: string) => normalizarConfigFiscal(daLoja(id).fiscalConfig) as any;
  const mudar = (id: string, f: (c: Linha) => Linha) => {
    const u = daLoja(id);
    u.fiscalConfig = f(u.fiscalConfig);
  };
  /** Tira a loja do cron (sem o provedor, a rodada não a lista): os casos seguintes não a tocam. */
  const encerrar = (id: string) => mudar(id, (c) => ({ ...c, enabled: false, provedor: "fora-do-teste" }));
  /** Uma rodada do cron `h` horas à frente — o relógio do emissor e o `agora` da rodada juntos. */
  const cron = async (h: number) => {
    const quando = new Date(Date.now() + h * HORA);
    loja.usarRelogioDeTeste(() => quando);
    try {
      return await auto.retentarNotasFiscais({ orcamentoMs: 120_000, agora: quando });
    } finally {
      loja.usarRelogioDeTeste(null);
    }
  };
  /** A SEFAZ só responde a autorização depois do timeout (o corpo saiu): contingência com outro número + nº tentado. */
  const semRespostaNaAutorizacao = (p: PedidoHttp): Resposta => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-depois" : saudavel(p));
  /** A SEFAZ recusa a conexão (nada saiu): contingência com o MESMO número. */
  const sefazFora = (p: PedidoHttp): Resposta => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : saudavel(p));

  // ══ 1. O pós-emissão não para ═══════════════════════════════════════════
  console.log("\n— 1. O pós-emissão do emissor próprio roda com a loja desligada, com pendência e depois de 48 h —");

  // A. Loja DESLIGADA com contingência e número tentado pendentes.
  await caso(async () => {
    const L = await novaLoja("loja-desligada");
    const P = pedido(L);
    roteiro = semRespostaNaAutorizacao;
    await auto.emitirNfceAutomatica(P.id);
    confere("contingência com o nº tentado a conferir", [doPedido(P.id).fiscalStatus, info(P.id).contingencia, info(P.id).numeroTentado?.situacao], ["EMITTED", true, "a_conferir"]);
    mudar(L, (c) => ({ ...c, enabled: false })); // o dono desliga a emissão
    roteiro = (p) => (metodoDo(p) === "nfeConsultaNF" ? responder("consulta-217.xml", p) : saudavel(p));
    const antes = sefaz.pedidos.length;
    await cron(0.2);
    confere(
      "desligada: o cron TRANSMITE a contingência que o cliente levou e INUTILIZA o nº tentado (antes: nenhuma chamada, para sempre)",
      [doPedido(P.id).fiscalStatus, info(P.id).contingencia ?? null, Boolean(info(P.id).contingenciaEfetivadaEm), info(P.id).numeroTentado?.situacao, metodosDesde(antes).includes("nfeAutorizacaoLote"), metodosDesde(antes).includes("nfeInutilizacaoNF")],
      ["EMITTED", null, true, "inutilizado", true, true]
    );
    const mensal = await inutilizarBuracosDoMes({ lojaId: L, config: configDe(L), agora: new Date(Date.now() + 20 * 24 * HORA), forcar: true });
    verdade("a inutilização mensal não pula a loja desligada", mensal.pulou !== "emissão própria desligada" && mensal.pulou !== "a loja não usa o emissor próprio", String(mensal.pulou));
    encerrar(L);
  });

  // B. Loja LIGADA com uma pendência de cadastro: acompanha o que saiu, não emite nada novo.
  await caso(async () => {
    const L = await novaLoja("loja-com-pendencia");
    const P = pedido(L);
    roteiro = sefazFora;
    await auto.emitirNfceAutomatica(P.id);
    confere("contingência (SEFAZ fora)", info(P.id).contingencia, true);
    mudar(L, (c) => ({ ...c, regimeTributario: 3 })); // o titular salva o CRT errado
    confere("a loja agora tem pendência", pendenciasParaEmitir(configDe(L)).map((p) => p.campo), ["regimeTributario"]);
    // Uma falha transitória e uma venda esquecida: emitir é que NÃO pode, com a pendência.
    const falha = pedido(L, { createdAt: new Date(Date.now() - 30 * MIN), updatedAt: new Date(Date.now() - 30 * MIN), fiscalStatus: "FAILED", fiscalInfo: { provedor: "sefaz", motivo: "erro_de_comunicacao", ambiente: 2, tentativasAutomaticas: 1, ultimaTentativaEm: new Date(Date.now() - 30 * MIN).toISOString() } });
    const esquecida = pedido(L, { createdAt: new Date(Date.now() - 20 * MIN), updatedAt: new Date(Date.now() - 20 * MIN) });
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    await cron(0.1);
    confere(
      "com pendência: a contingência é transmitida (antes: o cron pulava a loja inteira)",
      [info(P.id).contingencia ?? null, Boolean(info(P.id).contingenciaEfetivadaEm)],
      [null, true]
    );
    confere(
      "e nada novo é emitido com o cadastro errado: nem a falha nem a esquecida",
      [doPedido(falha.id).fiscalStatus, doPedido(esquecida.id).fiscalInfo, metodosDesde(antes).filter((m) => m === "nfeAutorizacaoLote").length],
      ["FAILED", null, 1]
    );
    encerrar(L);
  });

  // C. Credencial ilegível: a rodada volta sem gravar; depois de 48 h a nota continua na fila.
  await caso(async () => {
    const L = await novaLoja("loja-credencial");
    const P = pedido(L);
    roteiro = sefazFora;
    await auto.emitirNfceAutomatica(P.id);
    const bom = certificados.get(L)!;
    mudar(L, (c) => ({ ...c, sefaz: { ...c.sefaz, certificado: { ...bom, sha256: "0".repeat(64) } } })); // o .pfx do cofre não confere
    credenciais.esquecerCertificados();
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    for (const h of [1, 24, 47]) await cron(h);
    confere("sem credencial: nada vai à SEFAZ", metodosDesde(antes), []);
    mudar(L, (c) => ({ ...c, sefaz: { ...c.sefaz, certificado: bom } })); // o dono reenvia o A1
    credenciais.esquecerCertificados();
    await cron(49);
    confere(
      "credencial de volta 49 h depois: a contingência é transmitida (antes: fora da janela de 48 h, nunca mais)",
      [info(P.id).contingencia ?? null, Boolean(info(P.id).contingenciaEfetivadaEm)],
      [null, true]
    );
    encerrar(L);
  });

  // K. "Processando" deixado por uma queda + loja desligada dois dias.
  await caso(async () => {
    const L = await novaLoja("loja-processando");
    const P = pedido(L);
    roteiro = saudavel; // a SEFAZ AUTORIZA; o processo morre antes de gravar
    const updateMany = (db as any).__updateMany ?? null;
    void updateMany;
    const banco = (globalThis as any).prisma;
    const original = banco.customerOrder.updateMany;
    banco.customerOrder.updateMany = async (args: any) => {
      if (JSON.stringify(args?.where ?? {}).includes(P.id)) throw new Error("queda simulada do container");
      return original(args);
    };
    try {
      await auto.emitirNfceAutomatica(P.id);
    } finally {
      banco.customerOrder.updateMany = original;
    }
    confere("a queda deixou PENDING 'processando' com o envio a conferir", [doPedido(P.id).fiscalStatus, info(P.id).processando, info(P.id).envioSefaz?.aConferir], ["PENDING", true, true]);
    mudar(L, (c) => ({ ...c, enabled: false }));
    await cron(1);
    await cron(24);
    mudar(L, (c) => ({ ...c, enabled: true }));
    await cron(49);
    confere(
      "49 h depois: a consulta acha a nota AUTORIZADA e o pedido sai do 'processando' (antes: preso para sempre)",
      [doPedido(P.id).fiscalStatus, info(P.id).processando ?? null, Boolean(info(P.id).nfceKey)],
      ["EMITTED", null, true]
    );
    encerrar(L);
  });

  // S3. Notas em recuo no topo da lista não tiram a vez da nota de baixo.
  await caso(async () => {
    const L = await novaLoja("loja-fila");
    // 45 contingências novas, todas no recuo (transmissão falhou há 1 min).
    const agora = new Date();
    for (let k = 0; k < 45; k++) {
      pedido(L, {
        createdAt: new Date(agora.getTime() - (10 + k) * MIN), fiscalStatus: "EMITTED",
        fiscalInfo: { provedor: "sefaz", ambiente: 2, contingencia: true, nfceKey: `K${k}`, ultimaTransmissaoEm: new Date(agora.getTime() - MIN).toISOString(), transmissoesDaContingencia: 5 },
      });
    }
    // E a nota antiga que precisa de vez: contingência de 2 dias, com o XML no cofre.
    const P = pedido(L);
    roteiro = sefazFora;
    await auto.emitirNfceAutomatica(P.id);
    doPedido(P.id).createdAt = new Date(agora.getTime() - 2 * 24 * HORA);
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    await cron(0);
    confere(
      "a contingência antiga é transmitida mesmo atrás de 45 em recuo (antes: as 40 do topo ocupavam a rodada)",
      [info(P.id).contingencia ?? null, metodosDesde(antes).filter((m) => m === "nfeAutorizacaoLote").length],
      [null, 1]
    );
    encerrar(L);
  });

  terminar();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => rmSync(COFRE, { recursive: true, force: true }));
