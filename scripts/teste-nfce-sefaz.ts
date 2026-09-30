/**
 * Emissor próprio de NFC-e: webservices, envelope SOAP, respostas e a fachada.
 *
 *   npx tsx scripts/teste-nfce-sefaz.ts
 *
 * NÃO fala com a SEFAZ: o transporte HTTPS é trocado por uma SEFAZ FALSA que
 * responde com as fixtures de scripts/fixtures/nfce-sefaz (montadas pelo
 * leiaute do MOC e validadas aqui contra os schemas de retorno). Confere:
 *  - a cadeia ICP-Brasil embutida e o agente mTLS (com o .pfx 3DES);
 *  - endereço, namespace e action de cada serviço; envelope sem nfeCabecMsg;
 *  - cada mensagem enviada (enviNFe, consSitNFe, consStatServ, consReciNFe,
 *    envEvento, inutNFe) contra o XSD oficial, com as assinaturas conferidas;
 *  - a leitura de cada resposta e os documentos finais (nfeProc,
 *    procEventoNFe, procInutNFe) contra o XSD;
 *  - a fachada: autorizada, rejeitada, lote rejeitado, duplicidade, lote
 *    assíncrono, contingência (com e sem o número queimado), transmissão da
 *    contingência, consulta, cancelamento, inutilização, status, certificado
 *    de outro CNPJ / vencido / senha errada.
 */
