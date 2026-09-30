/**
 * A RECUPERAÇÃO do emissor próprio de NFC-e — o que acontece quando a SEFAZ
 * não responde, responde pela metade, recusa o LOTE em vez da nota, autoriza
 * com alerta ou bloqueia o CNPJ por consumo indevido — rodando de verdade
 * (lib/fiscal-automatico → lib/nfce/emissao-da-loja → lib/nfce/emissor) contra
 * o banco falso (scripts/nfce-teste-apoio → bancoFalso) e uma SEFAZ falsa COM
 * ESTADO: ela lembra o que autorizou, cancelou (com o procEventoNFe) e
 * inutilizou, e responde 204/539 como a de verdade.
 *
 * Cada caso é uma das provas da revisão de 30/09/2026 (numeracao-prova-*.ts),
 * virada teste de regressão: FALHA no código de antes e passa no de agora.
 * Nada vai ao banco de verdade, nem à SEFAZ.
 *
 *   npx tsx scripts/teste-nfce-recuperacao.ts
 */
export {};

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_NIK,
  FIXTURES,
  SENHA_DO_CERTIFICADO,
  bancoFalso,
  certificadoDeTeste,
  confere,
  mensagemDoEnvelope,
  metodoDo,
  responder,
  sefazFalsa,
  terminar,
  validarNoXsd,
  verdade,
  type Linha,
} from "./nfce-teste-apoio";
import type { PedidoHttp, RespostaHttp } from "../src/lib/nfce/sefaz";
import { lerChave } from "../src/lib/nfce/chave";
import { primeiro, serializar } from "../src/lib/nfce/xml";

process.env.FISCAL_CHAVE = "chave-de-teste-da-recuperacao-nfce";
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
const COFRE = mkdtempSync(join(tmpdir(), "fh-cofre-recuperacao-"));
process.env.FH_FISCAL_DIR = COFRE;
for (const k of ["FH_RESP_TEC_CNPJ", "FH_RESP_TEC_NOME", "FH_RESP_TEC_EMAIL", "FH_RESP_TEC_FONE"]) delete process.env[k];

const { db, estado } = bancoFalso();

// ── A SEFAZ falsa, com o roteiro trocável por caso ───────────────────────────
type Resposta = RespostaHttp | "timeout-antes" | "timeout-depois";
let roteiro: (p: PedidoHttp) => Resposta | Promise<Resposta> = () => ({ status: 500, corpo: "" });
const sefaz = sefazFalsa((p) => roteiro(p));
const metodos = (desde: number) => sefaz.pedidos.slice(desde).map(metodoDo).filter((m) => m !== "nfeStatusServicoNF");
const contar = (desde: number, metodo: string) => sefaz.pedidos.slice(desde).filter((p) => metodoDo(p) === metodo).length;
const texto = (p: PedidoHttp, nome: string) => primeiro(mensagemDoEnvelope(p.corpo), nome)?.textContent ?? "";
const chaveDaNota = (p: PedidoHttp) => (primeiro(mensagemDoEnvelope(p.corpo), "infNFe")?.getAttribute("Id") ?? "").replace(/^NFe/, "");

/**
 * Uma SEFAZ que LEMBRA. NFC-e: o número é da chave que a autorizou primeiro
 * (modelo 65: UF, CNPJ, série, número e tpEmis — MOC 7.0, regra 2B08-10):
 * a mesma chave de novo é 204; outra chave, 539 com a chave que tem o número.
 */
function novaSefaz() {
  const porNumero = new Map<string, string>();
  const autorizadas = new Set<string>();
  /** chave → evento + retEvento, o miolo do procEventoNFe que a consulta devolve. */
  const canceladas = new Map<string, string>();
  const inutilizadas = new Set<string>();
  const doNumero = (amb: string, chave: string) => {
    const c = lerChave(chave);
    return `${amb}:${c.serie}:${c.numero}:${c.tipoDeEmissao}`;
  };
  const s = {
    porNumero,
    autorizadas,
    canceladas,
    inutilizadas,
    autorizar(p: PedidoHttp, fixtureDaAutorizada = "autorizacao-100.xml"): RespostaHttp {
      const chave = chaveDaNota(p);
      const k = doNumero(texto(p, "tpAmb"), chave);
      const ja = porNumero.get(k);
      if (ja === chave) return responder("autorizacao-204.xml", p);
      if (ja) return responder("autorizacao-539.xml", p, { DUPLICADA: ja });
      porNumero.set(k, chave);
      autorizadas.add(chave);
      return responder(fixtureDaAutorizada, p);
    },
    /** A autorização que acontece e cuja resposta se perde. */
    gravarSemResponder(p: PedidoHttp): void {
      const chave = chaveDaNota(p);
      porNumero.set(doNumero(texto(p, "tpAmb"), chave), chave);
      autorizadas.add(chave);
    },
    consultar(p: PedidoHttp): RespostaHttp {
      const chave = texto(p, "chNFe");
      const proc = canceladas.get(chave);
      if (proc) {
        const r = responder("consulta-101.xml", p, { DIGVAL: "" });
        return { status: 200, corpo: r.corpo.replace("</retConsSitNFe>", `<procEventoNFe versao="1.00">${proc}</procEventoNFe></retConsSitNFe>`) };
      }
      return autorizadas.has(chave) ? responder("consulta-100.xml", p, { DIGVAL: "" }) : responder("consulta-217.xml", p);
    },
    evento(p: PedidoHttp): RespostaHttp {
      const chave = texto(p, "chNFe");
      if (canceladas.has(chave)) return responder("evento-573.xml", p);
      const r = responder(texto(p, "tpEvento") === "110112" ? "evento-135-substituicao.xml" : "evento-135.xml", p);
      const evento = /<evento[\s>][\s\S]*<\/evento>/.exec(p.corpo)?.[0] ?? "";
      const retEvento = /<retEvento[\s>][\s\S]*<\/retEvento>/.exec(r.corpo)?.[0] ?? "";
      canceladas.set(chave, evento + retEvento);
      return r;
    },
    inutilizar(p: PedidoHttp): RespostaHttp {
      const amb = texto(p, "tpAmb");
      const serie = Number(texto(p, "serie"));
      const ini = Number(texto(p, "nNFIni"));
      const fim = Number(texto(p, "nNFFin"));
      const faixa = Array.from({ length: fim - ini + 1 }, (_, i) => `${amb}:${serie}:${ini + i}`);
      if (faixa.some((n) => inutilizadas.has(n))) return responder("inutilizacao-256.xml", p);
      faixa.forEach((n) => inutilizadas.add(n));
      return responder("inutilizacao-102.xml", p);
    },
    saudavel(p: PedidoHttp): Resposta {
      const m = metodoDo(p);
      if (m === "nfeAutorizacaoLote") return s.autorizar(p);
      if (m === "nfeConsultaNF") return s.consultar(p);
      if (m === "nfeRecepcaoEvento") return s.evento(p);
      if (m === "nfeInutilizacaoNF") return s.inutilizar(p);
      if (m === "nfeStatusServicoNF") return responder("status-107.xml", p);
      return { status: 500, corpo: "" };
    },
  };
  return s;
}

