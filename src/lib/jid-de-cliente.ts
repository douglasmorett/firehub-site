/**
 * Quem é cliente e quem não é, olhando o endereço do WhatsApp.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O webhook tinha uma lista de BLOQUEIO: barrava `@broadcast` e `@g.us`, e
 * deixava passar todo o resto. O WhatsApp lançou os Canais depois disso, com o
 * sufixo `@newsletter`, e eles entraram no robô como se fossem cliente.
 *
 * Medido em produção, 01–14/09/2026, só na Brazza Burguer: 1.072 posts de 6
 * canais que o número dela segue viraram chamada de IA — 12,3 milhões de tokens
 * de prompt, R$ 41,57 de Gemini (23% da conta de IA do mês), mais 1.502
 * tentativas de envio de resposta para um lugar onde seguidor nem pode
 * responder. Ninguém leu uma linha disso.
 *
 * A lição não é "barrar newsletter": é que lista de bloqueio erra para o lado
 * errado. Quando o WhatsApp inventar o próximo tipo de endereço, a lista de
 * bloqueio deixa passar e a conta cresce calada até alguém abrir a fatura.
 * Aqui o padrão é RECUSAR, e o que é cliente está escrito.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-jid-de-cliente.mjs).
 */

/**
 * Os sufixos de conversa de verdade, um a um para o robô atender.
 *
 *   s.whatsapp.net  conversa 1-a-1 clássica. É o caso normal.
 *   lid             conversa 1-a-1 no formato novo de identidade do WhatsApp.
 *                   É CLIENTE DE VERDADE e precisa passar: em 19/09/2026 o banco
 *                   tinha 151 conversas vivas nesse formato (contra 915 no
 *                   clássico), e 1.420 chamadas de IA no histórico. Barrar isto
 *                   deixa o robô mudo para um sexto da base.
 *   c.us            formato legado de contato. Não aparece no banco hoje, mas o
 *                   `getRealJid` do webhook o trata como sufixo de contato
 *                   VÁLIDO e lhe dá a nota máxima (route.ts, `temSufixoDeContato`)
 *                   — ou seja, quando ele chega, é ELE que vence a disputa e vira
 *                   o telefone do cliente. Fora desta lista, o robô recusaria
 *                   justamente o endereço que o próprio webhook elegeu como o bom.
 *                   Achado pela revisão adversarial de 19/09/2026, antes do deploy.
 */
const SUFIXOS_DE_CLIENTE = ["s.whatsapp.net", "lid", "c.us"] as const;

/**
 * Este endereço é de uma conversa de cliente, que o robô deve atender?
 *
 * Endereço sem `@` passa SE for um telefone: o webhook às vezes cai no
 * `data.from` cru (só o número) e o resto do fluxo normaliza. Recusar aí
 * calaria cliente real.
 *
 * Mas "sem @" não pode ser cheque em branco. `String({})` é "[object Object]",
 * que não tem `@` — e a primeira versão disto respondia `true` para ele, ou
 * seja, objeto vazio virava cliente. Quem chama passa o que veio do gateway, e
 * o que vem do gateway nem sempre é string. Então: sem `@`, só passa o que tem
 * cara de telefone (8 a 15 dígitos, o intervalo do E.164 com DDD).
 *
 * Tudo que tem sufixo e não está na lista é recusado — grupo (`@g.us`), lista de
 * transmissão e status (`@broadcast`), canal (`@newsletter`) e o que vier
 * depois.
 */
export function ehConversaDeCliente(remoteJid: unknown): boolean {
  const jid = String(remoteJid ?? "").trim();
  if (!jid) return false;

  const corte = jid.lastIndexOf("@");
  if (corte === -1) return /^\+?\d{8,15}$/.test(jid); // número cru, sem sufixo

  const sufixo = jid.slice(corte + 1).toLowerCase();
  if (!sufixo) return false; // terminou em "@": endereço quebrado, não é cliente

  return (SUFIXOS_DE_CLIENTE as readonly string[]).includes(sufixo);
}

/**
 * A CONVERSA de onde a mensagem veio (`key.remoteJid`, antes de qualquer
 * troca) é de cliente?
 *
 * ── Por que olhar o endereço ORIGINAL ───────────────────────────────────────
 *
 * O webhook escolhe o "telefone de verdade" entre vários candidatos
 * (`getRealJid`: senderAlt, participant, remoteJid...) e só DEPOIS perguntava a
 * `ehConversaDeCliente`. Num status postado por um contato, `key.remoteJid` é
 * `status@broadcast` e `key.participant` é o telefone de quem postou — com nota
 * máxima na escolha. O filtro recebia o telefone, aprovava, e o robô respondia
 * por mensagem direta a um STATUS (auditoria de 25/09/2026). O mesmo vale para
 * grupo (`@g.us` + participant) e canal.
 *
 * A pergunta certa é sobre a conversa, e ela só existe no endereço original.
 * Vazio não recusa: há payload antigo que só traz `data.from`, e quem decide
 * nesse caso continua sendo `ehConversaDeCliente` sobre o endereço resolvido.
 */
export function conversaOriginalEhDeCliente(remoteJidOriginal: unknown): boolean {
  if (remoteJidOriginal === null || remoteJidOriginal === undefined) return true;
  if (typeof remoteJidOriginal === "string" && !remoteJidOriginal.trim()) return true;
  return ehConversaDeCliente(remoteJidOriginal);
}

/**
 * O que é este endereço, em uma palavra — para log e para alerta. Não decide
 * nada: quem decide é `ehConversaDeCliente`.
 */
export function tipoDoJid(remoteJid: unknown): string {
  const jid = String(remoteJid || "").trim();
  if (!jid) return "vazio";

  const corte = jid.lastIndexOf("@");
  const sufixo = corte === -1 ? "" : jid.slice(corte + 1).toLowerCase();

  if (!sufixo) {
    if (corte !== -1) return "quebrado";
    return /^\+?\d{8,15}$/.test(jid) ? "numero_cru" : "lixo";
  }
  if (sufixo === "s.whatsapp.net") return "cliente";
  if (sufixo === "lid") return "cliente_lid";
  if (sufixo === "c.us") return "cliente_legado";
  if (sufixo === "g.us") return "grupo";
  if (sufixo === "broadcast") return "transmissao";
  if (sufixo === "newsletter") return "canal";
  return "desconhecido";
}
