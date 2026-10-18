/**
 * O DIA OPERACIONAL em instantes — de "2026-10-18" (dia da loja, virando às 5h)
 * para a janela [início, fim) que a consulta usa. Saiu de
 * lib/relatorios/servidor.ts (que reexporta) para quem não é rota poder usar
 * sem puxar sessão e Next: o perfil da loja (lib/perfil-da-loja) e os testes.
 */
import { inicioDoDiaDaLoja } from "@/lib/fuso";
import { HORA_DA_VIRADA } from "@/lib/relatorios/base";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * O início do DIA OPERACIONAL de uma data do calendário, no fuso da loja.
 * Meio-dia local está dentro daquele dia em qualquer offset (−02/−03), então
 * serve de âncora para `inicioDoDiaDaLoja` achar a meia-noite certa.
 */
export function inicioOperacional(dia: string, tz: string | null | undefined): Date {
  const meioDia = new Date(`${dia}T12:00:00-03:00`);
  return new Date(inicioDoDiaDaLoja(tz, meioDia).getTime() + HORA_DA_VIRADA * 60 * 60 * 1000);
}

/** A janela [inicio, fim) de "de" a "ate", inclusive, no dia operacional. */
export function janelaDoPeriodo(de: string, ate: string, tz: string | null | undefined): { inicio: Date; fim: Date } {
  return { inicio: inicioOperacional(de, tz), fim: new Date(inicioOperacional(ate, tz).getTime() + DIA_MS) };
}