import { X509Certificate, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import forge from "node-forge";
import { montarCorpoDaNfce, type CorpoDaNfce, type ResultadoDaEmissao } from "../src/lib/fiscal-emissao";
import { verificarAssinatura } from "../src/lib/nfce/assinatura";
import { lerChave } from "../src/lib/nfce/chave";
import {
  cancelarNaSefaz,
  chaveDoMotivo,
  consultarNaSefaz,
  consultarReciboNaSefaz,
  contingenciaDoXml,
  emitirNfceNaSefaz,
  inutilizarNaSefaz,
  naturezaDaRecusa,
  prepararNotaAssinada,
  statusDoServico,
  transmitirContingencia,
  type ContextoDoEmissor,
  type ResultadoDaEmissaoSefaz,
} from "../src/lib/nfce/emissor";
import { CADEIA_ICP_BRASIL } from "../src/lib/nfce/icp-brasil";
import {
  FalhaDeTransporte,
  FalhaSoap,
  SERVICOS,
  agenteDoCertificado,
  autoridadesConfiaveis,
  cabecalhosSoap,
  envelopeSoap,
  lerRespostaSoap,
  lerRetConsSitNFe,
  lerRetConsStatServ,
  lerRetEnvEvento,
  lerRetEnviNFe,
  lerRetInutNFe,
  montarCancelamento,
  montarConsReciNFe,
  montarConsSitNFe,
  montarConsStatServ,
  montarEnviNFe,
  montarEventoDeCancelamento,
  montarInutilizacao,
  transporteHttps,
  urlDoServico,
  type Servico,
} from "../src/lib/nfce/sefaz";
import { elementos, lerXml, primeiro, semDeclaracao, serializar } from "../src/lib/nfce/xml";
import {
  CONFIG_NIK,
  FIXTURES,
  SENHA_DO_CERTIFICADO,
  certificadoDeTeste,
  confere,
  fixture,
  mensagemDoEnvelope,
  metodoDo,
  responder,
  sefazFalsa,
  terminar,
  validarNoXsd,
  verdade,
} from "./nfce-teste-apoio";

// Checagem de TIPO (o tsc confere; não roda): o resultado do emissor próprio
// cabe onde hoje cabe o da Focus.
void ((r: ResultadoDaEmissaoSefaz): ResultadoDaEmissao => r);

const AGORA = new Date("2026-09-29T15:00:00Z");
const cert = certificadoDeTeste();
const pfx = readFileSync(join(FIXTURES, "nfce-certificado-teste-3des.pfx"));

const corpoDe = (extra: Record<string, unknown> = {}): CorpoDaNfce => {
  const m = montarCorpoDaNfce(
    {
      id: "p1",
      numero: 42,
      canal: "PDV",
      itens: [{ codigo: "esf", descricao: "Esfiha de carne", ncm: "21069090", cfop: "5102", unidadeComercial: "UN", quantidade: 4, valorUnitario: 3.9, valorTotal: 15.6, origem: 0, csosn: "102" }],
      valorTotal: 15.6,
      formaDePagamento: "Dinheiro",
      ...extra,
    },
    CONFIG_NIK,
    AGORA
  );
  if (!m.ok) throw new Error(JSON.stringify(m.pendencias));
  return m.corpo;
};

const ctxBase = (extra: Partial<ContextoDoEmissor> = {}): ContextoDoEmissor => ({
  certificado: { pfx, senha: SENHA_DO_CERTIFICADO },
  uf: "DF",
  ambiente: 2,
  serie: 1,
  numero: 50,
  qrCode: { versao: 2, idCsc: "1", csc: "0123456789ABCDEF0123456789ABCDEF" },
  agora: () => AGORA,
  esperar: async () => {},
  ...extra,
});

/** Certificado de SERVIDOR para 127.0.0.1 (auto-assinado), só para o servidor HTTPS local do teste. */
function certificadoDeServidorLocal(): { chave: string; cert: string } {
  const par = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chave = par.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(par.publicKey.export({ type: "spki", format: "pem" }).toString());
  c.serialNumber = "01";
  c.validity.notBefore = new Date("2025-01-01T00:00:00Z");
  c.validity.notAfter = new Date("2035-12-31T00:00:00Z");
  const nome = [{ name: "commonName", value: "127.0.0.1" }];
  c.setSubject(nome);
  c.setIssuer(nome);
  c.setExtensions([{ name: "basicConstraints", cA: true }, { name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }]);
  c.sign(forge.pki.privateKeyFromPem(chave), forge.md.sha256.create());
  return { chave, cert: forge.pki.certificateToPem(c) };
}

/** Documentos para validar no XSD no fim, de uma vez. */
const paraValidar: Array<{ nome: string; xsd: string; xml: string }> = [];
const guardar = (nome: string, xsd: string, xml: string | undefined | null) => {
  if (xml) paraValidar.push({ nome, xsd, xml });
  else verdade(`${nome}: tem XML para validar`, false, "vazio");
};

async function principal() {
  // ─── ICP-Brasil e agente mTLS ─────────────────────────────────────────────
  console.log("\n— Cadeia ICP-Brasil embutida e agente mTLS —");
  {
    const doArquivo = (readFileSync(join(__dirname, "../src/lib/nfce/icp-brasil.pem"), "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []).map((s) => s.trim());
    confere("icp-brasil.ts = icp-brasil.pem (mesmos 6 certificados, mesma ordem)", CADEIA_ICP_BRASIL.map((c) => c.pem.trim()), doArquivo);
    const x509 = CADEIA_ICP_BRASIL.map((c) => new X509Certificate(c.pem));
    const porNome = (trecho: string) => x509.find((c) => c.subject.includes(trecho));
    const v10 = porNome("Raiz Brasileira v10");
    const serpro = porNome("SERPRO SSLv1");
    verdade("tem a Raiz v10 e a AC SERPRO SSLv1", Boolean(v10 && serpro));
    verdade("AC SERPRO SSLv1 é assinada pela Raiz v10 (a cadeia da SVRS)", Boolean(v10 && serpro && serpro.checkIssued(v10) && serpro.verify(v10.publicKey)));
    verdade("todas as ACs embutidas valem hoje", x509.every((c) => new Date(c.validTo) > AGORA), x509.map((c) => c.validTo).join(", "));
    confere("ca = raízes do Node + 6 ICP", autoridadesConfiaveis().length, tls.rootCertificates.length + 6);
    const cert3des = certificadoDeTeste("nfce-certificado-teste-3des.pfx");
    let contextoOk = true;
    try {
      tls.createSecureContext({ key: cert3des.chavePrivadaPem, cert: cert3des.certificadoPem, ca: autoridadesConfiaveis() });
    } catch (e: any) {
      contextoOk = false;
      console.log("   ", e?.message);
    }
    verdade("o .pfx 3DES, lido pelo forge, vira key/cert PEM que o OpenSSL do Node aceita", contextoOk);
    const agente = agenteDoCertificado(cert3des);
    verdade("agente reaproveitado por certificado (keep-alive)", agente === agenteDoCertificado(cert3des));
    confere("agente com TLS 1.2+", (agente.options as any).minVersion, "TLSv1.2");
  }

  // ─── Transporte HTTPS de verdade, contra um servidor LOCAL com mTLS ──────
  console.log("\n— Transporte HTTPS com mTLS (servidor local em 127.0.0.1, não a SEFAZ) —");
  {
    const servidor = certificadoDeServidorLocal();
    const clientes: string[] = [];
    const srv = https.createServer({ key: servidor.chave, cert: servidor.cert, requestCert: true, rejectUnauthorized: false }, (req, res) => {
      const peer = (req.socket as tls.TLSSocket).getPeerCertificate();
      clientes.push(String(peer?.subject?.CN ?? ""));
      let corpo = "";
      req.on("data", (d) => (corpo += d));
      req.on("end", () => {
        if (req.url === "/silencio") return; // recebe e não responde
        if (req.url === "/erro") {
          res.writeHead(500, { "Content-Type": "application/soap+xml" });
          return res.end(fixture("soap-fault.xml"));
        }
        res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
        res.end(corpo.includes("consStatServ") && req.headers["content-type"]?.includes("nfeStatusServicoNF") ? fixture("status-107.xml") : "?");
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const porta = (srv.address() as AddressInfo).port;
    const base = `https://127.0.0.1:${porta}`;
    const pedido = (caminho: string, timeoutMs = 2000) => ({ url: base + caminho, corpo: envelopeSoap("status", montarConsStatServ(2, "DF")), cabecalhos: cabecalhosSoap("status"), timeoutMs });
    const certLoja = certificadoDeTeste("nfce-certificado-teste-3des.pfx");
    const transporte = transporteHttps(certLoja, [servidor.cert]);

    const ok = await transporte(pedido("/ok"));
    confere("POST com mTLS: 200 e a resposta do status", [ok.status, lerRetConsStatServ(lerRespostaSoap(ok.corpo)).cStat], [200, "107"]);
    confere("o servidor recebeu o certificado da LOJA no handshake", clientes[0], "NIK COMERCIO DE ALIMENTOS LTDA:64568087000180");
    const erro = await transporte(pedido("/erro"));
    confere("HTTP 500 chega como resposta (quem decide é chamarServico)", erro.status, 500);

    const falhaDe = async (t: typeof transporte, p: ReturnType<typeof pedido>) => {
      try {
        await t(p);
        return null;
      } catch (e) {
        return e instanceof FalhaDeTransporte ? e : null;
      }
    };
    const silencio = await falhaDe(transporte, pedido("/silencio", 400));
    confere("recebeu e não respondeu: FalhaDeTransporte com enviado = true (número queimado)", silencio && [silencio.enviado, silencio.codigo], [true, "ETIMEDOUT"]);
    const semConfiar = await falhaDe(transporteHttps(certificadoDeTeste()), pedido("/ok"));
    verdade("servidor fora da cadeia ICP: falha de TLS com enviado = false", Boolean(semConfiar && semConfiar.enviado === false && /TLS/.test(semConfiar.message)), semConfiar ? `${semConfiar.codigo} ${semConfiar.message}` : "não falhou");
    await new Promise<void>((r) => srv.close(() => r()));
    srv.closeAllConnections?.();
    const recusada = await falhaDe(transporte, pedido("/ok"));
    confere("porta fechada: FalhaDeTransporte com enviado = false (número livre)", recusada && [recusada.enviado, recusada.codigo], [false, "ECONNREFUSED"]);
  }

  // ─── Endereços e envelope ─────────────────────────────────────────────────
  console.log("\n— Webservices, namespace e action —");
  {
    const esperado: Record<Servico, string> = {
      autorizacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
      retAutorizacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
      consulta: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
      status: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
      evento: "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
      inutilizacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
    };
    for (const s of Object.keys(esperado) as Servico[]) confere(`DF homologação: ${s}`, urlDoServico("DF", 2, s), esperado[s]);
    confere("DF produção: autorização", urlDoServico("DF", 1, "autorizacao"), "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx");
    confere("RJ e PA também na SVRS", [urlDoServico("RJ", 1, "status"), urlDoServico("PA", 2, "consulta")], ["https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx", "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx"]);
    confere("MG próprio", [urlDoServico("MG", 1, "autorizacao"), urlDoServico("MG", 2, "evento")], ["https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4", "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4"]);
    let recusou = false;
    try {
      urlDoServico("SP", 1, "status");
    } catch {
      recusou = true;
    }
    confere("UF sem tabela: recusa", recusou, true);

    const metodos: Record<Servico, string> = {
      autorizacao: "NFeAutorizacao4/nfeAutorizacaoLote",
      retAutorizacao: "NFeRetAutorizacao4/nfeRetAutorizacaoLote",
      consulta: "NFeConsultaProtocolo4/nfeConsultaNF",
      status: "NFeStatusServico4/nfeStatusServicoNF",
      evento: "NFeRecepcaoEvento4/nfeRecepcaoEvento",
      inutilizacao: "NFeInutilizacao4/nfeInutilizacaoNF",
    };
    for (const s of Object.keys(SERVICOS) as Servico[]) {
      const env = envelopeSoap(s, '<?xml version="1.0"?><consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb></consStatServ>');
      const doc = lerXml(env);
      const dados = primeiro(doc, "nfeDadosMsg")!;
      const ok =
        doc.documentElement.namespaceURI === "http://www.w3.org/2003/05/soap-envelope" &&
        elementos(doc, "Header").length === 0 &&
        dados.namespaceURI === `http://www.portalfiscal.inf.br/nfe/wsdl/${SERVICOS[s].wsdl}` &&
        !env.includes("<?xml version=\"1.0\"?>") &&
        cabecalhosSoap(s)["Content-Type"] === `application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/${metodos[s]}"`;
      verdade(`envelope ${s}: SOAP 1.2, sem cabeçalho, nfeDadosMsg no namespace, action ${metodos[s]}`, ok);
    }
  }

  // ─── Mensagens enviadas contra o XSD ─────────────────────────────────────
  console.log("\n— Mensagens de cada serviço (validadas no XSD no fim) —");
  let chaveAutorizada = "";
  {
    const preparada = prepararNotaAssinada(corpoDe(), ctxBase(), cert, { tipoDeEmissao: 1, agora: AGORA });
    if (!preparada.ok) throw new Error(JSON.stringify(preparada.pendencias));
    const envi = montarEnviNFe(preparada.nota.xml, "202609291200001");
    guardar("enviNFe", "enviNFe_v4.00.xsd", envi);
    confere("enviNFe: idLote e indSinc 1 (NFC-e síncrona)", [primeiro(lerXml(envi), "idLote")?.textContent, primeiro(lerXml(envi), "indSinc")?.textContent], ["202609291200001", "1"]);
    verdade("a NFe dentro do lote continua com a assinatura válida", verificarAssinatura(envi).ok);
    guardar("consSitNFe", "consSitNFe_v4.00.xsd", montarConsSitNFe(2, preparada.nota.chave));
    guardar("consStatServ", "consStatServ_v4.00.xsd", montarConsStatServ(2, "DF"));
    guardar("consReciNFe", "consReciNFe_v4.00.xsd", montarConsReciNFe(2, "531000012345678"));
    const cancel = montarCancelamento(
      { chave: preparada.nota.chave, protocolo: "353260000000123", justificativa: "Cliente desistiu da compra no caixa", cnpj: "64568087000180", ambiente: 2, dhEvento: "2026-09-29T12:05:00-03:00", idLote: "1" },
      cert
    );
    guardar("envEvento (cancelamento)", "evento/envEvento_v1.00.xsd", cancel.envEvento);
    const ev = lerXml(cancel.envEvento);
    confere(
      "evento: Id ID110111+chave+01, cOrgao 53, tpEvento 110111, descEvento, nProt",
      [primeiro(ev, "infEvento")?.getAttribute("Id"), primeiro(ev, "cOrgao")?.textContent, primeiro(ev, "tpEvento")?.textContent, primeiro(ev, "descEvento")?.textContent, primeiro(ev, "nProt")?.textContent, primeiro(ev, "detEvento")?.getAttribute("versao")],
      [`ID110111${preparada.nota.chave}01`, "53", "110111", "Cancelamento", "353260000000123", "1.00"]
    );
    verdade("evento assinado (infEvento) confere", verificarAssinatura(cancel.envEvento).ok);
    const inut = montarInutilizacao({ uf: "DF", ano: 2026, cnpj: "64568087000180", serie: 1, numeroInicial: 10, numeroFinal: 12, justificativa: "Numeracao pulada por falha do sistema", ambiente: 2 }, cert);
    guardar("inutNFe", "inutNFe_v4.00.xsd", inut);
    confere("inutilização: Id = ID+cUF+AA+CNPJ+65+série+nIni+nFim", primeiro(lerXml(inut), "infInut")?.getAttribute("Id"), "ID53266456808700018065001000000010000000012");
    verdade("inutilização assinada (infInut) confere", verificarAssinatura(inut).ok);
    chaveAutorizada = preparada.nota.chave;
  }

  // ─── Respostas de exemplo: schema e leitura ──────────────────────────────
  console.log("\n— Respostas de exemplo: leitura (schema validado no fim) —");
  {
    const preencher = (nome: string) =>
      fixture(nome).replace(/\{\{(\w+)\}\}/g, (_, k) => ({ CHAVE: chaveAutorizada, DIGVAL: "2OZCUwJiz82cO9wNXDT2+c6sL0Q=", DHRECBTO: "2026-09-29T12:00:05-03:00", IDLOTE: "1", NINI: "10", NFIM: "12" } as Record<string, string>)[k]);
    const xsdDo: Record<string, string> = {
      "status-107.xml": "retConsStatServ_v4.00.xsd",
      "autorizacao-100.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-464.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-204.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-lote-225.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-lote-108.xml": "retEnviNFe_v4.00.xsd",
      "consulta-100.xml": "retConsSitNFe_v4.00.xsd",
      "consulta-101.xml": "retConsSitNFe_v4.00.xsd",
      "consulta-217.xml": "retConsSitNFe_v4.00.xsd",
      "evento-135.xml": "evento/retEnvEvento_v1.00.xsd",
      "evento-573.xml": "evento/retEnvEvento_v1.00.xsd",
      "inutilizacao-102.xml": "retInutNFe_v4.00.xsd",
      // As da recuperação (scripts/teste-nfce-recuperacao.ts).
      "autorizacao-120.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-103.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-539.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-lote-656.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-lote-280.xml": "retEnviNFe_v4.00.xsd",
      "autorizacao-lote-999.xml": "retEnviNFe_v4.00.xsd",
      "recibo-104.xml": "retConsReciNFe_v4.00.xsd",
      "recibo-105.xml": "retConsReciNFe_v4.00.xsd",
      // consulta-120.xml fica de fora: a NT 2026.002 (item 2.3) põe cMsg/xMsg também no protNFe da
      // NFeConsultaProtocolo, e o leiauteConsSitNFe_v4.00 mais novo (PL_010d_v1.03) ainda não os
      // tem — a leitura aceita, o schema de 2026 ainda não.
      "consulta-656.xml": "retConsSitNFe_v4.00.xsd",
      "inutilizacao-256.xml": "retInutNFe_v4.00.xsd",
      "evento-135-substituicao.xml": "evento/cancsubst/retEnvEventoCancSubst_v1.00.xsd",
    };
    for (const [nome, xsd] of Object.entries(xsdDo)) guardar(`fixture ${nome}`, xsd, serializar(lerRespostaSoap(preencher(nome))));

    const st = lerRetConsStatServ(lerRespostaSoap(preencher("status-107.xml")));
    confere("status: 107, tMed 1, cUF 53", [st.cStat, st.xMotivo, st.tempoMedio, st.cUF], ["107", "Servico em Operacao", 1, "53"]);
    const au = lerRetEnviNFe(lerRespostaSoap(preencher("autorizacao-100.xml")));
    confere("autorização: lote 104, prot 100, nProt, digVal, chave", [au.cStat, au.protocolo?.cStat, au.protocolo?.protocolo, au.protocolo?.digVal, au.protocolo?.chave], ["104", "100", "353260000000123", "2OZCUwJiz82cO9wNXDT2+c6sL0Q=", chaveAutorizada]);
    verdade("protNFe serializado com o namespace da NF-e", /^<protNFe[^>]*xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe"/.test(au.protocolo?.xml ?? ""), au.protocolo?.xml.slice(0, 80));
    const lote = lerRetEnviNFe(lerRespostaSoap(preencher("autorizacao-lote-225.xml")));
    confere("lote rejeitado: 225 sem protNFe", [lote.cStat, lote.protocolo], ["225", null]);
    const cs = lerRetConsSitNFe(lerRespostaSoap(preencher("consulta-101.xml")));
    confere("consulta: 101 com o protNFe da autorização", [cs.cStat, cs.protocolo?.cStat, cs.chave], ["101", "100", chaveAutorizada]);
    const ev = lerRetEnvEvento(lerRespostaSoap(preencher("evento-135.xml")));
    confere("evento: lote 128, evento 135 com nProt e dhRegEvento", [ev.cStat, ev.eventos[0].cStat, ev.eventos[0].protocolo, ev.eventos[0].dhRegEvento], ["128", "135", "353260000000456", "2026-09-29T12:00:05-03:00"]);
    const inu = lerRetInutNFe(lerRespostaSoap(preencher("inutilizacao-102.xml")));
    confere("inutilização: 102 com nProt", [inu.cStat, inu.protocolo], ["102", "353260000000789"]);
    let fault = "";
    try {
      lerRespostaSoap(fixture("soap-fault.xml"));
    } catch (e: any) {
      fault = e instanceof FalhaSoap ? e.message : "outro erro";
    }
    verdade("SOAP Fault vira FalhaSoap com o motivo", fault.includes("Server was unable to process request"), fault);
    let trocada = "";
    try {
      lerRetEnviNFe(lerRespostaSoap(preencher("status-107.xml")));
    } catch (e: any) {
      trocada = e.message;
    }
    verdade("resposta de outro serviço é recusada", /Esperava retEnviNFe/.test(trocada), trocada);
  }

  // ─── A fachada: autorização ──────────────────────────────────────────────
  console.log("\n— emitirNfceNaSefaz: autorizada —");
  let autorizada: ResultadoDaEmissaoSefaz | null = null;
  {
    const s = sefazFalsa((p) => responder("autorizacao-100.xml", p));
    const r = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: s.transporte }));
    autorizada = r;
    confere("ok, com protocolo, número 50, série 1, ambiente 2", r.ok && [r.protocolo, r.numero, r.serie, r.ambiente, r.emContingencia ?? false], ["353260000000123", 50, 1, 2, false]);
    confere("uma chamada, na autorização da SVRS de homologação, método nfeAutorizacaoLote", [s.pedidos.length, s.pedidos[0]?.url, metodoDo(s.pedidos[0])], [1, "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx", "nfeAutorizacaoLote"]);
    if (r.ok) {
      confere("chave com tpEmis 1 e o número 50", [lerChave(r.chaveDeAcesso).tipoDeEmissao, lerChave(r.chaveDeAcesso).numero], [1, 50]);
      confere("emitidaEm = dhEmi da nota; sem URL de XML/DANFE (o XML vem em `xml`)", [r.emitidaEm, r.urlDoXml, r.urlDoDanfe], ["2026-09-29T12:00:00-03:00", null, null]);
      verdade("urlDoQrCode é o QR da nota", (r.urlDoQrCode ?? "").startsWith(`http://www.fazenda.df.gov.br/nfce/qrcode?p=${r.chaveDeAcesso}|2|2|1|`));
      guardar("nfeProc (autorizada)", "procNFe_v4.00.xsd", r.xml);
      verdade("a assinatura da NFe continua válida dentro do nfeProc", verificarAssinatura(r.xml ?? "").ok);
      const enviada = mensagemDoEnvelope(s.pedidos[0].corpo);
      confere("o que saiu foi um enviNFe com a NFe", [enviada.localName, elementos(enviada, "NFe").length], ["enviNFe", 1]);
    }
  }

  console.log("\n— emitirNfceNaSefaz: recusas —");
  {
    const rej = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: sefazFalsa((p) => responder("autorizacao-464.xml", p)).transporte }));
    confere("rejeição 464: motivo rejeitada, statusSefaz 464", !rej.ok && [rej.motivo, rej.statusSefaz], ["rejeitada", "464"]);
    verdade("mensagem traz o motivo da SEFAZ e o que fazer", !rej.ok && rej.mensagem.includes("[464]") && rej.mensagem.includes("CSC"), !rej.ok ? rej.mensagem : "");
    const lote = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: sefazFalsa((p) => responder("autorizacao-lote-225.xml", p)).transporte }));
    confere("lote rejeitado (225): rejeitada, statusSefaz 225", !lote.ok && [lote.motivo, lote.statusSefaz], ["rejeitada", "225"]);
    const r403 = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: sefazFalsa(() => ({ status: 403, corpo: "403 - Forbidden: Access is denied." })).transporte }));
    confere("HTTP 403 (certificado recusado no TLS): nao_configurado", !r403.ok && r403.motivo, "nao_configurado");
    const outroCnpj = await emitirNfceNaSefaz(
      (() => {
        const m = montarCorpoDaNfce({ id: "x", numero: 1, canal: "PDV", itens: [{ codigo: "a", descricao: "A", ncm: "21069090", cfop: "5102", unidadeComercial: "UN", quantidade: 1, valorUnitario: 5, valorTotal: 5, origem: 0, csosn: "102" }], valorTotal: 5, formaDePagamento: "Dinheiro" }, { ...CONFIG_NIK, cnpj: "11.222.333/0001-81" }, AGORA);
        if (!m.ok) throw new Error("corpo");
        return m.corpo;
      })(),
      ctxBase({ transporte: sefazFalsa(() => ({ status: 500, corpo: "" })).transporte })
    );
    verdade("certificado de outro CNPJ: nao_configurado ANTES de transmitir (213)", !outroCnpj.ok && outroCnpj.motivo === "nao_configurado" && /213/.test(outroCnpj.mensagem), !outroCnpj.ok ? outroCnpj.mensagem : "");
    const vencido = await emitirNfceNaSefaz(corpoDe(), ctxBase({ agora: () => new Date("2040-01-01T12:00:00Z"), transporte: sefazFalsa(() => ({ status: 500, corpo: "" })).transporte }));
    verdade("certificado vencido: nao_configurado", !vencido.ok && vencido.motivo === "nao_configurado" && /venceu/.test(vencido.mensagem), !vencido.ok ? vencido.mensagem : "");
    const senha = await emitirNfceNaSefaz(corpoDe(), ctxBase({ certificado: { pfx, senha: "errada" } }));
    verdade("senha errada: nao_configurado com a frase certa", !senha.ok && senha.motivo === "nao_configurado" && /Senha/.test(senha.mensagem), !senha.ok ? senha.mensagem : "");
    const incompleta = await emitirNfceNaSefaz({ ...corpoDe(), valor_total: 1 }, ctxBase({ transporte: sefazFalsa(() => ({ status: 500, corpo: "" })).transporte }));
    confere("corpo que não fecha: dados_incompletos, nada enviado", !incompleta.ok && incompleta.motivo, "dados_incompletos");
  }

  console.log("\n— emitirNfceNaSefaz: duplicidade e lote assíncrono —");
  {
    const s = sefazFalsa((p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-204.xml", p) : responder("consulta-100.xml", p, { DIGVAL: "" })));
    const r = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: s.transporte }));
    confere("204 (a tentativa anterior chegou): consulta e devolve a autorizada", [r.ok, s.pedidos.map(metodoDo)], [true, ["nfeAutorizacaoLote", "nfeConsultaNF"]]);
    if (r.ok) guardar("nfeProc (após duplicidade)", "procNFe_v4.00.xsd", r.xml);

    // Lote assíncrono: 103 com recibo, depois 105 (em processamento), depois 104 com o protocolo.
    let chave = "";
    const as = sefazFalsa((p, n) => {
      const m = metodoDo(p);
      if (m === "nfeAutorizacaoLote") {
        chave = (primeiro(mensagemDoEnvelope(p.corpo), "infNFe")?.getAttribute("Id") ?? "").slice(3);
        const env = fixture("autorizacao-lote-108.xml").replace("<cStat>108</cStat><xMotivo>Servico Paralisado Momentaneamente (curto prazo)</xMotivo>", "<cStat>103</cStat><xMotivo>Lote recebido com sucesso</xMotivo>");
        return { status: 200, corpo: env.replace("{{DHRECBTO}}", "2026-09-29T12:00:05-03:00").replace("</dhRecbto>", "</dhRecbto><infRec><nRec>531000012345678</nRec><tMed>1</tMed></infRec>") };
      }
      const ret = n === 2
        ? `<retConsReciNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SVRS202509251449</verAplic><nRec>531000012345678</nRec><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo><cUF>53</cUF><dhRecbto>2026-09-29T12:00:06-03:00</dhRecbto></retConsReciNFe>`
        : `<retConsReciNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SVRS202509251449</verAplic><nRec>531000012345678</nRec><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>53</cUF><dhRecbto>2026-09-29T12:00:07-03:00</dhRecbto><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS202509251449</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-09-29T12:00:07-03:00</dhRecbto><nProt>353260000000999</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retConsReciNFe>`;
      if (n === 3) guardar("retConsReciNFe de exemplo", "retConsReciNFe_v4.00.xsd", ret);
      return { status: 200, corpo: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4">${ret}</nfeResultMsg></soap:Body></soap:Envelope>` };
    });
    const ra = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: as.transporte }));
    confere("103 → consulta o recibo até sair o protocolo", [ra.ok && ra.protocolo, as.pedidos.map(metodoDo)], ["353260000000999", ["nfeAutorizacaoLote", "nfeRetAutorizacaoLote", "nfeRetAutorizacaoLote"]]);
  }

  // ─── Contingência ─────────────────────────────────────────────────────────
  console.log("\n— Contingência off-line —");
  let xmlDeContingencia = "";
  let chaveDeContingencia = "";
  {
    const antes = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: sefazFalsa(() => "timeout-antes").transporte }));
    confere("caiu ANTES de enviar: contingência com o MESMO número, sem número pendente", antes.ok && [antes.emContingencia, antes.numero, antes.numeroTentado, antes.protocolo], [true, 50, null, ""]);
    if (antes.ok) {
      confere("chave com tpEmis 9", lerChave(antes.chaveDeAcesso).tipoDeEmissao, 9);
      verdade("aviso fala em imprimir 'EMITIDA EM CONTINGÊNCIA' e transmitir", /EMITIDA EM CONTINGÊNCIA/.test(antes.aviso ?? "") && /transmita/.test(antes.aviso ?? ""));
      const doc = lerXml(antes.xml ?? "");
      confere("XML: tpEmis 9, dhCont, xJust com o motivo", [primeiro(doc, "tpEmis")?.textContent, primeiro(doc, "dhCont")?.textContent, /SEFAZ sem resposta/.test(primeiro(doc, "xJust")?.textContent ?? "")], ["9", "2026-09-29T12:00:00-03:00", true]);
      verdade("QR offline (dia|vNF|digVal)", /\|2\|2\|29\|15\.60\|[0-9a-f]{56}\|1\|[0-9A-F]{40}$/.test(antes.urlDoQrCode ?? ""), antes.urlDoQrCode ?? "");
      guardar("NFe de contingência", "nfe_v4.00.xsd", antes.xml);
      xmlDeContingencia = antes.xml ?? "";
      chaveDeContingencia = antes.chaveDeAcesso;
    }

    const semNumero = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: sefazFalsa(() => "timeout-depois").transporte }));
    verdade(
      "enviou e não veio resposta, sem número reserva: NÃO emite (o número pode estar autorizado) e manda consultar a chave",
      !semNumero.ok && semNumero.motivo === "erro_de_comunicacao" && /Consulte a chave \d{44}/.test(semNumero.mensagem),
      !semNumero.ok ? semNumero.mensagem : "emitiu"
    );
    const depois = await emitirNfceNaSefaz(corpoDe(), ctxBase({ numeroDeContingencia: 51, transporte: sefazFalsa(() => "timeout-depois").transporte }));
    confere("enviou e não veio resposta: contingência com OUTRO número (51) e o 50 pendente", depois.ok && [depois.emContingencia, depois.numero, depois.numeroTentado?.numero, lerChave(depois.numeroTentado?.chave ?? "0".repeat(44)).tipoDeEmissao], [true, 51, 50, 1]);
    const paralisada = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: sefazFalsa((p) => responder("autorizacao-lote-108.xml", p)).transporte }));
    confere("SEFAZ paralisada (108): contingência com o mesmo número", paralisada.ok && [paralisada.emContingencia, paralisada.numero], [true, 50]);
    const http500 = await emitirNfceNaSefaz(corpoDe(), ctxBase({ numeroDeContingencia: 52, transporte: sefazFalsa(() => ({ status: 500, corpo: fixture("soap-fault.xml") })).transporte }));
    confere("HTTP 500 com SOAP Fault: trata como 'pode ter chegado' → número reserva", http500.ok && [http500.emContingencia, http500.numero, http500.numeroTentado?.numero], [true, 52, 50]);
    const desligada = await emitirNfceNaSefaz(corpoDe(), ctxBase({ contingenciaOffline: false, transporte: sefazFalsa(() => "timeout-antes").transporte }));
    confere("contingência desligada: erro_de_comunicacao", !desligada.ok && desligada.motivo, "erro_de_comunicacao");

    // Número da contingência SOB DEMANDA: reservar a cada nota queimaria um
    // número por emissão (e cada um vira inutilização no mês seguinte).
    let reservas = 0;
    const reservar = async () => {
      reservas++;
      return 61;
    };
    const semPrecisar = await emitirNfceNaSefaz(corpoDe(), ctxBase({ reservarNumeroDeContingencia: reservar, transporte: sefazFalsa(() => "timeout-antes").transporte }));
    confere("caiu antes de enviar: a reserva da contingência NÃO é chamada (vai o mesmo número)", [semPrecisar.ok && semPrecisar.numero, reservas], [50, 0]);
    const autorizadaSemReserva = await emitirNfceNaSefaz(corpoDe(), ctxBase({ reservarNumeroDeContingencia: reservar, transporte: sefazFalsa((p) => responder("autorizacao-100.xml", p)).transporte }));
    confere("autorizada: a reserva da contingência NÃO é chamada", [autorizadaSemReserva.ok, reservas], [true, 0]);
    const comReserva = await emitirNfceNaSefaz(corpoDe(), ctxBase({ reservarNumeroDeContingencia: reservar, transporte: sefazFalsa(() => "timeout-depois").transporte }));
    confere(
      "enviou e não veio resposta: reserva chamada UMA vez; contingência com o número reservado e o 50 pendente",
      [comReserva.ok && comReserva.numero, comReserva.ok && comReserva.numeroTentado?.numero, reservas],
      [61, 50, 1]
    );
    const reservaQuebrada = await emitirNfceNaSefaz(
      corpoDe(),
      ctxBase({ reservarNumeroDeContingencia: () => Promise.reject(new Error("banco fora")), transporte: sefazFalsa(() => "timeout-depois").transporte })
    );
    verdade(
      "a reserva da contingência falhou: erro_de_comunicacao mandando consultar a chave (não inventa número)",
      !reservaQuebrada.ok && reservaQuebrada.motivo === "erro_de_comunicacao" && /Consulte a chave \d{44}/.test(reservaQuebrada.mensagem),
      !reservaQuebrada.ok ? reservaQuebrada.mensagem : "emitiu"
    );

    // aoAssinar: a nota assinada chega a quem integra ANTES de sair; se ele
    // não consegue guardar, nada sai (sem o XML, uma nota que ficasse sem
    // resposta não teria como virar nfeProc depois).
    const vistas: string[] = [];
    const sa = sefazFalsa((p) => responder("autorizacao-100.xml", p));
    const comGancho = await emitirNfceNaSefaz(
      corpoDe(),
      ctxBase({
        aoAssinar: (n) => {
          vistas.push(`${n.chave}|${n.numero}|${sa.pedidos.length}|${n.xml.includes("<Signature")}`);
        },
        transporte: sa.transporte,
      })
    );
    confere(
      "aoAssinar: chamado uma vez, antes do envio (nenhum pedido feito), com a nota assinada e a chave que foi autorizada",
      vistas,
      [`${comGancho.ok ? comGancho.chaveDeAcesso : "?"}|50|0|true`]
    );
    const sb = sefazFalsa((p) => responder("autorizacao-100.xml", p));
    let lancou = "";
    try {
      await emitirNfceNaSefaz(corpoDe(), ctxBase({ aoAssinar: () => { throw new Error("disco cheio"); }, transporte: sb.transporte }));
    } catch (e: any) {
      lancou = e.message;
    }
    confere("aoAssinar que lança: a exceção sobe e NADA é transmitido", [lancou, sb.pedidos.length], ["disco cheio", 0]);

    // Transmissão depois: a MESMA nota, a mesma chave.
    const s = sefazFalsa((p) => responder("autorizacao-100.xml", p));
    const t = await transmitirContingencia(xmlDeContingencia, ctxBase({ transporte: s.transporte }));
    confere("transmitirContingencia: autorizada, mesma chave, sem marca de contingência", t.ok && [t.chaveDeAcesso, t.protocolo, t.emContingencia ?? false], [chaveDeContingencia, "353260000000123", false]);
    verdade("o XML transmitido é byte a byte o guardado", s.pedidos[0]?.corpo.includes(xmlDeContingencia.replace(/^<\?xml[^>]*\?>/, "")) ?? false);
    if (t.ok) guardar("nfeProc (contingência autorizada)", "procNFe_v4.00.xsd", t.xml);
    const mexida = await transmitirContingencia(xmlDeContingencia.replace(/<vNF>[\d.]+<\/vNF>/, "<vNF>1.00</vNF>"), ctxBase({ transporte: s.transporte }));
    confere("XML de contingência alterado: não transmite", !mexida.ok && mexida.motivo, "dados_incompletos");
    const normal = await transmitirContingencia(autorizada?.ok ? (autorizada.xml ?? "").replace(/<protNFe[\s\S]*<\/protNFe>/, "").replace(/<\/?nfeProc[^>]*>/g, "") : "", ctxBase({ transporte: s.transporte }));
    confere("nota normal (tpEmis 1) não passa por transmitirContingencia", !normal.ok && normal.motivo, "dados_incompletos");
  }

  // ─── Consulta, cancelamento, inutilização, status ────────────────────────
  console.log("\n— Consulta, cancelamento, inutilização e status —");
  {
    const chave = autorizada?.ok ? autorizada.chaveDeAcesso : "";
    const xmlNFe = autorizada?.ok ? (autorizada.xml ?? "").replace(/^<\?xml[^>]*\?>/, "").replace(/<protNFe[\s\S]*<\/protNFe>/, "").replace(/<\/?nfeProc[^>]*>/g, "") : "";
    const c100 = await consultarNaSefaz(chave, { ...ctxBase({ transporte: sefazFalsa((p) => responder("consulta-100.xml", p, { DIGVAL: "" })).transporte }), xmlAssinado: xmlNFe });
    confere("consulta 100 com o XML: autorizada e com nfeProc", c100.ok && [c100.protocolo, Boolean(c100.xml)], ["353260000000123", true]);
    if (c100.ok) guardar("nfeProc (pela consulta)", "procNFe_v4.00.xsd", c100.xml);
    const c101 = await consultarNaSefaz(chave, ctxBase({ transporte: sefazFalsa((p) => responder("consulta-101.xml", p)).transporte }));
    verdade("consulta 101: 'foi CANCELADA'", !c101.ok && /CANCELADA/.test(c101.mensagem));
    const c217 = await consultarNaSefaz(chave, ctxBase({ transporte: sefazFalsa((p) => responder("consulta-217.xml", p)).transporte }));
    confere("consulta 217: não consta (erro_de_comunicacao, statusSefaz 217)", !c217.ok && [c217.motivo, c217.statusSefaz], ["erro_de_comunicacao", "217"]);

    const sc = sefazFalsa((p) => responder("evento-135.xml", p));
    const canc = await cancelarNaSefaz({ chave, protocolo: "353260000000123", justificativa: "Cliente desistiu da compra no caixa" }, ctxBase({ transporte: sc.transporte }));
    confere("cancelamento 135: ok com o protocolo do evento", canc.ok && [canc.protocolo, canc.mensagemSefaz], ["353260000000456", "Evento registrado e vinculado a NF-e"]);
    confere("cancelamento foi ao serviço de evento", [sc.pedidos[0]?.url, metodoDo(sc.pedidos[0])], ["https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx", "nfeRecepcaoEvento"]);
    if (canc.ok) guardar("procEventoNFe (cancelamento)", "evento/procEventoNFe_v1.00.xsd", (canc as any).xml);
    const dup = await cancelarNaSefaz({ chave, protocolo: "353260000000123", justificativa: "Cliente desistiu da compra no caixa" }, ctxBase({ transporte: sefazFalsa((p) => responder("evento-573.xml", p)).transporte }));
    verdade("cancelamento 573: rejeitado, 'já tem cancelamento'", !dup.ok && dup.motivo === "rejeitado" && /573/.test(dup.mensagem) && /já tem cancelamento/.test(dup.mensagem), !dup.ok ? dup.mensagem : "");
    const curta = await cancelarNaSefaz({ chave, protocolo: "353260000000123", justificativa: "desisti" }, ctxBase({ transporte: sc.transporte }));
    verdade("justificativa curta: recusa sem transmitir", !curta.ok && /15 a 255/.test(curta.mensagem) && sc.pedidos.length === 1);

    const si = sefazFalsa((p) => responder("inutilizacao-102.xml", p));
    const inu = await inutilizarNaSefaz({ cnpj: "64568087000180", serie: 1, numeroInicial: 10, numeroFinal: 12, justificativa: "Numeracao pulada por falha do sistema" }, ctxBase({ transporte: si.transporte }));
    confere("inutilização 102: ok, protocolo e faixa", inu.ok && [inu.protocolo, inu.statusSefaz, inu.numeroInicial, inu.numeroFinal], ["353260000000789", "102", 10, 12]);
    confere("inutilização foi ao serviço certo", metodoDo(si.pedidos[0]), "nfeInutilizacaoNF");
    if (inu.ok) guardar("procInutNFe", "procInutNFe_v4.00.xsd", (inu as any).xml);

    const st = await statusDoServico(ctxBase({ transporte: sefazFalsa((p) => responder("status-107.xml", p)).transporte }));
    confere("status 107: em operação", [st.ok, st.cStat, st.tempoMedio], [true, "107", 1]);
    const fora = await statusDoServico(ctxBase({ transporte: sefazFalsa(() => "timeout-depois").transporte }));
    confere("status sem resposta: ok false", [fora.ok, fora.cStat], [false, null]);
  }

  // ─── Recusa do lote × da nota, alerta, recibo, 539, 110112 ───────────────
  console.log("\n— Recusa do LOTE × da NOTA, autorizada com alerta, recibo, 539, 110112 —");
  {
    const emitir = (roteiro: Parameters<typeof sefazFalsa>[0], extra: Partial<ContextoDoEmissor> = {}) =>
      emitirNfceNaSefaz(corpoDe(), ctxBase({ ...extra, transporte: sefazFalsa(roteiro).transporte }));
    const lote = (fixture: string) => (p: Parameters<Parameters<typeof sefazFalsa>[0]>[0]) => responder(fixture, p);

    const r656 = await emitir(lote("autorizacao-lote-656.xml"));
    confere("lote 656 (consumo indevido): contingência com o MESMO número, e o 656 volta para quem integra", r656.ok && [r656.emContingencia, r656.numero, r656.numeroTentado, r656.statusSefaz], [true, 50, null, "656"]);
    const r656sem = await emitir(lote("autorizacao-lote-656.xml"), { contingenciaOffline: false });
    confere("…sem contingência: falha TRANSITÓRIA (retentativa), nunca 'rejeitada'", !r656sem.ok && [r656sem.motivo, r656sem.statusSefaz, r656sem.talvezNaSefaz], ["erro_de_comunicacao", "656", false]);
    const r999 = await emitir(lote("autorizacao-lote-999.xml"), { numeroDeContingencia: 51 });
    confere("lote 999 (a SEFAZ quebrou no meio): contingência com OUTRO número e o 50 a conferir", r999.ok && [r999.emContingencia, r999.numero, r999.numeroTentado?.numero], [true, 51, 50]);
    const r280 = await emitir(lote("autorizacao-lote-280.xml"));
    confere("lote 280 (certificado do transmissor): nao_configurado com a pendência do certificado", !r280.ok && [r280.motivo, r280.statusSefaz, (r280.pendencias ?? []).map((p) => p.campo)], ["nao_configurado", "280", ["certificado"]]);
    const r225 = await emitir(lote("autorizacao-lote-225.xml"));
    confere("lote 225 (schema da nota): 'rejeitada', mas NÃO recusa desta chave (não derruba contingência)", !r225.ok && [r225.motivo, r225.recusaDaNota], ["rejeitada", false]);
    const r464 = await emitir(lote("autorizacao-464.xml"));
    confere("protNFe desta chave com recusa (464): 'rejeitada' e recusaDaNota", !r464.ok && [r464.motivo, r464.recusaDaNota], ["rejeitada", true]);
    confere("a natureza de cada código", ["108", "999", "656", "286", "280", "290", "213", "225", "778"].map(naturezaDaRecusa), ["paralisada", "sistema", "sistema", "sistema", "certificado", "certificado", "certificado", "conteudo", "conteudo"]);

    const r120 = await emitir(lote("autorizacao-120.xml"));
    confere("120 (autorizada com alerta — NT 2026.002): autorizada, com a mensagem", r120.ok && [r120.protocolo, r120.alertaSefaz?.cStat, r120.alertaSefaz?.mensagens], ["353260000000123", "120", [{ codigo: "172", texto: "Alerta: Situacao do CNPJ destinatario inabilitado no momento da autorizacao" }]]);
    if (r120.ok) guardar("nfeProc com alerta (120)", "procNFe_v4.00.xsd", r120.xml);

    const r204 = await emitir((p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-204.xml", p) : "timeout-depois"));
    confere("204 e a consulta sem resposta: 'processando' (204), nunca 'rejeitada'", !r204.ok && [r204.motivo, r204.statusSefaz, r204.talvezNaSefaz], ["processando", "204", true]);

    const outra = chaveAutorizada; // uma chave válida (o 539 informa a chave que ocupa o número)
    const r539 = await emitir((p) => responder("autorizacao-539.xml", p, { DUPLICADA: outra }));
    confere("539: rejeitada, com a chave que ocupa o número (do xMotivo)", !r539.ok && [r539.statusSefaz, r539.chaveDuplicada], ["539", outra]);
    confere("a chave do xMotivo, com e sem espaço", [chaveDoMotivo(`Rejeicao: Duplicidade [chNFe: ${outra}][nRec:1]`), chaveDoMotivo(`[chNFe:${outra}]`), chaveDoMotivo("sem chave")], [outra, outra, null]);

    // O lote assíncrono sem desfecho: o recibo volta para ser consultado depois.
    const r103 = await emitir((p) => (metodoDo(p) === "nfeAutorizacaoLote" ? responder("autorizacao-103.xml", p) : responder("recibo-105.xml", p)));
    confere("103 e o recibo em 105: 'processando' COM o recibo (nRec)", !r103.ok && [r103.motivo, r103.recibo, r103.talvezNaSefaz], ["processando", "531000012345678", true]);
    const chaveDoRecibo = chaveAutorizada;
    const rr = await consultarReciboNaSefaz("531000012345678", { ...ctxBase({ transporte: sefazFalsa((p) => responder("recibo-104.xml", p, { CHAVE: chaveDoRecibo, DIGVAL: "" })).transporte }), chave: chaveDoRecibo });
    confere("consulta do recibo (104 com o protNFe desta chave): autorizada", rr.ok && [rr.protocolo, rr.recibo], ["353260000000999", "531000012345678"]);
    const r105 = await consultarReciboNaSefaz("531000012345678", { ...ctxBase({ transporte: sefazFalsa((p) => responder("recibo-105.xml", p)).transporte }), chave: chaveDoRecibo });
    confere("consulta do recibo em 105: 'processando' — nunca 'não consta'", !r105.ok && [r105.motivo, r105.statusSefaz], ["processando", "105"]);

    // A contingência RECUSADA, gerada de novo: mesma chave, mesmas datas.
    const cont = await emitirNfceNaSefaz(corpoDe(), ctxBase({ transporte: sefazFalsa(() => "timeout-antes").transporte }));
    const dados = cont.ok ? contingenciaDoXml(cont.xml ?? "") : null;
    const depois = ctxBase({ agora: () => new Date(AGORA.getTime() + 3 * 60 * 60_000), refazerContingencia: dados, transporte: sefazFalsa((p) => responder("autorizacao-100.xml", p)).transporte });
    const refeita = await emitirNfceNaSefaz(corpoDe(), depois);
    confere(
      "refazerContingencia: a MESMA chave (tpEmis 9) e o mesmo dhEmi, horas depois — autorizada",
      refeita.ok && cont.ok && [refeita.chaveDeAcesso === cont.chaveDeAcesso, lerChave(refeita.chaveDeAcesso).tipoDeEmissao, refeita.emitidaEm === cont.emitidaEm, refeita.emContingencia ?? false],
      [true, 9, true, false]
    );
    const semResposta = await emitirNfceNaSefaz(corpoDe(), ctxBase({ refazerContingencia: dados, transporte: sefazFalsa(() => "timeout-depois").transporte }));
    confere("refeita sem resposta: vale como contingência (a mesma chave), para transmitir depois", semResposta.ok && [semResposta.emContingencia, semResposta.chaveDeAcesso === (cont.ok ? cont.chaveDeAcesso : "")], [true, true]);
    const direta = await emitirNfceNaSefaz(corpoDe(), ctxBase({ contingenciaDireta: "SEFAZ bloqueada por consumo indevido (656) ate 14:00; emissao em contingencia off-line", transporte: sefazFalsa(() => ({ status: 500, corpo: "" })).transporte }));
    confere("contingenciaDireta: sem tocar a SEFAZ, contingência com o mesmo número", direta.ok && [direta.emContingencia, direta.numero, direta.numeroTentado], [true, 50, null]);

    // A consulta de uma cancelada devolve o procEventoNFe (a resposta do evento se perdeu).
    const chave = autorizada?.ok ? autorizada.chaveDeAcesso : "";
    const ev = montarEventoDeCancelamento(
      { chave, protocolo: "353260000000123", justificativa: "Cliente desistiu da compra no caixa", cnpj: "64568087000180", ambiente: 2, dhEvento: "2026-09-29T12:05:00-03:00", idLote: "1" },
      cert
    );
    const retEvento = /<retEvento[\s>][\s\S]*<\/retEvento>/.exec(fixture("evento-135.xml").replace(/\{\{CHAVE\}\}/g, chave).replace(/\{\{\w+\}\}/g, "2026-09-29T12:05:01-03:00"))?.[0] ?? "";
    const consultaComEvento = (p: Parameters<Parameters<typeof sefazFalsa>[0]>[0]) => {
      const r = responder("consulta-101.xml", p, { DIGVAL: "" });
      return { status: 200, corpo: r.corpo.replace("</retConsSitNFe>", `<procEventoNFe versao="1.00">${semDeclaracao(ev.evento)}${retEvento}</procEventoNFe></retConsSitNFe>`) };
    };
    const sCanc = sefazFalsa(consultaComEvento);
    const xmlNFe = autorizada?.ok ? (autorizada.xml ?? "").replace(/^<\?xml[^>]*\?>/, "").replace(/<protNFe[\s\S]*<\/protNFe>/, "").replace(/<\/?nfeProc[^>]*>/g, "") : "";
    const cc = await consultarNaSefaz(chave, { ...ctxBase({ transporte: sCanc.transporte }), xmlAssinado: xmlNFe });
    confere("consulta de cancelada: o evento (procEventoNFe) e o nfeProc voltam com a falha", !cc.ok && [cc.cancelamento?.tpEvento, cc.cancelamento?.protocolo, Boolean(cc.cancelamento?.xml), Boolean(cc.xml), cc.protocoloDaAutorizacao], ["110111", "353260000000456", true, true, "353260000000123"]);
    guardar("retConsSitNFe com procEventoNFe", "retConsSitNFe_v4.00.xsd", serializar(lerRespostaSoap(consultaComEvento(sCanc.pedidos[0]).corpo)));
    if (!cc.ok) guardar("procEventoNFe lido da consulta", "evento/procEventoNFe_v1.00.xsd", cc.cancelamento?.xml);

    // 110112: o leiaute do pacote "Evento Cancelamento por Substituição".
    const subst = montarEventoDeCancelamento(
      {
        chave, protocolo: "353260000000123", justificativa: "NFC-e substituida pela NFC-e de contingencia", cnpj: "64568087000180", ambiente: 2,
        dhEvento: "2026-09-29T12:05:00-03:00", idLote: "1", chaveSubstituta: chaveDeContingencia, versaoDoAplicativo: "FireHub NFC-e 1.0",
      },
      cert
    );
    guardar("envEvento 110112", "evento/cancsubst/envEventoCancSubst_v1.00.xsd", subst.envEvento);
    verdade("evento 110112 assinado confere", verificarAssinatura(subst.envEvento).ok);
    const sSubst = sefazFalsa((p) => responder("evento-135-substituicao.xml", p));
    const cs = await cancelarNaSefaz({ chave, protocolo: "353260000000123", justificativa: "NFC-e substituida pela NFC-e de contingencia", chaveSubstituta: chaveDeContingencia }, ctxBase({ transporte: sSubst.transporte }));
    confere("cancelamento por substituição: registrado, com o chNFeRef no pedido", [cs.ok, sSubst.pedidos[0]?.corpo.includes(`<chNFeRef>${chaveDeContingencia}</chNFeRef>`)], [true, true]);
    if (cs.ok) guardar("procEventoNFe 110112", "evento/cancsubst/procEventoCancSubst_v1.00.xsd", cs.xml);
    let recusou = "";
    try {
      montarEventoDeCancelamento({ chave, protocolo: "353260000000123", justificativa: "NFC-e substituida pela propria", cnpj: "64568087000180", ambiente: 2, dhEvento: "2026-09-29T12:05:00-03:00", idLote: "1", chaveSubstituta: chave }, cert);
    } catch (e: any) {
      recusou = e.message;
    }
    verdade("110112 com a própria chave como substituta: recusado antes de sair", /própria nota/.test(recusou), recusou);
    const perdido = await cancelarNaSefaz({ chave, protocolo: "353260000000123", justificativa: "Cliente desistiu da compra no caixa" }, ctxBase({ transporte: sefazFalsa(() => "timeout-depois").transporte }));
    confere("cancelamento sem resposta depois de sair: 'pode ter sido registrado'", !perdido.ok && [perdido.motivo, perdido.enviado, /PODE ter sido registrado/.test(perdido.mensagem)], ["erro_de_comunicacao", true, true]);

    // Inutilização: o pedido assinado sai para quem integra antes de ir, e a recusa traz o cStat.
    const assinados: string[] = [];
    const i256 = await inutilizarNaSefaz(
      { cnpj: "64568087000180", serie: 1, numeroInicial: 10, numeroFinal: 10, justificativa: "Numeracao pulada por falha do sistema" },
      { ...ctxBase({ transporte: sefazFalsa((p) => responder("inutilizacao-256.xml", p)).transporte }), aoAssinarPedido: (x) => void assinados.push(x) }
    );
    confere("inutilização 256 ('já inutilizada'): a falha traz o statusSefaz, e o pedido assinado saiu antes", [!i256.ok && i256.statusSefaz, assinados.length, assinados[0]?.includes("<Signature")], ["256", 1, true]);
  }

  // ─── Tudo que foi guardado, contra o XSD ─────────────────────────────────
  console.log(`\n— ${paraValidar.length} documentos contra os schemas oficiais —`);
  const resultados = validarNoXsd(paraValidar.map((p) => ({ xsd: p.xsd, xml: p.xml })));
  resultados.forEach((r, i) => verdade(`XSD: ${paraValidar[i].nome} (${paraValidar[i].xsd})`, r.ok, r.erros.join(" | ")));
}

principal()
  .then(() => terminar())
  .catch((e) => {
    console.error("❌ exceção:", e);
    process.exit(1);
  });
