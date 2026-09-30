/**
 * /src/lib/nfce/envio-do-certificado.ts
 *
 * A conferência do certificado A1 que o titular envia para o emissor próprio
 * (POST /api/store/fiscal/certificado), antes de ele ir para o cofre.
 *
 * ── Por que conferir aqui, e não na primeira nota ───────────────────────────
 *
 * Com a Focus, era ela quem abria o .pfx e dizia "senha errada". Agora o
 * FireHub assina, e um certificado ruim só apareceria na primeira venda — com
 * a fila do balcão esperando o cupom. Então o envio já abre o arquivo com a
 * senha (lib/nfce/assinatura → carregarCertificado) e recusa, em português:
 *   - senha errada, ou arquivo que não é .pfx/.p12 (o .cer é só a parte pública);
 *   - certificado vencido, ou que ainda não começou a valer;
 *   - certificado sem CNPJ (e-CPF);
 *   - certificado de OUTRA empresa.
 *
 * ── "Outra empresa" é o CNPJ-base, não o CNPJ inteiro ───────────────────────
 *
 * O Ajuste SINIEF 19/16 (a NFC-e), cláusula quarta, IV, na redação do Ajuste
 * SINIEF 19/24, manda assinar com certificado ICP-Brasil "contendo o número do
 * CPF ou CNPJ de QUALQUER DOS ESTABELECIMENTOS do contribuinte" (o § 1º-A da
 * cláusula primeira diz o mesmo). E a SEFAZ confere só a raiz: a rejeição 213
 * é "CNPJ-Base do Emitente difere do CNPJ-Base do Certificado Digital". Logo o
 * e-CNPJ da matriz assina a nota da filial (e vice-versa) — aceitamos, com um
 * aviso dizendo de qual estabelecimento ele é. CNPJ-base diferente é outra
 * empresa: recusado.
 *
 * ── Segredos ────────────────────────────────────────────────────────────────
 *
 * Nada aqui loga ou devolve o .pfx ou a senha. A senha é guardada cifrada
 * (lib/fiscal-credenciais → cifrar), e `cifrar` apara espaços nas pontas: a
 * senha que TEM espaço na ponta não voltaria igual. Por isso a conferência
 * abre o arquivo também com a senha aparada — se não abrir, recusa com a
 * explicação, em vez de guardar uma senha que depois não abre o certificado.
 *
 * Só servidor (node-forge, fs).
 */
import { createHash, X509Certificate } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { carregarCertificado, ErroDoCertificado, type CertificadoCarregado } from "./assinatura";
import { raizDoCofre, type ArquivoGuardado } from "./armazenamento";
import { cnpjFormatado, cnpjLimpo, raizDoCnpj, situacaoDoA1 } from "./cadastro-do-emissor";
import type { CertificadoDaLoja } from "./config-da-loja";

/** Um A1 tem poucos KB; 50 KB é o mesmo teto do cadastro na Focus (lib/focus-empresas). */
export const TAMANHO_MAXIMO_DO_PFX = 50 * 1024;

export type CertificadoConferido = {
  ok: true;
  cert: CertificadoCarregado;
  cnpj: string;
  sha256: string;
  dias: number;
  outroEstabelecimento: boolean;
  avisos: string[];
};

export type CertificadoRecusado = { ok: false; status: 400 | 409 | 413; erro: string; mensagem: string };

const dataCurta = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Abre o .pfx com a senha e confere se ele serve para esta loja.
 *
 * `cnpjDaLoja`: o CNPJ gravado no cadastro fiscal (ou o do cadastro da loja).
 * Sem ele não há com o que comparar — a rota pede para salvar primeiro.
 */
