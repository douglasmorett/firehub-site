/**
 * Trava o CADASTRO DO EMISSOR PRÓPRIO: o envio do certificado A1
 * (lib/nfce/envio-do-certificado + a rota api/store/fiscal/certificado), o
 * cofre, o bloco `fiscalConfig.sefaz` do PUT (lib/nfce/cadastro-do-emissor),
 * as pendências e o checklist, a escolha do emissor, a gravação com
 * compare-and-swap, os dados da Receita e o passo a passo por UF.
 *
 *   npx tsx scripts/teste-nfce-certificado.ts
 *
 * O certificado de verdade do teste é scripts/fixtures/nfce-certificado-teste.pfx
 * (auto-assinado, CNPJ da NIK, senha "firehub-teste" — scripts/nfce-certificado-de-teste.mjs).
 * Os outros (outra empresa, filial, vencido, e-CPF...) são gerados aqui com o
 * openssl, num diretório temporário. O cofre roda em FH_FISCAL_DIR temporário.
 * Nada fala com banco nem com a SEFAZ.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COFRE = mkdtempSync(join(tmpdir(), "nfce-cofre-"));
process.env.FH_FISCAL_DIR = COFRE;
process.env.FISCAL_CHAVE = "chave-de-teste-do-certificado-nfce";

import { cifrar, decifrar } from "../src/lib/fiscal-credenciais";
import { cnpjValido } from "../src/lib/fiscal-validacao";
import { pendenciasParaEmitir } from "../src/lib/fiscal-emissao";
import { configParaConferencia, retratoDoCadastro } from "../src/lib/fiscal-config";
import { guardarArquivoFiscal, lerArquivoFiscal } from "../src/lib/nfce/armazenamento";
import { certificadoDaLoja, qrCodeDaLoja } from "../src/lib/nfce/credenciais-da-loja";
import {
  aplicarFormularioDoEmissor,
  cnpjParaConferir,
  emissorParaTela,
  lerProvedor,
  conferirComEmissorProprio,
  prontidaoDoEmissor,
  provedorEfetivo,
  SERIE_SUGERIDA,
} from "../src/lib/nfce/cadastro-do-emissor";
import type { ConfigDoEmissorProprio } from "../src/lib/nfce/config-da-loja";
import { mesmoTexto, sugestoesDaReceita } from "../src/lib/nfce/dados-da-receita";
import {
  apagarDoCofre,
  conferirCertificadoEnviado,
  identificacaoDoA1,
  registroDoCertificado,
  type CertificadoConferido,
} from "../src/lib/nfce/envio-do-certificado";
import { alterarFiscalConfig, ConflitoNaGravacao, LojaNaoEncontrada, type BancoDaConfigFiscal } from "../src/lib/nfce/gravar-config-fiscal";
import { passoAPassoDaUf } from "../src/lib/nfce/passo-a-passo-da-sefaz";

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

const FIXTURES = join(__dirname, "fixtures");
const SENHA = "firehub-teste";
const CNPJ_NIK = "64568087000180";
const AGORA = new Date("2026-09-29T12:00:00-03:00");
const PFX_NIK = readFileSync(join(FIXTURES, "nfce-certificado-teste.pfx"));
const PFX_NIK_3DES = readFileSync(join(FIXTURES, "nfce-certificado-teste-3des.pfx"));

// ─── Certificados gerados na hora (openssl) ─────────────────────────────────

function acharOpenssl(): string {
  for (const c of [process.env.OPENSSL, "openssl", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"].filter(Boolean) as string[]) {
    try {
      execFileSync(c, ["version"], { stdio: "pipe" });
      return c;
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error("openssl não encontrado (defina OPENSSL=<caminho>).");
}
const OPENSSL = acharOpenssl();
const TMP = mkdtempSync(join(tmpdir(), "nfce-cert-"));

/** Um A1 de TESTE no formato ICP-Brasil de PJ (o mesmo molde de scripts/nfce-certificado-de-teste.mjs). */
function gerarPfx(p: { nome: string; cnpj?: string | null; cn: string; senha: string; de: string; ate: string }): Buffer {
  const pasta = join(TMP, p.nome);
  execFileSync(OPENSSL, ["version"], { stdio: "pipe" });
  const cnf = `${pasta}.cnf`;
  const san = p.cnpj
    ? `subjectAltName = @san\n\n[san]\notherName.1 = 2.16.76.1.3.3;FORMAT:ASCII,OCT:${p.cnpj}\n`
    : `subjectAltName = @san\n\n[san]\nemail.1 = teste@firehub.invalid\n`;
  writeFileSync(
    cnf,
    `[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = ext\nstring_mask = utf8only\n\n[dn]\nC = BR\nO = ICP-Brasil\nOU = Certificado de TESTE\nCN = ${p.cn}\n\n[ext]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,nonRepudiation,keyEncipherment\nextendedKeyUsage = clientAuth\n${san}`
  );
  execFileSync(OPENSSL, ["genrsa", "-out", `${pasta}.key`, "2048"], { stdio: "pipe" });
  execFileSync(OPENSSL, ["req", "-new", "-x509", "-key", `${pasta}.key`, "-out", `${pasta}.pem`, "-sha256", "-config", cnf, "-not_before", p.de, "-not_after", p.ate], { stdio: "pipe" });
  execFileSync(OPENSSL, ["pkcs12", "-export", "-inkey", `${pasta}.key`, "-in", `${pasta}.pem`, "-out", `${pasta}.pfx`, "-passout", `pass:${p.senha}`, "-name", p.nome], { stdio: "pipe" });
  return readFileSync(`${pasta}.pfx`);
}

