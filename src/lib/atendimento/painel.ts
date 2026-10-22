import { prisma } from "@/lib/prisma";
import { chaveDoTelefone, jidDoTelefone, telefoneParaExibir } from "@/lib/crm/telefone";
import { registrarEvento } from "@/lib/crm/contatos";
import type { Canal } from "@/lib/crm/mensagens";
import { WHATSAPP_DE_VENDAS } from "@/lib/app-da-loja/solicitacao";

/**
 * O CHAT DE SUPORTE DENTRO DO PAINEL — a aba "Suporte FireHub" do balão do
 * painel da loja (HumanSupportFloatingWidget → SuporteDoFireHub).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O número do FireHub caiu (banido pelo WhatsApp) duas vezes, e a cada queda
 * os lojistas ficavam sem ter com quem falar (Douglas, 08/10/2026). O chat do
 * painel não passa pelo WhatsApp: a pessoa já está logada, escreve ali, o
 * robô responde ali, e a equipe responde pela MESMA tela do atendimento no
 * admin.
 *
 * ── É a mesma conversa do CRM ───────────────────────────────────────────────
 *
 * Cada loja tem um contato no CRM (`CrmContato.userId`). As mensagens do
 * painel entram nele com `canal = "PAINEL"`: o robô lê o histórico inteiro
 * (o que a loja já falou pelo WhatsApp também conta), a equipe vê tudo junto,
 * e a resposta volta pelo canal em que a pessoa escreveu por último
 * (`canalDaResposta`). O balão do painel mostra só o que passou por ele.
 *
 * ── Identidade ──────────────────────────────────────────────────────────────
 *
 * Quem escreve aqui passou pelo login, e isso vale mais que o número do
 * WhatsApp: as ferramentas do robô que mexem na conta (lojaDoNumero em
 * ferramentas.ts) aceitam a conversa do painel como prova de que é a loja.
 *
 * ── A equipe atende pelo WhatsApp, não aqui ─────────────────────────────────
 *
 * Ninguém da equipe fica olhando este chat: o robô chamava uma pessoa, dizia
 * "alguém responde por aqui" e calava — o Sushi Dojo mandou o link do iFood e
 * ficou mais de 30 min falando sozinho (Douglas, 22/10/2026). Agora, no
 * painel, quando precisa da equipe o robô manda chamar no WhatsApp do FireHub
 * (os textos abaixo) e continua respondendo as dúvidas: a conversa do painel
 * não fica "esperando uma pessoa" (chamarPessoa em ferramentas.ts).
 */

/** O WhatsApp do atendimento do FireHub (o mesmo do site, do login e do pedido do app da loja). */
export const WHATSAPP_DO_FIREHUB_NA_TELA = telefoneParaExibir(WHATSAPP_DE_VENDAS);
export const LINK_DO_WHATSAPP_DO_FIREHUB = `https://wa.me/${WHATSAPP_DE_VENDAS}`;
const CHAME_NO_WHATSAPP = `chama a gente no WhatsApp do FireHub, ${WHATSAPP_DO_FIREHUB_NA_TELA}: ${LINK_DO_WHATSAPP_DO_FIREHUB}`;

/** Precisa da equipe (pediu pessoa, cobrança, a equipe fazer algo na conta). */
export const PAINEL_PRECISA_DA_EQUIPE = `Isso quem resolve é a nossa equipe, e ela atende pelo WhatsApp: ${CHAME_NO_WHATSAPP}. Eu continuo aqui para as outras dúvidas.`;
/** Pediu para puxar/montar o cardápio: o iFood bloqueia a cópia pelo link público, então a equipe precisa do login do portal (ou de outro cardápio, ou fotos). */
export const PAINEL_MONTAR_O_CARDAPIO = `Para a nossa equipe puxar o seu cardápio, ${CHAME_NO_WHATSAPP} e manda lá o login do Portal do Parceiro do iFood (o iFood bloqueia a cópia pelo link público), o link de outro cardápio digital ou fotos/PDF do cardápio. Eu continuo aqui para as outras dúvidas.`;
/** A revisão barrou a resposta (conferente.ts): no painel, "alguém te responde por aqui" deixava a pessoa esperando. */
export const PAINEL_NAO_SABE = `Essa eu prefiro confirmar com a nossa equipe para não te passar nada errado: ${CHAME_NO_WHATSAPP}. Eu continuo aqui para as outras dúvidas.`;
/** Pediu para a equipe mexer na loja e o robô ia dizer que já tinha feito (conferente.ts). */
export const PAINEL_NAO_FAZ = `Essa mudança quem faz é a nossa equipe, e ela atende pelo WhatsApp: ${CHAME_NO_WHATSAPP}. Se preferir fazer agora, eu te passo o passo a passo por aqui.`;