export function conferirCertificadoEnviado(p: {
  pfx: Buffer | Uint8Array | null | undefined;
  senha: string | null | undefined;
  cnpjDaLoja: string | null | undefined;
  agora?: Date;
}): CertificadoConferido | CertificadoRecusado {
  const agora = p.agora ?? new Date();
  const recusa = (status: 400 | 409 | 413, erro: string, mensagem: string): CertificadoRecusado => ({ ok: false, status, erro, mensagem });
  const pfx = p.pfx ? Buffer.from(p.pfx) : null;

  if (!pfx || pfx.length === 0) return recusa(400, "sem_arquivo", "Escolha o arquivo do certificado digital A1 (.pfx ou .p12).");
  if (pfx.length > TAMANHO_MAXIMO_DO_PFX) {
    return recusa(413, "grande_demais", `O arquivo tem ${Math.ceil(pfx.length / 1024)} KB — um certificado A1 tem poucos KB (limite 50 KB). Confira se escolheu o .pfx certo.`);
  }
  // Todo PKCS#12 começa com SEQUENCE (0x30). PDF, imagem e o .cer em texto
  // ("-----BEGIN") caem aqui, antes de gastar a conta de abrir.
  if (pfx[0] !== 0x30) {
    return recusa(400, "nao_e_pfx", "Este arquivo não é um certificado A1 (.pfx/.p12). O .cer ou .crt é só a parte pública e não assina nota.");
  }
  const senha = typeof p.senha === "string" ? p.senha : "";
  if (!senha) return recusa(400, "sem_senha", "Informe a senha do certificado — é a que foi definida ao baixá-lo da certificadora.");

  let cert: CertificadoCarregado;
  try {
    cert = carregarCertificado(pfx, senha);
  } catch (e) {
    if (e instanceof ErroDoCertificado) return recusa(400, "certificado_ilegivel", e.message);
    throw e;
  }
  if (senha !== senha.trim()) {
    try {
      carregarCertificado(pfx, senha.trim());
    } catch {
      return recusa(
        400,
        "senha_com_espaco",
        "A senha deste certificado tem espaço no começo ou no fim, e o cofre do FireHub não guarda espaço nas pontas. Exporte o certificado de novo com uma senha sem espaços nas pontas."
      );
    }
  }

  if (!cert.cnpj) {
    return recusa(400, "sem_cnpj", "Este certificado não traz CNPJ (parece um e-CPF). A NFC-e da empresa é assinada com o e-CNPJ A1 dela.");
  }
  const { dias, situacao } = situacaoDoA1({ validoDe: cert.validoDe.toISOString(), validoAte: cert.validoAte.toISOString() }, agora);
  if (situacao === "vencido") {
    return recusa(400, "vencido", `Este certificado venceu em ${dataCurta(cert.validoAte)}. Compre a renovação na certificadora e envie o arquivo novo.`);
  }
  if (situacao === "ainda_nao_vale") {
    return recusa(400, "ainda_nao_vale", `Este certificado só começa a valer em ${dataCurta(cert.validoDe)}.`);
  }

  const daLoja = cnpjLimpo(p.cnpjDaLoja);
  if (daLoja.length !== 14) {
    return recusa(409, "sem_cnpj_da_loja", "Salve o CNPJ da empresa em \"Dados da empresa\" antes de enviar o certificado — é com ele que o certificado é conferido.");
  }
  const doCert = cnpjLimpo(cert.cnpj);
  if (raizDoCnpj(doCert) !== raizDoCnpj(daLoja)) {
    return recusa(
      400,
      "outro_cnpj",
      `Este certificado é de outra empresa: ${cert.titular || "sem nome"} (CNPJ ${cnpjFormatado(doCert)}), e a loja é do CNPJ ${cnpjFormatado(daLoja)}. ` +
        "A SEFAZ recusa nota assinada com certificado de outra empresa (rejeição 213). Envie o e-CNPJ A1 da própria empresa."
    );
  }

  const avisos: string[] = [];
  const outroEstabelecimento = doCert !== daLoja;
  if (outroEstabelecimento) {
    avisos.push(
      `O certificado é do CNPJ ${cnpjFormatado(doCert)}, outro estabelecimento da mesma empresa (${cnpjFormatado(daLoja)} é o da loja). ` +
        "Vale: o Ajuste SINIEF 19/16 aceita o certificado de qualquer estabelecimento do contribuinte, e a SEFAZ confere só a raiz do CNPJ."
    );
  }
  if (situacao === "vence_em_breve") {
    avisos.push(`Atenção: este certificado vence em ${dataCurta(cert.validoAte)} (${dias} dia(s)). Renove na certificadora antes disso.`);
  }
  // Só a ICP-Brasil vale na SEFAZ (rejeição 280). O .pfx de certificadora
  // traz "ICP-Brasil" no emissor; se nem o titular nem o emissor falam dela,
  // é quase certo um certificado que a SEFAZ não aceita — aviso, não recusa:
  // a cadeia completa só a SEFAZ confere.
  if (!pareceIcpBrasil(cert)) {
    avisos.push("Este certificado não parece da ICP-Brasil: a SEFAZ só aceita certificado ICP-Brasil (rejeição 280). Confira com a certificadora.");
  }

  return {
    ok: true,
    cert,
    cnpj: doCert,
    sha256: createHash("sha256").update(pfx).digest("hex"),
    dias,
    outroEstabelecimento,
    avisos,
  };
}