/** O CNPJ de outro estabelecimento da NIK (mesma raiz 64568087, filial 0002), com os dígitos certos. */
const CNPJ_FILIAL = (() => {
  for (let dv = 0; dv < 100; dv++) {
    const c = `645680870002${String(dv).padStart(2, "0")}`;
    if (cnpjValido(c)) return c;
  }
  throw new Error("sem DV");
})();

async function main() {
console.log("— o envio do certificado");
{
  const ok = conferirCertificadoEnviado({ pfx: PFX_NIK, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  verdade("o A1 da NIK com a senha certa passa", ok.ok, JSON.stringify(ok));
  if (ok.ok) {
    confere("CNPJ lido do certificado, mesmo estabelecimento, sem aviso", [ok.cnpj, ok.outroEstabelecimento, ok.avisos], [CNPJ_NIK, false, []]);
    confere("o titular é o CN do certificado", ok.cert.titular, `NIK COMERCIO DE ALIMENTOS LTDA:${CNPJ_NIK}`);
    verdade("o hash é do arquivo (64 hex)", /^[0-9a-f]{64}$/.test(ok.sha256));
  }
  const tresDes = conferirCertificadoEnviado({ pfx: PFX_NIK_3DES, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  verdade("o .pfx no formato antigo (3DES, que o OpenSSL 3 recusa) também passa", tresDes.ok);

  const errada = conferirCertificadoEnviado({ pfx: PFX_NIK, senha: "senha-errada", cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("senha errada: recusado, em português", errada.ok ? "passou" : [errada.status, errada.mensagem], [400, "Senha do certificado digital incorreta."]);
  verdade("a mensagem da senha errada não repete a senha", !JSON.stringify(errada).includes("senha-errada"));
  const semSenha = conferirCertificadoEnviado({ pfx: PFX_NIK, senha: "", cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("sem senha: recusado", semSenha.ok ? "passou" : semSenha.erro, "sem_senha");

  const outra = gerarPfx({ nome: "outra", cnpj: "11222333000181", cn: "OUTRA EMPRESA LTDA:11222333000181", senha: SENHA, de: "20250101000000Z", ate: "20351231235959Z" });
  const recusaOutra = conferirCertificadoEnviado({ pfx: outra, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("certificado de OUTRA empresa: recusado (rejeição 213), com os dois CNPJs", recusaOutra.ok ? "passou" : [recusaOutra.status, recusaOutra.erro, /11\.222\.333\/0001-81/.test(recusaOutra.mensagem), /64\.568\.087\/0001-80/.test(recusaOutra.mensagem), /213/.test(recusaOutra.mensagem)], [400, "outro_cnpj", true, true, true]);

  const filial = gerarPfx({ nome: "filial", cnpj: CNPJ_FILIAL, cn: `NIK COMERCIO DE ALIMENTOS LTDA:${CNPJ_FILIAL}`, senha: SENHA, de: "20250101000000Z", ate: "20351231235959Z" });
  const daFilial = conferirCertificadoEnviado({ pfx: filial, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("certificado da FILIAL (mesma raiz): aceito, com o aviso do Ajuste SINIEF 19/16", daFilial.ok ? [daFilial.cnpj, daFilial.outroEstabelecimento, daFilial.avisos.some((a) => /SINIEF 19\/16/.test(a) && /raiz/.test(a))] : daFilial, [CNPJ_FILIAL, true, true]);

  const vencido = gerarPfx({ nome: "vencido", cnpj: CNPJ_NIK, cn: `NIK:${CNPJ_NIK}`, senha: SENHA, de: "20200101000000Z", ate: "20210101000000Z" });
  const recusaVencido = conferirCertificadoEnviado({ pfx: vencido, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("certificado VENCIDO: recusado, com a data", recusaVencido.ok ? "passou" : [recusaVencido.erro, /01\/01\/2021|31\/12\/2020/.test(recusaVencido.mensagem)], ["vencido", true]);

  const futuro = gerarPfx({ nome: "futuro", cnpj: CNPJ_NIK, cn: `NIK:${CNPJ_NIK}`, senha: SENHA, de: "20300101000000Z", ate: "20310101000000Z" });
  const recusaFuturo = conferirCertificadoEnviado({ pfx: futuro, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("certificado que ainda não vale: recusado", recusaFuturo.ok ? "passou" : recusaFuturo.erro, "ainda_nao_vale");

  const ecpf = gerarPfx({ nome: "ecpf", cnpj: null, cn: "FULANO DE TAL", senha: SENHA, de: "20250101000000Z", ate: "20351231235959Z" });
  const recusaCpf = conferirCertificadoEnviado({ pfx: ecpf, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("certificado sem CNPJ (e-CPF): recusado", recusaCpf.ok ? "passou" : recusaCpf.erro, "sem_cnpj");

  const comEspaco = gerarPfx({ nome: "espaco", cnpj: CNPJ_NIK, cn: `NIK:${CNPJ_NIK}`, senha: "segredo ", de: "20250101000000Z", ate: "20351231235959Z" });
  const recusaEspaco = conferirCertificadoEnviado({ pfx: comEspaco, senha: "segredo ", cnpjDaLoja: CNPJ_NIK, agora: AGORA });
  confere("senha com espaço na ponta (o cofre não guarda): recusado com a explicação", recusaEspaco.ok ? "passou" : recusaEspaco.erro, "senha_com_espaco");

  const perto = conferirCertificadoEnviado({ pfx: PFX_NIK, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: new Date("2035-12-21T12:00:00Z") });
  confere("a 10 dias de vencer: aceito, com o alerta", perto.ok ? perto.avisos.some((a) => /vence em/.test(a)) : perto, true);

  confere("sem CNPJ da loja para comparar: 409, pede para salvar antes", (() => { const r = conferirCertificadoEnviado({ pfx: PFX_NIK, senha: SENHA, cnpjDaLoja: null, agora: AGORA }); return r.ok ? "passou" : [r.status, r.erro]; })(), [409, "sem_cnpj_da_loja"]);
  confere("arquivo que não é .pfx (o .cer em texto): recusado sem tentar abrir", (() => { const r = conferirCertificadoEnviado({ pfx: Buffer.from("-----BEGIN CERTIFICATE-----"), senha: SENHA, cnpjDaLoja: CNPJ_NIK }); return r.ok ? "passou" : r.erro; })(), "nao_e_pfx");
  confere("arquivo grande demais (60 KB): 413", (() => { const r = conferirCertificadoEnviado({ pfx: Buffer.concat([Buffer.from([0x30]), Buffer.alloc(60 * 1024)]), senha: SENHA, cnpjDaLoja: CNPJ_NIK }); return r.ok ? "passou" : [r.status, r.erro]; })(), [413, "grande_demais"]);
  confere("sem arquivo: recusado", (() => { const r = conferirCertificadoEnviado({ pfx: null, senha: SENHA, cnpjDaLoja: CNPJ_NIK }); return r.ok ? "passou" : r.erro; })(), "sem_arquivo");
  confere("cnpjParaConferir: o gravado; sem ele, o documento da loja; CPF não serve", [cnpjParaConferir({ cnpj: "64.568.087/0001-80" }, null), cnpjParaConferir({}, CNPJ_NIK), cnpjParaConferir({}, "52998224725")], [CNPJ_NIK, CNPJ_NIK, null]);
}

console.log("\n— o cofre e o registro");
let registro: ReturnType<typeof registroDoCertificado> | null = null;
{
  const conferido = conferirCertificadoEnviado({ pfx: PFX_NIK, senha: SENHA, cnpjDaLoja: CNPJ_NIK, agora: AGORA }) as CertificadoConferido;
  const arquivo = await guardarArquivoFiscal({ lojaId: "cmtn5q78c00ebte01zsqrggqx", tipo: "certificado", identificacao: identificacaoDoA1(conferido.sha256), conteudo: PFX_NIK });
  const noDisco = readFileSync(join(COFRE, arquivo.caminho));
  verdade("o .pfx vai CIFRADO para o disco (não é o arquivo, nem começa como um PKCS#12)", !noDisco.includes(PFX_NIK.subarray(0, 64)) && noDisco.subarray(0, 4).toString() === "FHC2");
  verdade("o nome do arquivo é opaco (não tem o CNPJ nem \"a1\")", !arquivo.caminho.includes(CNPJ_NIK) && /\/certificado\/geral\/[0-9a-f]{40}\.fh$/.test(arquivo.caminho));
  const lido = await lerArquivoFiscal(arquivo.caminho, arquivo.sha256);
  verdade("volta igual do cofre, conferido pelo hash", lido.equals(PFX_NIK));
  confere("o hash guardado é o do arquivo em claro", arquivo.sha256, conferido.sha256);
  const senhaCifrada = cifrar(SENHA)!;
  registro = registroDoCertificado({ conferido, arquivo, senhaCifrada, enviadoPor: "dono@nik.com", agora: AGORA });
  confere("o registro tem o que a tela mostra e as referências do cofre", Object.keys(registro).sort(), ["arquivo", "cnpj", "enviadoEm", "enviadoPor", "senhaCifrada", "sha256", "titular", "validoAte", "validoDe"]);
  verdade("a senha está cifrada no registro (e decifra de volta)", registro.senhaCifrada.startsWith("fh2:") && decifrar(registro.senhaCifrada) === SENHA && !JSON.stringify(registro).includes(SENHA));
  verdade("o registro não carrega o conteúdo do .pfx", !JSON.stringify(registro).includes(PFX_NIK.toString("base64").slice(0, 40)));
  // O que a tela grava é o que a EMISSÃO lê (lib/nfce/credenciais-da-loja, da
  // frente de emissão): o .pfx do cofre com a senha decifrada, e o CSC.
  const lido2 = await certificadoDaLoja({ sefaz: { certificado: registro } });
  confere("a emissão abre o certificado gravado pelo envio (cofre + senha cifrada)", [lido2.cnpj, lido2.titular], [CNPJ_NIK, `NIK COMERCIO DE ALIMENTOS LTDA:${CNPJ_NIK}`]);
  const CSC = "ABCDEF0123456789ABCDEF0123456789ABCD";
  const formulario = aplicarFormularioDoEmissor({}, { csc: { homologacao: { id: "000001", codigo: CSC } } }, { papel: "FRANCHISEE", cifrar: (x: string) => cifrar(x), emissaoLigadaNoProprio: false, ambiente: 2 });
  confere("a emissão lê o CSC que o PUT gravou (versão 2, o ID e o código)", formulario.ok ? qrCodeDaLoja({ sefaz: formulario.sefaz }, 2) : formulario, { versao: 2, idCsc: "000001", csc: CSC });
  // Trocar o certificado não sobrescreve o arquivo em uso: cada um tem o seu.
  const outroHash = identificacaoDoA1("f".repeat(64));
  verdade("certificados diferentes caem em arquivos diferentes (a troca não tem janela)", outroHash !== identificacaoDoA1(conferido.sha256));
  verdade("apagar do cofre funciona dentro dele...", await apagarDoCofre(arquivo.caminho));
  verdade("...o arquivo sumiu", !existsSync(join(COFRE, arquivo.caminho)));
  verdade("...e recusa caminho para fora do cofre", !(await apagarDoCofre("../../fora.txt")));
}

console.log("\n— o retrato para a tela (sem segredo nenhum)");
const CONFIG_NIK: Record<string, unknown> = {
  provedor: "sefaz",
  enabled: false,
  ambiente: 2,
  cnpj: CNPJ_NIK,
  inscricaoEstadual: "0712345600123",
  razaoSocial: "NIK COMERCIO DE ALIMENTOS LTDA",
  nomeFantasia: "NIK ESFIHAS E PIZZAS",
  regimeTributario: 1,
  logradouro: "QUADRA 5 COMERCIO LOCAL",
  numero: "17",
  complemento: "LOJA 03 E 07",
  bairro: "SOBRADINHO",
  municipio: "BRASILIA",
  codigoMunicipio: "5300108",
  uf: "DF",
  cep: "73031-545",
  serie: 1,
};
{
  const sefaz: ConfigDoEmissorProprio = {
    certificado: registro!,
    csc: { homologacao: { id: "1", cifrado: cifrar("HOMOLOGACAO0123456789ABCDEF0123456789")!, final: "6789" }, producao: null },
    serie: 2,
    numeroInicial: 1,
    qrVersao: 2,
    contingenciaOffline: true,
  };
  const tela = emissorParaTela({ ...CONFIG_NIK, sefaz }, AGORA);
  const json = JSON.stringify(tela);
  confere("a tela não recebe caminho do cofre, hash, senha nem CSC cifrado", ["arquivo", "sha256", "senhaCifrada", "cifrado", "fh1:", "fh2:", "HOMOLOGACAO"].filter((k) => json.includes(k)), []);
  confere("titular, CNPJ, validade e situação", [tela.certificado?.cnpjFormatado, tela.certificado?.validoAte.slice(0, 10), tela.certificado?.situacao, tela.certificado?.mesmaEmpresa], ["64.568.087/0001-80", "2035-12-31", "ok", true]);
  confere("CSC: só o ID e o final", tela.csc, { homologacao: { id: "1", final: "6789" }, producao: null });
  confere("pronto em homologação (certificado + CSC), não em produção (sem CSC)", tela.prontoNoAmbiente, { homologacao: true, producao: false });
  const venceLogo = emissorParaTela({ ...CONFIG_NIK, sefaz }, new Date("2035-12-10T12:00:00Z"));
  confere("a 21 dias de vencer: \"vence_em_breve\" (o alerta começa 30 dias antes)", [venceLogo.certificado?.situacao, venceLogo.certificado?.dias], ["vence_em_breve", 21]);
  const vencido = emissorParaTela({ ...CONFIG_NIK, sefaz }, new Date("2036-01-02T12:00:00Z"));
  confere("vencido: não está pronto em ambiente nenhum", [vencido.certificado?.situacao, vencido.prontoNoAmbiente], ["vencido", { homologacao: false, producao: false }]);
  const outraLoja = emissorParaTela({ ...CONFIG_NIK, cnpj: "11222333000181", sefaz }, AGORA);
  confere("CNPJ da loja trocado depois: o certificado é de outra empresa", [outraLoja.certificado?.mesmaEmpresa, outraLoja.prontoNoAmbiente.homologacao], [false, false]);
  const semNada = emissorParaTela({ ...CONFIG_NIK }, AGORA);
  confere("sem bloco sefaz: série sugerida 2, QR 2, contingência ligada", [semNada.serie, semNada.serieSugerida, semNada.qrVersao, semNada.contingenciaOffline, semNada.certificado], [null, SERIE_SUGERIDA, 2, true, null]);
  verdade("o motivo da série fala da Saipos e da rejeição 539", /Saipos/.test(semNada.motivoDaSerie) && /539/.test(semNada.motivoDaSerie));
}

console.log("\n— o bloco `sefaz` no PUT (aplicarFormularioDoEmissor)");
{
  const titular = { papel: "FRANCHISEE", cifrar: (s: string) => cifrar(s), emissaoLigadaNoProprio: false, ambiente: 2 as const };
  const CSC_H = "ABCDEF0123456789ABCDEF0123456789ABCD";
  const r = aplicarFormularioDoEmissor({}, { serie: 2, numeroInicial: 1, qrVersao: 2, contingenciaOffline: true, csc: { homologacao: { id: "000001", codigo: CSC_H } } }, titular);
  verdade("titular: grava série, número, QR, contingência e o CSC", r.ok && r.mudou && r.sefaz.serie === 2 && r.sefaz.numeroInicial === 1 && r.sefaz.qrVersao === 2 && r.sefaz.contingenciaOffline === true);
  if (r.ok) {
    const c = r.sefaz.csc?.homologacao;
    confere("o CSC vai cifrado, com o ID e o final", [c?.id, c?.final, c?.cifrado.startsWith("fh2:"), decifrar(c?.cifrado) === CSC_H], ["000001", "ABCD", true, true]);
    verdade("o CSC em claro não aparece no bloco gravado", !JSON.stringify(r.sefaz).includes(CSC_H));
  }
  const staff = aplicarFormularioDoEmissor({ serie: 1 }, { serie: 2, csc: { producao: { id: "2", codigo: CSC_H } }, qrVersao: 3 }, { ...titular, papel: "STAFF" });
  confere("STAFF: nada muda, e a resposta diz o quê", staff.ok ? [staff.mudou, staff.recusados, staff.sefaz.serie] : staff, [false, ["sefaz.serie", "sefaz.qrVersao", "sefaz.csc.producao"], 1]);
  const staffSemMudar = aplicarFormularioDoEmissor({ serie: 2 }, { serie: 2 }, { ...titular, papel: "STAFF" });
  confere("STAFF mandando o mesmo valor: não é recusa", staffSemMudar.ok ? staffSemMudar.recusados : staffSemMudar, []);
  confere("série 0: 400", (() => { const x = aplicarFormularioDoEmissor({}, { serie: 0 }, titular); return x.ok ? "passou" : [x.status, x.corpo.error]; })(), [400, "serie_invalido"]);
  confere("ID do CSC com letras: 400", (() => { const x = aplicarFormularioDoEmissor({}, { csc: { homologacao: { id: "abc", codigo: CSC_H } } }, titular); return x.ok ? "passou" : x.status; })(), 400);
  confere("CSC com espaço no meio: 400, sem repetir o CSC", (() => { const x = aplicarFormularioDoEmissor({}, { csc: { homologacao: { id: "1", codigo: "ABC DEF 123" } } }, titular); return x.ok ? "passou" : [x.status, x.corpo.mensagem.includes("ABC DEF")]; })(), [400, false]);
  const soId = aplicarFormularioDoEmissor({ csc: { homologacao: { id: "1", cifrado: "fh1:x", final: "ABCD" } } }, { csc: { homologacao: { id: "2", codigo: "" } } }, titular);
  confere("trocar só o ID sem o CSC: não grava e avisa", soId.ok ? [soId.mudou, soId.avisos.length > 0, soId.sefaz.csc?.homologacao?.id] : soId, [false, true, "1"]);
  const ligada = { ...titular, emissaoLigadaNoProprio: true };
  confere("com a emissão ligada: trocar a série é 409", (() => { const x = aplicarFormularioDoEmissor({ serie: 2 }, { serie: 3 }, ligada); return x.ok ? "passou" : [x.status, x.corpo.error]; })(), [409, "emissao_ligada"]);
  confere("com a emissão ligada: mandar a mesma série passa", (() => { const x = aplicarFormularioDoEmissor({ serie: 2 }, { serie: 2 }, ligada); return x.ok ? x.mudou : x; })(), false);
  confere("com a emissão ligada: tirar o CSC do ambiente em uso é 409", (() => { const x = aplicarFormularioDoEmissor({ csc: { homologacao: { id: "1", cifrado: "fh1:x", final: "ABCD" } } }, { csc: { homologacao: null } }, ligada); return x.ok ? "passou" : x.corpo.error; })(), "csc_em_uso");
  confere("sem a emissão ligada: tirar o CSC passa", (() => { const x = aplicarFormularioDoEmissor({ csc: { homologacao: { id: "1", cifrado: "fh1:x", final: "ABCD" } } }, { csc: { homologacao: null } }, titular); return x.ok ? [x.mudou, x.sefaz.csc?.homologacao] : x; })(), [true, null]);
  const qr3 = aplicarFormularioDoEmissor({}, { qrVersao: 3 }, titular);
  verdade("QR versão 3: grava com o aviso de que depende da UF", qr3.ok && qr3.sefaz.qrVersao === 3 && qr3.avisos.some((a) => /UF/.test(a)));
  confere("corpo sem `sefaz`: nada muda", (() => { const x = aplicarFormularioDoEmissor({ serie: 2 }, undefined, titular); return x.ok ? x.mudou : x; })(), false);
}

console.log("\n— pendências do emissor próprio e o checklist");
{
  // O que a rota faz: o retrato gravado → pendenciasParaEmitir (a MESMA da
  // emissão, que no emissor próprio usa lib/nfce/pendencias) → a série.
  const conferir = (c: Record<string, unknown>) => {
    const { config } = retratoDoCadastro(c, null);
    return conferirComEmissorProprio(pendenciasParaEmitir(configParaConferencia(config)), config);
  };
  const campos = (c: Record<string, unknown>) => conferir(c).map((p) => p.campo).sort();
  confere("loja nova no emissor do FireHub: certificado, CSC do ambiente e a série", campos(CONFIG_NIK), ["certificado", "csc", "cscId", "serie"]);
  const pronta = { ...CONFIG_NIK, sefaz: { certificado: registro, csc: { homologacao: { id: "1", cifrado: "fh1:x", final: "ABCD" } }, serie: 2 } };
  confere("com certificado, CSC de homologação e série: nada falta em homologação", campos(pronta), []);
  confere(
    "sem escolher a série do emissor: a tela e o ligar exigem (a emissão cairia na 1, a que a Saipos usou)",
    campos({ ...pronta, sefaz: { ...(pronta.sefaz as object), serie: undefined } }),
    ["serie"]
  );
  confere("em produção sem o CSC de produção: falta o CSC", campos({ ...pronta, ambiente: 1 }), ["csc", "cscId"]);
  confere("QR v3 dispensa o CSC", campos({ ...pronta, ambiente: 1, sefaz: { ...(pronta.sefaz as object), qrVersao: 3 } }), []);
  confere(
    "certificado vencido: pendência",
    campos({ ...pronta, sefaz: { ...(pronta.sefaz as object), certificado: { ...registro!, validoAte: "2021-01-01T00:00:00.000Z" } } }),
    ["certificado"]
  );
  confere("SP é atendida desde 09/10/2026: só a IE (a de 13 dígitos é do DF, não de SP)", campos({ ...pronta, uf: "SP" }), ["inscricaoEstadual"]);
  verdade("UF que não existe (ZZ): pendência de UF", campos({ ...pronta, uf: "ZZ" }).includes("uf"));
  // Desde 09/10/2026 a Focus não é mais oferecida: sem emissor gravado, a
  // loja É do Emissor do FireHub — nada de "escolha quem transmite".
  confere("sem emissor gravado: é o Emissor do FireHub, com a conferência dele", conferir({ ...pronta, provedor: null }).map((p) => p.campo), []);
  const antigaNaFocus = conferir({ ...CONFIG_NIK, provedor: null, tokenDoProvedor: cifrar("tok"), cscId: "1", csc: "X".repeat(36), temCertificado: true });
  verdade(
    "loja antiga na Focus (token, sem escolha gravada): continua na Focus e a pendência manda passar para o FireHub",
    antigaNaFocus.some((p) => p.campo === "provedor" && /Emissor do FireHub/.test(p.mensagem)) && !antigaNaFocus.some((p) => p.campo === "serie")
  );
  confere(
    "loja na Focus: a conferência de sempre, sem a série do emissor próprio",
    conferir({ ...CONFIG_NIK, provedor: "focusnfe", tokenDoProvedor: cifrar("tok"), cscId: "1", csc: "X".repeat(36), temCertificado: true }).map((p) => p.campo),
    []
  );
  const itens = prontidaoDoEmissor(pronta, { produtosSemNcm: 163, totalDeProdutos: 163, temNotaDeHomologacao: false, agora: AGORA });
  confere("o checklist, na ordem do caminho", itens.map((i) => i.chave), ["certificado", "csc", "ie", "empresa", "ncm", "conexao", "respTec", "homologacao", "notaDeTeste", "producao"]);
  confere("responsável técnico não conferido (extras sem o campo): não acusa", itens.find((i) => i.chave === "respTec")?.ok, true);
  confere(
    "responsável técnico ausente no servidor: o checklist acusa e diz que é com o FireHub",
    (() => {
      const item = prontidaoDoEmissor(pronta, { produtosSemNcm: 0, totalDeProdutos: 1, temNotaDeHomologacao: false, responsavelTecnicoOk: false, agora: AGORA }).find((i) => i.chave === "respTec");
      return [item?.ok, /972/.test(item?.detalhe ?? ""), /FireHub/.test(item?.detalhe ?? "")];
    })(),
    [false, true, true]
  );
  confere("NIK hoje: certificado ✓, CSC só de homologação ✗, IE ✓, empresa ✓, NCM ✗ (163), conexão ✗, resp. técnico não conferido ✓, desligada", itens.map((i) => i.ok), [true, false, true, true, false, false, true, false, false, false]);
  verdade("o item do NCM diz quantos faltam", /163 de 163/.test(itens.find((i) => i.chave === "ncm")!.detalhe));
  const semIe = prontidaoDoEmissor({ ...pronta, inscricaoEstadual: "" }, { produtosSemNcm: 0, totalDeProdutos: 10, temNotaDeHomologacao: false, agora: AGORA });
  verdade("sem IE no DF, o checklist fala do CF/DF e de que a Receita não informa", /CF\/DF/.test(semIe.find((i) => i.chave === "ie")!.detalhe) && /Receita Federal não informa/.test(semIe.find((i) => i.chave === "ie")!.detalhe));
  const testada = prontidaoDoEmissor({ ...pronta, sefaz: { ...(pronta.sefaz as object), ultimoTeste: { quando: AGORA.toISOString(), ambiente: 2, ok: true, cStat: "107", mensagem: "Serviço em operação" } } }, { produtosSemNcm: 0, totalDeProdutos: 10, temNotaDeHomologacao: true, agora: AGORA });
  confere("com o teste OK em homologação e nota de teste: conexão ✓ e nota ✓", [testada.find((i) => i.chave === "conexao")!.ok, testada.find((i) => i.chave === "notaDeTeste")!.ok], [true, true]);
}

console.log("\n— quem transmite as notas");
{
  confere("loja nova (nada gravado): o emissor do FireHub, como padrão", provedorEfetivo({}), { provedor: "sefaz", gravado: null, padrao: true });
  confere("loja com a Focus cadastrada e nada gravado: continua na Focus", provedorEfetivo({ focusEmpresaId: "123" }), { provedor: "focusnfe", gravado: null, padrao: true });
  confere("token colado à mão também é Focus", provedorEfetivo({ tokenDoProvedor: "fh1:x" }).provedor, "focusnfe");
  confere("o gravado manda", [provedorEfetivo({ provedor: "focusnfe" }), provedorEfetivo({ provedor: "sefaz", focusEmpresaId: "1" })], [
    { provedor: "focusnfe", gravado: "focusnfe", padrao: false },
    { provedor: "sefaz", gravado: "sefaz", padrao: false },
  ]);
  confere("o PUT só aceita os dois emissores", [lerProvedor("SEFAZ"), lerProvedor("focusnfe"), lerProvedor("plugnotas").ok], [{ ok: true, provedor: "sefaz" }, { ok: true, provedor: "focusnfe" }, false]);
}

console.log("\n— gravação com compare-and-swap");
{
  const banco = (inicial: unknown, conflitos: number): BancoDaConfigFiscal & { gravado: unknown; tentativas: number } => {
    const b = {
      gravado: inicial,
      tentativas: 0,
      async ler() {
        return b.gravado;
      },
      async gravarSeIgual(_: string, novo: Record<string, unknown>, anterior: unknown) {
        b.tentativas++;
        if (b.tentativas <= conflitos) {
          // Outra tela gravou no meio: o certificado chegou.
          b.gravado = { ...(b.gravado as object), sefaz: { certificado: { arquivo: "x" } } };
          return false;
        }
        if (JSON.stringify(anterior) !== JSON.stringify(b.gravado)) return false;
        b.gravado = novo;
        return true;
      },
    };
    return b;
  };
  const b1 = banco({ serie: 1 }, 1);
  await alterarFiscalConfig("loja", (atual) => ({ gravar: { ...(atual as object), contador: { email: "c@x" } }, resposta: null }), { banco: b1 });
  confere("conflito: relê e reaplica sobre o que chegou (o certificado não some)", b1.gravado, { serie: 1, sefaz: { certificado: { arquivo: "x" } }, contador: { email: "c@x" } });
  let desistiu = false;
  try {
    await alterarFiscalConfig("loja", (atual) => ({ gravar: { ...(atual as object), a: 1 }, resposta: null }), { banco: banco({}, 99), tentativas: 3 });
  } catch (e) {
    desistiu = e instanceof ConflitoNaGravacao;
  }
  verdade("conflito sem fim: desiste com erro claro (não grava por cima)", desistiu);
  const b3 = banco({ x: 1 }, 0);
  const r = await alterarFiscalConfig("loja", () => ({ gravar: null, resposta: "recusado" }), { banco: b3 });
  confere("recusa (gravar null): não escreve nada", [r, b3.tentativas], ["recusado", 0]);
  let naoExiste = false;
  try {
    await alterarFiscalConfig("loja", () => ({ gravar: {}, resposta: null }), { banco: { ler: async () => undefined, gravarSeIgual: async () => true } });
  } catch (e) {
    naoExiste = e instanceof LojaNaoEncontrada;
  }
  verdade("loja que não existe: erro próprio", naoExiste);
}

console.log("\n— os dados da Receita (sugestão)");
{
  // A resposta de /api/cnpj-lookup para a NIK (BrasilAPI, consultada em 29/09/2026).
  const nik = {
    cnpj: CNPJ_NIK, razao_social: "NIK COMERCIO DE ALIMENTOS LTDA", nome_fantasia: "NIK ESFIHAS E PIZZAS", situacao: "ATIVA",
    municipio: "BRASILIA", uf: "DF", bairro: "SOBRADINHO", logradouro: "5 COMERCIO LOCAL", numero: "17", cep: "73031545",
    tipo_logradouro: "QUADRA", complemento: "LOJA 03 E 07", codigo_municipio_ibge: "5300108", opcao_pelo_simples: true, opcao_pelo_mei: false,
    porte: "EMPRESA DE PEQUENO PORTE", cnae_fiscal: "5611203", cnae_fiscal_descricao: "Lanchonetes, casas de chá, de sucos e similares",
  };
  const s = sugestoesDaReceita(nik)!;
  confere("NIK: razão social, fantasia, endereço com o tipo do logradouro, IBGE, CEP e CRT 1", [s.razaoSocial, s.nomeFantasia, s.logradouro, s.numero, s.complemento, s.bairro, s.municipio, s.codigoMunicipio, s.uf, s.cep, s.regimeTributario, s.ativa], [
    "NIK COMERCIO DE ALIMENTOS LTDA", "NIK ESFIHAS E PIZZAS", "QUADRA 5 COMERCIO LOCAL", "17", "LOJA 03 E 07", "SOBRADINHO", "BRASILIA", "5300108", "DF", "73031-545", 1, true,
  ]);
  verdade("Simples vem com o aviso do CRT 2 (sublimite)", s.avisos.some((a) => /CRT 2/.test(a)));
  confere("MEI: CRT 4", sugestoesDaReceita({ ...nik, opcao_pelo_mei: true })!.regimeTributario, 4);
  const normal = sugestoesDaReceita({ ...nik, opcao_pelo_simples: false, opcao_pelo_mei: false })!;
  confere("fora do Simples: sem CRT sugerido, com o aviso do Regime Normal", [normal.regimeTributario, normal.avisos.some((a) => /CRT 3/.test(a))], [null, true]);
  confere("ReceitaWS (sem IBGE nem Simples): sem essas sugestões, com o aviso do IBGE", (() => { const r = sugestoesDaReceita({ ...nik, codigo_municipio_ibge: "", opcao_pelo_simples: null, opcao_pelo_mei: null })!; return ["codigoMunicipio" in r, "regimeTributario" in r, r.avisos.some((a) => /IBGE/.test(a))]; })(), [false, false, true]);
  confere("CNPJ baixado: aviso", sugestoesDaReceita({ ...nik, situacao: "BAIXADA" })!.avisos.some((a) => /BAIXADA/.test(a)), true);
  confere("sem número na Receita: S/N", sugestoesDaReceita({ ...nik, numero: "" })!.numero, "S/N");
  confere("o tipo não se repete quando o logradouro já começa com ele", sugestoesDaReceita({ ...nik, logradouro: "QUADRA 5 COMERCIO LOCAL" })!.logradouro, "QUADRA 5 COMERCIO LOCAL");
  confere("comparação ignora caixa e acento", [mesmoTexto("Brasília", "BRASILIA"), mesmoTexto("Sobradinho ", "SOBRADINHO"), mesmoTexto("Nik Esfiharia", "NIK COMERCIO DE ALIMENTOS LTDA")], [true, true, false]);
  confere("resposta inválida: null", [sugestoesDaReceita(null), sugestoesDaReceita({ cnpj: "123" })], [null, null]);
}

console.log("\n— o passo a passo por UF");
{
  const df = passoAPassoDaUf("df");
  const textoDf = JSON.stringify(df);
  confere("o DF: Receita do DF, Painel de Serviços → Meus Serviços → DF-e → Credenciamento, 1 dia, Código CSC, 2 CSCs por CNPJ raiz, CF/DF, A1 em arquivo", [
    textoDf.includes("ww2.receita.fazenda.df.gov.br"), textoDf.includes("Painel de Serviços → Meus Serviços → DF-e → Credenciamento"), textoDf.includes("até 1 dia"),
    textoDf.includes("DF-e → Código CSC"), textoDf.includes("até 2 CSCs ativos"), textoDf.includes("CF/DF"), textoDf.includes(".pfx"), textoDf.includes("Saipos"),
  ], [true, true, true, true, true, true, true, true]);
  confere("RJ, PA e MG têm o passo a passo próprio", [JSON.stringify(passoAPassoDaUf("RJ")).includes("fazenda.rj.gov.br/dfe"), JSON.stringify(passoAPassoDaUf("PA")).includes("Cadastro Software NFC-e"), JSON.stringify(passoAPassoDaUf("MG")).includes("SIARE")], [true, true, true]);
  confere("UF que não existe: o genérico", passoAPassoDaUf("ZZ").titulo, "Seu estado");
  // 09/10/2026: as UF onde há loja vendendo têm o guia próprio, com link do portal.
  const comGuia = ["SP", "CE", "RS", "GO", "BA", "PR", "PE", "SC", "PI", "MT", "MA", "ES", "RN", "TO", "PB", "AM", "MS", "RO"];
  confere(
    "as 18 UF novas têm passo a passo próprio, com pelo menos um link oficial (gov.br)",
    comGuia.filter((uf) => {
      const g = passoAPassoDaUf(uf);
      return g.titulo === "Seu estado" || g.links.length === 0 || !g.links.every((l) => /\.gov\.br/.test(l.url)) || g.passos.length < 3;
    }),
    []
  );
}

console.log("\n— a rota do certificado e a tela (conferência estática)");
{
  const rota = readFileSync(join(__dirname, "../src/app/api/store/fiscal/certificado/route.ts"), "utf8");
  verdade("só FRANCHISEE e ADMIN (STAFF recebe 403)", rota.includes('user.role !== "FRANCHISEE" && user.role !== "ADMIN"') && rota.includes("status: 403"));
  const logs = rota.split("\n").filter((l) => /console\.(error|log|warn)/.test(l));
  confere("nenhum log leva a senha ou o .pfx", logs.filter((l) => /senha|pfx|entrada/.test(l)), []);
  verdade("o .pfx vai para o cofre (guardarArquivoFiscal, tipo certificado) e a senha, cifrada", rota.includes('tipo: "certificado"') && rota.includes("cifrar(entrada.senha)"));
  verdade(
    "a resposta nunca devolve a senha (nem `entrada.senha` nem chave `senha:` num NextResponse.json)",
    !/NextResponse\.json\([^;]*entrada\.senha/.test(rota) && !/NextResponse\.json\(\{[^}]*\bsenha\s*:/.test(rota)
  );
  verdade("o arquivo anterior só sai do cofre depois de o banco apontar para o novo", rota.indexOf("alterarFiscalConfig(lojaId") < rota.indexOf("apagarDoCofre(gravado.arquivoAnterior)"));
  verdade("limite de tamanho antes de ler o corpo", rota.includes("TAMANHO_MAXIMO_DO_PFX * 4"));
  const tela = readFileSync(join(__dirname, "../src/app/store/fiscal/EmissorProprio.tsx"), "utf8");
  const ids = ["nfce-certificado", "nfce-senha-certificado", "nfce-serie", "nfce-numero-inicial"];
  confere("cada rótulo com htmlFor e o id do campo", ids.filter((id) => tela.split(`htmlFor="${id}"`).length !== 2 || tela.split(`id="${id}"`).length !== 2), []);
  verdade("os campos do CSC têm rótulo por ambiente", tela.includes("htmlFor={`nfce-id-csc-${amb}`}") && tela.includes("id={`nfce-id-csc-${amb}`}") && tela.includes("htmlFor={`nfce-csc-${amb}`}") && tela.includes("id={`nfce-csc-${amb}`}"));
  const senhas = [...tela.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0]).filter((t) => /type="(password|file)"/.test(t));
  confere("todo campo de senha/arquivo tem id (e o rótulo acima como nome)", [senhas.length, senhas.filter((t) => !/\bid=/.test(t)).length], [3, 0]);
  verdade("a escolha da Focus saiu da tela (09/10/2026): sem \"Quem transmite as notas\" nem EscolhaDoEmissor", !tela.includes("Quem transmite as notas") && !tela.includes("EscolhaDoEmissor"));
  // A rota é só POST { ambiente } (o GET com ?ambiente= saiu): a tela manda o corpo.
  verdade(
    "o teste de conexão chama a rota da emissão em homologação (POST com { ambiente })",
    tela.includes('fetch("/api/store/fiscal/testar-conexao", {') && tela.includes("JSON.stringify({ ambiente })") && tela.includes("pedirTesteDeConexao(2)") && !tela.includes("testar-conexao?ambiente=")
  );
  verdade("o alerta de vencimento em 30 dias é anunciado (role=alert)", tela.includes('cert.situacao === "vence_em_breve"') && tela.includes('role="alert"'));
  verdade("a senha sai da tela depois do envio, com sucesso ou não", /finally \{[\s\S]*?setSenha\(""\)/.test(tela));
  const pagina = readFileSync(join(__dirname, "../src/app/store/fiscal/page.tsx"), "utf8");
  verdade("a página esconde a Focus quando o emissor é o do FireHub", pagina.includes("{!emissorProprioAtivo && ("));
  verdade("no celular o menu vira faixa e as grades viram uma coluna", pagina.includes("@media (max-width: 760px)") && pagina.includes(".fiscal-config-grade, .fiscal-grade-2 { grid-template-columns: 1fr !important; }"));
  verdade("a IE diz que a Receita Federal não informa", pagina.includes('id="fiscal-ie-ajuda"') && pagina.includes("A Receita Federal não informa a IE."));
}

rmSync(TMP, { recursive: true, force: true });
rmSync(COFRE, { recursive: true, force: true });
const sobrou = existsSync(COFRE) ? readdirSync(COFRE).length : 0;
verdade("o cofre temporário foi limpo", sobrou === 0 && !existsSync(COFRE), String(sobrou));
}

main()
  .catch((e) => {
    falhas++;
    console.log(`❌ exceção: ${String(e?.stack ?? e).slice(0, 600)}`);
  })
  .finally(() => {
    rmSync(TMP, { recursive: true, force: true });
    rmSync(COFRE, { recursive: true, force: true });
    console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  });
