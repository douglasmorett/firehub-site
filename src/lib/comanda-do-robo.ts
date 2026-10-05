/**
 * src/lib/comanda-do-robo.ts — a mensagem que o cliente recebe quando o robô
 * fecha o pedido, e o parágrafo do cashback que o prompt leva.
 *
 * ── Por que a confirmação saiu da boca do modelo ────────────────────────────
 *
 * Até 05/10/2026 o fechamento era o texto que a IA escreveu ("Perfeito! Pedido
 * confirmado 🚀") mais a linha "🧾 Pedido nº X registrado na cozinha!". O resumo
 * de itens, taxa e total, quando vinha, era o que o MODELO lembrava — não o que
 * foi gravado. Os lojistas pediram a comanda do Anota AI: número, cada item,
 * pagamento, entrega com a taxa, endereço, previsão, cashback e total.
 *
 * Agora a mensagem é montada com os valores GRAVADOS no pedido, do mesmo jeito
 * que a comanda impressa: o que o cliente lê é o que a loja vai cobrar. É a
 * mesma regra do "contrato honesto" em lib/chatbot-ai.ts — confirmação só com
 * o pedido no banco, e agora com o pedido inteiro, não só o número.
 *
 * SEM BANCO de propósito: quem consulta é chatbot-ai.ts, e o teste
 * (scripts/teste-comanda-do-robo.ts) carrega este arquivo sozinho.
 */

export type ItemDaComanda = {
  quantity: number;
  /** Nome do cadastro (as escolhas vêm em `comboSelections`). */
  productName: string;
  /** Preço UNITÁRIO gravado, já com as escolhas. */
  price: number;
  /** `{ grupoId: { nomeDaOpcao: quantidade } }`, o formato do cardápio online. */
  comboSelections?: Record<string, Record<string, number>> | null;
  notes?: string | null;
};

export type DadosDaComanda = {
  numero: string | number | null;
  /** ACEITO entra direto na cozinha; NOVO espera a loja aceitar. */
  status: string;
  /** Pedido que já tinha sido enviado e foi alterado agora. */
  alterado?: boolean;
  itens: ItemDaComanda[];
  formaDePagamento: string | null;
  /** Em dinheiro: a NOTA com que o cliente vai pagar. */
  trocoPara?: number | null;
  entrega: boolean;
  taxaDeEntrega: number;
  /** Frete grátis por regra da loja ("acima de R$ 60"): o valor que a taxa teria. */
  freteGratisAcimaDe?: number | null;
  endereco?: string | null;
  /** Hora em que o pedido deve chegar (criação + tempo da área). */
  previsao?: Date | null;
  fuso?: string | null;
  cupom?: { code: string; desconto: number; freteGratis: boolean } | null;
  /** Motivo de um cupom que o cliente pediu e o sistema recusou. */
  cupomRecusado?: string | null;
  cashbackUsado?: number;
  /** O que este pedido gera, liberado quando for entregue. */
  cashbackGerado?: number;
  total: number;
};

const reais = (n: number) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

/** As escolhas do item numa linha: "Grande, Bacon x2". */
function escolhasDoItem(item: ItemDaComanda): string {
  const sel = item.comboSelections;
  if (!sel || typeof sel !== "object") return "";
  const partes: string[] = [];
  for (const grupo of Object.values(sel)) {
    if (!grupo || typeof grupo !== "object") continue;
    for (const [nome, qtd] of Object.entries(grupo)) {
      const q = Number(qtd) || 0;
      if (q <= 0) continue;
      partes.push(q > 1 ? `${nome} x${q}` : nome);
    }
  }
  return partes.join(", ");
}

function horaNoFuso(d: Date, fuso: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: fuso || "America/Sao_Paulo",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(d);
  }
}

/** Título: o cliente precisa saber se o pedido já está sendo feito ou espera a loja. */
function titulo(d: DadosDaComanda): string {
  const status = String(d.status || "").toUpperCase();
  if (d.alterado) return "✏️ Pronto! Seu pedido foi *ATUALIZADO*.";
  if (status === "ACEITO" || status === "PREPARANDO" || status === "EM_PREPARO") {
    return "Oba! Seu pedido está *EM PRODUÇÃO*! 🥳";
  }
  return "✅ Recebemos seu pedido! Assim que a loja aceitar, ele entra em produção.";
}

/**
 * A mensagem inteira, pronta para o WhatsApp (negrito com `*`). Linha que não
 * tem valor não aparece: sem taxa não há "Taxa de entrega: R$ 0,00", sem
 * cashback não há linha de cashback.
 */