function pareceIcpBrasil(cert: CertificadoCarregado): boolean {
  try {
    const x = new X509Certificate(cert.certificadoPem);
    return /ICP-Brasil/i.test(`${x.issuer}\n${x.subject}`) || cert.cadeiaPem.some((pem) => /ICP-Brasil/i.test(new X509Certificate(pem).subject));
  } catch {
    return false;
  }
}

/**
 * A identificação do arquivo no cofre: uma por certificado (pelo hash).
 *
 * Com uma identificação fixa ("a1"), o arquivo novo sobrescreveria o antigo
 * ANTES de o banco apontar para ele: nesse intervalo a emissão leria o arquivo
 * novo com o hash antigo e recusaria ("arquivo fiscal não confere"). Com um
 * arquivo por certificado, o banco troca de um para o outro de uma vez, e o
 * antigo é apagado depois.
 */
export const identificacaoDoA1 = (sha256: string) => `a1-${sha256.slice(0, 16)}`;

/** O registro que vai para `fiscalConfig.sefaz.certificado`. */
export function registroDoCertificado(p: {
  conferido: CertificadoConferido;
  arquivo: ArquivoGuardado;
  senhaCifrada: string;
  enviadoPor: string | null;
  agora?: Date;
}): CertificadoDaLoja {
  return {
    arquivo: p.arquivo.caminho,
    sha256: p.arquivo.sha256,
    senhaCifrada: p.senhaCifrada,
    cnpj: p.conferido.cnpj,
    titular: p.conferido.cert.titular,
    validoDe: p.conferido.cert.validoDe.toISOString(),
    validoAte: p.conferido.cert.validoAte.toISOString(),
    enviadoEm: (p.agora ?? new Date()).toISOString(),
    enviadoPor: p.enviadoPor,
  };
}

/**
 * Apaga um arquivo do cofre (o certificado removido ou substituído).
 *
 * Mesma trava de caminho de lib/nfce/armazenamento: só dentro do cofre. Falha
 * ao apagar não derruba a operação — o arquivo é cifrado e o banco já não
 * aponta para ele —, mas volta `false` para a rota avisar no log.
 */
export async function apagarDoCofre(caminho: string | null | undefined): Promise<boolean> {
  if (!caminho) return false;
  const raiz = path.resolve(/*turbopackIgnore: true*/ raizDoCofre());
  const alvo = path.resolve(/*turbopackIgnore: true*/ raiz, caminho);
  if (!alvo.startsWith(raiz + path.sep)) return false;
  try {
    await unlink(alvo);
    return true;
  } catch {
    return false;
  }
}
