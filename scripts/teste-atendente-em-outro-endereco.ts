/**
 * "Atendente assumiu" vale para a conversa inteira, não só para o endereço em
 * que foi gravado (src/lib/loop-guard.ts, `outrosEnderecos`).
 *
 * O caso real (Pizzaria do Costa, 25/09/2026): o dono puxou assunto pelo
 * celular com um contato cujo telefone o gateway não conhecia — a trava foi
 * gravada no LID. A resposta do contato chegou um minuto depois COM o telefone,
 * a conversa passou a ser a do telefone, e o robô respondeu por cima do dono.
 *
 * Sem banco: um prisma de mentira em memória, posto no lugar do singleton
 * antes de carregar o módulo.
 *
 *   npx tsx scripts/teste-atendente-em-outro-endereco.ts
 */
export {}; // módulo: o import do loop-guard é dinâmico e vem depois do prisma de mentira
// prisma.ts só exige que a variável exista; o cliente de verdade nunca é criado.
process.env.DATABASE_URL ||= "teste-sem-banco";

const linhas = new Map<string, any>();
let falharEm: string | null = null;
const chave = (w: any) => `${w.userId_remoteJid.userId}|${w.userId_remoteJid.remoteJid}`;
(globalThis as any).prisma = {
  chatbotConversationState: {
    async findUnique({ where }: any) {
      if (falharEm && where.userId_remoteJid.remoteJid === falharEm) throw new Error("conexão caiu");
      return linhas.get(chave(where)) ?? null;
    },
    async upsert({ where, create, update }: any) {
      if (falharEm && where.userId_remoteJid.remoteJid === falharEm) throw new Error("conexão caiu");
      const vazia = {
        turnCount: 0, turnsWithoutProgress: 0, recentIntervals: [], recentHashes: [], botSentHashes: [],
        lastMessageAt: null, degradedAt: null, degradedReason: null, humanTakeoverAt: null,
      };
      const atual = linhas.get(chave(where));
      linhas.set(chave(where), atual ? { ...atual, ...update } : { ...vazia, ...create });
      return linhas.get(chave(where));
    },
  },
};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`); }
}

(async () => {
  const { evaluateLoopGuard, handleOutgoingMessage, registerBotReply, HUMAN_TAKEOVER_SILENCE_MS } =
    await import("../src/lib/loop-guard");

  const LID = "186475350100001@lid";
  const TEL = "5516999990001@s.whatsapp.net";
  const t0 = 1_790_000_000_000;
  const pergunta = "Você tem interesse em excluir a loja da plataforma?";

  // O caso real: dono fala pelo LID, a resposta chega pelo telefone.
  confere("mensagem do dono pelo LID é atendente", await handleOutgoingMessage("costa", LID, "Excluir a conta por favor", t0));
  const r1 = await evaluateLoopGuard({ userId: "costa", remoteJid: TEL, outrosEnderecos: [LID], text: pergunta, now: t0 + 63_000 });
  confere("resposta pelo telefone um minuto depois: robô calado", r1.action === "ignore");

  // Sem os outros endereços é o comportamento antigo — o que deixou o robô falar.
  await handleOutgoingMessage("antigo", LID, "Excluir a conta por favor", t0);
  const r2 = await evaluateLoopGuard({ userId: "antigo", remoteJid: TEL, text: pergunta, now: t0 + 63_000 });
  confere("sem outrosEnderecos a trava do LID não é vista (por isso o conserto)", r2.action === "allow");

  // O silêncio continua tendo prazo.
  await handleOutgoingMessage("prazo", LID, "Bom dia", t0);
  const r3 = await evaluateLoopGuard({ userId: "prazo", remoteJid: TEL, outrosEnderecos: [LID], text: "oi", now: t0 + HUMAN_TAKEOVER_SILENCE_MS + 1_000 });
  confere("passado o prazo do silêncio, o robô volta", r3.action === "allow");
  confere("contadores ficam no endereço principal", linhas.get(`prazo|${TEL}`)?.turnCount === 1 && linhas.get(`prazo|${LID}`)?.turnCount === 0);

  // O sentido contrário: trava no telefone, cliente chega só pelo LID.
  await handleOutgoingMessage("inverso", TEL, "já te respondo", t0);
  const r4 = await evaluateLoopGuard({ userId: "inverso", remoteJid: LID, outrosEnderecos: [TEL], text: "e aí?", now: t0 + 30_000 });
  confere("trava no telefone vale para a conversa pelo LID", r4.action === "ignore");

  // O eco do próprio robô no LID não é atendente.
  await registerBotReply("eco", LID, "Oi! Segue o cardápio");
  confere("eco do robô no LID não assume", !(await handleOutgoingMessage("eco", LID, "Oi! Segue o cardápio", t0)));
  const r5 = await evaluateLoopGuard({ userId: "eco", remoteJid: TEL, outrosEnderecos: [LID], text: "quero 2 x salada", now: t0 + 10_000 });
  confere("depois do eco o robô segue atendendo", r5.action === "allow");

  // Falha ao ler o endereço secundário não derruba a avaliação.
  falharEm = LID;
  const r6 = await evaluateLoopGuard({ userId: "falha", remoteJid: TEL, outrosEnderecos: [LID], text: "oi", now: t0 });
  falharEm = null;
  confere("falha no LID: decide pelo principal", r6.action === "allow" && linhas.get(`falha|${TEL}`)?.turnCount === 1);
  confere("falha no LID: nada gravado nele", !linhas.has(`falha|${LID}`));

  // Lixo na lista não quebra nada.
  const r7 = await evaluateLoopGuard({ userId: "lixo", remoteJid: TEL, outrosEnderecos: ["", TEL, TEL], text: "oi", now: t0 });
  confere("lista com vazio e o próprio endereço", r7.action === "allow");

  console.log(`${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
