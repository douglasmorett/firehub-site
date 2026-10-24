import { randomInt } from "crypto";
import { SENHA_PADRAO } from "@/lib/motoboy-senha";

/**
 * /src/lib/senha-gerada.ts
 *
 * Senha sorteada para quem nasce (ou volta) sem senha própria — no lugar do
 * "123456" fixo, que valia para todo motoboy novo e para toda loja redefinida
 * pelo suporte. Sorteio com crypto.randomInt, nunca Math.random.
 */

/** Motoboy: só números, fácil de ditar pelo telefone. Nunca sai a padrão antiga. */
export function gerarSenhaDeNumeros(tamanho = 6): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < tamanho; i++) s += String(randomInt(10));
    if (s !== SENHA_PADRAO) return s;
  }
}

/** Sem as letras e números que se confundem lidos em voz alta ou na tela (i, l, o, 0, 1). */
export const ALFABETO_LEGIVEL = "abcdefghjkmnpqrstuvwxyz23456789";

/** Conta da loja redefinida pelo suporte: minúsculas e números, sem ambíguos. */
export function gerarSenhaLegivel(tamanho = 10): string {
  let s = "";
  for (let i = 0; i < tamanho; i++) s += ALFABETO_LEGIVEL[randomInt(ALFABETO_LEGIVEL.length)];
  return s;
}
