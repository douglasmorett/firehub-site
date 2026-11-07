/**
 * O robô não se cala com o eco da PRÓPRIA mensagem (src/lib/loop-guard.ts,
 * `registerBotReply` e `handleOutgoingMessage`).
 *
 * O caso real (Frangoso, 30/10/2026): o robô mandou "Boa noite, Leandro!..." e
 * "Tudo sim, Leandro!" no mesmo minuto. O registro de cada resposta era ler a
 * lista de hashes, somar e gravar a lista inteira — os dois processamentos ao
 * mesmo tempo, um gravando por cima do outro. O eco da mensagem que ficou de
 * fora chegou como "atendente assumiu" e o cliente ficou sem resposta. O
 * Lucas: "não foi ninguém daqui da equipe".
 *
 * Sem banco: um prisma de mentira em memória, com a soma do hash feita de uma
 * vez como o SQL faz. A gravação "lenta" simula o registro ainda a caminho.
 *
 *   npx tsx scripts/teste-eco-do-robo.ts
 */
export {};
process.env.DATABASE_URL ||= "teste-sem-banco";

const linhas = new Map<string, any>();
const chave = (w: any) => `${w.userId_remoteJid.userId}|${w.userId_remoteJid.remoteJid}`;
let atrasoDaSoma = 0;
(globalThis as any).prisma = {
  chatbotConversationState: {
    async findUnique({ where }: any) {
      return linhas.get(chave(where)) ?? null;
    },
    async upsert({ where, create, update }: any) {
      const atual = linhas.get(chave(where));
      linhas.set(chave(where), atual ? { ...atual, ...update } : { botSentHashes: [], ...create });
      return linhas.get(chave(where));
    },
  },
  async $executeRawUnsafe(_sql: string, _id: string, userId: string, remoteJid: string, hash: string, janela: number) {
    if (atrasoDaSoma) await new Promise((r) => setTimeout(r, atrasoDaSoma));
    const k = `${userId}|${remoteJid}`;
    const atual = linhas.get(k) ?? { botSentHashes: [] };
    linhas.set(k, { ...atual, botSentHashes: [...(atual.botSentHashes || []), hash].slice(-janela) });
    return 1;
  },
};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`); }
}

(async () => {
  const { handleOutgoingMessage, registerBotReply, ESPERA_DO_ECO_MS } = await import("../src/lib/loop-guard");
  const TEL = "5521998025306@s.whatsapp.net";
  const t0 = 1_790_000_000_000;
  const saudacao = "Boa noite, Leandro! Tudo bem? 😊 Aqui é Lucas, do atendimento da Frangoso - Trindade.";
  const resposta = "Tudo sim, Leandro! 😊 Em que posso te ajudar?";

  // As duas respostas registradas ao mesmo tempo: nenhuma some.
  await Promise.all([registerBotReply("frangoso", TEL, saudacao), registerBotReply("frangoso", TEL, resposta)]);
  confere("duas respostas no mesmo instante ficam as duas na lista", linhas.get(`frangoso|${TEL}`)?.botSentHashes?.length === 2);
  confere("eco da saudação não é atendente", !(await handleOutgoingMessage("frangoso", TEL, saudacao, t0)));
  confere("eco da resposta não é atendente", !(await handleOutgoingMessage("frangoso", TEL, resposta, t0)));
  confere("nada de atendente gravado", !linhas.get(`frangoso|${TEL}`)?.humanTakeoverAt);

  // O eco chega antes de o registro terminar (outro servidor, banco lento).
  atrasoDaSoma = 400;
  const registro = registerBotReply("lento", TEL, resposta);
  const assumiu = await handleOutgoingMessage("lento", TEL, resposta, t0);
  await registro;
  atrasoDaSoma = 0;
  confere("eco que chega antes do registro não cala o robô", assumiu === false);
  confere("registro lento: nada de atendente gravado", !linhas.get(`lento|${TEL}`)?.humanTakeoverAt);

  // Atendente de verdade continua sendo atendente (depois da espera).
  await registerBotReply("humano", TEL, resposta);
  const antes = Date.now();
  confere("texto que o robô nunca mandou é atendente", await handleOutgoingMessage("humano", TEL, "Já te respondo, Leandro", t0));
  confere("e espera o eco antes de decidir", Date.now() - antes >= ESPERA_DO_ECO_MS - 50);
  confere("atendente gravado", linhas.get(`humano|${TEL}`)?.humanTakeoverAt instanceof Date);

  // A janela continua com as 10 últimas.
  for (let i = 0; i < 12; i++) await registerBotReply("janela", TEL, `mensagem ${i}`);
  confere("a lista guarda só as 10 últimas", linhas.get(`janela|${TEL}`)?.botSentHashes?.length === 10);
  confere("a mais antiga que sobrou é a 2", !(await handleOutgoingMessage("janela", TEL, "mensagem 2", t0)));

  // Saudação automática do WhatsApp Business (06/11/2026): sai 2 s depois do
  // primeiro "oi" do cliente. Não é o lojista assumindo — o robô segue.
  const SAUDACAO_DO_BUSINESS = "Olá! Seja bem vindo ao *Construção do lanche* 🥳 Veja o nosso cardápio";
  linhas.set(`business|${TEL}`, { botSentHashes: [], lastMessageAt: new Date(t0), recentIntervals: [] });
  confere("saudação do Business 2 s depois do primeiro 'oi' não cala o robô", !(await handleOutgoingMessage("business", TEL, SAUDACAO_DO_BUSINESS, t0 + 2000)));
  confere("saudação do Business: nada de atendente gravado", !linhas.get(`business|${TEL}`)?.humanTakeoverAt);
  // No meio da conversa (o cliente tinha escrito 40 s antes), 2 s depois é o lojista.
  linhas.set(`meio|${TEL}`, { botSentHashes: [], lastMessageAt: new Date(t0), recentIntervals: [40_000] });
  confere("no meio da conversa, mensagem 2 s depois do cliente é o lojista", await handleOutgoingMessage("meio", TEL, "Já te mando o Pix", t0 + 2000));

  console.log(`${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