export function comandaDoRobo(d: DadosDaComanda): string {
  const linhas: string[] = [titulo(d), ""];

  if (d.numero != null && d.numero !== "") linhas.push(`🧾 *Pedido nº ${d.numero}*`, "");

  linhas.push("*Itens:*");
  let subtotal = 0;
  for (const item of d.itens) {
    const qtd = Math.max(1, Number(item.quantity) || 1);
    const valor = (Number(item.price) || 0) * qtd;
    subtotal += valor;
    linhas.push(`➡️ ${qtd}x ${item.productName}${valor > 0 ? ` — ${reais(valor)}` : ""}`);
    const escolhas = escolhasDoItem(item);
    if (escolhas) linhas.push(`      ↳ ${escolhas}`);
    const obs = String(item.notes || "").trim();
    if (obs) linhas.push(`      ↳ Obs: ${obs}`);
  }
  linhas.push("");

  const pagamento = String(d.formaDePagamento || "").trim();
  if (pagamento) {
    const troco = d.trocoPara && d.trocoPara > d.total ? ` (troco para ${reais(d.trocoPara)})` : "";
    linhas.push(`💳 *Pagamento:* ${pagamento}${troco}`);
  }

  if (d.entrega) {
    const freteDoCupom = d.cupom?.freteGratis === true;
    const taxa =
      d.taxaDeEntrega > 0
        ? `taxa de entrega: ${reais(d.taxaDeEntrega)}`
        : freteDoCupom
        ? `entrega grátis pelo cupom ${d.cupom!.code} 🎉`
        : d.freteGratisAcimaDe != null
        ? `entrega grátis (pedido acima de ${reais(d.freteGratisAcimaDe)}) 🎉`
        : "entrega grátis 🎉";
    linhas.push(`🛵 *Delivery* (${taxa})`);
    const endereco = String(d.endereco || "").trim();
    if (endereco) linhas.push(`🏠 ${endereco}`);
    if (d.previsao && Number.isFinite(d.previsao.getTime())) {
      linhas.push(`⏰ Previsão de entrega: até ${horaNoFuso(d.previsao, d.fuso)}`);
    }
  } else {
    linhas.push("🏪 *Retirada na loja*");
  }
  linhas.push("");

  // Os valores, na ordem em que a conta é feita.
  const descontoDoCupom = d.cupom && !d.cupom.freteGratis ? d.cupom.desconto : 0;
  const usado = Number(d.cashbackUsado) || 0;
  const temAbatimento = descontoDoCupom > 0 || usado > 0 || (d.entrega && d.taxaDeEntrega > 0);
  if (temAbatimento) linhas.push(`Subtotal: ${reais(subtotal)}`);
  if (d.entrega && d.taxaDeEntrega > 0) linhas.push(`Taxa de entrega: ${reais(d.taxaDeEntrega)}`);
  if (descontoDoCupom > 0) linhas.push(`🎟️ Cupom ${d.cupom!.code}: -${reais(descontoDoCupom)}`);
  if (usado > 0) linhas.push(`💰 Cashback (desconto): -${reais(usado)}`);
  linhas.push(`*Total: ${reais(d.total)}*`);

  const gerado = Number(d.cashbackGerado) || 0;
  if (gerado > 0) {
    linhas.push("", `🎁 Este pedido vai te dar ${reais(gerado)} de cashback, liberado quando ele for entregue.`);
  }
  if (d.cupomRecusado) linhas.push("", `ℹ️ ${d.cupomRecusado}`);

  linhas.push("", "Obrigado pela preferência! Se precisar de algo, é só chamar 😉");
  return linhas.join("\n");
}

/**
 * O parágrafo do prompt quando o cliente tem saldo NESTA loja. O modelo não
 * calcula o desconto — só pergunta e marca `usarCashback` na tag; quem decide
 * quanto abate é o servidor (lib/cashback.ts, resgateMaximo).
 */
export function cashbackDoClienteParaOPrompt(opcoes: {
  saldo: number;
  maxResgatePct: number;
  vence?: { valor: number; em: string } | null;
  fuso?: string | null;
}): string {
  const { saldo, maxResgatePct } = opcoes;
  if (!(saldo > 0)) return "";
  let vence = "";
  if (opcoes.vence) {
    try {
      const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: opcoes.fuso || "America/Sao_Paulo" })
        .format(new Date(opcoes.vence.em));
      vence = ` (${reais(opcoes.vence.valor)} vencem em ${dia})`;
    } catch { /* sem a data, segue sem ela */ }
  }
  const limite = maxResgatePct < 100 ? ` O saldo paga até ${maxResgatePct}% do valor dos itens (a taxa de entrega não entra).` : "";
  return [
    `💰 CASHBACK DESTE CLIENTE: ele tem ${reais(saldo)} de saldo de cashback nesta loja${vence}.${limite}`,
    `    - Quando for mandar o resumo para ele confirmar, PERGUNTE junto, uma vez só: "Você tem ${reais(saldo)} de cashback aqui. Quer usar neste pedido?"`,
    `    - Se ele quiser usar, coloque "usarCashback": true na tag [[PEDIDO_IA]] (no rascunho E na finalização). Se não quiser, "usarCashback": false.`,
    `    - Você NÃO calcula o desconto do cashback e não tira nada do total que você escreve: o sistema calcula e acrescenta, logo abaixo da sua mensagem, a linha com o cashback e o total exato.`,
    `    - Não insista se ele recusar, e nunca ofereça cashback a outro cliente.`,
  ].join("\n");
}
