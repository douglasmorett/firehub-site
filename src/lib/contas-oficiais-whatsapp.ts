/**
 * Contas do próprio WhatsApp/Meta, com quem o robô da loja NUNCA conversa.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * Na noite de 24 para 25/09/2026 o dono da Divinos Burger abriu um chamado no
 * Suporte do WhatsApp (+1 551-786-8423) pelo número da loja, perguntando por
 * que o QR "até lê, porém não funciona". O robô do FireHub respondeu ao robô do
 * Suporte: cerca de 40 chamadas de IA, três "vou chamar uma pessoa", um alerta
 * ao dono dizendo que "o cliente pediu atendente", e as 27 mensagens INBOUND da
 * loja naquele dia eram todas do Suporte. O botão "Encerrar atendimento" do
 * painel ainda mandava "Atendimento humano finalizado" para o Suporte, e o laço
 * recomeçava a cada clique (quatro vezes naquela noite).
 *
 * Nada filtrava conta oficial: o anti-loop só percebe robô depois de umas seis
 * trocas (cadência de máquina + mensagem repetida), e aí já gastou a IA e já
 * atrapalhou o dono justamente no chamado em que ele pedia socorro.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 * Esta lista é de IDENTIDADES conhecidas, não de apelidos: o nome que a pessoa
 * põe no perfil (`pushName`) não entra, porque qualquer cliente pode se chamar
 * "WhatsApp". O nome de empresa VERIFICADA (`verifiedBizName`) entra só quando é
 * exatamente o de uma conta da Meta — "Meta Burger" é cliente.
 *
 * Os números vêm do próprio Baileys (WABinary/jid-utils: PSA_WID, SERVER_JID,
 * OFFICIAL_BIZ_JID, META_AI_JID e a faixa `isJidBot`) e do caso real acima (o
 * Suporte chegou como LID 198964645236955 e como telefone 15517868423).
 *
 * Arquivo puro, sem imports: o teste o carrega sozinho
 * (scripts/teste-contas-oficiais-whatsapp.mjs).
 */

export type ContaOficial = {
  /** Qual conta é, em português, para o log e para a tela. */
  quem: string;
  /** Qual endereço (ou nome verificado) denunciou. Sem telefone de cliente: só contas oficiais aparecem aqui. */
  porque: string;
};

/** Telefones (só dígitos, com DDI) das contas oficiais. */
const TELEFONES_OFICIAIS = new Map<string, string>([
  // Suporte do WhatsApp — o do caso da Divinos (25/09/2026).
  ["15517868423", "Suporte do WhatsApp"],
  // OFFICIAL_BIZ_JID do Baileys: a conta oficial "WhatsApp".
  ["16505361212", "Conta oficial do WhatsApp"],
  // META_AI_JID do Baileys.
  ["13135550002", "Meta AI"],
]);

/**
 * LIDs conhecidos das mesmas contas. LID é a identidade nova do WhatsApp e é
 * GLOBAL da conta (não depende de quem conversa com ela): o Suporte chegou
 * assim à Divinos, sem telefone junto em parte das mensagens.
 */
const LIDS_OFICIAIS = new Map<string, string>([
  ["198964645236955", "Suporte do WhatsApp"],
]);

/**
 * Faixa de números dos robôs da Meta AI (`isJidBot` do Baileys:
 * /^1313555\d{4}$|^131655500\d{2}$/). São números fictícios da faixa 555 dos
 * EUA, que nenhum cliente de loja brasileira usa.
 */
const FAIXA_DE_ROBO_DA_META = /^1313555\d{4}$|^131655500\d{2}$/;

/**
 * Usuários de sistema: avisos do WhatsApp (0@c.us / 0@s.whatsapp.net) e o
 * próprio servidor. Map, e não objeto literal: `{}` tem "constructor" e
 * "toString" herdados, e um endereço "constructor@..." viraria conta oficial.
 */
const USUARIOS_DE_SISTEMA = new Map<string, string>([
  ["0", "Avisos do WhatsApp (sistema)"],
  ["server", "Servidor do WhatsApp"],
]);