/** O contato da loja no CRM; cria quando a loja ainda não tem (mesma regra do "Trazer as lojas"). */
export async function contatoDoPainel(lojaId: string) {
  const existente = await prisma.crmContato.findFirst({
    where: { userId: lojaId },
    orderBy: [{ ultimaMensagemEm: { sort: "desc", nulls: "last" } }, { criadoEm: "asc" }],
  });
  if (existente) return existente;

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { id: true, name: true, storeName: true, city: true, email: true, storePhone: true, notificationPhone: true, vendedorId: true, vendedorAtribuidoEm: true, trialEndsAt: true, createdAt: true },
  });
  if (!loja) return null;

  const telefone = loja.notificationPhone || loja.storePhone;
  const chave = chaveDoTelefone(telefone);
  const doNumero = chave ? await prisma.crmContato.findUnique({ where: { telefone: chave } }) : null;
  // O dono já escreveu do número dele e virou lead: a conversa é essa.
  if (doNumero && !doNumero.userId) {
    const ligado = await prisma.crmContato.update({
      where: { id: doNumero.id },
      data: {
        userId: loja.id,
        nomeDaLoja: doNumero.nomeDaLoja || loja.storeName,
        cidade: doNumero.cidade || loja.city,
        email: doNumero.email || loja.email,
        ...(!doNumero.vendedorId && loja.vendedorId ? { vendedorId: loja.vendedorId, vendedorAtribuidoEm: loja.vendedorAtribuidoEm || new Date() } : {}),
      },
    });
    await registrarEvento(ligado.id, "CADASTRO", `Ligado à loja ${loja.storeName || loja.name} pelo chat do painel.`);
    return ligado;
  }

  const fimDoTeste = loja.trialEndsAt ? loja.trialEndsAt.getTime() : loja.createdAt.getTime() + 15 * 86_400_000;
  const novo = await prisma.crmContato.create({
    data: {
      // Número já usado por outro contato (dono de duas lojas): fica só com o endereço.
      telefone: doNumero ? null : chave,
      jid: jidDoTelefone(telefone),
      nome: loja.name,
      nomeDaLoja: loja.storeName,
      cidade: loja.city,
      email: loja.email,
      origem: "PAINEL",
      etapa: fimDoTeste > Date.now() ? "EM_TESTE" : "CLIENTE",
      userId: loja.id,
      vendedorId: loja.vendedorId,
      vendedorAtribuidoEm: loja.vendedorId ? loja.vendedorAtribuidoEm || new Date() : null,
    },
  });
  await registrarEvento(novo.id, "CADASTRO", "Escreveu pelo chat de suporte do painel.");
  return novo;
}

/** O contato da loja, sem criar (para ler a conversa sem que abrir o balão vire contato). */
export function contatoExistenteDoPainel(lojaId: string) {
  return prisma.crmContato.findFirst({
    where: { userId: lojaId },
    orderBy: [{ ultimaMensagemEm: { sort: "desc", nulls: "last" } }, { criadoEm: "asc" }],
  });
}

/** Por onde a conversa responde: o canal da última mensagem que o contato mandou. */
export async function canalDaResposta(contatoId: string): Promise<Canal> {
  const ultima = await prisma.crmMensagem.findFirst({
    where: { contatoId, direcao: "ENTRADA" },
    orderBy: { criadoEm: "desc" },
    select: { canal: true },
  });
  return ultima?.canal === "PAINEL" ? "PAINEL" : "WHATSAPP";
}

/** O que o balão do painel mostra: só o que passou por ele, da mais antiga para a mais nova. */
export async function mensagensDoPainel(contatoId: string, limite = 80) {
  const ultimas = await prisma.crmMensagem.findMany({
    where: { contatoId, canal: "PAINEL" },
    orderBy: { criadoEm: "desc" },
    take: limite,
    select: { id: true, direcao: true, autor: true, autorNome: true, texto: true, status: true, criadoEm: true },
  });
  return ultimas.reverse();
}

/**
 * Teto de mensagens do lojista: o chat é de gente, e um script colado num
 * campo de texto não pode virar uma fila de chamadas ao Gemini.
 */
export const MAXIMO_DO_LOJISTA_NA_JANELA = 30;
export const JANELA_DO_LOJISTA_MS = 10 * 60_000;
