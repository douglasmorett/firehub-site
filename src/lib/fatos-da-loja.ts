/**
 * Os FATOS da loja que o robô do WhatsApp diz ao cliente — pedido mínimo, prazo
 * de entrega e horário — tirados do CADASTRO da loja, nunca de um número fixo.
 *
 * Por que existe: o prompt do robô nasceu na Hakim e carregava os números dela
 * como se fossem de todo mundo. Loja sem mínimo cadastrado ganhava "mínimo de
 * R$ 26,00"; toda loja prometia "45 a 60 minutos"; loja sem horário cadastrado
 * "abria todos os dias das 18:00 às 23:30"; e o exemplo do pedido mínimo
 * oferecia "mais uma esfirra" ao cliente de uma hamburgueria — com um pedaço de
 * código cru (`${(minimumOrderValue - 19)...}`) escrito dentro da frase, porque
 * a interpolação estava escapada.
 *
 * A regra aqui é a mesma do resto do robô: o que a loja não cadastrou, ele NÃO
 * afirma. Diz que confirma com a equipe.
 *
 * SEM IMPORTS de propósito: `scripts/teste-fatos-da-loja.mjs` transpila este
 * arquivo sozinho e o carrega por data: URL.
 */

const brl = (n: number): string => n.toFixed(2).replace(".", ",");

