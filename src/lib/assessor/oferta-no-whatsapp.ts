/**
 * O DONO SEM O BILL FALANDO COM A PRÓPRIA LOJA PELO WHATSAPP.
 *
 * Douglas, 23/10/2026: conversar com a própria loja (relatório, faturamento,
 * caixa, lançar, pausar) é o Bill. "Não é para ninguém conseguir ficar
 * conversando com a própria loja e fazendo as coisas, tirando informação sem
 * ativar o Bill." Quem tenta recebe a oferta; respondeu que sim, o Bill liga
 * ali mesmo (com o termo, como na tela) e a cobrança segue o termo.
 *
 * Antes: o modo dono do robô de vendas (chatbot-ai) passava o retrato da loja
 * de graça. Agora a mensagem do dono sem o Bill para aqui e não chega ao robô.
 *
 * O "sim" só vale logo depois de o termo ter sido mostrado (JANELA_DO_SIM): a
 * oferta guardada é a prova do que ele leu. Guardada na memória do servidor —
 * reiniciou no meio, ele recebe a oferta de novo, e só.
 *
 * E só com a chave do gateway (lib/chave-do-gateway.ts): o webhook aceita sem
 * ela a instância que ainda não a mandou, e aí o "sim" do dono pode ser forjado
 * por quem sabe o número dele. Ligar o Bill é cobrança: sem a chave, não liga.
 */
import { CLAUSULAS_DO_TERMO_DO_BILL, VERSAO_DO_TERMO_DO_BILL } from "./termo";

const JANELA_DO_SIM_MS = 30 * 60 * 1000;
const ofertas = new Map<string, number>();

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

function sem(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** "sim", "pode ativar", "quero" — curto e sem "não" no meio. */
export function ehSim(texto: string): boolean {
  const t = sem(texto);
  if (!t || t.length > 40 || /\bnao\b/.test(t)) return false;
  return /^(sim|s|ss|pode|ativa|ativar|ative|quero|ok|okay|bora|claro|aceito|confirmo|isso|manda ver|fechado)\b/.test(t);
}

export function ehNao(texto: string): boolean {
  return /^(n|nao|agora nao|depois|deixa|nao quero)\b/.test(sem(texto));
}

export function textoDaOferta(o: { nomeDaLoja: string; preco: number; jaTestou: boolean }): string {
  const preco = o.jaTestou
    ? `São ${reais(o.preco)} por mês no boleto do FireHub.`
    : `São *7 dias grátis* e, depois, ${reais(o.preco)} por mês no boleto do FireHub.`;
  return [
    `Oi! Conversar com a ${o.nomeDaLoja} por aqui (relatórios, faturamento, caixa, pedidos, lançar compra, pausar item do cardápio) é função do *Bill, seu assessor*, e ele ainda não está ativo na sua loja.`,
    `Quer que eu ative agora? ${preco}`,
    `Respondendo *SIM*, você aceita o termo de contratação:\n${CLAUSULAS_DO_TERMO_DO_BILL.map((c) => `• ${c}`).join("\n")}`,
    `Responda *SIM* para ativar.`,
  ].join("\n\n");
}

export const TEXTO_CURTO_DA_OFERTA =
  "Isso é com o *Bill, seu assessor*, que ainda não está ativo na sua loja. Responda *SIM* para ativar (termo na mensagem acima) ou *NÃO* para deixar para depois.";

export const TEXTO_SEM_CHAVE =
  "Por aqui não consegui confirmar a ativação. Ative no painel, em *Bill, seu assessor* — é um clique.";

export const TEXTO_DO_NAO =
  "Tudo bem! Quando quiser, é só me mandar *SIM* por aqui ou ativar no painel, em *Bill, seu assessor*.";

export type RespostaAoDono = { resposta: string; acao: "oferta" | "lembrete" | "ativou" | "recusou" | "falhou" | "sem-chave" };

export async function respostaAoDonoSemBill(e: {
  franchiseeId: string;
  telefone: string;
  texto: string;
  /** O evento chegou com a chave certa do gateway (chaveDoGateway === "ok"). */
  comChaveDoGateway: boolean;
  agora?: Date;
}): Promise<RespostaAoDono> {
  const agora = e.agora ?? new Date();
  const chave = `${e.franchiseeId}:${e.telefone}`;
  const ofertadoEm = ofertas.get(chave);
  const ofertaValendo = ofertadoEm !== undefined && agora.getTime() - ofertadoEm < JANELA_DO_SIM_MS;
  const { estadoDoAssessor, ligarOuDesligarAssessor } = await import("./assinatura");

  if (ofertaValendo && ehSim(e.texto)) {
    if (!e.comChaveDoGateway) {
      // A oferta fica valendo: o "sim" de verdade, com a chave, ainda liga.
      console.warn(`[Bill pelo WhatsApp] "Sim" sem a chave do gateway: NÃO ativei ${e.franchiseeId} (+${e.telefone.slice(-4)}).`);
      return { acao: "sem-chave", resposta: TEXTO_SEM_CHAVE };
    }
    try {
      const estado = await ligarOuDesligarAssessor(
        e.franchiseeId,
        true,
        {
          versao: VERSAO_DO_TERMO_DO_BILL,
          email: null,
          ip: null,
          userAgent: `WhatsApp +${e.telefone}: respondeu "${e.texto.trim().slice(0, 60)}" à oferta com o termo`,
        },
        agora,
      );
      ofertas.delete(chave);
      const quando = estado.emTeste && estado.testeAte
        ? `Seus 7 dias grátis vão até ${dataBr(estado.testeAte)}; depois, ${reais(estado.preco)} por mês no boleto do FireHub.`
        : `${reais(estado.preco)} por mês no boleto do FireHub.`;
      return {
        acao: "ativou",
        resposta: `Pronto, o *Bill, seu assessor* está ativo ✅ ${quando}\n\nAgora é só me mandar o que precisa: relatório do dia, caixa, compra para lançar, item para pausar… por texto, áudio ou foto.`,
      };
    } catch (err: any) {
      console.error(`[Bill pelo WhatsApp] Não ativou ${e.franchiseeId}:`, err?.message || err);
      return { acao: "falhou", resposta: "Não consegui ativar agora. Tenta de novo em alguns minutos, ou ative no painel, em *Bill, seu assessor*." };
    }
  }

  if (ofertaValendo && ehNao(e.texto)) {
    ofertas.delete(chave);
    return { acao: "recusou", resposta: TEXTO_DO_NAO };
  }

  if (ofertaValendo) return { acao: "lembrete", resposta: TEXTO_CURTO_DA_OFERTA };

  const estado = await estadoDoAssessor(e.franchiseeId, agora);
  const { prisma } = await import("@/lib/prisma");
  const loja = await prisma.user.findUnique({ where: { id: e.franchiseeId }, select: { storeName: true } }).catch(() => null);
  ofertas.set(chave, agora.getTime());
  return { acao: "oferta", resposta: textoDaOferta({ nomeDaLoja: loja?.storeName?.trim() || "sua loja", preco: estado.preco, jaTestou: estado.jaTestou }) };
}
