/**
 * /src/lib/terminal-app.ts
 *
 * Autenticação do app que roda DENTRO da maquininha.
 *
 * A PagBank não expõe API de nuvem para acender cobrança à distância. O caminho
 * que existe — e que o dono já viu funcionando num sistema concorrente — é um
 * app Android instalado no próprio terminal Smart POS, usando a
 * PlugPagServiceWrapper para cobrar localmente.
 *
 * Isso inverte a direção em relação ao Mercado Pago Point:
 *
 *   Point   : FireHub  ->  nuvem do MP  ->  maquininha
 *   PagBank : FireHub  <-  app na maquininha pergunta "tem cobrança pra mim?"
 *
 * Como quem inicia a conversa é o aparelho, ele precisa de um crachá. O token
 * segue o mesmo desenho do totem (`totem-auth.ts`): procurado no banco, sem
 * assinatura. A licença do totem morreu em produção justamente por ser um JWT
 * assinado com um segredo de ambiente; não vamos repetir o erro num aparelho
 * que fica preso no balcão de um cliente e que ninguém vai querer reconfigurar.
 */
import { prisma } from "./prisma";

/** Tamanho mínimo do crachá. Evita consultar o banco com "" ou "123". */
const TAMANHO_MINIMO = 24;

export type TerminalAutenticado = {
  id: string;
  franchiseeId: string;
  label: string;
  provider: string;
};

export type ResultadoDaAutenticacao =
  | { ok: true; terminal: TerminalAutenticado }
  | { ok: false; status: number; erro: string; codigo: string };

/**
 * Confere o crachá do app e devolve a maquininha.
 *
 * Cada situação tem código próprio de propósito: o app precisa distinguir
 * "token errado, pare de tentar" de "maquininha desativada no painel, avise o
 * operador". Uma mensagem só faria o aparelho ficar em laço eterno.
 */
export async function autenticarTerminal(token: unknown): Promise<ResultadoDaAutenticacao> {
  if (typeof token !== "string" || token.trim().length < TAMANHO_MINIMO) {
    return { ok: false, status: 400, erro: "Token do terminal obrigatório", codigo: "TOKEN_AUSENTE" };
  }

  const terminal = await prisma.posTerminal.findUnique({
    where: { deviceToken: token.trim() },
    select: { id: true, franchiseeId: true, label: true, provider: true, active: true },
  });

  if (!terminal) {
    return {
      ok: false,
      status: 401,
      erro: "Esta maquininha não está cadastrada. Gere o código de pareamento no painel, em Maquininhas.",
      codigo: "TERMINAL_DESCONHECIDO",
    };
  }

  if (!terminal.active) {
    return {
      ok: false,
      status: 403,
      erro: "Esta maquininha está desativada no painel.",
      codigo: "TERMINAL_DESATIVADO",
    };
  }

  return {
    ok: true,
    terminal: {
      id: terminal.id,
      franchiseeId: terminal.franchiseeId,
      label: terminal.label,
      provider: terminal.provider,
    },
  };
}

/**
 * Estados da cobrança no terminal, gravados em `CustomerOrder.posStatus`.
 *
 * `AGUARDANDO_TERMINAL` é a fila: o pedido está esperando o app perguntar. Ele
 * vira `NO_TERMINAL` no instante em que um app pega a cobrança — é o que impede
 * duas maquininhas da mesma loja cobrarem o mesmo pedido, cada uma no cartão de
 * um cliente diferente.
 */
export const ESTADOS_DA_COBRANCA = {
  aguardando: "AGUARDANDO_TERMINAL",
  noTerminal: "NO_TERMINAL",
  pago: "PAGO",
  recusado: "RECUSADO",
  cancelado: "CANCELADO",
  expirado: "EXPIRADO",
} as const;

/**
 * Quanto tempo uma cobrança pode ficar presa no terminal antes de voltar para a
 * fila. Se o app travar ou o aparelho desligar no meio, o pedido não pode ficar
 * marcado como "em cobrança" para sempre — o operador precisa poder tentar de
 * novo. Cinco minutos é mais do que o suficiente para uma transação de cartão,
 * que costuma levar menos de quarenta segundos.
 */
export const MINUTOS_ATE_DESTRAVAR = 5;

/**
 * Quantas recusas o mesmo pedido pode acumular antes de sair da fila.
 *
 * A fila entrega sempre o pedido mais antigo. Quem fecha o pedido no totem e vai
 * embora sem passar o cartão deixa a cobrança na cabeça da fila: ela é recusada
 * por tempo, volta para o começo e prende todos os pedidos seguintes num laço.
 * Uma fila de almoço inteira ficaria parada por causa de uma pessoa que desistiu.
 *
 * Cinco é folgado para quem está tentando de verdade — dá para trocar de cartão
 * quatro vezes — e curto o bastante para não segurar a fila por muito tempo.
 * O pedido não é cancelado: sai da fila da maquininha e o operador ainda cobra
 * pelo painel se o cliente voltar.
 */
export const TENTATIVAS_ATE_SAIR_DA_FILA = 5;

/** O token novo de uma maquininha. Aleatório e longo: ele É a credencial. */
export function gerarTokenDeTerminal(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
