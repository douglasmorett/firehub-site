/**
 * /src/lib/nfce/chave.ts
 *
 * A chave de acesso da NFC-e — as 44 posições que identificam a nota para
 * sempre (consulta pública, QR Code, cancelamento, DANFE).
 *
 * Composição (MOC 7.0, item 5.4 "Chave de Acesso", e NT Conjunta 2025.001,
 * item 5, para o CNPJ alfanumérico):
 *
 *   cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
 *
 * O CNPJ pode ter LETRAS nas 12 primeiras posições desde a NT 2026.004 (schema
 * TChNFe = [0-9]{6}[0-9A-Z]{12}[0-9]{26}). O dígito verificador usa módulo 11
 * com pesos 2 a 9 da direita para a esquerda, e cada caractere vale o código
 * ASCII menos 48 — assim '0'..'9' continuam valendo 0..9 e 'A' vale 17 (NT
 * Conjunta 2025.001, "Cálculo do DV da Chave de Acesso"). Resto 0 ou 1 → DV 0.
 *
 * PURO: sem banco, sem rede. O único não-determinismo é o `cNF`, que vem de
 * `crypto.randomInt` quando não é informado.
 */
import { randomInt } from "node:crypto";

/** Código IBGE de cada UF (tabela de UF do IBGE, usada em cUF e cOrgao). */
export const CODIGO_DA_UF: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29",
  MG: "31", ES: "32", RJ: "33", SP: "35",
  PR: "41", SC: "42", RS: "43",
  MS: "50", MT: "51", GO: "52", DF: "53",
};

export function codigoDaUf(uf: string): string | null {
  return CODIGO_DA_UF[String(uf ?? "").trim().toUpperCase()] ?? null;
}

/** Valor de um caractere no módulo 11 da chave: ASCII − 48 (NT Conjunta 2025.001). */
const valorDoCaractere = (ch: string): number => ch.charCodeAt(0) - 48;

/**
 * Dígito verificador de uma chave de 43 posições (sem o DV).
 *
 * Pesos 2,3,...,9,2,3,... aplicados da DIREITA para a esquerda; DV = 11 − resto,
 * e resto 0 ou 1 dá DV 0 (MOC 7.0, 5.4).
 */
