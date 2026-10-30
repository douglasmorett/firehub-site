/**
 * src/lib/numeros-do-dono.ts — MAIS DE UM NÚMERO DE DONO NA LOJA.
 *
 * O principal continua sendo o "WhatsApp do Proprietário" (`notificationPhone`,
 * em Minha Loja). Os outros (sócio, gerente) moram em
 * `chatbotConfig.outrosNumerosDoDono`, editados na aba Alertas do chatbot e na
 * aba Configuração do Bill (as duas por /api/chatbot/config).
 * Todos recebem os mesmos avisos, sempre pela instância do WhatsApp da própria
 * loja, e todos são tratados como dono quando escrevem para o robô (pedido do
 * Douglas, 01/10/2026).
 *
 * Sem banco de propósito: a tela do chatbot usa a mesma limpeza para mostrar e
 * validar, e o robô (lib/chatbot-ai.ts) importa sem puxar a lib de alertas.
 */
import { mesmoTelefone } from "./telefone";

/** Quantos números além do principal. Cada aviso sai uma vez por número. */
export const MAX_OUTROS_NUMEROS_DO_DONO = 4;

/** Só dígitos e com DDI 55; vazio quando não chega a um número com DDD. */
export function digitosDoTelefoneDoDono(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 10) return "";
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}

/** Os números extras gravados na config, já limpos, sem repetir e no teto. */
export function lerOutrosNumerosDoDono(chatbotConfig: any): string[] {
  const lista = Array.isArray(chatbotConfig?.outrosNumerosDoDono) ? chatbotConfig.outrosNumerosDoDono : [];
  const limpos: string[] = [];
  for (const v of lista) {
    const d = digitosDoTelefoneDoDono(v);
    if (d && !limpos.some((x) => x.slice(-10) === d.slice(-10))) limpos.push(d);
  }
  return limpos.slice(0, MAX_OUTROS_NUMEROS_DO_DONO);
}

/**
 * Confere o número digitado antes de entrar na lista dos outros: com DDD, não
 * é o número do robô, ainda não recebe e cabe no teto. A mesma regra na aba
 * Notificações do robô e na tela do Bill (Configuração › Quem fala com o Bill),
 * as duas gravando por /api/chatbot/config.
 */
export function conferirNovoNumeroDoDono(
  digitado: unknown,
  { principal, outros, robo }: { principal: string | null | undefined; outros: string[]; robo: string | null | undefined },
): { ok: true; numero: string } | { ok: false; motivo: "formato" | "robo" | "repetido" | "teto"; mensagem: string } {
  const d = digitosDoTelefoneDoDono(digitado);
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (!d || local.length < 10 || local.length > 11) {
    return { ok: false, motivo: "formato", mensagem: "Digite o número com DDD, por exemplo (22) 99999-8888." };
  }
  const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const mesmo = (a: string, b: string) => a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10);
  if (mesmo(d, soDigitos(robo))) {
    return { ok: false, motivo: "robo", mensagem: "Esse é o número do próprio robô — ele não pode avisar a si mesmo." };
  }
  if (mesmo(d, soDigitos(principal)) || outros.some((x) => mesmo(x, d))) {
    return { ok: false, motivo: "repetido", mensagem: "Esse número já recebe os alertas." };
  }
  if (outros.length >= MAX_OUTROS_NUMEROS_DO_DONO) {
    return { ok: false, motivo: "teto", mensagem: `No máximo ${MAX_OUTROS_NUMEROS_DO_DONO} números além do principal.` };
  }
  return { ok: true, numero: d };
}

/**
 * Para quem os avisos da loja vão: o principal e os outros, sem repetir e sem
 * o número do próprio robô — o robô avisando a si mesmo leria a mensagem como
 * conversa dele e responderia.
 */
export function numerosDoDono(notificationPhone: string | null | undefined, chatbotConfig: any): string[] {
  const robo = String(chatbotConfig?.phone || "").replace(/\D/g, "");
  const todos: string[] = [];
  for (const d of [digitosDoTelefoneDoDono(notificationPhone), ...lerOutrosNumerosDoDono(chatbotConfig)]) {
    if (!d) continue;
    if (robo.length >= 10 && robo.slice(-10) === d.slice(-10)) continue;
    if (todos.some((x) => x.slice(-10) === d.slice(-10))) continue;
    todos.push(d);
  }
  return todos;
}

/**
 * Este telefone é de um DONO da loja (o principal ou um dos outros)?
 *
 * Quem recebe os alertas responde a eles. Sem isto, o sócio que respondia
 * "ok" ao aviso era tratado como cliente: ganhava saudação com cardápio e, se
 * escrevesse "atrasado", virava chamado para a equipe.
 */
export function ehNumeroDoDono(
  notificationPhone: string | null | undefined,
  chatbotConfig: any,
  telefone: string | null | undefined,
): boolean {
  if (!telefone) return false;
  if (notificationPhone && mesmoTelefone(notificationPhone, telefone)) return true;
  return lerOutrosNumerosDoDono(chatbotConfig).some((n) => mesmoTelefone(n, telefone));
}