const numero = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    // "26,90" é o que um humano digita no painel; parseFloat leria 26.
    const n = parseFloat(v.trim().replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/**
 * Pedido mínimo da ENTREGA. Zero = a loja não tem mínimo — igual ao cardápio
 * do site, que usa `Number(minimumOrderValue || 0)`. Era `|| 26.00`.
 */
export function minimoDeEntrega(deliveryConfig: unknown): number {
  const n = numero((deliveryConfig as any)?.minimumOrderValue);
  return n > 0 ? n : 0;
}

/**
 * Pedido mínimo da RETIRADA. Ausente = herda o da entrega (é como o cardápio
 * trata); zero explícito = retirada sem mínimo.
 */
export function minimoDeRetirada(deliveryConfig: unknown): number {
  const bruto = (deliveryConfig as any)?.minimumOrderValuePickup;
  if (bruto === undefined || bruto === null || bruto === "") return minimoDeEntrega(deliveryConfig);
  const n = numero(bruto);
  return n > 0 ? n : 0;
}

/** As duas linhas de "DADOS DA LOJA" sobre pedido mínimo. */
export function linhasDoMinimoNosDados(o: { minimoEntrega: number; minimoRetirada: number; aceitaRetirada: boolean }): string {
  const entrega = o.minimoEntrega > 0
    ? `- ⚠️ PEDIDO MÍNIMO PARA ENTREGA: R$ ${brl(o.minimoEntrega)} (subtotal dos itens, SEM a taxa de entrega)`
    : `- PEDIDO MÍNIMO PARA ENTREGA: NÃO HÁ — qualquer valor fecha. NUNCA diga ao cliente que existe um valor mínimo.`;
  if (!o.aceitaRetirada) return entrega;
  const retirada = o.minimoRetirada > 0
    ? `- ⚠️ PEDIDO MÍNIMO PARA RETIRADA NO BALCÃO: R$ ${brl(o.minimoRetirada)}`
    : `- PEDIDO MÍNIMO PARA RETIRADA NO BALCÃO: não há — qualquer valor fecha`;
  return `${entrega}\n${retirada}`;
}

/**
 * A conferência "A" da regra 21.9 do prompt (pedido mínimo antes de fechar).
 *
 * O exemplo de tom usa números derivados do mínimo REAL da loja — assim o
 * modelo nunca vê dois mínimos diferentes no mesmo prompt — e fala em "mais
 * alguma coisa", não no produto de uma loja específica.
 */
export function regraDoPedidoMinimo(o: { minimoEntrega: number; minimoRetirada: number; aceitaRetirada: boolean }): string {
  if (!(o.minimoEntrega > 0)) {
    const retirada = o.aceitaRetirada && o.minimoRetirada > 0
      ? `\n       Só a RETIRADA NO BALCÃO tem mínimo nesta loja: R$ ${brl(o.minimoRetirada)} de subtotal dos itens.`
      : "";
    return `    A) PEDIDO MÍNIMO — esta loja NÃO tem pedido mínimo para entrega: qualquer valor fecha.
       NUNCA diga ao cliente que existe um valor mínimo, nem segure o pedido por causa disso.${retirada}`;
  }

  const min = o.minimoEntrega;
  // Subtotal de exemplo: uns 70% do mínimo, em centavos inteiros.
  const exemplo = Math.round(min * 70) / 100;
  const falta = Math.round((min - exemplo) * 100) / 100;

  let saidaPelaRetirada: string;
  if (!o.aceitaRetirada) {
    saidaPelaRetirada = `       - Esta loja NÃO aceita retirada no balcão: não ofereça retirada como saída. O pedido só
         fecha completando o mínimo.`;
  } else if (o.minimoRetirada === min) {
    saidaPelaRetirada = `       - A retirada no balcão tem o MESMO mínimo (R$ ${brl(o.minimoRetirada)}): não a ofereça como saída
         para fugir do mínimo — ela não resolve.`;
  } else if (o.minimoRetirada > min) {
    saidaPelaRetirada = `       - A retirada no balcão tem mínimo MAIOR (R$ ${brl(o.minimoRetirada)}): não a ofereça como saída
         para fugir do mínimo da entrega — ela não resolve.`;
  } else {
    saidaPelaRetirada = `       - Se o cliente NÃO quiser completar, ofereça a RETIRADA NO BALCÃO — ${
      o.minimoRetirada > 0
        ? `na retirada o mínimo é R$ ${brl(o.minimoRetirada)}`
        : "retirada não tem pedido mínimo"
    }.`;
  }

  return `    A) PEDIDO MÍNIMO — R$ ${brl(min)} de SUBTOTAL (itens, sem a taxa):
       - Some os itens. Se o subtotal for MENOR que o mínimo, NÃO FECHE. Não adianta a taxa
         de entrega somar e passar do mínimo: o que conta é o subtotal dos itens.
       - Diga com simpatia quanto falta e ofereça complementar. Exemplo do tom:
         "Ficou ${brl(exemplo)} reais em itens, e o mínimo pra entrega aqui é ${brl(min)} reais 😊
          Faltam ${brl(falta)} reais — quer incluir mais alguma coisa pra fechar?"
         (troque os valores pelos reais do pedido e sugira um item DO CARDÁPIO DESTA LOJA).
${saidaPelaRetirada}
       - Já aconteceu de o robô montar um pedido abaixo do mínimo e ir pedir confirmação para
         mandar para a cozinha. É isto que esta regra impede.`;
}

/** O lembrete de mínimo na resposta sobre a promoção de amanhã (regra 23). */
export function lembreteDoMinimo(minimoEntrega: number): string {
  return minimoEntrega > 0
    ? `, e lembre o pedido mínimo de ${brl(minimoEntrega)} reais para entrega`
    : "";
}

// ── PRAZO DE ENTREGA ─────────────────────────────────────────────────────────

const tempoValido = (z: unknown): number | null => {
  const t = numero((z as any)?.time);
  // Acima de 6 h não é prazo de entrega, é erro de digitação.
  return t > 0 && t <= 360 ? Math.round(t) : null;
};

/** " · ~40 min" para pôr ao lado da taxa de uma zona; "" se a zona não tem tempo. */
export function tempoDaZona(zona: unknown): string {
  const t = tempoValido(zona);
  return t ? ` · ~${t} min` : "";
}

export type PrazoParaORobo = {
  /** A loja cadastrou tempo em alguma zona? */
  temDado: boolean;
  menorMin: number | null;
  maiorMin: number | null;
  /** "de 30 a 50 minutos" | "cerca de 40 minutos" | "" */
  faixa: string;
  /** Valor da linha "Tempo Médio de Entrega da Loja" em DADOS DA LOJA. */
  linhaDosDados: string;
  /** Texto da regra 9 (cliente pergunta o tempo de entrega). */
  regra: string;
};

/**
 * O que o robô pode dizer sobre tempo de entrega. Vem do `time` das zonas de
 * entrega — o mesmo número que o cardápio do site mostra ao cliente. Sem zona
 * com tempo, o robô NÃO promete minutos: era "45 a 60 minutos" para todo mundo.
 */
export function prazoParaORobo(deliveryZones: unknown): PrazoParaORobo {
  const zonas = Array.isArray(deliveryZones) ? deliveryZones : [];
  const tempos = zonas.map(tempoValido).filter((t): t is number => t !== null);

  if (tempos.length === 0) {
    return {
      temDado: false,
      menorMin: null,
      maiorMin: null,
      faixa: "",
      linhaDosDados:
        "NÃO CADASTRADO — não prometa minutos. (Se as INSTRUÇÕES EXTRAS DA LOJA, mais abaixo, informarem um tempo, vale o de lá.)",
      regra:
        `   - A loja NÃO cadastrou tempo de entrega. NÃO invente minutos. Se as "INSTRUÇÕES EXTRAS DA LOJA" informarem um tempo, use o de lá; senão diga que o tempo depende da região e do movimento e que a equipe confirma na hora do pedido.`,
    };
  }

  const menor = Math.min(...tempos);
  const maior = Math.max(...tempos);
  const faixa = menor === maior ? `cerca de ${maior} minutos` : `de ${menor} a ${maior} minutos`;
  return {
    temDado: true,
    menorMin: menor,
    maiorMin: maior,
    faixa,
    linhaDosDados:
      menor === maior
        ? `${faixa}`
        : `${faixa}, conforme a região (o tempo de cada região está na lista de taxas abaixo)`,
    regra:
      `   - Diga o tempo CADASTRADO pela loja: ${faixa}${menor === maior ? "" : ", conforme a região"}. Se o endereço do cliente já foi validado e a validação trouxe o tempo daquela região, diga o tempo DELA. NUNCA cite um tempo que não esteja nos dados da loja.`,
  };
}

// ── HORÁRIO ──────────────────────────────────────────────────────────────────

/** Quadro de horários de quem não cadastrou horário. Era "18:00 às 23:30". */
export const HORARIO_NAO_CADASTRADO =
  "NÃO CADASTRADO. Não afirme horário de abertura nem de fechamento: se perguntarem, diga que vai confirmar com a equipe.";

/** Valor da linha "Horário de Funcionamento Cadastrado" em DADOS DA LOJA. */
export function linhaDoHorarioDeHoje(o: { fraseDeHoje: string; temQuadro: boolean }): string {
  if (o.fraseDeHoje) return o.fraseDeHoje;
  return o.temQuadro ? "veja o Quadro Geral de Horários abaixo" : HORARIO_NAO_CADASTRADO;
}
