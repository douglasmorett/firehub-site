/**
 * QUAL MODELO RESPONDE ESTA MENSAGEM DO CLIENTE — o barato ou o caro.
 *
 * O robô gastava ~R$ 1.650/mês só no Gemini 3.6 Flash (out/2026), e o preço
 * dele dobra em 01/01/2027. O 3.1 Flash-Lite custa ~4x menos por resposta.
 *
 * ── Por que não o Lite em tudo ──────────────────────────────────────────────
 *
 * A/B de 03/10/2026 com o prompt REAL de 69 conversas de 12 lojas
 * (worktree firehub-robo-lite, pasta ab/): no "oi", cardápio, horário,
 * endereço da loja, cadê meu pedido, cupom e chamar atendente o Lite foi tão
 * bem quanto o 3.6. Na hora de FECHAR pedido, não:
 *  - esqueceu a marca [[PEDIDO_IA]] em 5 de 15 (10 de 15 com o lembrete) —
 *    sem ela o pedido não entra no painel;
 *  - chutou taxa de entrega (R$ 5,99 da tabela por km, sem saber a distância);
 *  - deu o total sem a taxa antes do "confirma?";
 *  - abriu rascunho novo para quem já tinha pedido na cozinha;
 *  - ofereceu borda em vez de pedir o endereço.
 * Todos esses 10 erros caíram nos sinais abaixo. Com a divisão, o custo por
 * resposta caiu 40% no A/B, sem nenhum erro do Lite sobrar.
 *
 * Arquivo puro, sem imports: o teste o carrega sozinho
 * (scripts/teste-modelo-do-robo.mjs).
 */

export const MODELO_BARATO = "gemini-3.1-flash-lite";
export const MODELO_DE_PEDIDO = "gemini-3.6-flash";

export type EscolhaDoModelo = { modelo: string; motivo: string | null };

const semAcento = (t: unknown) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// "nº 31" sim, a palavra "no" não ("vai ser no pix", "tem no cardápio?").
const ENDERECO = /localizacao enviada|\b(rua|r\.|av\.?|avenida|travessa|estrada|rodovia|beco|alameda|bairro|numero|casa|apto|apartamento|bloco|lote|quadra|cep)\b|\bn[º°o]\.?\s*\d|\d{5}-?\d{3}/;
const PEDIDO = /\b(quero|queria|vou querer|vo querer|manda|me ve|me da|pedir|fazer (o |um )?pedido|encomendar|\d+\s*x|meio a meio|metade|sabor|sem (cebola|salada|tomate)|com (bacon|cheddar|catupiry)|troco|pix|cartao|dinheiro|debito|credito|retir|buscar|entrega(r)?|confirm|pode (mandar|fechar|ser)|fech(a|ado)|isso mesmo|ta certo|correto)\b/;
const ROBO_PERGUNTOU = /endereco|forma de pagamento|pagamento|confirma|resumo|total|taxa|anot|r\$|reais|tamanho|sabor|qual (vai|voce)|retirada|entrega|troco/;

/**
 * O modelo da resposta. Na dúvida, o de pedido: errar para o caro custa
 * centavos; errar para o barato pode perder um pedido.
 */
export function escolherModeloDoRobo(entrada: {
  /** Há rascunho ou pedido ainda alterável deste cliente (memória do pedido no prompt). */
  temPedidoEmAndamento: boolean;
  mensagem: string;
  historico: { sender: string; text: string }[];
  temAudio?: boolean;
  /** A loja não anota pedido pelo robô: não há pedido para fechar. */
  anotaPedido?: boolean;
}): EscolhaDoModelo {
  const caro = (motivo: string): EscolhaDoModelo => ({ modelo: MODELO_DE_PEDIDO, motivo });
  if (entrada.anotaPedido === false) return { modelo: MODELO_BARATO, motivo: null };
  // Áudio: o que o cliente disse só se sabe ouvindo — pode ser o pedido inteiro.
  if (entrada.temAudio) return caro("áudio");
  if (entrada.temPedidoEmAndamento) return caro("pedido em andamento");
  const m = semAcento(entrada.mensagem);
  // Sem nenhuma palavra ("50", "??", "🤝"): só o contexto diz se é troco, cobrança ou confirmação.
  if (!/[a-z]{2,}/.test(m)) return caro("sem palavras");
  if (ENDERECO.test(m)) return caro("endereço");
  if (PEDIDO.test(m)) return caro("pedido");
  if (/^\s*\d+\s+\S/.test(m)) return caro("quantidade");
  const historico = Array.isArray(entrada.historico) ? entrada.historico : [];
  const ultimoDoRobo = [...historico].reverse().find((h) => h && h.sender !== "user");
  if (ultimoDoRobo && ROBO_PERGUNTOU.test(semAcento(ultimoDoRobo.text))) return caro("robô perguntou");
  return { modelo: MODELO_BARATO, motivo: null };
}

/**
 * Lembrete no FIM do prompt, só para o modelo barato: ele segue a instrução
 * curta e recente melhor que a regra do pedido no meio do texto (5 → 10 de 15 no A/B).
 */
export const LEMBRETE_DO_MODELO_BARATO = `

⚠️ MARCA DO PEDIDO — CONFIRA ANTES DE ENVIAR:
Se nesta conversa o cliente já escolheu algum item (mesmo sem endereço ou pagamento), sua resposta TEM QUE terminar com a marca do rascunho, com TODOS os itens escolhidos até agora:
[[PEDIDO_IA: {"status": "CRIANDO_IA", "items": [{"name": "...", "quantity": 1, "options": ["..."]}], "customerName": "...", "address": "...", "paymentMethod": "...", "deliveryFee": 0, "totalAmount": 0.00, "finalized": false}]]
Sem a marca o pedido NÃO entra no sistema da loja. Quando o cliente CONFIRMAR o resumo final, use a marca com "status": "NOVO" e "finalized": true (regra do pedido). Não ponha a marca se o cliente ainda não escolheu nada, se só está perguntando, ou se o pedido já foi enviado à cozinha.
Quando o cliente escolhe o item, o próximo passo é pedir o que falta (endereço/retirada e pagamento) — não ofereça outro produto no lugar disso.
Taxa de entrega: NUNCA diga um valor sem o endereço confirmado no mapa — peça a localização pelo 📎.`;
