/**
 * /src/lib/motivo-do-cancelamento.ts
 *
 * O MOTIVO É OBRIGATÓRIO QUANDO A LOJA CANCELA — pedido inteiro ou item.
 *
 * Pizzaria 17 (Antonio, 09/10/2026): "quando cancelar qualquer coisa, preciso
 * que um campo obrigatório seja preenchido explicando o motivo". E, por áudio:
 * "se a menina do caixa tiver que cancelar algum item de alguma mesa, ou
 * alguma bebida, no momento do cancelamento ela já coloca o motivo, para que,
 * quando for fechar o caixa, estejam todas as observações que eu preciso ver
 * na conferência do fechamento". O fechamento dele mostrava "cancelado pela
 * loja: Cancelado pelo painel ao editar o pedido", "Cancelado na mesa pelo
 * painel" ou só "cancelado pela loja" — nada que o dono pudesse conferir.
 *
 * REGRA ÚNICA, PARA TODAS AS LOJAS: cancelamento à mão sem explicação é o furo
 * de caixa que ninguém consegue auditar depois, e não há loja que perca com o
 * campo. Opção desligável seria a loja que mais precisa dele desligando.
 *
 * Vale para o que a PESSOA faz na loja (painel, balcão, mesa no tablet e no
 * celular, garçom pelo link). NÃO vale para o que chega pronto de fora: o
 * iFood/99Food cancelando, o cliente cancelando no site, o Pix que venceu, o
 * robô, o totem abandonado — esses seguem gravando o motivo do sistema.
 *
 * Mora aqui (sem Prisma) porque a tela usa a mesma régua do servidor: o botão
 * só acende quando o servidor vai aceitar.
 */

/** Menos que isto não explica nada ("x", "ok"). */
export const MINIMO_DO_MOTIVO = 3;
/** Teto para o JSONB e para o papel do caixa. */
export const MAXIMO_DO_MOTIVO = 300;

/** Atalhos da tela. Opcionais: clicar preenche o campo, a pessoa pode completar. */
export const SUGESTOES_DE_MOTIVO = [
  "Cliente desistiu",
  "Erro de lançamento",
  "Falta de produto",
  "Pedido duplicado",
] as const;

/** O texto do 400, igual em todas as rotas. */
export const MENSAGEM_SEM_MOTIVO = `Escreva o motivo do cancelamento (pelo menos ${MINIMO_DO_MOTIVO} letras). Ele aparece no fechamento do caixa.`;

/**
 * A recusa do SERVIDOR leva também o que fazer quando não há onde escrever.
 *
 * O painel aberto antes do deploy de 09/10/2026 (20h05) cancelava ao arrastar
 * sem perguntar o motivo; o servidor novo recusa, e a tela velha mostrava só
 * "Escreva o motivo…" — sem campo nenhum para escrever (Lapastine, 20h28: "a
 * gente está tentando cancelar e não cancela"). A tela antiga mostra o `error`
 * da resposta como veio, então a saída tem de estar nele: atualizar o painel.
 */
export const MENSAGEM_SEM_MOTIVO_DO_SERVIDOR = `${MENSAGEM_SEM_MOTIVO} Se não apareceu onde escrever, aperte F5 para atualizar o painel e cancele de novo.`;

/** O motivo limpo (espaços juntados, cortado no teto), ou "" quando não serve. */
export function limparMotivo(texto: unknown): string {
  if (typeof texto !== "string") return "";
  const limpo = texto.replace(/\s+/g, " ").trim().slice(0, MAXIMO_DO_MOTIVO);
  // Só pontuação/números não explica nada: "...", "---", "123".
  const letras = (limpo.match(/\p{L}/gu) || []).length;
  return letras >= MINIMO_DO_MOTIVO ? limpo : "";
}

/** O motivo serve? */
export function motivoValido(texto: unknown): boolean {
  return limparMotivo(texto) !== "";
}

/**
 * Lê o motivo do corpo da requisição. Aceita os nomes que as rotas já usam
 * (`cancelReason` no quadro de pedidos, `motivo` nas novas).
 */
export function motivoDoCorpo(body: unknown): string {
  const b = (body || {}) as { motivo?: unknown; cancelReason?: unknown; motivoDoCancelamento?: unknown };
  return limparMotivo(b.motivo ?? b.motivoDoCancelamento ?? b.cancelReason);
}

/**
 * Um item que a loja tirou de um pedido (ou de uma mesa), gravado no rastro
 * do pedido (`RegistroDeEdicao.itensRetirados`). É o que o fechamento do caixa
 * lista em "Itens cancelados": quem, quando, o item, o valor e o motivo.
 * `valor` é o da linha (unitário × quantidade retirada), em reais.
 */
export type ItemRetirado = { nome: string; quantidade: number; valor: number };
