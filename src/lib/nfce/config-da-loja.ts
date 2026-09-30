/**
 * A configuração do EMISSOR PRÓPRIO (lib/nfce) dentro de User.fiscalConfig.
 *
 * `fiscalConfig.provedor` decide quem transmite: "sefaz" é o emissor do
 * próprio FireHub, direto na SEFAZ, sem custo por nota; "focusnfe" continua
 * existindo para a loja que já tem conta lá. Os dados da empresa (CNPJ, IE,
 * razão social, regime, endereço, ambiente, emissão ligada) são os mesmos
 * campos de sempre do fiscalConfig — este bloco guarda só o que é do emissor.
 *
 * O que é segredo nunca fica em claro: o .pfx mora no cofre
 * (lib/nfce/armazenamento.ts, cifrado), a senha dele e o CSC vão cifrados
 * (lib/fiscal-credenciais.ts, cifrar). Aqui ficam as referências e o que a
 * tela precisa mostrar (validade, titular, 4 últimos dígitos do CSC).
 *
 * Puro: sem banco, sem cripto — a tela pode importar os tipos.
 */

export const PROVEDOR_PROPRIO = "sefaz";

export type CertificadoDaLoja = {
  /** Caminho no cofre (relativo) e o SHA-256 do .pfx, para conferir ao ler. */
  arquivo: string;
  sha256: string;
  /** A senha do .pfx, cifrada. */
  senhaCifrada: string;
  /** Lido do próprio certificado no envio (lib/nfce/assinatura.ts, carregarCertificado). */
  cnpj: string;
  titular: string;
  validoDe: string;
  validoAte: string;
  enviadoEm: string;
  enviadoPor?: string | null;
};

export type CscDoAmbiente = {
  /** O "ID do token" (idCSC) que a SEFAZ mostra junto do código. */
  id: string;
  /** O CSC, cifrado. */
  cifrado: string;
  /** Os 4 últimos caracteres, para a tela mostrar sem revelar. */
  final: string;
};

export type ConfigDoEmissorProprio = {
  certificado?: CertificadoDaLoja | null;
  csc?: { homologacao?: CscDoAmbiente | null; producao?: CscDoAmbiente | null } | null;
  /**
   * Série da NFC-e no FireHub. A loja que emitiu antes por outro sistema
   * (a NIK usou a Saipos) deve usar uma série NOVA: número repetido na mesma
   * série é rejeição 539 — e o FireHub não sabe até onde o outro sistema foi.
   */
  serie?: number | null;
  /** Primeiro número desta série no FireHub (padrão 1). */
  numeroInicial?: number | null;
  /** Versão do QR Code: 2 (com CSC, a que toda UF aceita) ou 3 (NT 2025.001, sem CSC). */
  qrVersao?: 2 | 3 | null;
  /** A UF pode não admitir contingência off-line; padrão: ligada. */
  contingenciaOffline?: boolean | null;
  /** Último teste de conexão com a SEFAZ (status do serviço), para a tela. */
  ultimoTeste?: { quando: string; ambiente: 1 | 2; ok: boolean; cStat?: string | null; mensagem: string } | null;
};

/** O bloco do emissor próprio dentro do fiscalConfig (vazio quando não existe). */
export function configDoEmissorProprio(fiscalConfig: unknown): ConfigDoEmissorProprio {
  const fc = (fiscalConfig && typeof fiscalConfig === "object" ? fiscalConfig : {}) as Record<string, any>;
  const s = fc.sefaz && typeof fc.sefaz === "object" ? fc.sefaz : {};
  return s as ConfigDoEmissorProprio;
}

export function usaEmissorProprio(fiscalConfig: unknown): boolean {
  const fc = (fiscalConfig && typeof fiscalConfig === "object" ? fiscalConfig : {}) as Record<string, any>;
  return String(fc.provedor || "") === PROVEDOR_PROPRIO;
}

/** Nome do ambiente na chave do CSC: 1 = produção, 2 = homologação. */
export const chaveDoAmbiente = (ambiente: unknown): "producao" | "homologacao" =>
  Number(ambiente) === 1 ? "producao" : "homologacao";
