/**
 * O emissor próprio de NFC-e LIGADO AO SISTEMA — emissão, numeração, cofre,
 * contingência, cancelamento, inutilização, teste de conexão e pacote do
 * contador — rodando de verdade (lib/fiscal-automatico → lib/fiscal-emissao →
 * lib/nfce/emissao-da-loja → lib/nfce/emissor) contra:
 *
 *  - um BANCO FALSO em memória (o `globalThis.prisma` que lib/prisma usa),
 *    com a transação interativa, a trava pg_advisory_xact_lock simulada e o
 *    SQL cru da numeração interpretado pela MESMA leitura de referência
 *    (lib/nfce/numeracao → numerosDoFiscalInfo) — o SQL em si é conferido
 *    contra um Postgres de verdade, só lendo, por
 *    scripts/nfce-conferir-sql-da-numeracao.ts;
 *  - a SEFAZ FALSA das fixtures (scripts/fixtures/nfce-sefaz);
 *  - um cofre em pasta temporária (FH_FISCAL_DIR) com o certificado de TESTE.
 *
 * Nada vai ao banco de verdade, nem à SEFAZ.
 *
 *   npx tsx scripts/teste-nfce-integracao.ts
 */
export {};

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_NIK,
  FIXTURES,
  bancoFalso,
  type Linha,
  SENHA_DO_CERTIFICADO,
  confere,
  mensagemDoEnvelope,
  metodoDo,
  responder,
  sefazFalsa,
  terminar,
  validarNoXsd,
  verdade,
} from "./nfce-teste-apoio";
import type { PedidoHttp, RespostaHttp } from "../src/lib/nfce/sefaz";
import { serializar } from "../src/lib/nfce/xml";

process.env.FISCAL_CHAVE = "chave-de-teste-da-integracao-nfce";
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
const COFRE = mkdtempSync(join(tmpdir(), "fh-cofre-nfce-"));
process.env.FH_FISCAL_DIR = COFRE;
for (const k of ["FH_RESP_TEC_CNPJ", "FH_RESP_TEC_NOME", "FH_RESP_TEC_EMAIL", "FH_RESP_TEC_FONE"]) delete process.env[k];

// ── Banco falso (scripts/nfce-teste-apoio → bancoFalso) ──────────────────────
// O `globalThis.prisma` em memória, com a trava e o SQL cru da numeração.
const { db, estado, objetoDe } = bancoFalso();
/** Um pedido do banco falso, com o que as funções de verdade exigem. */
type PedidoDoBancoFalso = Linha & { id: string; fiscalStatus: string | null; fiscalInfo: unknown };
const sqlVistos = estado.sqlVistos;

// ── SEFAZ falsa (a do apoio), com o roteiro trocável por cenário ─────────────
type Resposta = RespostaHttp | "timeout-antes" | "timeout-depois";
let roteiro: (p: PedidoHttp) => Resposta = () => ({ status: 500, corpo: "" });
const sefaz = sefazFalsa((p) => roteiro(p));
const metodos = (desde: number) => sefaz.pedidos.slice(desde).map(metodoDo);
/** Resposta padrão de uma SEFAZ saudável, por serviço. */
const saudavel = (p: PedidoHttp): Resposta => {
  const m = metodoDo(p);
  if (m === "nfeAutorizacaoLote") return responder("autorizacao-100.xml", p);
  if (m === "nfeConsultaNF") return responder("consulta-100.xml", p, { DIGVAL: "" });
  if (m === "nfeRecepcaoEvento") return responder(p.corpo.includes("<tpEvento>110112</tpEvento>") ? "evento-135-substituicao.xml" : "evento-135.xml", p);
  if (m === "nfeInutilizacaoNF") return responder("inutilizacao-102.xml", p);
  if (m === "nfeStatusServicoNF") return responder("status-107.xml", p);
  return { status: 500, corpo: "" };
};

// ── Cenário ──────────────────────────────────────────────────────────────────
const LOJA = "loja-nik";
const agoraReal = () => new Date();
const haMin = (min: number) => new Date(Date.now() - min * 60_000);
const produto = { id: "esf", name: "Esfiha de carne", ncm: "21069090", cfop: "5102", csosn: "102", origem: "0" };
let seq = 0;
function pedido(p: Partial<Linha>): Linha {
  const n = ++seq;
  const o: Linha = {
    id: `p${n}`, franchiseeId: LOJA, dailyOrderNumber: n, status: "ENTREGUE", deliveryType: "RETIRADA", tableSessionId: null,
    paymentMethod: "Pix", paymentMethods: null, gatewayPaymentId: null, totalAmount: 15.6, customerCpfCnpj: null,
    customerName: "Cliente", customerAddress: null, source: "BALCAO", fiscalStatus: "PENDING", fiscalInfo: null,
    // 3 horas atrás: fora da varredura dos esquecidos (2 h) — cada cenário emite o seu.
    createdAt: haMin(180),
    items: [{ id: `i${n}`, productName: "Esfiha de carne", quantity: 4, price: 3.9, menuProduct: produto }],
    ...p,
  };
  o.updatedAt ??= o.createdAt;
  db.customerOrder.push(o);
  return o;
}
const doPedido = (id: string) => db.customerOrder.find((o) => o.id === id)! as PedidoDoBancoFalso;
const info = (id: string) => objetoDe(doPedido(id).fiscalInfo);
const paraValidar: Array<{ nome: string; xsd: string; xml: string }> = [];

