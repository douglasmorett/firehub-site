import { paraEnvioWhatsApp, telefoneCanonico } from "@/lib/telefone";

/**
 * O telefone como CHAVE do contato do CRM.
 *
 * ── Por que não o número "como veio" ────────────────────────────────────────
 *
 * A mesma pessoa chega de dois jeitos: o vendedor cadastra "(22) 98111-8514"
 * e o WhatsApp entrega a conversa como `552281118514@s.whatsapp.net` — sem o
 * nono dígito, que é como o WhatsApp registrou muitos celulares brasileiros.
 * Com o número cru como chave, viravam dois contatos: o lead do vendedor
 * parado em "Novo" e a conversa de verdade num contato sem vendedor.
 *
 * A chave é a forma canônica de lib/telefone.ts (DDD + 8, sem o nono), a mesma
 * régua que o sistema já usa para "é o mesmo número?". Número estrangeiro, que
 * a régua brasileira não entende, fica com os dígitos crus.
 *
 * Para RESPONDER, o contato guarda o `jid` exato da conversa — nunca a chave.
 */
export function chaveDoTelefone(bruto: string | null | undefined): string | null {
  const canonico = telefoneCanonico(bruto);
  if (canonico) return canonico;
  const d = String(bruto || "").replace(/\D/g, "");
  // Estrangeiro: DDI + número. Menos de 10 dígitos não é telefone de ninguém.
  if (d.length >= 10 && d.length <= 15 && !d.startsWith("0") && !d.startsWith("55")) return d;
  return null;
}

/** O endereço de WhatsApp para um número digitado (cadastro à mão). */
export function jidDoTelefone(bruto: string | null | undefined): string | null {
  const numero = paraEnvioWhatsApp(bruto);
  return numero ? `${numero}@s.whatsapp.net` : null;
}

/** Só os dígitos de um jid de telefone; LID não é telefone e devolve "". */
export function digitosDoJid(jid: string | null | undefined): string {
  const s = String(jid || "");
  if (!s || s.includes("@lid") || s.includes("@g.us") || s.includes("@broadcast")) return "";
  return s.split("@")[0].replace(/\D/g, "");
}

/**
 * "(22) 98111-8514" — para a tela. Aceita jid, número com 55 ou a chave
 * canônica; a chave sem o nono dígito volta com ele quando é celular (começa
 * com 6–9), que é como o dono reconhece o número.
 */
export function telefoneParaExibir(bruto: string | null | undefined): string {
  let d = String(bruto || "").split("@")[0].replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `+${d}`;
}

/** wa.me para abrir a conversa no aparelho, ou null sem número utilizável. */
export function linkDoWhatsApp(bruto: string | null | undefined): string | null {
  const s = String(bruto || "");
  if (s.includes("@lid")) return null;
  let d = s.split("@")[0].replace(/\D/g, "");
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + "9" + d.slice(2);
  const numero = paraEnvioWhatsApp(d) || (d.length >= 10 ? d : "");
  return numero ? `https://wa.me/${numero}` : null;
}