/** Servidores que nunca são conversa de cliente, mesmo que o sufixo passe em outro filtro. */
const SERVIDORES_DE_SISTEMA = new Map<string, string>([
  ["bot", "Meta AI"],
  ["call", "Chamada do WhatsApp (sistema)"],
]);

/**
 * Nome de empresa verificada que é da própria Meta. Ancorado dos dois lados:
 * "Meta Burger", "Pizzaria Meta" e "WhatsApp da Tia" são clientes.
 */
const NOME_VERIFICADO_OFICIAL =
  /^(?:whats\s?app|meta|facebook|instagram)(?:\s+(?:ai|support|suporte|business|brasil|verified|verificado))?$|^suporte\s+(?:do\s+)?whats\s?app$/;

function normalizarNome(nome: unknown): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Desmonta um endereço do WhatsApp em usuário e servidor.
 *
 * "15517868423:12@s.whatsapp.net" → { usuario: "15517868423", servidor: "s.whatsapp.net" }
 * O ":12" é o id do APARELHO, não parte do número.
 */
function desmontar(jid: unknown): { usuario: string; servidor: string } | null {
  if (jid === null || jid === undefined) return null;
  if (typeof jid !== "string" && typeof jid !== "number") return null;
  const texto = String(jid).trim().toLowerCase();
  if (!texto) return null;
  const corte = texto.lastIndexOf("@");
  const usuarioBruto = corte === -1 ? texto : texto.slice(0, corte);
  const servidor = corte === -1 ? "" : texto.slice(corte + 1);
  const usuario = usuarioBruto.split(":")[0].replace(/^\+/, "").trim();
  return { usuario, servidor };
}

/** Uma identidade só: devolve a conta oficial, ou null. */
function contaDoJid(jid: unknown): ContaOficial | null {
  const partes = desmontar(jid);
  if (!partes) return null;
  const { usuario, servidor } = partes;

  const doServidor = servidor ? SERVIDORES_DE_SISTEMA.get(servidor) : undefined;
  if (doServidor) return { quem: doServidor, porque: `endereço @${servidor}` };
  const deSistema = USUARIOS_DE_SISTEMA.get(usuario);
  if (deSistema) return { quem: deSistema, porque: `${usuario}@${servidor || "?"}` };

  // LID: o número é um id interno, não um telefone — só casa com a lista de LIDs.
  if (servidor === "lid") {
    const lid = LIDS_OFICIAIS.get(usuario);
    return lid ? { quem: lid, porque: `${usuario}@lid` } : null;
  }

  // Telefone: só dígitos (tolera "+1 551-786-8423" digitado ou vindo cru).
  const digitos = usuario.replace(/[\s().-]/g, "");
  if (!/^\d+$/.test(digitos)) return null;
  const telefone = TELEFONES_OFICIAIS.get(digitos);
  if (telefone) return { quem: telefone, porque: `+${digitos}` };
  if (FAIXA_DE_ROBO_DA_META.test(digitos)) return { quem: "Meta AI", porque: `+${digitos}` };
  return null;
}

/**
 * A mensagem veio de uma conta oficial do WhatsApp/Meta?
 *
 * `jids` são TODOS os endereços que o payload trouxe (remoteJid, remoteJidAlt,
 * senderPn, participant, senderAlt, from...): basta um casar. O Suporte chegou
 * à Divinos ora por LID, ora com o telefone junto — olhar só o endereço já
 * resolvido deixaria passar a metade que vem pelo outro.
 */
export function contaOficialDoWhatsApp(entrada: {
  jids?: unknown[] | null;
  verifiedBizName?: unknown;
}): ContaOficial | null {
  for (const jid of entrada?.jids || []) {
    const achada = contaDoJid(jid);
    if (achada) return achada;
  }
  const nome = normalizarNome(entrada?.verifiedBizName);
  if (nome && NOME_VERIFICADO_OFICIAL.test(nome)) {
    return { quem: "Conta verificada da Meta", porque: `nome verificado "${String(entrada?.verifiedBizName).trim()}"` };
  }
  return null;
}

/** Atalho booleano de `contaOficialDoWhatsApp`. */
export function ehContaOficialDoWhatsApp(entrada: { jids?: unknown[] | null; verifiedBizName?: unknown }): boolean {
  return contaOficialDoWhatsApp(entrada) !== null;
}
