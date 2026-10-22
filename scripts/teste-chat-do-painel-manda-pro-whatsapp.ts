/**
 * No chat de suporte do PAINEL, quando precisa da equipe, o robô manda chamar
 * no WhatsApp do FireHub e segue respondendo; no WhatsApp continua como era
 * (Douglas, 22/10/2026 — o Sushi Dojo ficou 30+ min falando sozinho no painel).
 *
 *   npx tsx scripts/teste-chat-do-painel-manda-pro-whatsapp.ts
 *
 * Sem banco e sem Gemini: o prisma é trocado por um falso em memória, e a
 * config do atendimento aponta o aviso do dono para o próprio número do
 * atendimento (avisarDono não manda nada nesse caso).
 */
// Módulo, não script global: o tsc do build lê scripts/ junto, e `falhas` colidiria com os outros.
export {};

// Banco que não existe: nada aqui pode chegar ao de verdade.
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/teste";

let falhas = 0;
const confere = (oQue: string, ok: boolean, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok || !detalhe ? "" : ` — ${detalhe}`}`);
};

const NUMERO = "(22) 98111-8514";
const LINK = "https://wa.me/5522981118514";

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const atualizacoes: any[] = [];
  const eventos: string[] = [];
  const falso: any = {
    crmContato: { update: async (a: any) => { atualizacoes.push(a); return {}; } },
    crmEvento: {
      findFirst: async () => null,
      create: async ({ data }: any) => { eventos.push(data.texto); return {}; },
    },
    crmConfig: { findUnique: async () => ({ dados: { avisarNoWhatsApp: "5500900000001", conexao: { telefone: "5500900000001" } } }) },
  };
  for (const k of Object.keys(falso)) Object.defineProperty(prisma, k, { value: falso[k], configurable: true });

  const { instrucoes, respostaDeReserva } = await import("../src/lib/atendimento/robo");
  const { executarFerramenta, chamarPessoa } = await import("../src/lib/atendimento/ferramentas");
  const { CONFIG_PADRAO } = await import("../src/lib/atendimento/config");

  const loja = () => ({ id: "c1", telefone: null, nome: "Kenji", nomeDaLoja: "Sushi Dojo", cidade: null, email: null, userId: "u1", vendedorId: null, etapa: "CLIENTE", resumo: null });
  const doPainel = () => ({ ...loja(), canalDaConversa: "PAINEL" });
  const doWhatsApp = () => ({ ...loja(), telefone: "22999990000", canalDaConversa: "WHATSAPP" });
  const limpa = () => { atualizacoes.length = 0; eventos.length = 0; };
  const marcouEspera = () => atualizacoes.some((a) => a?.data?.aguardandoHumanoDesde);

  // ── O prompt ───────────────────────────────────────────────────────────────
  const videos = { manual: "", jaEnviados: [] };
  const pPainel = instrucoes(CONFIG_PADRAO, loja(), null, null, false, null, videos, "PAINEL");
  const pZap = instrucoes(CONFIG_PADRAO, { ...loja(), userId: null }, null, null, false, null, videos, "WHATSAPP");
  confere("painel: prompt traz o número e o link do WhatsApp", pPainel.includes(NUMERO) && pPainel.includes(LINK));
  confere("painel: prompt não diz mais que a equipe responde no chat", !/a equipe responde aqui mesmo/.test(pPainel) && !/avise que alguém da equipe vai responder por aqui/.test(pPainel));
  confere("painel: prompt pede o login do Portal do Parceiro para puxar o cardápio", pPainel.includes("Portal do Parceiro do iFood"));
  confere("whatsapp: prompt como era (equipe responde por aqui)", pZap.includes("Ao chamar, avise que alguém da equipe vai responder por aqui."));
  confere("whatsapp: sem a seção do chat do painel", !pZap.includes("# Chat do painel"));

  // ── chamar_pessoa ─────────────────────────────────────────────────────────
  limpa();
  const rPainel: any = await executarFerramenta("chamar_pessoa", { motivo: "Quer o app da loja." }, doPainel());
  confere("painel: chamar_pessoa manda o número e o link", String(rPainel.aviso).includes(NUMERO) && String(rPainel.aviso).includes(LINK), rPainel.aviso);
  confere("painel: e o robô segue atendendo", !/Não continue/.test(rPainel.aviso) && /continue respondendo/.test(rPainel.aviso), rPainel.aviso);
  confere("painel: a conversa NÃO fica esperando uma pessoa", !marcouEspera(), JSON.stringify(atualizacoes));
  confere("painel: fica o registro na ficha", eventos.some((e) => e.startsWith("Mandou chamar no WhatsApp do FireHub: Quer o app")), JSON.stringify(eventos));

  limpa();
  const rZap: any = await executarFerramenta("chamar_pessoa", { motivo: "Quer o app da loja." }, doWhatsApp());
  confere("whatsapp: chamar_pessoa como era", rZap.aviso === "Avise que uma pessoa da equipe vai responder por aqui em breve. Não continue o atendimento.", rZap.aviso);
  confere("whatsapp: a conversa espera uma pessoa (robô para)", marcouEspera());
  confere("whatsapp: evento de sempre", eventos.some((e) => e.startsWith("Chamou uma pessoa: Quer o app")), JSON.stringify(eventos));

  // A trava de laço e a revisão chamam chamarPessoa direto (robo.ts).
  limpa();
  await chamarPessoa(doPainel(), "O robô respondeu 12 vezes em 10 minutos.");
  confere("painel: chamarPessoa direto também não trava a conversa", !marcouEspera());

  // ── montar_loja (puxar o cardápio do iFood) ───────────────────────────────
  limpa();
  const ifood = "https://www.ifood.com.br/delivery/cabo-frio-rj/sushi-dojo/abc";
  const rMontar: any = await executarFerramenta("montar_loja", { nomeDaLoja: "Sushi Dojo", linkDoCardapio: ifood }, doPainel());
  confere("painel: montar_loja manda para o WhatsApp com o que levar", String(rMontar.aviso).includes(LINK) && String(rMontar.aviso).includes("Portal do Parceiro do iFood"), rMontar.aviso);
  confere("painel: montar_loja não trava a conversa", !marcouEspera());
  confere("painel: o link do iFood fica na ficha para a equipe", eventos.some((e) => e.includes(ifood)), JSON.stringify(eventos));

  // ── Respostas prontas (o modelo agiu e não escreveu) ──────────────────────
  const chamou = [{ nome: "chamar_pessoa", resultado: { ok: true } }];
  const montou = [{ nome: "montar_loja", resultado: { ok: true } }];
  const reservaPainel = respostaDeReserva(chamou, "PAINEL");
  confere("painel: reserva do chamar_pessoa traz número e link", reservaPainel.includes(NUMERO) && reservaPainel.includes(LINK), reservaPainel);
  confere("painel: reserva não promete resposta por aqui", !/respondem por aqui/.test(reservaPainel), reservaPainel);
  confere("painel: reserva do montar_loja pede o login do portal no WhatsApp", respostaDeReserva(montou, "PAINEL").includes("Portal do Parceiro do iFood"));
  confere("whatsapp: reserva do chamar_pessoa como era", respostaDeReserva(chamou, "WHATSAPP") === "Já chamei alguém da nossa equipe — em instantes te respondem por aqui. 🙏");
  confere("whatsapp: reserva do montar_loja como era", respostaDeReserva(montou).startsWith("Recebi o seu cardápio!"));

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