async function main() {
  const numeracao = await import("../src/lib/nfce/numeracao");
  const { guardarArquivoFiscal, lerXmlFiscal, raizDoCofre } = await import("../src/lib/nfce/armazenamento");
  const { cifrar } = await import("../src/lib/fiscal-credenciais");
  const { carregarCertificado } = await import("../src/lib/nfce/assinatura");
  const { lerChave } = await import("../src/lib/nfce/chave");
  const { pendenciasParaEmitir } = await import("../src/lib/fiscal-emissao");
  const { normalizarConfigFiscal } = await import("../src/lib/fiscal-config");
  const loja = await import("../src/lib/nfce/emissao-da-loja");
  const credenciais = await import("../src/lib/nfce/credenciais-da-loja");
  const { inutilizarBuracosDoMes, inutilizarFaixaNaSefaz, mesDaLoja } = await import("../src/lib/nfce/inutilizacao-da-loja");
  const auto = await import("../src/lib/fiscal-automatico");
  const { montarPacoteDoContador } = await import("../src/lib/contador-pacote");
  loja.usarTransporteDeTeste(sefaz.transporte);
  const cupons: string[] = [];
  auto.usarImpressoraDeTeste((id) => cupons.push(id));

  // O certificado de TESTE (CNPJ da NIK) guardado no cofre, como a tela guarda.
  const pfx = readFileSync(join(FIXTURES, "nfce-certificado-teste.pfx"));
  const cert = carregarCertificado(pfx, SENHA_DO_CERTIFICADO);
  const noCofre = await guardarArquivoFiscal({ lojaId: LOJA, tipo: "certificado", identificacao: "a1", conteudo: pfx });
  const certificadoDaLoja = {
    arquivo: noCofre.caminho, sha256: noCofre.sha256, senhaCifrada: cifrar(SENHA_DO_CERTIFICADO)!, cnpj: cert.cnpj!,
    titular: cert.titular, validoDe: cert.validoDe.toISOString(), validoAte: cert.validoAte.toISOString(), enviadoEm: new Date().toISOString(),
  };
  const CSC = "0123456789ABCDEF0123456789ABCDEF";
  const cscDe = (id: string) => ({ id, cifrado: cifrar(CSC)!, final: CSC.slice(-4) });
  const configDaNik = (extra: Linha = {}): Linha => ({
    ...CONFIG_NIK,
    tokenDoProvedor: null,
    cscId: null,
    csc: null,
    temCertificado: false,
    provedor: "sefaz",
    enabled: true,
    ambiente: 2,
    inscricaoEstadual: "0712345600123",
    autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"],
    momentoDaEmissao: "saida",
    sefaz: { certificado: certificadoDaLoja, csc: { homologacao: cscDe("1"), producao: cscDe("2") }, serie: 7, numeroInicial: 1, qrVersao: 2 },
    ...extra,
  });
  db.user.push({ id: LOJA, ifoodMerchantId: null, food99MerchantId: null, storeName: "Nik Esfiharia", name: "Nik", fiscalConfig: configDaNik() });
  const configAtual = () => normalizarConfigFiscal(db.user.find((u) => u.id === LOJA)!.fiscalConfig) as Linha;
  const mudarConfig = (f: (c: Linha) => Linha) => {
    const u = db.user.find((x) => x.id === LOJA)!;
    u.fiscalConfig = f(u.fiscalConfig);
  };

  // ── 1. Pendências do emissor próprio ─────────────────────────────────────
  console.log("\n— Pendências (provedor sefaz) —");
  {
    const campos = (c: Linha) => pendenciasParaEmitir(normalizarConfigFiscal(c) as any).map((p) => p.campo);
    confere("cadastro completo: nenhuma pendência (token da Focus não se aplica)", campos(configDaNik()), []);
    confere("sem certificado: pendência de certificado", campos(configDaNik({ sefaz: { ...configDaNik().sefaz, certificado: null } })), ["certificado"]);
    const outro = campos(configDaNik({ cnpj: "11.222.333/0001-81" }));
    verdade("certificado de OUTRO CNPJ: pendência que cita a 213", outro.includes("certificado") && pendenciasParaEmitir(normalizarConfigFiscal(configDaNik({ cnpj: "11.222.333/0001-81" })) as any).some((p) => /213/.test(p.mensagem)), outro.join(","));
    const vencido = pendenciasParaEmitir(normalizarConfigFiscal(configDaNik({ sefaz: { ...configDaNik().sefaz, certificado: { ...certificadoDaLoja, validoAte: "2026-01-01T00:00:00.000Z" } } })) as any);
    verdade("certificado vencido: pendência 'venceu'", vencido.some((p) => p.campo === "certificado" && /venceu/.test(p.mensagem)));
    confere("produção sem CSC de produção: pendências do CSC (o de homologação não vale)", campos(configDaNik({ ambiente: 1, sefaz: { ...configDaNik().sefaz, csc: { homologacao: cscDe("1") } } })), ["cscId", "csc"]);
    confere("QR Code v3: sem CSC e sem pendência", campos(configDaNik({ ambiente: 1, sefaz: { ...configDaNik().sefaz, csc: null, qrVersao: 3 } })), []);
    confere("UF que o emissor ainda não atende (SP): pendência de UF", campos(configDaNik({ uf: "SP", codigoMunicipio: "3550308", inscricaoEstadual: "110042490114" })), ["uf"]);
    confere("CRT 3 continua bloqueado", campos(configDaNik({ regimeTributario: 3 })), ["regimeTributario"]);
  }

  // ── 2. Credenciais da loja ───────────────────────────────────────────────
  console.log("\n— Credenciais (cofre + senha e CSC cifrados) —");
  {
    const ctx = await credenciais.contextoDaLoja(configAtual() as any);
    const c = ctx.certificado as any;
    confere("contexto: certificado da NIK aberto do cofre, DF, homologação, série 7 do bloco", [c.cnpj, ctx.uf, ctx.ambiente, ctx.serie], ["64568087000180", "DF", 2, 7]);
    confere("QR v2 com o CSC de HOMOLOGAÇÃO decifrado", ctx.qrCode, { versao: 2, idCsc: "1", csc: CSC });
    const prod = await credenciais.contextoDaLoja(configAtual() as any, { ambiente: 1 });
    confere("em produção, o CSC de produção (id 2)", (prod.qrCode as any).idCsc, "2");
    credenciais.esquecerCertificados();
    let erro: any = null;
    try {
      await credenciais.certificadoDaLoja(configDaNik({ sefaz: { ...configDaNik().sefaz, certificado: { ...certificadoDaLoja, sha256: "0".repeat(64) } } }));
    } catch (e) {
      erro = e;
    }
    verdade("arquivo que não confere com o SHA-256: FaltaNoEmissor (certificado)", erro instanceof credenciais.FaltaNoEmissor && erro.pendencias[0].campo === "certificado", String(erro?.message));
    erro = null;
    try {
      await credenciais.certificadoDaLoja(configDaNik({ sefaz: { ...configDaNik().sefaz, certificado: { ...certificadoDaLoja, senhaCifrada: "fh1:AAAA.BBBB.CCCC" } } }));
    } catch (e) {
      erro = e;
    }
    verdade("senha que não abre com a FISCAL_CHAVE: FaltaNoEmissor com a frase certa", erro instanceof credenciais.FaltaNoEmissor && /FISCAL_CHAVE/.test(erro.message), String(erro?.message));
    confere("responsável técnico: nenhum → null; os quatro → grupo", [
      credenciais.responsavelTecnico({}),
      credenciais.responsavelTecnico({ FH_RESP_TEC_CNPJ: "11.222.333/0001-81", FH_RESP_TEC_NOME: "FireHub", FH_RESP_TEC_EMAIL: "fiscal@firehub.com.br", FH_RESP_TEC_FONE: "(61) 99999-0000" }),
    ], [null, { cnpj: "11222333000181", contato: "FireHub", email: "fiscal@firehub.com.br", telefone: "61999990000" }]);
    confere("responsável técnico incompleto: não vai (o schema pede os quatro)", credenciais.responsavelTecnico({ FH_RESP_TEC_CNPJ: "11222333000181" }), null);
  }

  // ── 3. Balcão autorizado, XML no cofre ───────────────────────────────────
  console.log("\n— Balcão: autorizada, nfeProc no cofre —");
  const A = pedido({});
  {
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    const r = await auto.emitirNfceAutomatica(A.id);
    const i = info(A.id);
    confere("emitida: EMITTED, número 1 da série 7, homologação, provedor sefaz", [r.acao, doPedido(A.id).fiscalStatus, i.nfceNumber, i.serie, i.ambiente, i.provedor], ["emitida", "EMITTED", 1, 7, 2, "sefaz"]);
    confere("uma chamada só, de autorização", metodos(antes), ["nfeAutorizacaoLote"]);
    verdade("chave de 44 sem o prefixo NFe, tpEmis 1, série 7, nº 1", /^\d{44}$/.test(i.nfceKey) && lerChave(i.nfceKey).tipoDeEmissao === 1 && lerChave(i.nfceKey).serie === 7 && lerChave(i.nfceKey).numero === 1, i.nfceKey);
    confere("protocolo e o que a tela já lê", [i.protocol, i.xmlUrl, i.pdfUrl, i.emitidaAutomaticamente], ["353260000000123", null, null, true]);
    verdade("QR Code e URL de consulta do DF gravados", String(i.qrCode).startsWith(`http://www.fazenda.df.gov.br/nfce/qrcode?p=${i.nfceKey}|2|2|1|`) && i.urlConsulta === "www.fazenda.df.gov.br/nfce/consulta", `${i.qrCode} ${i.urlConsulta}`);
    confere("a reserva saiu (o número agora é da nota) e nada ficou processando", [i.numeroReservado ?? null, i.processando ?? null], [null, null]);
    const xml = await lerXmlFiscal(i.xmlNoCofre.caminho, i.xmlNoCofre.sha256);
    verdade("xmlNoCofre é o nfeProc (NFe + protNFe com o protocolo)", xml.includes("<nfeProc") && xml.includes("<nProt>353260000000123</nProt>") && xml.includes(`Id="NFe${i.nfceKey}"`));
    confere("xmlNoCofre.tipo = nota (o contrato do DANFE)", i.xmlNoCofre.tipo, "nota");
    const bruto = readFileSync(join(raizDoCofre(), i.xmlNoCofre.caminho));
    verdade("no disco, CIFRADO (FHC2 + id da chave) e sem a chave no nome", bruto.subarray(0, 4).toString() === "FHC2" && !bruto.includes("nfeProc") && !i.xmlNoCofre.caminho.includes(i.nfceKey), i.xmlNoCofre.caminho);
    confere("o envio que saiu fica registrado (mesma chave)", i.envioSefaz?.chave, i.nfceKey);
    confere("o cupom fiscal foi para a impressão, uma vez", cupons.filter((c) => c === A.id).length, 1);
    paraValidar.push({ nome: "nfeProc do balcão", xsd: "procNFe_v4.00.xsd", xml });
  }

  // ── 4. Rejeição e retry com o MESMO número ──────────────────────────────
  console.log("\n— Rejeitada: a reserva fica, e o retry usa o mesmo número —");
  const B = pedido({});
  const C = pedido({});
  {
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-464.xml", p) : saudavel(p));
    const rb = await auto.emitirNfceAutomatica(B.id);
    const ib = info(B.id);
    confere("rejeição 464: FAILED, cStat e o que fazer gravados", [rb.acao, doPedido(B.id).fiscalStatus, ib.motivo, ib.cStat, /CSC/.test(String(ib.oQueFazer))], ["falhou", "FAILED", "rejeitada", "464", true]);
    confere("a reserva do nº 2 ficou (sem a marca de emissão em curso) e o envio saiu", [ib.numeroReservado?.numero, ib.numeroReservado?.emissaoEmCurso ?? null, ib.envioSefaz ?? null], [2, null, null]);
    verdade("a mensagem diz o motivo da SEFAZ", /\[464\]/.test(String(ib.ultimoErro)), String(ib.ultimoErro));
    roteiro = saudavel;
    await auto.emitirNfceAutomatica(C.id);
    confere("outro pedido no meio pega o 3 (o 2 é do pedido rejeitado)", info(C.id).nfceNumber, 3);
    await auto.emitirNfceAutomatica(B.id);
    confere("retry do rejeitado: autorizada com o MESMO nº 2", [doPedido(B.id).fiscalStatus, info(B.id).nfceNumber, info(B.id).numeroReservado ?? null], ["EMITTED", 2, null]);
    verdade("…e o cStat/oQueFazer velhos não ficaram na nota autorizada", info(B.id).cStat == null && info(B.id).oQueFazer == null);
  }

  // ── 5. Concorrência: a trava ─────────────────────────────────────────────
  console.log("\n— Duas emissões ao mesmo tempo —");
  {
    roteiro = saudavel;
    const D = pedido({});
    const E = pedido({});
    const esperasAntes = estado.esperasNaTrava;
    await Promise.all([auto.emitirNfceAutomatica(D.id), auto.emitirNfceAutomatica(E.id)]);
    const nums = [info(D.id).nfceNumber, info(E.id).nfceNumber].sort();
    confere("dois pedidos juntos: números diferentes (4 e 5), os dois autorizados", [nums, doPedido(D.id).fiscalStatus, doPedido(E.id).fiscalStatus], [[4, 5], "EMITTED", "EMITTED"]);
    verdade("a segunda reserva ESPEROU a trava", estado.esperasNaTrava > esperasAntes);

    // Mutante: sem a trava, as duas leem o mesmo "maior" — é o defeito que ela evita.
    const X = pedido({ franchiseeId: "loja-mutante" });
    const Y = pedido({ franchiseeId: "loja-mutante" });
    db.user.push({ id: "loja-mutante", fiscalConfig: {} });
    estado.travaLigada = false;
    const [rx, ry] = await Promise.all([
      numeracao.reservarNumero({ lojaId: "loja-mutante", pedidos: [X.id], serie: 1, ambiente: 2 }),
      numeracao.reservarNumero({ lojaId: "loja-mutante", pedidos: [Y.id], serie: 1, ambiente: 2 }),
    ]);
    estado.travaLigada = true;
    confere("MUTANTE sem a trava: as duas reservas pegam o MESMO número", [rx.ok && rx.numero, ry.ok && ry.numero], [1, 1]);
    const [rx2, ry2] = await Promise.all([
      numeracao.reservarNumero({ lojaId: "loja-mutante", pedidos: [pedido({ franchiseeId: "loja-mutante" }).id], serie: 1, ambiente: 2 }),
      numeracao.reservarNumero({ lojaId: "loja-mutante", pedidos: [pedido({ franchiseeId: "loja-mutante" }).id], serie: 1, ambiente: 2 }),
    ]);
    confere("com a trava, de novo: 2 e 3", [rx2.ok && rx2.numero, ry2.ok && ry2.numero].sort(), [2, 3]);

    // Duplo toque no MESMO pedido: uma transmissão só.
    const F = pedido({});
    const antes = sefaz.pedidos.length;
    const [r1, r2] = await Promise.all([auto.emitirNfceAutomatica(F.id), auto.emitirNfceAutomatica(F.id)]);
    confere("duplo toque no mesmo pedido: UMA autorização na SEFAZ", metodos(antes), ["nfeAutorizacaoLote"]);
    confere("…uma emitida, a outra recusada por 'em curso' sem gravar por cima", [[r1.acao, r2.acao].sort(), doPedido(F.id).fiscalStatus, info(F.id).nfceNumber], [["emitida", "processando"], "EMITTED", 6]);
    confere("ambiente é numeração própria: a 1ª reserva de PRODUÇÃO desta loja é o nº 1", await (async () => {
      const r = await numeracao.reservarNumero({ lojaId: LOJA, pedidos: [pedido({ status: "PREPARANDO" }).id], serie: 7, ambiente: 1 });
      return r.ok && r.numero;
    })(), 1);
  }

  // ── 6. Contingência off-line e a transmissão depois ─────────────────────
  console.log("\n— Contingência: sem resposta da SEFAZ, cupom off-line, transmissão pelo cron —");
  const G = pedido({});
  let chaveG = "";
  let tentadoG: Linha = {};
  {
    let jaFoi = false;
    roteiro = (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote" && !jaFoi) {
        jaFoi = true;
        return "timeout-depois"; // saiu e não voltou: o nº pode estar autorizado
      }
      return saudavel(p);
    };
    const antesDoCupom = cupons.length;
    const r = await auto.emitirNfceAutomatica(G.id);
    const i = info(G.id);
    chaveG = i.nfceKey;
    tentadoG = i.numeroTentado;
    confere("contingência: EMITTED com a marca, tpEmis 9", [r.acao, doPedido(G.id).fiscalStatus, i.contingencia, lerChave(i.nfceKey).tipoDeEmissao], ["emitida", "EMITTED", true, 9]);
    confere("o nº tentado (7) não foi para a contingência: ela saiu com o 8, reservado na hora", [i.numeroTentado?.numero, i.numeroTentado?.situacao, i.nfceNumber, i.numeroDeContingencia?.numero], [7, "a_conferir", 8, 8]);
    verdade("o tentado guarda a chave e o XML assinado dele (para conferir depois)", /^\d{44}$/.test(String(i.numeroTentado?.chave)) && Boolean(i.numeroTentado?.xml?.caminho));
    const xmlCont = await lerXmlFiscal(i.xmlDaContingencia.caminho, i.xmlDaContingencia.sha256);
    verdade("a NFe off-line assinada está no cofre (tipo contingencia) e é o xmlNoCofre do DANFE", xmlCont.includes("<tpEmis>9</tpEmis>") && i.xmlNoCofre?.tipo === "contingencia" && i.xmlNoCofre.caminho === i.xmlDaContingencia.caminho);
    verdade("prazo de transmissão gravado (fim do 1º dia útil seguinte)", Number.isFinite(Date.parse(i.contingenciaPrazo)) && Date.parse(i.contingenciaPrazo) > Date.now());
    confere("o cupom de contingência vai para a impressão", cupons.length - antesDoCupom, 1);
    paraValidar.push({ nome: "NFe de contingência", xsd: "nfe_v4.00.xsd", xml: xmlCont });

    // O cron: a SEFAZ voltou.
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    const cuponsAntes = cupons.length;
    await auto.retentarNotasFiscais({ orcamentoMs: 60_000 });
    const depois = info(G.id);
    confere("o cron TRANSMITIU a contingência: autorizada, marca apagada, efetivada", [doPedido(G.id).fiscalStatus, depois.contingencia ?? null, Boolean(depois.contingenciaEfetivadaEm), depois.protocol], ["EMITTED", null, true, "353260000000123"]);
    const enviada = sefaz.pedidos.slice(antes).find((p) => metodoDo(p) === "nfeAutorizacaoLote");
    verdade("foi a MESMA NFe guardada (mesma chave, byte a byte)", Boolean(enviada && enviada.corpo.includes(xmlCont.replace(/^<\?xml[^>]*\?>/, ""))) && depois.nfceKey === chaveG);
    const proc = await lerXmlFiscal(depois.xmlNoCofre.caminho, depois.xmlNoCofre.sha256);
    verdade("agora xmlNoCofre é o nfeProc (tipo nota); a contingência continua guardada", proc.includes("<nfeProc") && depois.xmlNoCofre.tipo === "nota" && Boolean(depois.xmlDaContingencia?.caminho));
    confere("a efetivação não reimprime o cupom", cupons.length - cuponsAntes, 0);
    confere("o número tentado continua a conferir (a espera de 10 min ainda não passou)", depois.numeroTentado?.situacao, "a_conferir");
    paraValidar.push({ nome: "nfeProc da contingência transmitida", xsd: "procNFe_v4.00.xsd", xml: proc });
  }

  // ── 6b. O número tentado: não chegou → inutiliza; autorizado → cancela ───
  console.log("\n— Número tentado —");
  {
    // G: a SEFAZ não tem a tentada (217) → inutiliza o nº 7.
    roteiro = (p) => (metodoDo(p) === "nfeConsultaNF" ? responder("consulta-217.xml", p) : saudavel(p));
    const antes = sefaz.pedidos.length;
    const r = await auto.retentarNotasFiscais({ orcamentoMs: 60_000, agora: new Date(Date.now() + 11 * 60_000) });
    const i = info(G.id);
    confere("217: o nº 7 foi INUTILIZADO (o tentado sai da fila)", [i.numeroTentado?.situacao, Boolean(i.numeroTentado?.protocoloDaInutilizacao), r.tentadosConferidos], ["inutilizado", true, 1]);
    verdade("consultou a chave tentada e pediu a inutilização 7–7", metodos(antes).includes("nfeConsultaNF") && sefaz.pedidos.slice(antes).some((p) => metodoDo(p) === "nfeInutilizacaoNF" && p.corpo.includes("<nNFIni>7</nNFIni>") && p.corpo.includes("<nNFFin>7</nNFFin>")));
    const inut = (db.user.find((u) => u.id === LOJA)!.fiscalConfig.inutilizacoes ?? []).find((x: Linha) => x.numeroInicial === 7);
    confere("a inutilização ficou em fiscalConfig.inutilizacoes (homologação, origem tentado)", [inut?.serie, inut?.numeroFinal, inut?.ambiente, inut?.origem, inut?.protocolo], [7, 7, 2, "tentado", "353260000000789"]);
    const procInut = await lerXmlFiscal(inut.xmlNoCofre.caminho, inut.xmlNoCofre.sha256);
    paraValidar.push({ nome: "ProcInutNFe do número tentado", xsd: "procInutNFe_v4.00.xsd", xml: procInut });

    // G2: a tentada FOI autorizada → a mesma venda tem duas notas → cancela a
    // tentada POR SUBSTITUIÇÃO (110112), referenciando a de contingência.
    const G2 = pedido({});
    let foi = false;
    roteiro = (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote" && !foi) {
        foi = true;
        return "timeout-depois";
      }
      return saudavel(p);
    };
    await auto.emitirNfceAutomatica(G2.id);
    const t = info(G2.id).numeroTentado;
    roteiro = saudavel; // a contingência é transmitida; consulta 100 (autorizada) e evento 135
    const antesG2 = sefaz.pedidos.length;
    await auto.retentarNotasFiscais({ orcamentoMs: 60_000, agora: new Date(Date.now() + 11 * 60_000) });
    const i2 = info(G2.id);
    confere("autorizada: cancelada por substituição e o tentado fica 'cancelado'", i2.numeroTentado?.situacao, "cancelado");
    const evento = sefaz.pedidos.slice(antesG2).find((p) => metodoDo(p) === "nfeRecepcaoEvento");
    const envEvento = evento ? mensagemDoEnvelope(evento.corpo) : null;
    confere(
      "o evento foi o 110112, com a chave da contingência (a nota que acobertou a venda) em chNFeRef",
      [envEvento?.getElementsByTagName("tpEvento")[0]?.textContent, envEvento?.getElementsByTagName("chNFeRef")[0]?.textContent, envEvento?.getElementsByTagName("descEvento")[0]?.textContent],
      ["110112", i2.nfceKey, "Cancelamento por substituicao"]
    );
    if (envEvento) paraValidar.push({ nome: "envEvento 110112 da tentada", xsd: "evento/cancsubst/envEventoCancSubst_v1.00.xsd", xml: serializar(envEvento) });
    const anterior = (i2.notasAnteriores ?? []).find((n: Linha) => n.nfceKey === t.chave);
    confere("a tentada cancelada vai para notasAnteriores (o contador recebe), com número e protocolos", [anterior?.nfceNumber, anterior?.protocol, anterior?.protocoloCancelamento, anterior?.provedor], [t.numero, "353260000000123", "353260000000456", "sefaz"]);
    const procEv = await lerXmlFiscal(anterior.xmlCancelamentoNoCofre.caminho, anterior.xmlCancelamentoNoCofre.sha256);
    verdade("o evento de cancelamento está no cofre", procEv.includes("<procEventoNFe") && procEv.includes("<tpEvento>110112</tpEvento>"));
    paraValidar.push({ nome: "procEventoNFe (110112) da tentada", xsd: "evento/cancsubst/procEventoCancSubst_v1.00.xsd", xml: procEv });
    const procTentada = await lerXmlFiscal(anterior.xmlNoCofre.caminho, anterior.xmlNoCofre.sha256);
    paraValidar.push({ nome: "nfeProc da tentada (remontado com o XML assinado guardado)", xsd: "procNFe_v4.00.xsd", xml: procTentada });
  }

  // ── 7. Cancelamento ──────────────────────────────────────────────────────
  console.log("\n— Cancelamento —");
  {
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    const r = await loja.cancelarNotaDoPedidoNaSefaz({
      lojaId: LOJA, config: configAtual() as any, pedido: doPedido(A.id), pedidosDaNota: [A.id], ambiente: 2, justificativa: "Cliente desistiu da compra no caixa",
    });
    const i = info(A.id);
    confere("cancelada: 200, CANCELED, protocolo do evento", [r.status, doPedido(A.id).fiscalStatus, i.protocoloCancelamento], [200, "CANCELED", "353260000000456"]);
    confere("foi ao serviço de evento, com o nProt da autorização", [metodos(antes), sefaz.pedidos[antes].corpo.includes("<nProt>353260000000123</nProt>")], [["nfeRecepcaoEvento"], true]);
    const ev = await lerXmlFiscal(i.xmlCancelamentoNoCofre.caminho, i.xmlCancelamentoNoCofre.sha256);
    verdade("procEventoNFe no cofre (tipo evento) e a nota autorizada continua lá", ev.includes("<procEventoNFe") && i.xmlCancelamentoNoCofre.tipo === "evento" && Boolean(i.xmlNoCofre?.caminho));
    paraValidar.push({ nome: "procEventoNFe do cancelamento", xsd: "evento/procEventoNFe_v1.00.xsd", xml: ev });
    roteiro = (p) => (metodoDo(p) === "nfeRecepcaoEvento" ? responder("evento-573.xml", p) : saudavel(p));
    const dup = await loja.cancelarNotaDoPedidoNaSefaz({
      lojaId: LOJA, config: configAtual() as any, pedido: doPedido(B.id), pedidosDaNota: [B.id], ambiente: 2, justificativa: "Cliente desistiu da compra no caixa",
    });
    confere("573 (já cancelada): 409 com o cStat, e o pedido não muda", [dup.status, dup.corpo.cStat, doPedido(B.id).fiscalStatus], [409, "573", "EMITTED"]);

    // "Consultar situação" (tela): autorizada continua; cancelada não é tocada.
    roteiro = saudavel;
    const { resultado, semToken } = await auto.consultarNotaDoPedido(doPedido(C.id), LOJA);
    confere("Consultar situação de uma autorizada: sem token (não se aplica), segue EMITTED", [semToken, resultado?.ok, doPedido(C.id).fiscalStatus, info(C.id).provedor], [false, true, "EMITTED", "sefaz"]);
    roteiro = (p) => (metodoDo(p) === "nfeConsultaNF" ? responder("consulta-101.xml", p) : saudavel(p));
    const antesDeA = JSON.stringify(doPedido(A.id).fiscalInfo);
    await auto.consultarNotaDoPedido(doPedido(A.id), LOJA);
    confere("Consultar situação de uma cancelada: nada muda", JSON.stringify(doPedido(A.id).fiscalInfo), antesDeA);
  }

  // ── 8. Envio sem desfecho (contingência desligada) e a conferência ──────
  console.log("\n— Sem resposta e contingência desligada: o retry CONFERE antes de reenviar —");
  {
    mudarConfig((c) => ({ ...c, sefaz: { ...c.sefaz, contingenciaOffline: false } }));
    const J = pedido({});
    const J2 = pedido({});
    roteiro = (p) => (metodoDo(p) === "nfeAutorizacaoLote" ? "timeout-depois" : saudavel(p));
    await auto.emitirNfceAutomatica(J.id);
    await auto.emitirNfceAutomatica(J2.id);
    const ij = info(J.id);
    confere("sem resposta: FAILED transitória, com o envio a conferir e a reserva", [doPedido(J.id).fiscalStatus, ij.motivo, Boolean(ij.envioSefaz?.chave), ij.numeroReservado?.numero === ij.envioSefaz?.numero], ["FAILED", "erro_de_comunicacao", true, true]);
    // 3 minutos depois: cedo demais para a SEFAZ ter terminado o que recebeu
    // — a primeira consulta sai 10 min depois do envio (e 217 cedo não quer
    // dizer "não chegou"). Nada vai à SEFAZ, nem consulta nem reenvio.
    loja.usarRelogioDeTeste(() => new Date(Date.now() + 3 * 60_000));
    roteiro = saudavel;
    const antes0 = sefaz.pedidos.length;
    await auto.emitirNfceAutomatica(J.id);
    confere("J aos 3 min: nada vai à SEFAZ e a nota segue a conferir", [metodos(antes0), doPedido(J.id).fiscalStatus, info(J.id).envioSefaz?.chave === ij.envioSefaz.chave], [[], "FAILED", true]);
    // 11 minutos depois: J — a SEFAZ tinha autorizado → a conferência acha, e nada é reenviado.
    loja.usarRelogioDeTeste(() => new Date(Date.now() + 11 * 60_000));
    const antes = sefaz.pedidos.length;
    await auto.emitirNfceAutomatica(J.id);
    const ij2 = info(J.id);
    confere("J: a tentativa anterior estava AUTORIZADA — EMITTED com ela, sem nova autorização", [doPedido(J.id).fiscalStatus, ij2.nfceKey, metodos(antes)], ["EMITTED", ij.envioSefaz.chave, ["nfeConsultaNF"]]);
    const procJ = await lerXmlFiscal(ij2.xmlNoCofre.caminho, ij2.xmlNoCofre.sha256);
    verdade("…e o nfeProc foi remontado com o XML assinado que estava no cofre", procJ.includes(`Id="NFe${ij.envioSefaz.chave}"`) && procJ.includes("<protNFe"));
    paraValidar.push({ nome: "nfeProc remontado pela conferência", xsd: "procNFe_v4.00.xsd", xml: procJ });
    // J2: a SEFAZ não tem (217). O primeiro 217 NÃO libera o número (o lote
    // pode estar na fila dela); o segundo, 10 min depois, sim — e a nota sai
    // de novo com o MESMO número.
    const ij2a = info(J2.id);
    roteiro = (p) => (metodoDo(p) === "nfeConsultaNF" ? responder("consulta-217.xml", p) : saudavel(p));
    const antes2 = sefaz.pedidos.length;
    await auto.emitirNfceAutomatica(J2.id);
    confere("J2: o primeiro 217 só é anotado — nada reenviado", [doPedido(J2.id).fiscalStatus, metodos(antes2), info(J2.id).envioSefaz?.naoConsta?.length], ["FAILED", ["nfeConsultaNF"], 1]);
    loja.usarRelogioDeTeste(() => new Date(Date.now() + 22 * 60_000));
    const antes3 = sefaz.pedidos.length;
    await auto.emitirNfceAutomatica(J2.id);
    const ij2b = info(J2.id);
    confere("J2: o segundo 217, 11 min depois → emitida de novo com o MESMO número e outra chave", [doPedido(J2.id).fiscalStatus, ij2b.nfceNumber, ij2b.nfceKey !== ij2a.envioSefaz.chave, metodos(antes3)], ["EMITTED", ij2a.numeroReservado.numero, true, ["nfeConsultaNF", "nfeAutorizacaoLote"]]);
    confere("…e a chave que não chegou fica no histórico do pedido (o 539 procura lá)", (ij2b.enviosAnteriores ?? []).map((e: Linha) => e.chave).includes(ij2a.envioSefaz.chave), true);
    loja.usarRelogioDeTeste(null);
    mudarConfig((c) => ({ ...c, sefaz: { ...c.sefaz, contingenciaOffline: true } }));
  }

  // ── 9. Queda depois de assinar: o cron recupera pela chave ──────────────
  console.log("\n— Queda no meio (o processo morreu com a nota na SEFAZ) —");
  {
    // O estado que a emissão deixa ANTES de transmitir (aoAssinar): a nota
    // assinada no cofre e o pedido PENDING/processando com o envio.
    // O banco é fotografado NA HORA em que a nota sai para a SEFAZ; a SEFAZ
    // autoriza; e o banco volta à foto — é o que sobra quando o processo
    // morre entre a transmissão e a gravação do resultado.
    const K = pedido({});
    let foto: Linha | null = null;
    roteiro = (p) => {
      if (metodoDo(p) === "nfeAutorizacaoLote" && !foto) {
        const o = doPedido(K.id);
        foto = { fiscalStatus: o.fiscalStatus, fiscalInfo: structuredClone(o.fiscalInfo) };
        const enviada = mensagemDoEnvelope(p.corpo);
        verdade("na hora do envio, o pedido JÁ tem o envio registrado com a chave que está saindo", foto.fiscalInfo?.envioSefaz?.chave === (enviada.getElementsByTagName("infNFe")[0]?.getAttribute("Id") ?? "").slice(3));
      }
      return saudavel(p);
    };
    await auto.emitirNfceAutomatica(K.id);
    Object.assign(doPedido(K.id), foto);
    const ik = info(K.id);
    verdade("depois da queda: PENDING/processando, com a chave e o XML assinado no cofre", doPedido(K.id).fiscalStatus === "PENDING" && ik.processando === true && Boolean(ik.envioSefaz?.xml?.caminho), JSON.stringify(ik).slice(0, 200));
    const r0 = await auto.emitirNfceAutomatica(K.id);
    confere("um gancho de status no meio NÃO reemite (a nota está processando)", r0.acao, "ignorado");
    // O cron consulta a chave 10 min depois do envio: a SEFAZ tinha autorizado.
    roteiro = saudavel;
    loja.usarRelogioDeTeste(() => new Date(Date.now() + 4 * 60_000));
    const antes4 = sefaz.pedidos.length;
    await auto.retentarNotasFiscais({ orcamentoMs: 60_000 });
    confere("aos 4 min o cron ainda não consulta (a SEFAZ pode estar processando)", [metodos(antes4).filter((m) => m === "nfeConsultaNF"), doPedido(K.id).fiscalStatus], [[], "PENDING"]);
    loja.usarRelogioDeTeste(() => new Date(Date.now() + 11 * 60_000));
    const antes = sefaz.pedidos.length;
    await auto.retentarNotasFiscais({ orcamentoMs: 60_000 });
    loja.usarRelogioDeTeste(null);
    confere("o cron achou a nota pela chave (só consulta) e gravou EMITTED com o nfeProc", [metodos(antes).filter((m) => m !== "nfeStatusServicoNF"), doPedido(K.id).fiscalStatus, info(K.id).nfceKey, Boolean(info(K.id).xmlNoCofre?.caminho)], [["nfeConsultaNF"], "EMITTED", ik.envioSefaz.chave, true]);
  }

  // ── 9b. Queda depois da reserva e ANTES de assinar: nada saiu ────────────
  console.log("\n— Queda entre a reserva e o envio (nada foi à SEFAZ) —");
  {
    mudarConfig((c) => ({ ...c, sefaz: { ...c.sefaz, contingenciaOffline: false } }));
    const K2 = pedido({});
    let foto: Linha | null = null;
    estado.depoisDeMarcar = (ids, dados) => {
      if (ids.includes(K2.id) && dados.numeroReservado && !foto) {
        const o = doPedido(K2.id);
        foto = { fiscalStatus: o.fiscalStatus, fiscalInfo: structuredClone(o.fiscalInfo) };
      }
    };
    roteiro = () => "timeout-antes"; // a SEFAZ não recebe nada
    await auto.emitirNfceAutomatica(K2.id);
    estado.depoisDeMarcar = null;
    Object.assign(doPedido(K2.id), foto); // o processo morreu logo depois da reserva
    const reservado = info(K2.id).numeroReservado?.numero;
    confere(
      "logo depois da reserva o pedido já está PENDING/processando, sem envio",
      [doPedido(K2.id).fiscalStatus, info(K2.id).processando, info(K2.id).envioSefaz ?? null, typeof reservado],
      ["PENDING", true, null, "number"]
    );
    roteiro = saudavel;
    loja.usarRelogioDeTeste(() => new Date(Date.now() + 4 * 60_000));
    const antes = sefaz.pedidos.length;
    await auto.retentarNotasFiscais({ orcamentoMs: 60_000 });
    confere(
      "o cron vê que nada saiu: falha transitória com a MESMA reserva, sem ir à SEFAZ",
      [doPedido(K2.id).fiscalStatus, info(K2.id).motivo, info(K2.id).numeroReservado?.numero, metodos(antes).filter((m) => m === "nfeConsultaNF" || m === "nfeAutorizacaoLote")],
      ["FAILED", "erro_de_comunicacao", reservado, []]
    );
    await auto.emitirNfceAutomatica(K2.id);
    loja.usarRelogioDeTeste(null);
    confere("a retentativa emite com o número reservado", [doPedido(K2.id).fiscalStatus, info(K2.id).nfceNumber], ["EMITTED", reservado]);
    mudarConfig((c) => ({ ...c, sefaz: { ...c.sefaz, contingenciaOffline: true } }));
  }

  // ── 10. A nota da conta da mesa também reserva ───────────────────────────
  console.log("\n— Conta da mesa —");
  {
    roteiro = saudavel;
    db.tableSession.push({ id: "S1", franchiseeId: LOJA, status: "CLOSED", closedAt: haMin(170), customerName: "Mesa 4", serviceFee: 0, waiterTip: 0, paymentMethods: [{ method: "Pix", amount: 31.2 }] });
    const m1 = pedido({ tableSessionId: "S1", deliveryType: "MESA", paymentMethod: "N/A" });
    const m2 = pedido({ tableSessionId: "S1", deliveryType: "MESA", paymentMethod: "N/A" });
    const r = await auto.emitirNfceDaMesa("S1", { manual: true });
    confere("uma nota para a conta, com a mesma chave e número nos dois pedidos", [r.acao, info(m1.id).nfceKey === info(m2.id).nfceKey, info(m1.id).nfceNumber === info(m2.id).nfceNumber, info(m1.id).idDaNota], ["emitida", true, true, "mesa-S1"]);
    const usados = db.customerOrder.filter((o) => o.franchiseeId === LOJA && objetoDe(o.fiscalInfo).ambiente === 2 && objetoDe(o.fiscalInfo).nfceNumber != null && !objetoDe(o.fiscalInfo).notaDaConta).map((o) => objetoDe(o.fiscalInfo).nfceNumber);
    verdade("o número da conta não repete nenhum outro da série", !usados.includes(info(m1.id).nfceNumber), `${info(m1.id).nfceNumber} em ${usados}`);
  }

  // ── 10b. A consulta rápida (32 dias) e a nota de uma venda antiga ────────
  console.log("\n— A consulta rápida da reserva e a nota de uma venda antiga —");
  {
    roteiro = saudavel;
    const vistos = sqlVistos.length;
    const R = pedido({});
    await auto.emitirNfceAutomatica(R.id);
    const usadas = sqlVistos.slice(vistos);
    confere("loja que já emite: a reserva lê só os pedidos recentes (não varre o histórico)", [usadas.includes("maior-numero-recente"), usadas.includes("maior-numero")], [true, false]);
    // Uma venda de 40 dias atrás, emitida agora (o botão Emitir alcança venda velha).
    const velho = new Date(Date.now() - 40 * 24 * 60 * 60_000);
    const O = pedido({ createdAt: velho, updatedAt: velho });
    await auto.emitirNfceAutomatica(O.id);
    const nO = info(O.id).nfceNumber;
    const marca = () => db.user.find((u) => u.id === LOJA)!.fiscalConfig.sefaz.maiorNumero?.["2"]?.["7"];
    confere("o número da venda antiga ficou na marca de maior número (homologação, série 7)", marca(), nO);
    const Q = pedido({});
    await auto.emitirNfceAutomatica(Q.id);
    confere("a venda seguinte não repete o número da antiga (ela está fora da janela)", [info(Q.id).nfceNumber, marca()], [nO + 1, nO + 1]);
  }

  // ── 11. Teste de conexão (o "dia 1") ─────────────────────────────────────
  console.log("\n— Testar conexão —");
  {
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    const r = await loja.testarConexaoDaLoja({ lojaId: LOJA, config: configAtual() as any, ambiente: null });
    confere("status 107 em HOMOLOGAÇÃO (o padrão), com o certificado da loja", [r.ok, r.cStat, r.ambiente, r.certificado?.titular, r.certificado?.validoAte], [true, "107", 2, "NIK COMERCIO DE ALIMENTOS LTDA:64568087000180", "2035-12-31T23:59:59.000Z"]);
    verdade("dias para vencer calculados", Number(r.certificado?.diasParaVencer) > 3000, String(r.certificado?.diasParaVencer));
    confere("foi ao status do serviço da SVRS de homologação", [metodos(antes), sefaz.pedidos[antes]?.url], [["nfeStatusServicoNF"], "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx"]);
    const ult = db.user.find((u) => u.id === LOJA)!.fiscalConfig.sefaz.ultimoTeste;
    confere("fiscalConfig.sefaz.ultimoTeste gravado (sem apagar o resto do bloco)", [ult?.ok, ult?.cStat, ult?.ambiente, Boolean(db.user.find((u) => u.id === LOJA)!.fiscalConfig.sefaz.certificado)], [true, "107", 2, true]);
    const p1 = await loja.testarConexaoDaLoja({ lojaId: LOJA, config: configAtual() as any, ambiente: 1 });
    confere("?ambiente=1: produção", [p1.ambiente, sefaz.pedidos[sefaz.pedidos.length - 1]?.url], [1, "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx"]);
    roteiro = () => "timeout-depois";
    const fora = await loja.testarConexaoDaLoja({ lojaId: LOJA, config: configAtual() as any, ambiente: 2 });
    confere("SEFAZ sem resposta: ok false, com a mensagem, e o certificado continua informado", [fora.ok, fora.cStat, /Sem resposta/.test(fora.mensagem), Boolean(fora.certificado)], [false, null, true, true]);
    const semCert = await loja.testarConexaoDaLoja({ lojaId: LOJA, config: configDaNik({ sefaz: { ...configDaNik().sefaz, certificado: null } }) as any, ambiente: 2 });
    confere("sem certificado: ok false, sem ir à SEFAZ", [semCert.ok, semCert.certificado, /certificado/i.test(semCert.mensagem)], [false, null, true]);
  }

  // ── 12. Inutilização mensal dos buracos (produção) ───────────────────────
  console.log("\n— Inutilização mensal —");
  const LOJA_P = "loja-producao";
  const agoraOutubro = new Date("2026-10-02T13:00:00.000Z"); // 02/10 10h em Brasília
  const noCofreP = await guardarArquivoFiscal({ lojaId: LOJA_P, tipo: "certificado", identificacao: "a1", conteudo: pfx });
  {
    db.user.push({
      id: LOJA_P, ifoodMerchantId: null, food99MerchantId: null, storeName: "Nik Produção", name: "Nik",
      fiscalConfig: configDaNik({ ambiente: 1, sefaz: { ...configDaNik().sefaz, certificado: { ...certificadoDaLoja, arquivo: noCofreP.caminho, sha256: noCofreP.sha256 } } }),
    });
    const setembro = (dia: number) => new Date(Date.UTC(2026, 8, dia, 15)).toISOString();
    const antigo = new Date("2026-08-15T15:00:00.000Z");
    const linhaP = (fiscalStatus: string, fiscalInfo: Linha) => pedido({ franchiseeId: LOJA_P, createdAt: antigo, updatedAt: antigo, fiscalStatus, fiscalInfo });
    const nota = (n: number, dia: number, extra: Linha = {}) => ({ nfceKey: `K${n}`, nfceNumber: n, serie: 7, ambiente: 1, emittedAt: setembro(dia), provedor: "sefaz", ...extra });
    linhaP("EMITTED", nota(1, 2));
    linhaP("EMITTED", nota(2, 3));
    const reservaVencida = linhaP("FAILED", { motivo: "rejeitada", provedor: "sefaz", ambiente: 1, numeroReservado: { serie: 7, numero: 3, ambiente: 1, em: setembro(20) } });
    // nº 4: nenhum registro (a nota se perdeu) — buraco.
    linhaP("CANCELED", nota(5, 25));
    linhaP("EMITTED", nota(6, 28, { contingencia: true })); // contingência: NUNCA inutilizar
    linhaP("EMITTED", nota(10, 28, { numeroTentado: { numero: 7, serie: 7, ambiente: 1, chave: "X", desde: setembro(29), situacao: "a_conferir" } })); // tentado 7
    const reservaDoMes = linhaP("FAILED", { motivo: "rejeitada", numeroReservado: { serie: 7, numero: 8, ambiente: 1, em: "2026-10-01T12:00:00.000Z" } });
    linhaP("EMITTED", nota(9, 30, { emittedAt: "2026-10-01T15:00:00.000Z" })); // já é de outubro
    const configP = normalizarConfigFiscal(db.user.find((u) => u.id === LOJA_P)!.fiscalConfig) as any;
    const n = await numeracao.numerosDoFiscalInfo(doPedido(reservaVencida.id));
    confere("a leitura de referência acha a reserva vencida", n.map((t: Linha) => [t.papel, t.numero]), [["reserva", 3]]);

    // A conferência de faixa recusa número de contingência e tentado (nada vai à SEFAZ).
    roteiro = saudavel;
    const antes = sefaz.pedidos.length;
    const recusa = await inutilizarFaixaNaSefaz({ lojaId: LOJA_P, config: configP, serie: 7, numeroInicial: 5, numeroFinal: 7, justificativa: "Teste de faixa com numero usado", ambiente: 1, origem: "tela" });
    confere("faixa 5–7 (cancelada, contingência, tentado): recusada aqui, sem SEFAZ", [recusa.ok, !recusa.ok && recusa.motivo, !recusa.ok && recusa.conflitos, sefaz.pedidos.length - antes], [false, "recusada_aqui", [5, 6, 7], 0]);

    const r = await inutilizarBuracosDoMes({ lojaId: LOJA_P, config: configP, agora: agoraOutubro });
    confere("outubro: buracos de setembro = 3 (reserva vencida) e 4 (sem registro), numa faixa só", r.faixas.map((f) => [f.serie, f.numeroInicial, f.numeroFinal]), [[7, 3, 4]]);
    const pedidoInut = sefaz.pedidos.slice(antes).find((p) => metodoDo(p) === "nfeInutilizacaoNF");
    verdade("a inutilização foi a PRODUÇÃO (tpAmb 1) e da faixa 3–4", Boolean(pedidoInut && pedidoInut.corpo.includes("<tpAmb>1</tpAmb>") && pedidoInut.corpo.includes("<nNFIni>3</nNFIni>") && pedidoInut.corpo.includes("<nNFFin>4</nNFFin>") && pedidoInut.url.startsWith("https://nfce.svrs.rs.gov.br/")));
    confere("a reserva vencida foi SOLTA (o pedido não reusa um número inutilizado)", [info(reservaVencida.id).numeroReservado ?? null, info(reservaVencida.id).reservaLiberada?.numero, r.reservasSoltas], [null, 3, 1]);
    confere("a reserva deste mês ficou", info(reservaDoMes.id).numeroReservado?.numero, 8);
    const fc = db.user.find((u) => u.id === LOJA_P)!.fiscalConfig;
    const reg = (fc.inutilizacoes ?? []).find((x: Linha) => x.numeroInicial === 3);
    confere("registro em fiscalConfig.inutilizacoes (mensal, produção) e o mês marcado", [reg?.numeroFinal, reg?.origem, reg?.ambiente, reg?.mes, fc.sefaz.inutilizacaoMensal?.mes, fc.sefaz.inutilizacaoMensal?.pendente], [4, "mensal", 1, "202609", "202609", false]);
    const procInut = await lerXmlFiscal(reg.xmlNoCofre.caminho, reg.xmlNoCofre.sha256);
    paraValidar.push({ nome: "ProcInutNFe mensal", xsd: "procInutNFe_v4.00.xsd", xml: procInut });
    const deNovo = await inutilizarBuracosDoMes({ lojaId: LOJA_P, config: normalizarConfigFiscal(fc) as any, agora: new Date(agoraOutubro.getTime() + 60 * 60_000) });
    confere("o mês já conferido não é refeito", deNovo.pulou, "mês já conferido");
    const forcado = await inutilizarBuracosDoMes({ lojaId: LOJA_P, config: normalizarConfigFiscal(fc) as any, agora: new Date(agoraOutubro.getTime() + 2 * 60 * 60_000), forcar: true });
    confere("forçado de novo: nada mais a inutilizar (3–4 já inutilizados)", forcado.faixas, []);
    confere("o mês da loja no fuso dela", mesDaLoja("DF", new Date("2026-10-01T02:30:00.000Z")).mesAtual, "202609");

    // Cadastro errado (número inicial 1 com a numeração real em 2000) não inutiliza 1.999 números sozinho.
    const LOJA_G = "loja-buraco-grande";
    db.user.push({ id: LOJA_G, fiscalConfig: configDaNik({ ambiente: 1 }) });
    pedido({ franchiseeId: LOJA_G, createdAt: antigo, fiscalStatus: "EMITTED", fiscalInfo: nota(2000, 5) });
    const antesG = sefaz.pedidos.length;
    const g = await inutilizarBuracosDoMes({ lojaId: LOJA_G, config: normalizarConfigFiscal(db.user.find((u) => u.id === LOJA_G)!.fiscalConfig) as any, agora: agoraOutubro });
    confere("buraco grande demais: nada vai à SEFAZ, e o erro explica", [g.faixas.length, sefaz.pedidos.length - antesG, /grande demais/.test(g.erros[0] ?? "")], [0, 0, true]);
  }

  // ── 13. Pacote do contador lendo do cofre ────────────────────────────────
  console.log("\n— Pacote do contador —");
  {
    roteiro = saudavel;
    const P = pedido({ franchiseeId: LOJA_P });
    const vistos = sqlVistos.length;
    await auto.emitirNfceAutomatica(P.id);
    const ip = info(P.id);
    confere("uma nota de PRODUÇÃO na loja de produção (nº 11: acima do 10 tentado/usado)", [doPedido(P.id).fiscalStatus, ip.ambiente, ip.nfceNumber], ["EMITTED", 1, 11]);
    confere("sem número nos últimos 32 dias, a reserva varre o histórico inteiro", sqlVistos.slice(vistos).filter((m) => m.startsWith("maior-numero")), ["maior-numero-recente", "maior-numero"]);
    const fetchOriginal = globalThis.fetch;
    let chamouFora = 0;
    (globalThis as any).fetch = async () => {
      chamouFora++;
      throw new Error("o pacote do emissor próprio não pode buscar XML fora");
    };
    const pacote = await montarPacoteDoContador(LOJA_P, { de: "2026-09-01", ate: "2026-12-31" }, { inicio: new Date("2026-09-01T03:00:00.000Z"), fim: new Date("2027-01-01T02:59:59.999Z") });
    (globalThis as any).fetch = fetchOriginal;
    const doZip = (nome: string) => String(pacote.arquivos.find((a) => a.nome === nome)?.conteudo ?? "");
    const xmlDaNota = await lerXmlFiscal(ip.xmlNoCofre.caminho, ip.xmlNoCofre.sha256);
    confere("o XML da nota veio do COFRE, idêntico, sem ir a provedor nenhum", [doZip(`xml/${ip.nfceKey}.xml`) === xmlDaNota, chamouFora], [true, 0]);
    verdade("a inutilização mensal vai com o ProcInutNFe", doZip("xml/inutilizacao-serie7-3-a-4.xml").includes("<ProcInutNFe"));
    verdade("a relação traz a nota", doZip("relacao-de-notas.csv").includes(ip.nfceKey));
  }

  // ── Os XML de verdade contra o XSD oficial ───────────────────────────────
  console.log(`\n— ${paraValidar.length} documentos do cofre contra os schemas oficiais —`);
  const resultados = validarNoXsd(paraValidar.map((p) => ({ xsd: p.xsd, xml: p.xml })));
  resultados.forEach((r, i) => verdade(`XSD: ${paraValidar[i].nome} (${paraValidar[i].xsd})`, r.ok, r.erros.join(" | ")));

  confere("todo SQL cru passou pelo banco falso com marcador conhecido", [...new Set(sqlVistos)].sort(), [
    "anexar-inutilizacao", "liberar-reserva", "maior-numero", "maior-numero-recente", "marcar-em-emissao", "marcar-maior-numero",
    "mesclar-fiscal-info", "mesclar-sefaz", "numeros-da-loja", "pegar-concessao-da-rodada", "soltar-concessao-da-rodada", "trava",
  ]);
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