export function digitoDaChave(chave43: string): number {
  const c = String(chave43 ?? "").toUpperCase();
  if (!/^[0-9A-Z]{43}$/.test(c)) throw new Error(`Chave sem DV precisa de 43 posições alfanuméricas (recebi ${c.length}).`);
  let soma = 0;
  let peso = 2;
  for (let i = c.length - 1; i >= 0; i--) {
    soma += valorDoCaractere(c[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** A chave (44) confere com o próprio DV e tem o formato do schema TChNFe? */
export function chaveValida(chave: string): boolean {
  const c = String(chave ?? "").toUpperCase();
  if (!/^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/.test(c)) return false;
  return digitoDaChave(c.slice(0, 43)) === Number(c[43]);
}

/**
 * Os cNF que a SEFAZ recusa (MOC 7.0 Anexo I, regra B09-20, rejeição 897):
 * oito algarismos iguais e as sequências crescentes que dão a volta no 0.
 */
export const CNF_PROIBIDOS = new Set([
  "00000000", "11111111", "22222222", "33333333", "44444444",
  "55555555", "66666666", "77777777", "88888888", "99999999",
  "12345678", "23456789", "34567890", "45678901", "56789012",
  "67890123", "78901234", "89012345", "90123456", "01234567",
]);

/** O cNF passa na regra B09-20 (formato, lista proibida e diferente do nNF)? */
export function codigoNumericoValido(cNF: string, numero: number): boolean {
  if (!/^[0-9]{8}$/.test(String(cNF ?? ""))) return false;
  if (CNF_PROIBIDOS.has(cNF)) return false;
  // "cNF não pode ser igual a nNF" (NT 2019.001): comparado como número, já
  // que o nNF vai no XML sem zeros à esquerda e o cNF com eles.
  return Number(cNF) !== Number(numero);
}

/**
 * Um cNF aleatório de 8 dígitos que a SEFAZ aceita.
 *
 * Aleatório de verdade (crypto), e não derivado do número: o cNF existe para
 * que ninguém adivinhe a chave de uma nota a partir da anterior (MOC 7.0,
 * B03 — "número aleatório gerado pelo emitente").
 */
export function gerarCodigoNumerico(numero: number, sortear: () => number = () => randomInt(0, 100_000_000)): string {
  for (let tentativa = 0; tentativa < 1000; tentativa++) {
    const cNF = String(sortear()).padStart(8, "0").slice(-8);
    if (codigoNumericoValido(cNF, numero)) return cNF;
  }
  throw new Error("Não consegui sortear um cNF válido (o sorteador está viciado).");
}

export type PartesDaChave = {
  /** Sigla da UF do emitente ("DF") ou o código IBGE ("53"). */
  uf: string;
  /** Data/hora de emissão: dá o AAMM. Para não errar o mês na virada, passe o AAMM já no fuso da loja. */
  anoMes: string;
  cnpj: string;
  modelo?: 55 | 65;
  serie: number;
  numero: number;
  /** 1 = normal, 9 = contingência off-line da NFC-e. */
  tipoDeEmissao: number;
  codigoNumerico: string;
};

/** Monta a chave de 44 posições, com o DV. Recusa o que o schema ou a regra B09-20 recusariam. */
export function montarChave(p: PartesDaChave): string {
  const cUF = /^\d{2}$/.test(p.uf) ? p.uf : codigoDaUf(p.uf);
  if (!cUF) throw new Error(`UF desconhecida: "${p.uf}".`);
  if (!/^\d{2}(0[1-9]|1[0-2])$/.test(p.anoMes)) throw new Error(`AAMM inválido: "${p.anoMes}".`);
  const cnpj = String(p.cnpj ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) throw new Error(`CNPJ inválido para a chave: "${p.cnpj}".`);
  const modelo = p.modelo ?? 65;
  if (!(Number.isInteger(p.serie) && p.serie >= 0 && p.serie <= 999)) throw new Error(`Série fora de 0–999: ${p.serie}.`);
  if (!(Number.isInteger(p.numero) && p.numero >= 1 && p.numero <= 999_999_999)) throw new Error(`Número fora de 1–999999999: ${p.numero}.`);
  if (!/^[1-9]$/.test(String(p.tipoDeEmissao))) throw new Error(`tpEmis inválido: ${p.tipoDeEmissao}.`);
  if (!codigoNumericoValido(p.codigoNumerico, p.numero)) throw new Error(`cNF inválido (regra B09-20): "${p.codigoNumerico}".`);

  const semDv =
    cUF +
    p.anoMes +
    cnpj +
    String(modelo).padStart(2, "0") +
    String(p.serie).padStart(3, "0") +
    String(p.numero).padStart(9, "0") +
    String(p.tipoDeEmissao) +
    p.codigoNumerico;
  return semDv + String(digitoDaChave(semDv));
}

/** O atributo Id do infNFe: "NFe" + chave (schema: pattern NFe[0-9]{6}[A-Z0-9]{12}[0-9]{26}). */
export const idDaNota = (chave: string): string => `NFe${chave}`;

/** Lê as partes de uma chave (para conferir, e para a contingência saber o tpEmis). */
export function lerChave(chave: string) {
  const c = String(chave ?? "").toUpperCase();
  return {
    cUF: c.slice(0, 2),
    anoMes: c.slice(2, 6),
    cnpj: c.slice(6, 20),
    modelo: Number(c.slice(20, 22)),
    serie: Number(c.slice(22, 25)),
    numero: Number(c.slice(25, 34)),
    tipoDeEmissao: Number(c.slice(34, 35)),
    codigoNumerico: c.slice(35, 43),
    digito: Number(c.slice(43, 44)),
  };
}