// ── Cenário ──────────────────────────────────────────────────────────────────
const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const haMin = (min: number) => new Date(Date.now() - min * MIN);
const produto = { id: "esf", name: "Esfiha de carne", ncm: "21069090", cfop: "5102", csosn: "102", origem: "0" };
let seq = 0;
function pedido(lojaId: string, p: Partial<Linha> = {}): Linha {
  const n = ++seq;
  const o: Linha = {
    id: `r${n}`, franchiseeId: lojaId, dailyOrderNumber: n, status: "ENTREGUE", deliveryType: "RETIRADA", tableSessionId: null,
    paymentMethod: "Pix", paymentMethods: null, gatewayPaymentId: null, totalAmount: 15.6, customerCpfCnpj: null,
    customerName: "Cliente", customerAddress: null, source: "BALCAO", fiscalStatus: "PENDING", fiscalInfo: null,
    // 3 horas atrás: fora da varredura dos esquecidos (2 h) — cada caso emite o seu.
    createdAt: haMin(180),
    items: [{ id: `i${n}`, productName: "Esfiha de carne", quantity: 4, price: 3.9, menuProduct: produto }],
    ...p,
  };
  o.updatedAt ??= o.createdAt;
  db.customerOrder.push(o);
  return o;
}
/** Um pedido do banco falso, com o que as funções de verdade exigem. */
type PedidoDoBancoFalso = Linha & { id: string; fiscalStatus: string | null; fiscalInfo: unknown };
const doPedido = (id: string) => db.customerOrder.find((o) => o.id === id)! as PedidoDoBancoFalso;
const info = (id: string): Linha => {
  const f = doPedido(id).fiscalInfo;
  return f && typeof f === "object" ? (f as Linha) : {};
};
const paraValidar: Array<{ nome: string; xsd: string; xml: string }> = [];

/**
 * Um caso: a exceção dentro dele conta como falha e não derruba os outros —
 * no código de antes, um caso pode quebrar no meio (é o defeito), e os
 * seguintes ainda têm de mostrar os deles.
 */
async function caso(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    verdade(`o caso rodou até o fim (${String(e?.message ?? e).slice(0, 200)})`, false, String(e?.stack ?? "").slice(0, 600));
  }
}

async function main() {
  const { guardarArquivoFiscal, lerXmlFiscal } = await import("../src/lib/nfce/armazenamento");
  const { cifrar } = await import("../src/lib/fiscal-credenciais");
  const { carregarCertificado } = await import("../src/lib/nfce/assinatura");
  const { normalizarConfigFiscal } = await import("../src/lib/fiscal-config");
  const { montarCorpoDaNfce } = await import("../src/lib/fiscal-emissao");
  const loja = await import("../src/lib/nfce/emissao-da-loja");
  const rotina = await import("../src/lib/nfce/rotina-da-sefaz");
  const inut = await import("../src/lib/nfce/inutilizacao-da-loja");
  const emissor = await import("../src/lib/nfce/emissor");
  const auto = await import("../src/lib/fiscal-automatico");
  loja.usarTransporteDeTeste(sefaz.transporte);
  const cupons: Array<{ id: string; forcar: boolean }> = [];
  auto.usarImpressoraDeTeste((id, o) => cupons.push({ id, forcar: o?.forcar === true }));

  // O certificado de TESTE (CNPJ da NIK) no cofre, como a tela guarda — um arquivo para todas as lojas do teste.
  const pfx = readFileSync(join(FIXTURES, "nfce-certificado-teste.pfx"));
  const cert = carregarCertificado(pfx, SENHA_DO_CERTIFICADO);
  const noCofre = await guardarArquivoFiscal({ lojaId: "loja-nik", tipo: "certificado", identificacao: "a1", conteudo: pfx });
  const certificadoDaLoja = {
    arquivo: noCofre.caminho, sha256: noCofre.sha256, senhaCifrada: cifrar(SENHA_DO_CERTIFICADO)!, cnpj: cert.cnpj!,
    titular: cert.titular, validoDe: cert.validoDe.toISOString(), validoAte: cert.validoAte.toISOString(), enviadoEm: new Date().toISOString(),
  };
  const CSC = "0123456789ABCDEF0123456789ABCDEF";
  const cscDe = (id: string) => ({ id, cifrado: cifrar(CSC)!, final: CSC.slice(-4) });
  const sefazDaNik = (extra: Linha = {}) => ({ certificado: certificadoDaLoja, csc: { homologacao: cscDe("1"), producao: cscDe("2") }, serie: 7, numeroInicial: 1, qrVersao: 2, ...extra });
  const configDaNik = (extra: Linha = {}): Linha => ({
    ...CONFIG_NIK,
    tokenDoProvedor: null, cscId: null, csc: null, temCertificado: false,
    provedor: "sefaz", enabled: true, ambiente: 2, inscricaoEstadual: "0712345600123",
    autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"], momentoDaEmissao: "saida",
    sefaz: sefazDaNik(),
    ...extra,
  });
  const novaLoja = (id: string, extra: Linha = {}) => {
    db.user.push({ id, ifoodMerchantId: null, food99MerchantId: null, storeName: id, name: id, fiscalConfig: configDaNik(extra) });
    loja.esquecerBloqueiosDaSefaz();
    return id;
  };
  const daLoja = (id: string) => db.user.find((u) => u.id === id)!;
  const configDe = (id: string) => normalizarConfigFiscal(daLoja(id).fiscalConfig) as any;
  const mudar = (id: string, f: (c: Linha) => Linha) => {
    const u = daLoja(id);
    u.fiscalConfig = f(u.fiscalConfig);
  };
  /** Tira a loja do cron: as rodadas dos casos seguintes não a tocam. */
  const encerrar = (id: string) => mudar(id, (c) => ({ ...c, enabled: false }));
  const em = (t0: number, min: number) => new Date(t0 + min * MIN);
  const irPara = (t0: number, min: number) => loja.usarRelogioDeTeste(() => em(t0, min));
  /** Uma rodada do cron no minuto `min` (o relógio do emissor e o `agora` da rodada juntos). */
  const cron = async (t0: number, min: number) => {
    irPara(t0, min);
    return auto.retentarNotasFiscais({ orcamentoMs: 120_000, agora: em(t0, min) });
  };
  const semLoja = { ifoodMerchantId: null, food99MerchantId: null } as any;
  const corpoDeTeste = () => {
    const m = montarCorpoDaNfce(
      { id: "u1", numero: 1, canal: "PDV", itens: [{ codigo: "esf", descricao: "Esfiha de carne", ncm: "21069090", cfop: "5102", unidadeComercial: "UN", quantidade: 4, valorUnitario: 3.9, valorTotal: 15.6, origem: 0, csosn: "102" }], valorTotal: 15.6, formaDePagamento: "Dinheiro" } as any,
      CONFIG_NIK,
      new Date()
    );
    if (!m.ok) throw new Error(JSON.stringify(m.pendencias));
    return m.corpo;
  };
  const ctxDeTeste = (extra: Linha = {}): any => ({
    certificado: certificadoDeTeste(), uf: "DF", ambiente: 2, serie: 1, numero: 50,
    qrCode: { versao: 2, idCsc: "1", csc: CSC }, esperar: async () => {}, ...extra,
  });
  const lerDoCofre = (p: Linha) => lerXmlFiscal(p.caminho, p.sha256);

  // ── 1. O número tentado: recuo, "já inutilizada", para_pessoa ────────────
  console.log("\n— 1. Número tentado: conferência com recuo, 'já inutilizada' e 'para_pessoa' —");
  await caso(async () => {
    const L = novaLoja("loja-tentado");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    let foi = false;
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" && !foi ? ((foi = true), "timeout-depois") : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const t = info(G.id).numeroTentado;
    confere("contingência com o número tentado a conferir", [info(G.id).contingencia, t?.situacao], [true, "a_conferir"]);
    roteiro = s.saudavel;
    await cron(t0, 1);
    confere("a contingência foi efetivada", [doPedido(G.id).fiscalStatus, info(G.id).contingencia ?? null], ["EMITTED", null]);
    // A partir de 11 min: 217 na tentada; a 1ª inutilização HOMOLOGA e a
    // resposta se perde; daí em diante a SEFAZ diz "já inutilizada" (256).
    let inutilizacoes = 0;
    roteiro = (p) => {
      if (metodoDo(p) === "nfeInutilizacaoNF" && ++inutilizacoes === 1) {
        s.inutilizar(p);
        return "timeout-depois";
      }
      return s.saudavel(p);
    };
    const antes = sefaz.pedidos.length;
    for (let k = 0; k < 10; k++) await cron(t0, 11 + 2 * k);
    const tf = info(G.id).numeroTentado;
    confere(
      "20 min de cron: 2 consultas e 2 inutilizações (antes: 10 e 10, a mesma chave e a mesma faixa a cada 2 min — o caminho do 656)",
      [contar(antes, "nfeConsultaNF"), contar(antes, "nfeInutilizacaoNF")],
      [2, 2]
    );
    confere("'já inutilizada': o tentado sai da fila como inutilizado, sem protocolo", [tf.situacao, tf.semProtocolo, tf.conferencias], ["inutilizado", true, 2]);
    const reg = (daLoja(L).fiscalConfig.inutilizacoes ?? []).find((x: Linha) => x.numeroInicial === t.numero);
    confere("a faixa ficou registrada (sem protocolo), com o pedido assinado no cofre", [reg?.semProtocolo, reg?.origem, Boolean(reg?.pedidoNoCofre?.caminho)], [true, "tentado", true]);
    const pedidoInut = await lerDoCofre(reg.pedidoNoCofre);
    verdade("o inutNFe assinado foi guardado ANTES de sair", pedidoInut.includes("<inutNFe") && pedidoInut.includes("<Signature"));
    paraValidar.push({ nome: "inutNFe guardado antes de sair", xsd: "inutNFe_v4.00.xsd", xml: pedidoInut });
    encerrar(L);
  });
  await caso(async () => {
    const L = novaLoja("loja-tentado-sem-resposta");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    let foi = false;
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" && !foi ? ((foi = true), "timeout-depois") : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    roteiro = s.saudavel;
    await cron(t0, 1);
    // A consulta da tentada nunca responde.
    roteiro = (p) => (metodoDo(p) === "nfeConsultaNF" ? "timeout-depois" : s.saudavel(p));
    const antes = sefaz.pedidos.length;
    let minuto = 1;
    for (let k = 0; k < 12; k++) {
      const proxima = rotina.proximaConferenciaDoTentado(info(G.id).numeroTentado);
      minuto = Math.max(minuto + 1, Math.ceil((proxima - t0) / MIN));
      await cron(t0, minuto);
    }
    const tf = info(G.id).numeroTentado;
    confere("8 conferências sem resposta → 'para_pessoa', com a orientação", [tf.situacao, tf.conferencias, /portal da SEFAZ/.test(String(tf.orientacao))], ["para_pessoa", 8, true]);
    confere("…no recuo (10, 20, 40… min, teto 6 h): 8 consultas em mais de 16 h, e nenhuma depois", [contar(antes, "nfeConsultaNF"), minuto > 16 * 60], [8, true]);
    encerrar(L);
  });

  // ── 2. Recusa do lote × recusa da nota; 656 ──────────────────────────────
  console.log("\n— 2. Recusa do LOTE não é recusa da nota; 656 bloqueia a loja —");
  await caso(async () => {
    const L = novaLoja("loja-656");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    confere("contingência emitida", [doPedido(G.id).fiscalStatus, info(G.id).contingencia], ["EMITTED", true]);
    // O CNPJ bloqueado por consumo indevido na hora da transmissão.
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-lote-656.xml", p) : s.saudavel(p));
    await cron(t0, 1);
    confere("656 do LOTE não derruba o cupom: segue EMITTED em contingência (antes: FAILED, 'o cupom não vale mais')", [doPedido(G.id).fiscalStatus, info(G.id).contingencia, info(G.id).contingenciaRecusadaEm ?? null], ["EMITTED", true, null]);
    const bloqueio = Date.parse(String(daLoja(L).fiscalConfig.sefaz?.bloqueadoAte ?? ""));
    confere("…e grava fiscalConfig.sefaz.bloqueadoAte = agora + 65 min", Math.round((bloqueio - em(t0, 1).getTime()) / MIN), 65);
    // Durante o bloqueio: nem o cron, nem a emissão, nem o teste de conexão chamam a SEFAZ.
    roteiro = s.saudavel;
    let antes = sefaz.pedidos.length;
    for (const m of [10, 30, 60]) await cron(t0, m);
    irPara(t0, 30);
    const N = pedido(L);
    await auto.emitirNfceAutomatica(N.id);
    const teste = await loja.testarConexaoDaLoja({ lojaId: L, config: configDe(L), ambiente: 2 });
    confere("bloqueada: 0 chamadas à SEFAZ em 1 hora de cron, emissão e teste de conexão", sefaz.pedidos.length - antes, 0);
    confere(
      "a venda no bloqueio sai em contingência direto, com o MESMO número e sem número tentado",
      [doPedido(N.id).fiscalStatus, info(N.id).contingencia, lerChave(String(info(N.id).nfceKey)).tipoDeEmissao, info(N.id).numeroTentado ?? null],
      ["EMITTED", true, 9, null]
    );
    confere("o teste de conexão diz que está bloqueado, sem chamar", [teste.ok, teste.cStat], [false, "656"]);
    antes = sefaz.pedidos.length;
    await cron(t0, 70);
    confere("passou o bloqueio: as duas contingências são transmitidas e efetivadas", [contar(antes, "nfeAutorizacaoLote"), doPedido(G.id).fiscalStatus, info(G.id).contingencia ?? null, info(N.id).contingencia ?? null], [2, "EMITTED", null, null]);
    encerrar(L);
  });
  await caso(async () => {
    const L = novaLoja("loja-lote");
    const s = novaSefaz();
    loja.usarRelogioDeTeste(null);
    let resposta = "autorizacao-lote-656.xml";
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder(resposta, p) : s.saudavel(p));
    const A = pedido(L);
    await auto.emitirNfceAutomatica(A.id);
    confere("656 na emissão normal: contingência com o MESMO número (antes: FAILED 'rejeitada', fora da retentativa)", [doPedido(A.id).fiscalStatus, info(A.id).contingencia, info(A.id).numeroTentado ?? null], ["EMITTED", true, null]);
    loja.esquecerBloqueiosDaSefaz();
    mudar(L, (c) => ({ ...c, sefaz: { ...c.sefaz, bloqueadoAte: null } }));
    resposta = "autorizacao-lote-280.xml";
    const B = pedido(L);
    await auto.emitirNfceAutomatica(B.id);
    const ib = info(B.id);
    confere(
      "280 (certificado do transmissor): falha de CONFIGURAÇÃO com a pendência 'certificado', sem queimar número",
      [doPedido(B.id).fiscalStatus, ib.motivo, (ib.pendencias ?? []).map((p: Linha) => p.campo), ib.numerosQueimados ?? null, typeof ib.numeroReservado?.numero],
      ["FAILED", "nao_configurado", ["certificado"], null, "number"]
    );
    resposta = "autorizacao-lote-225.xml";
    const C = pedido(L);
    await auto.emitirNfceAutomatica(C.id);
    confere("225 (schema do lote): é da nota — recusa, com o número guardado para a corrigida", [doPedido(C.id).fiscalStatus, info(C.id).motivo, info(C.id).cStat, typeof info(C.id).numeroReservado?.numero], ["FAILED", "rejeitada", "225", "number"]);
    resposta = "autorizacao-lote-999.xml";
    const D = pedido(L);
    await auto.emitirNfceAutomatica(D.id);
    confere(
      "999 (a SEFAZ quebrou no meio, a nota pode ter sido gravada): contingência com OUTRO número e o tentado a conferir",
      [doPedido(D.id).fiscalStatus, info(D.id).contingencia, info(D.id).numeroTentado?.situacao, info(D.id).numeroTentado?.numero !== info(D.id).nfceNumber],
      ["EMITTED", true, "a_conferir", true]
    );
    encerrar(L);
  });
  await caso(async () => {
    // 656 numa CONSULTA (o recibo): nenhuma chamada até o bloqueio passar.
    const L = novaLoja("loja-656-consulta");
    const t0 = Date.now();
    irPara(t0, 0);
    let bloqueado = false;
    roteiro = (p) => {
      const m = metodoDo(p);
      if (m === "nfeAutorizacaoLote") return responder("autorizacao-103.xml", p);
      if (m === "nfeRetAutorizacaoLote") {
        const r = responder("recibo-105.xml", p);
        return bloqueado ? { status: 200, corpo: r.corpo.replace("<cStat>105</cStat><xMotivo>Lote em processamento</xMotivo>", "<cStat>656</cStat><xMotivo>Rejeicao: Consumo Indevido</xMotivo>") } : r;
      }
      if (m === "nfeConsultaNF") return responder("consulta-656.xml", p);
      return responder("status-107.xml", p);
    };
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    confere("103/105: processando", [doPedido(G.id).fiscalStatus, info(G.id).processando], ["PENDING", true]);
    bloqueado = true;
    let antes = sefaz.pedidos.length;
    await cron(t0, 11);
    confere("a consulta volta 656: uma chamada, e o bloqueio gravado", [metodos(antes), Boolean(daLoja(L).fiscalConfig.sefaz?.bloqueadoAte)], [["nfeRetAutorizacaoLote"], true]);
    antes = sefaz.pedidos.length;
    for (let k = 1; k <= 15; k++) await cron(t0, 11 + 4 * k);
    confere("1 hora de cron durante o bloqueio: nenhuma chamada (antes: 15 consultas da mesma chave)", sefaz.pedidos.length - antes, 0);
    bloqueado = false;
    antes = sefaz.pedidos.length;
    await cron(t0, 80);
    confere("passou o bloqueio: a conferência volta", metodos(antes), ["nfeRetAutorizacaoLote"]);
    encerrar(L);
  });

  // ── 3. 204 com a consulta muda ───────────────────────────────────────────
  console.log("\n— 3. Duplicidade (204) sem a consulta responder: nunca 'recusada' —");
  await caso(async () => {
    const L = novaLoja("loja-204");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const k9 = String(info(G.id).nfceKey);
    confere("contingência (tpEmis 9)", [doPedido(G.id).fiscalStatus, info(G.id).contingencia, lerChave(k9).tipoDeEmissao], ["EMITTED", true, 9]);
    // Uma transmissão anterior chegou e a resposta se perdeu: a SEFAZ já tem esta chave.
    s.porNumero.set(`2:${lerChave(k9).serie}:${lerChave(k9).numero}:9`, k9);
    s.autorizadas.add(k9);
    roteiro = (p) => (metodoDo(p) === "nfeConsultaNF" ? "timeout-depois" : s.saudavel(p));
    await cron(t0, 1);
    const i1 = info(G.id);
    confere(
      "204 + consulta sem resposta: a contingência SEGUE valendo (antes: FAILED 'recusada' — e a reemissão fazia a segunda nota)",
      [doPedido(G.id).fiscalStatus, i1.contingencia, i1.contingenciaRecusadaEm ?? null, Boolean(i1.contingenciaAConferirEm)],
      ["EMITTED", true, null, true]
    );
    roteiro = s.saudavel;
    const antes = sefaz.pedidos.length;
    await cron(t0, 4);
    confere("a rodada seguinte CONSULTA a chave (sem retransmitir: cada 204 conta para o 656) e efetiva a nota", [metodos(antes), doPedido(G.id).fiscalStatus, info(G.id).contingencia ?? null, info(G.id).nfceKey], [["nfeConsultaNF"], "EMITTED", null, k9]);
    confere("uma nota só autorizada para a venda", [...s.autorizadas].filter((k) => lerChave(k).numero === lerChave(k9).numero).length, 1);
    const r = await emissor.emitirNfceNaSefaz(corpoDeTeste(), ctxDeTeste({ transporte: sefazFalsa((p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-204.xml", p) : "timeout-depois")).transporte }));
    confere("na emissão: 204 com a consulta muda = 'processando' (204), nunca 'rejeitada'", !r.ok && [r.motivo, r.statusSefaz, r.talvezNaSefaz], ["processando", "204", true]);
    encerrar(L);
  });

  // ── 4. Lote assíncrono, 217 cedo e 539 da própria chave ─────────────────
  console.log("\n— 4. Lote assíncrono: o recibo primeiro; 217 só vale duas vezes; 539 da própria chave —");
  await caso(async () => {
    const L = novaLoja("loja-recibo");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    const fila: PedidoHttp[] = [];
    let k1 = "";
    roteiro = (p) => {
      const m = metodoDo(p);
      if (m === "nfeAutorizacaoLote") {
        fila.push(p);
        return responder("autorizacao-103.xml", p);
      }
      if (m === "nfeRetAutorizacaoLote") return fila.length ? responder("recibo-105.xml", p) : responder("recibo-104.xml", p, { CHAVE: k1, DIGVAL: "" });
      if (m === "nfeConsultaNF") return s.consultar(p); // a chave na fila dá 217
      return s.saudavel(p);
    };
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    k1 = String(info(G.id).envioSefaz?.chave);
    confere("103/105: processando, com o recibo (nRec) guardado no envio", [doPedido(G.id).fiscalStatus, info(G.id).processando, info(G.id).envioSefaz?.recibo], ["PENDING", true, "531000012345678"]);
    let antes = sefaz.pedidos.length;
    await cron(t0, 3);
    confere("+3 min: nada é consultado — 217 agora seria o lote ainda na fila", metodos(antes), []);
    antes = sefaz.pedidos.length;
    await cron(t0, 11);
    confere("+11 min: consulta o RECIBO (105) — a chave nem é consultada, e nada fica 'livre'", [metodos(antes), doPedido(G.id).fiscalStatus, info(G.id).envioSefaz?.chave], [["nfeRetAutorizacaoLote"], "PENDING", k1]);
    for (const p of fila.splice(0)) s.gravarSemResponder(p); // a fila anda: a nota é autorizada
    antes = sefaz.pedidos.length;
    await cron(t0, 22);
    confere("o recibo traz o protocolo: EMITTED com a PRIMEIRA chave, sem reenvio", [metodos(antes), doPedido(G.id).fiscalStatus, info(G.id).nfceKey], [["nfeRetAutorizacaoLote"], "EMITTED", k1]);
    confere("uma nota autorizada para a venda (antes: duas)", [...s.autorizadas].filter((k) => lerChave(k).numero === lerChave(k1).numero).length, 1);
    encerrar(L);
  });
  await caso(async () => {
    const L = novaLoja("loja-539", { sefaz: sefazDaNik({ contingenciaOffline: false }) });
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    let atrasada: PedidoHttp | null = null;
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" && !atrasada ? ((atrasada = p), "timeout-depois") : s.saudavel(p));
    const H = pedido(L);
    await auto.emitirNfceAutomatica(H.id);
    const k1 = String(info(H.id).envioSefaz?.chave);
    confere("sem resposta e sem contingência: FAILED com o envio a conferir", [doPedido(H.id).fiscalStatus, info(H.id).envioSefaz?.aConferir], ["FAILED", true]);
    irPara(t0, 11);
    await auto.emitirNfceAutomatica(H.id);
    confere("o primeiro 217 só é anotado", [doPedido(H.id).fiscalStatus, info(H.id).envioSefaz?.naoConsta?.length], ["FAILED", 1]);
    // O lote atrasado é processado bem na hora da reemissão com o mesmo número.
    irPara(t0, 22);
    roteiro = (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote" && atrasada) {
        s.gravarSemResponder(atrasada);
        atrasada = null;
      }
      return s.saudavel(p);
    };
    const antes = sefaz.pedidos.length;
    await auto.emitirNfceAutomatica(H.id);
    confere(
      "539 que aponta a chave de uma tentativa DESTE pedido: a nota é adotada (antes: número queimado e outra nota)",
      [doPedido(H.id).fiscalStatus, info(H.id).nfceKey, info(H.id).numerosQueimados ?? null],
      ["EMITTED", k1, null]
    );
    confere("o caminho: consulta (217), autorização (539), consulta (100) — e uma nota só", [metodos(antes), s.autorizadas.size], [["nfeConsultaNF", "nfeAutorizacaoLote", "nfeConsultaNF"], 1]);
    encerrar(L);
  });

  // ── 5. O envio que a retentativa abandonou ───────────────────────────────
  console.log("\n— 5. O envio sem desfecho que saiu da retentativa é reconciliado devagar —");
  await caso(async () => {
    const L = novaLoja("loja-abandonado");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    let instavel = true;
    const html = { status: 200, corpo: "<html><body>Servico temporariamente indisponivel</body></html>" };
    roteiro = (p) => {
      const m = metodoDo(p);
      if (m === "nfeAutorizacaoLote") {
        s.gravarSemResponder(p); // a SEFAZ autoriza...
        return instavel ? html : responder("autorizacao-100.xml", p); // ...e a resposta não se lê
      }
      if (m === "nfeConsultaNF") return instavel ? html : s.consultar(p);
      return s.saudavel(p);
    };
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const k1 = String(info(G.id).envioSefaz?.chave);
    confere("resposta ilegível: FAILED transitória com o envio a conferir", [doPedido(G.id).fiscalStatus, info(G.id).motivo, info(G.id).envioSefaz?.aConferir], ["FAILED", "erro_de_comunicacao", true]);
    let min = 0;
    for (let k = 0; k < 12 && !info(G.id).retentativaEncerrada; k++) {
      min += 2 * 2 ** k + 1;
      await cron(t0, min);
    }
    confere("a retentativa encerra com o envio ainda sem desfecho", [info(G.id).retentativaEncerrada, info(G.id).envioSefaz?.chave, info(G.id).envioSefaz?.aConferir], [true, k1, true]);
    instavel = false;
    const antes = sefaz.pedidos.length;
    for (let h = 1; h <= 5; h++) await cron(t0, min + h * 60);
    confere(
      "SEFAZ de volta: a reconciliação consulta a chave e a nota AUTORIZADA vira EMITTED (antes: nenhuma consulta, FAILED para sempre)",
      [contar(antes, "nfeConsultaNF"), doPedido(G.id).fiscalStatus, info(G.id).nfceKey],
      [1, "EMITTED", k1]
    );
    encerrar(L);
  });

  // ── 6. A marca de maior número ───────────────────────────────────────────
  console.log("\n— 6. A marca de maior número: a janela de 32 dias não repete número —");
  await caso(async () => {
    const L = novaLoja("loja-janela");
    const s = novaSefaz();
    roteiro = s.saudavel;
    loja.usarRelogioDeTeste(null);
    const t0 = Date.now();
    for (let d = 10; d >= 6; d--) await auto.emitirNfceAutomatica(pedido(L, { createdAt: new Date(t0 - d * DIA) }).id);
    confere("nº 1..5 nas vendas recentes", db.customerOrder.filter((o) => o.franchiseeId === L).map((o) => info(o.id).nfceNumber), [1, 2, 3, 4, 5]);
    const O = pedido(L, { createdAt: new Date(t0 - 31.5 * DIA) });
    await auto.emitirNfceDoPedidoPelaTela(doPedido(O.id) as any, semLoja, configDe(L));
    confere("a venda de 31,5 dias recebe o nº 6, e a marca sobe para 6", [info(O.id).nfceNumber, daLoja(L).fiscalConfig.sefaz.maiorNumero?.["2"]?.["7"]], [6, 6]);
    // Um dia depois a venda antiga saiu da janela; a SEFAZ está fora e a venda do dia sai em contingência.
    loja.usarRelogioDeTeste(() => new Date(t0 + DIA));
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : s.saudavel(p));
    const Q = pedido(L, { createdAt: new Date(t0 + DIA - 5 * MIN) });
    await auto.emitirNfceAutomatica(Q.id);
    confere("o cupom de contingência sai com o nº 7 (antes: 6 — o número da nota autorizada da venda antiga)", [info(Q.id).nfceNumber, info(Q.id).contingencia], [7, true]);
    loja.usarRelogioDeTeste(null);
    encerrar(L);
  });

  // ── 7. A contingência recusada, gerada de novo ───────────────────────────
  console.log("\n— 7. A contingência RECUSADA sai de novo com a mesma chave e a mesma data —");
  await caso(async () => {
    const L = novaLoja("loja-contingencia-recusada");
    const t0 = Date.now();
    irPara(t0, 0);
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : responder("status-107.xml", p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const k9 = String(info(G.id).nfceKey);
    const original = await lerDoCofre(info(G.id).xmlDaContingencia);
    const campo = (xml: string, nome: string) => new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(xml)?.[1] ?? null;
    // A transmissão é RECUSADA no protNFe desta chave: o cupom deixa de valer.
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-464.xml", p) : responder("status-107.xml", p));
    await cron(t0, 1);
    confere("recusa no protNFe desta chave: FAILED, o número volta para a nota corrigida", [doPedido(G.id).fiscalStatus, Boolean(info(G.id).contingenciaRecusadaEm), info(G.id).numeroReservado?.numero], ["FAILED", true, lerChave(k9).numero]);
    // A loja corrige e emite de novo — três horas depois.
    irPara(t0, 180);
    cupons.length = 0;
    let enviada = "";
    roteiro = (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote") {
        enviada = p.corpo;
        return responder("autorizacao-100.xml", p);
      }
      return responder("status-107.xml", p);
    };
    const r = await auto.emitirNfceDoPedidoPelaTela(doPedido(G.id) as any, semLoja, configDe(L));
    confere(
      "gerada de novo com a MESMA chave, tpEmis 9 e os MESMOS dhEmi, dhCont e xJust (Ajuste SINIEF 19/16, cl. 11ª § 1º III — antes: outra chave, tpEmis 1, data de agora)",
      [chaveDaNota({ corpo: enviada } as PedidoHttp), campo(enviada, "tpEmis"), campo(enviada, "dhEmi"), campo(enviada, "dhCont"), campo(enviada, "xJust"), campo(enviada, "cNF")],
      [k9, "9", campo(original, "dhEmi"), campo(original, "dhCont"), campo(original, "xJust"), campo(original, "cNF")]
    );
    confere("autorizada: EMITTED com a chave do cupom, sem a marca de contingência", [r.resultado.ok, doPedido(G.id).fiscalStatus, info(G.id).nfceKey, info(G.id).contingencia ?? null], [true, "EMITTED", k9, null]);
    confere("o DANFE é reimpresso, forçado", cupons.map((c) => [c.id, c.forcar]), [[G.id, true]]);
    encerrar(L);
  });

  // ── 8. Cancelamento com a resposta perdida ───────────────────────────────
  console.log("\n— 8. Cancelamento com a resposta perdida: o evento vem pela consulta —");
  await caso(async () => {
    const L = novaLoja("loja-cancelamento-tentado");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    // A tentada chega, é AUTORIZADA, e a resposta se perde.
    let foi = false;
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" && !foi ? ((foi = true), s.gravarSemResponder(p), "timeout-depois") : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const t = info(G.id).numeroTentado;
    roteiro = s.saudavel;
    await cron(t0, 1);
    // 11 min: o cancelamento da tentada é registrado e a resposta se perde.
    roteiro = (p) => (metodoDo(p) === "nfeRecepcaoEvento" ? (s.evento(p), "timeout-depois") : s.saudavel(p));
    await cron(t0, 11);
    const t1 = info(G.id).numeroTentado;
    confere("evento sem resposta: o tentado segue a conferir, JÁ com o ponteiro do nfeProc", [t1.situacao, Boolean(t1.xmlNoCofre?.caminho), s.canceladas.has(t.chave)], ["a_conferir", true, true]);
    roteiro = s.saudavel;
    await cron(t0, 22);
    const tf = info(G.id).numeroTentado;
    const anterior = (info(G.id).notasAnteriores ?? []).find((n: Linha) => n.nfceKey === t.chave);
    confere(
      "CANCELADA na consulta: 'cancelado', em notasAnteriores, com a nota e o evento no cofre (antes: sem registro e sem XML)",
      [tf.situacao, Boolean(anterior), Boolean(anterior?.xmlNoCofre?.caminho), Boolean(anterior?.xmlCancelamentoNoCofre?.caminho), anterior?.protocoloCancelamento],
      ["cancelado", true, true, true, "353260000000456"]
    );
    const proc = await lerDoCofre(anterior.xmlCancelamentoNoCofre);
    verdade("o procEventoNFe veio da consulta, e é o do 110112", proc.includes("<procEventoNFe") && proc.includes("<tpEvento>110112</tpEvento>"));
    paraValidar.push({ nome: "procEventoNFe (110112) recuperado pela consulta", xsd: "evento/cancsubst/procEventoCancSubst_v1.00.xsd", xml: proc });
    paraValidar.push({ nome: "nfeProc da tentada cancelada", xsd: "procNFe_v4.00.xsd", xml: await lerDoCofre(anterior.xmlNoCofre) });
    encerrar(L);
  });
  await caso(async () => {
    const L = novaLoja("loja-cancelamento-botao");
    const s = novaSefaz();
    loja.usarRelogioDeTeste(null);
    roteiro = s.saudavel;
    const A = pedido(L);
    await auto.emitirNfceAutomatica(A.id);
    roteiro = (p) => (metodoDo(p) === "nfeRecepcaoEvento" ? (s.evento(p), "timeout-depois") : s.saudavel(p));
    const c1 = await loja.cancelarNotaDoPedidoNaSefaz({ lojaId: L, config: configDe(L), pedido: doPedido(A.id), pedidosDaNota: [A.id], ambiente: 2, justificativa: "Cliente desistiu da compra no caixa" });
    confere(
      "resposta perdida: 'pode ter sido registrado — use Consultar situação' (antes: 'NÃO foi feito', e o 2º clique dava 573)",
      [c1.status, /PODE ter sido registrado/.test(String(c1.corpo.mensagem)), /Consultar situação/.test(String(c1.corpo.mensagem)), c1.corpo.podeTerSidoRegistrado],
      [502, true, true, true]
    );
    roteiro = s.saudavel;
    await auto.consultarNotaDoPedido(doPedido(A.id), L);
    const ia = info(A.id);
    confere("'Consultar situação' grava CANCELED com o evento que a consulta trouxe, no cofre", [doPedido(A.id).fiscalStatus, Boolean(ia.xmlCancelamentoNoCofre?.caminho), ia.protocoloCancelamento], ["CANCELED", true, "353260000000456"]);
    paraValidar.push({ nome: "procEventoNFe (110111) recuperado pelo Consultar situação", xsd: "evento/procEventoNFe_v1.00.xsd", xml: await lerDoCofre(ia.xmlCancelamentoNoCofre) });
    encerrar(L);
  });

  // ── 9. O aviso de cancelamento gravado durante a emissão ─────────────────
  console.log("\n— 9. O aviso 'pedido cancelado com NFC-e' gravado DURANTE a emissão não some —");
  await caso(async () => {
    const L = novaLoja("loja-aviso", { ambiente: 1 });
    const s = novaSefaz();
    loja.usarRelogioDeTeste(null);
    const G = pedido(L);
    let marcados = -1;
    roteiro = async (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote") {
        doPedido(G.id).status = "CANCELADO"; // o iFood cancela enquanto a nota está na SEFAZ
        marcados = await auto.alertarCancelamentoComNota({ id: G.id }, "iFood");
      }
      return s.saudavel(p);
    };
    await auto.emitirNfceAutomatica(G.id);
    confere("o aviso foi gravado no meio da transmissão", marcados, 1);
    confere("a nota saiu AUTORIZADA em produção para o pedido cancelado", [doPedido(G.id).fiscalStatus, info(G.id).ambiente], ["EMITTED", 1]);
    const alerta = info(G.id).alerta;
    confere("o aviso continua, com a origem e falando da nota que saiu (antes: sumia)", [alerta?.origem, /NFC-e autorizada nº/.test(String(alerta?.mensagem)), alerta?.nfceKey === info(G.id).nfceKey], ["iFood", true, true]);
    encerrar(L);
  });

  // ── 10. A reemissão de uma cancelada que caiu depois da reserva ──────────
  console.log("\n— 10. A reemissão de uma nota cancelada interrompida logo depois da reserva —");
  await caso(async () => {
    const L = novaLoja("loja-reemissao");
    const s = novaSefaz();
    loja.usarRelogioDeTeste(null);
    roteiro = s.saudavel;
    const A = pedido(L);
    await auto.emitirNfceAutomatica(A.id);
    const kA = String(info(A.id).nfceKey);
    await loja.cancelarNotaDoPedidoNaSefaz({ lojaId: L, config: configDe(L), pedido: doPedido(A.id), pedidosDaNota: [A.id], ambiente: 2, justificativa: "Cliente desistiu da compra no caixa" });
    confere("nota cancelada", doPedido(A.id).fiscalStatus, "CANCELED");
    let foto: Linha | null = null;
    estado.depoisDeMarcar = (ids, dados) => {
      if (ids.includes(A.id) && dados.numeroReservado && !foto) foto = { fiscalStatus: doPedido(A.id).fiscalStatus, fiscalInfo: structuredClone(doPedido(A.id).fiscalInfo) };
    };
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : s.saudavel(p)); // nada chega à SEFAZ
    await auto.emitirNfceDoPedidoPelaTela(doPedido(A.id) as any, semLoja, configDe(L));
    estado.depoisDeMarcar = null;
    Object.assign(doPedido(A.id), foto); // o processo caiu logo depois da reserva
    confere("depois da queda: PENDING/processando com o fiscalInfo da cancelada", [doPedido(A.id).fiscalStatus, info(A.id).processando, info(A.id).envioSefaz?.chave === kA], ["PENDING", true, true]);
    roteiro = s.saudavel;
    const t0 = Date.now();
    irPara(t0, 10);
    const consulta = await auto.consultarNotaDoPedido(doPedido(A.id), L);
    const i1 = info(A.id);
    confere(
      "'Consultar situação' reconhece a emissão interrompida (antes: 'não tem nota enviada', preso): falha transitória, a cancelada em notasAnteriores e a ref nova",
      [doPedido(A.id).fiscalStatus, i1.motivo, i1.nfceKey ?? null, (i1.notasAnteriores ?? []).map((n: Linha) => n.nfceKey), i1.idDaNota, /interrompida/.test(String((consulta.resultado as Linha)?.mensagem))],
      ["FAILED", "erro_de_comunicacao", null, [kA], `${A.id}-2`, true]
    );
    await cron(t0, 15);
    const i2 = info(A.id);
    confere("a retentativa do cron emite a nota nova, e a cancelada continua para o contador", [doPedido(A.id).fiscalStatus, Boolean(i2.nfceKey) && i2.nfceKey !== kA, (i2.notasAnteriores ?? []).map((n: Linha) => n.nfceKey), i2.idDaNota], ["EMITTED", true, [kA], `${A.id}-2`]);
    encerrar(L);
  });

  // ── 11. Ambiente do envio, contingência em curso, faixa da tela ──────────
  console.log("\n— 11. Envio de outro ambiente, contingência com emissão no ar, faixa da tela —");
  await caso(async () => {
    const L = novaLoja("loja-ambiente", { sefaz: sefazDaNik({ contingenciaOffline: false }) });
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    // Em homologação, a autorização chega (e é autorizada) e a resposta se perde.
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? (s.gravarSemResponder(p), "timeout-depois") : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const kh = String(info(G.id).envioSefaz?.chave);
    confere("homologação: FAILED com o envio a conferir", [doPedido(G.id).fiscalStatus, info(G.id).envioSefaz?.ambiente], ["FAILED", 2]);
    mudar(L, (c) => ({ ...c, ambiente: 1 })); // a loja passa para produção
    irPara(t0, 15);
    roteiro = s.saudavel;
    const antes = sefaz.pedidos.length;
    await auto.emitirNfceAutomatica(G.id);
    confere(
      "em produção, a nota de homologação NÃO é adotada: sai uma de produção, sem consultar a de teste",
      [doPedido(G.id).fiscalStatus, info(G.id).ambiente, info(G.id).nfceKey !== kh, metodos(antes), (info(G.id).enviosAnteriores ?? []).map((e: Linha) => e.chave).includes(kh)],
      ["EMITTED", 1, true, ["nfeAutorizacaoLote"], true]
    );
    encerrar(L);
  });
  await caso(async () => {
    const L = novaLoja("loja-em-curso");
    const t0 = Date.now();
    irPara(t0, 0);
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : responder("status-107.xml", p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    // Uma contingência cuja gravação caiu ("processando", com o XML) enquanto OUTRA emissão está no ar.
    const H = pedido(L, {
      fiscalInfo: {
        provedor: "sefaz", processando: true, ambiente: 2, xmlDaContingencia: info(G.id).xmlDaContingencia,
        numeroReservado: { serie: 7, numero: 99, ambiente: 2, em: em(t0, 0).toISOString(), emissaoEmCurso: em(t0, 0).toISOString() },
      },
    });
    roteiro = (p) => responder(metodoDo(p) === "nfeAutorizacaoLote" ? "autorizacao-100.xml" : "status-107.xml", p);
    const antes = sefaz.pedidos.length;
    await auto.sincronizarNota({ ids: [H.id], info: info(H.id), fiscalStatus: "PENDING", lojaId: L }, H.id, configDe(L));
    confere("contingência sem gravação com uma emissão EM CURSO: não transmite (antes: transmitia no meio da outra)", [metodos(antes), doPedido(H.id).fiscalStatus], [[], "PENDING"]);
    encerrar(L);
  });
  await caso(async () => {
    const L = novaLoja("loja-faixa");
    const s = novaSefaz();
    loja.usarRelogioDeTeste(null);
    roteiro = s.saudavel;
    for (let k = 0; k < 3; k++) await auto.emitirNfceAutomatica(pedido(L).id); // nº 1..3
    pedido(L, { fiscalStatus: "EMITTED", fiscalInfo: { provedor: "sefaz", nfceKey: "K5", nfceNumber: 5, serie: 7, ambiente: 2, emittedAt: new Date().toISOString() } });
    const antes = sefaz.pedidos.length;
    const acima = await inut.inutilizarFaixaNaSefaz({ lojaId: L, config: configDe(L), serie: 7, numeroInicial: 6, numeroFinal: 20, justificativa: "Numeracao pulada por falha do sistema", ambiente: 2, origem: "tela" });
    confere("faixa acima do maior número usado: recusada aqui, nada vai à SEFAZ (antes: pedida)", [acima.ok, !acima.ok && acima.motivo, sefaz.pedidos.length - antes], [false, "recusada_aqui", 0]);
    const dentro = await inut.inutilizarFaixaNaSefaz({ lojaId: L, config: configDe(L), serie: 7, numeroInicial: 4, numeroFinal: 4, justificativa: "Numeracao pulada por falha do sistema", ambiente: 2, origem: "tela" });
    confere("o buraco antes do maior: homologado, com o ambiente na resposta", [dentro.ok, dentro.ok && dentro.ambiente], [true, 2]);
    const rota = readFileSync(join(process.cwd(), "src", "app", "api", "store", "fiscal", "inutilizacao", "route.ts"), "utf8");
    verdade("a rota da inutilização aceita `ambiente` e devolve o ambiente usado", /ambientePedido/.test(rota) && /ambiente: r\.ambiente/.test(rota));
    encerrar(L);
  });

  // ── 12. cStat 120 ────────────────────────────────────────────────────────
  console.log("\n— 12. cStat 120: autorizada com alerta (NT 2026.002) —");
  await caso(async () => {
    const L = novaLoja("loja-alerta");
    loja.usarRelogioDeTeste(null);
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-120.xml", p) : responder("status-107.xml", p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const i = info(G.id);
    confere(
      "120 é AUTORIZADA (antes: recusada), e o alerta fica no fiscalInfo",
      [doPedido(G.id).fiscalStatus, i.alertaSefaz?.cStat, i.alertaSefaz?.mensagens?.[0]?.codigo, /inabilitado/.test(String(i.alertaSefaz?.mensagens?.[0]?.texto))],
      ["EMITTED", "120", "172", true]
    );
    const proc = await lerDoCofre(i.xmlNoCofre);
    verdade("o nfeProc guardado leva o protNFe com o alerta (o DANFE lê de lá)", proc.includes("<cStat>120</cStat>") && proc.includes("<xMsg>"));
    paraValidar.push({ nome: "nfeProc autorizado com alerta (120)", xsd: "procNFe_v4.00.xsd", xml: proc });
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-antes" : responder("status-107.xml", p));
    const C = pedido(L);
    await auto.emitirNfceAutomatica(C.id);
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-120.xml", p) : responder("status-107.xml", p));
    await auto.retentarNotasFiscais({ orcamentoMs: 120_000 });
    confere("contingência transmitida com 120: efetivada, com o alerta", [doPedido(C.id).fiscalStatus, info(C.id).contingencia ?? null, info(C.id).alertaSefaz?.cStat], ["EMITTED", null, "120"]);
    const r = await emissor.consultarNaSefaz(String(i.nfceKey), { certificado: certificadoDeTeste(), uf: "DF", ambiente: 2, transporte: sefazFalsa((p) => responder("consulta-120.xml", p, { DIGVAL: "" })).transporte });
    confere("consulta com 120: autorizada, com o alerta", [r.ok, r.ok && r.alertaSefaz?.cStat], [true, "120"]);
    encerrar(L);
  });

  // ── 13. Cancelamento por substituição ────────────────────────────────────
  console.log("\n— 13. Tentada autorizada: cancelamento POR SUBSTITUIÇÃO (110112) até 168 h —");
  await caso(async () => {
    const L = novaLoja("loja-110112");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    let foi = false;
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" && !foi ? ((foi = true), s.gravarSemResponder(p), "timeout-depois") : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    const t = info(G.id).numeroTentado;
    roteiro = s.saudavel;
    await cron(t0, 1);
    const antes = sefaz.pedidos.length;
    await cron(t0, 11);
    const ev = sefaz.pedidos.slice(antes).find((p) => metodoDo(p) === "nfeRecepcaoEvento");
    const msg = ev ? mensagemDoEnvelope(ev.corpo) : null;
    const de = (n: string) => (msg ? primeiro(msg, n)?.textContent ?? null : null);
    confere(
      "o evento é o 110112 (e não o 110111), com os campos do leiaute",
      [de("tpEvento"), de("descEvento"), de("cOrgaoAutor"), de("tpAutor"), de("verAplic"), de("nProt"), de("chNFe"), de("chNFeRef")],
      ["110112", "Cancelamento por substituicao", "53", "1", "FireHub NFC-e 1.0", "353260000000123", t.chave, info(G.id).nfceKey]
    );
    confere("…com o Id ID110112 + chave + 01", msg ? primeiro(msg, "infEvento")?.getAttribute("Id") : null, `ID110112${t.chave}01`);
    if (msg) paraValidar.push({ nome: "envEvento 110112 (e110112_v1.00)", xsd: "evento/cancsubst/envEventoCancSubst_v1.00.xsd", xml: serializar(msg) });
    confere("o tentado fica 'cancelado'", info(G.id).numeroTentado?.situacao, "cancelado");
    encerrar(L);
  });
  await caso(async () => {
    const L = novaLoja("loja-110112-prazo");
    const s = novaSefaz();
    const t0 = Date.now();
    irPara(t0, 0);
    let foi = false;
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" && !foi ? ((foi = true), s.gravarSemResponder(p), "timeout-depois") : s.saudavel(p));
    const G = pedido(L);
    await auto.emitirNfceAutomatica(G.id);
    roteiro = s.saudavel;
    await cron(t0, 1);
    const antes = sefaz.pedidos.length;
    await cron(t0, 169 * 60);
    const tf = info(G.id).numeroTentado;
    confere(
      "depois de 168 h: nenhum evento — 'autorizado' para uma pessoa, com a orientação (cl. 15ª-A § 6º)",
      [contar(antes, "nfeRecepcaoEvento"), tf.situacao, tf.paraPessoa, /168 h/.test(String(tf.orientacao))],
      [0, "autorizado", true, true]
    );
    encerrar(L);
  });

  // ── 14. Loja sem fiscal ──────────────────────────────────────────────────
  console.log("\n— 14. Loja sem emissão: uma leitura e nada mais —");
  await caso(async () => {
    const L = "loja-sem-fiscal";
    db.user.push({ id: L, fiscalConfig: null });
    const p1 = pedido(L);
    const p2 = pedido(L);
    estado.chamadas.length = 0;
    await auto.emitirNfceDosPedidos({ id: { in: [p1.id, p2.id] } });
    confere("emitirNfceDosPedidos numa loja sem fiscal: 1 leitura e zero pedidos (antes: 1 + 2 por pedido)", estado.chamadas, ["customerOrder.findMany"]);
    db.tableSession.push({ id: "S-sem-fiscal", franchiseeId: L, status: "CLOSED", closedAt: new Date(), customerName: "Mesa 1", serviceFee: 0, waiterTip: 0, paymentMethods: [{ method: "Pix", amount: 15.6 }] });
    pedido(L, { tableSessionId: "S-sem-fiscal", deliveryType: "MESA" });
    estado.chamadas.length = 0;
    const r = await auto.emitirNfceDaMesa("S-sem-fiscal");
    confere(
      "a conta da mesa numa loja sem fiscal não carrega os pedidos nem os itens (antes: a sessão inteira primeiro)",
      [r.motivo, estado.chamadas],
      ["emissão desligada nesta loja", ["tableSession.findUnique", "user.findUnique"]]
    );
  });

  // ── 15. O relógio da rodada e a concessão ────────────────────────────────
  console.log("\n— 15. A varredura respeita o relógio, e duas rodadas não pegam a mesma loja —");
  await caso(async () => {
    const L = novaLoja("loja-cron");
    const s = novaSefaz();
    loja.usarRelogioDeTeste(null);
    roteiro = s.saudavel;
    const esquecidos = [pedido(L, { createdAt: haMin(10) }), pedido(L, { createdAt: haMin(10) })];
    const antes = sefaz.pedidos.length;
    const n = await auto.emitirNotasEsquecidas({ franchiseeId: L, acabou: () => true });
    confere("a varredura dos esquecidos para quando o relógio da rodada acaba (antes: emitia tudo)", [n, sefaz.pedidos.length - antes], [0, 0]);
    // Duas rodadas ao mesmo tempo (a anterior ainda esperando a SEFAZ).
    roteiro = async (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote") await new Promise((r) => setTimeout(r, 300));
      return s.saudavel(p);
    };
    const [r1, r2] = await Promise.all([auto.retentarNotasFiscais({ orcamentoMs: 120_000 }), auto.retentarNotasFiscais({ orcamentoMs: 120_000 })]);
    confere("a segunda rodada pula a loja que a primeira está trabalhando (a concessão)", [r1.lojasEmOutraRodada ?? 0, r2.lojasEmOutraRodada ?? 0].sort(), [0, 1]);
    confere(
      "…os esquecidos saíram uma vez cada, e a concessão foi solta",
      [esquecidos.map((o) => doPedido(o.id).fiscalStatus), contar(antes, "nfeAutorizacaoLote"), daLoja(L).fiscalConfig.rodadaFiscal ?? null],
      [["EMITTED", "EMITTED"], 2, null]
    );
    const runner = readFileSync(join(process.cwd(), "scripts", "cron-runner.js"), "utf8");
    verdade("o cron-runner não sobrepõe a rodada fiscal (exclusivo)", /name: 'fiscal-retentativa',[\s\S]*?exclusivo: true/.test(runner));
    encerrar(L);
  });

  // ── Os XML contra o XSD oficial ──────────────────────────────────────────
  console.log(`\n— ${paraValidar.length} documentos contra os schemas oficiais —`);
  const resultados = validarNoXsd(paraValidar.map((p) => ({ xsd: p.xsd, xml: p.xml })));
  resultados.forEach((r, i) => verdade(`XSD: ${paraValidar[i].nome} (${paraValidar[i].xsd})`, r.ok, r.erros.join(" | ")));
}

main()
  .then(() => {
    rmSync(COFRE, { recursive: true, force: true });
    terminar();
  })
  .catch((e) => {
    console.error("❌ exceção:", e);
    rmSync(COFRE, { recursive: true, force: true });
    process.exit(1);
  });
