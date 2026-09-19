/**
 * O preço que o robô DISSE bate com o preço que existe?
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O FireHub tem uma rede para o pedido GRAVADO: `syncAiOrderToDatabase` casa
 * cada item contra o cardápio, ignora o preço que a IA mandou e recalcula tudo
 * a partir do banco. Item que não casa é descartado. Essa parte é sólida.
 *
 * Só que o pastel de R$ 21,90 que foi cotado a R$ 131,40 nunca passou por ali.
 * Ele foi COTAÇÃO — texto, dito na conversa, lido pelo cliente. E o texto que o
 * cliente lê não passava por conferência nenhuma: o único tratamento era
 * cosmético ("R$ 24,90" → "24,90 reais"). A revisão de 19/09/2026 mediu isso:
 * existe rede para o que é gravado, não existe rede nenhuma para o que é dito.
 *
 * Este arquivo é essa rede. Ele não bloqueia resposta — bloquear com regra
 * chutada quebraria atendimento bom. Ele MEDE, para que a primeira vez que um
 * preço inventado voltar apareça num log no mesmo dia, e não numa reclamação de
 * cliente três semanas depois.
 *
 * A régua nasce dos dados: depois de uma semana medindo, os limites se escrevem
 * sozinhos. Até lá, só `impossivel` alarma — e ele é conservador de propósito.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-precos-ditos.mjs).
 */

/** Um valor em reais que o robô escreveu na resposta. */
export type PrecoDito = {
  /** O valor em reais, já normalizado (12345 centavos → 123.45). */
  valor: number;
  /** O trecho exato como apareceu no texto, para o log. */
  trecho: string;
};

export type ConferenciaDePrecos = {
  /** Todo valor em reais que o robô disse. */
  ditos: number[];
  /** Ditos que existem tal e qual no cardápio (preço de item ou de opção). */
  conhecidos: number[];
  /**
   * Ditos que não existem no cardápio. NÃO é erro por si: soma de dois itens,
   * total com frete e troco caem aqui. Serve para medir, não para alarmar.
   */
  desconhecidos: number[];
  /**
   * Acima de qualquer pedido plausível da loja. Absurdo grosso.
   */
  impossiveis: number[];
  /**
   * Alto demais para UM item, baixo demais para ser absurdo — a faixa do pastel
   * de R$ 21,90 cotado a R$ 131,40. Não é prova de erro (o total de um pedido
   * grande mora aqui também), por isso não alarma: mede.
   */
  suspeitos: number[];
  /** Acima disto é absurdo: maior item do cardápio × 20. */
  teto: number;
  /** Acima disto é alto para um item só: maior item do cardápio × 3. */
  tetoDeItemUnico: number;
};

/**
 * Tira de um texto todo valor em reais que o robô escreveu.
 *
 * Pega "R$ 21,90", "R$21.90", "21,90 reais" e "R$ 1.234,56". Não pega número
 * solto ("2 pastéis", "30 minutos", "pedido 1234"): sem marca de dinheiro não
 * dá para saber se é preço, e contar prazo como preço encheria o log de ruído.
 */
export function extrairPrecosDoTexto(texto: unknown): PrecoDito[] {
  const t = String(texto ?? "");
  if (!t) return [];

  const achados: PrecoDito[] = [];
  const vistos = new Set<string>();

  // "R$ 1.234,56" | "R$21,90" | "R$ 21.90"   e   "21,90 reais"
  //
  // O grupo começa e termina em DÍGITO. Com `[\d.,]+` solto, "R$ 21,90," no meio
  // da frase capturava a vírgula do texto — e "21,90," não tem 2 dígitos depois
  // do último separador, então caía na regra de milhar e virava 2190. Um preço
  // de R$ 21,90 entrava no log como R$ 2.190,00.
  const padroes = [
    /R\$\s*(\d[\d.,]*\d|\d)/gi,
    /(\d[\d.,]*\d|\d)\s*reais\b/gi,
  ];

  for (const re of padroes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const bruto = m[1];
      const valor = paraNumero(bruto);
      if (valor === null) continue;
      const chave = `${m.index}:${valor}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      achados.push({ valor, trecho: m[0].trim() });
    }
  }

  return achados.sort((a, b) => a.valor - b.valor);
}

/**
 * "1.234,56" → 1234.56 · "21,90" → 21.9 · "21.90" → 21.9 · "1,234.56" → 1234.56
 *
 * O ponto é ambíguo em português: em "21.90" separa centavos, em "1.234" separa
 * milhar. A regra que resolve: o ÚLTIMO separador com exatamente 2 dígitos
 * depois dele é o decimal; qualquer outro é milhar.
 */
function paraNumero(bruto: string): number | null {
  // Separador solto na ponta é pontuação do texto, não do número: some antes de
  // qualquer conta. (Cinto e suspensório: o regex já exige dígito nas pontas.)
  const s = String(bruto || "").trim().replace(/\s/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if (!s || !/\d/.test(s)) return null;

  const ultimaVirgula = s.lastIndexOf(",");
  const ultimoPonto = s.lastIndexOf(".");
  const corte = Math.max(ultimaVirgula, ultimoPonto);

  let limpo: string;
  if (corte === -1) {
    limpo = s.replace(/\D/g, "");
  } else if (s.length - corte - 1 === 2) {
    // exatamente 2 dígitos depois: é o decimal
    limpo = s.slice(0, corte).replace(/\D/g, "") + "." + s.slice(corte + 1).replace(/\D/g, "");
  } else {
    // 1 ou 3+ dígitos depois: separador de milhar, não há decimal
    limpo = s.replace(/\D/g, "");
  }

  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Confere os preços ditos contra os preços que existem no cardápio.
 *
 * `precosDoCardapio` é todo valor cobrável da loja: preço de produto, preço de
 * opção de combo, taxa de entrega de cada zona. Quem chama monta essa lista a
 * partir dos mesmos dados que foram para o prompt.
 *
 * ── A RÉGUA, e o que ela honestamente pega ─────────────────────────────────
 *
 * A primeira versão disto tinha um piso fixo de R$ 500 no teto. A revisão
 * adversarial de 19/09/2026 derrubou: com piso de 500, o pastel de R$ 131,40 —
 * o caso que deu origem a tudo — NUNCA seria marcado, em loja nenhuma. O teste
 * só passava porque forçava um teto artificial que produção jamais usaria.
 * Alarme que não pode disparar é pior que alarme nenhum: dá sensação de rede.
 *
 * Agora a régua sai do próprio cardápio, sem piso inventado:
 *
 *   > maior × 20  → `impossivel`. Absurdo grosso, alarma no log.
 *   > maior × 3   → `suspeito`. Alto demais para um item, plausível para um
 *                   pedido grande. O pastel mora aqui (24,90 × 3 = 74,70 < 131,40).
 *                   NÃO alarma: o total de um pedido de 8 pastéis também cai
 *                   aqui, e gritar por venda boa vira ruído que ninguém lê.
 *   resto         → `desconhecido`, pura medida.
 *
 * O que pega o pastel com CERTEZA não é este arquivo sozinho: é
 * `compararTotalDitoComGravado`, quando o pedido é fechado e o total anunciado
 * encontra o total recalculado do banco. Este aqui é a rede da COTAÇÃO, onde
 * não existe número certo para comparar — e por isso mede em vez de afirmar.
 */
export function conferirPrecosDitos(e: {
  texto: unknown;
  precosDoCardapio: number[];
  /** Sobrescreve o teto calculado. Só para teste. */
  tetoManual?: number;
}): ConferenciaDePrecos {
  const ditos = extrairPrecosDoTexto(e.texto).map((p) => p.valor);

  const cardapio = (e.precosDoCardapio || [])
    .map((n) => Math.round(Number(n) * 100) / 100)
    .filter((n) => Number.isFinite(n) && n > 0);

  const maiorDoCardapio = cardapio.length ? Math.max(...cardapio) : 0;
  // Sem cardápio não há régua: nada é impossível, porque não há com o que
  // comparar. Infinity é honesto; um número inventado aqui viraria alarme falso.
  // Arredondado a centavos: 24,9 × 3 dá 74.69999999999999 em ponto flutuante, e
  // limiar com sujeira decimal decide errado exatamente em cima da borda.
  const centavos = (n: number) => Math.round(n * 100) / 100;
  const teto = e.tetoManual ?? (maiorDoCardapio > 0 ? centavos(maiorDoCardapio * 20) : Infinity);
  const tetoDeItemUnico = maiorDoCardapio > 0 ? centavos(maiorDoCardapio * 3) : Infinity;

  const noCardapio = new Set(cardapio.map((n) => n.toFixed(2)));

  const conhecidos: number[] = [];
  const desconhecidos: number[] = [];
  const suspeitos: number[] = [];
  const impossiveis: number[] = [];

  for (const v of ditos) {
    if (noCardapio.has(v.toFixed(2))) {
      conhecidos.push(v);
    } else if (v > teto) {
      impossiveis.push(v);
    } else if (v > tetoDeItemUnico) {
      suspeitos.push(v);
    } else {
      desconhecidos.push(v);
    }
  }

  return { ditos, conhecidos, desconhecidos, suspeitos, impossiveis, teto, tetoDeItemUnico };
}

// ── O total que a IA anunciou x o que o sistema gravou ─────────────────────

/**
 * União discriminada de propósito: quando `houve` é false, `gravidade` só pode
 * ser "nenhuma", e o TypeScript sabe disso dentro de um `if (d.houve)`. Com um
 * tipo solto, quem registra a divergência precisaria de um cast — e cast é onde
 * "nenhuma" acabaria gravado no banco como se fosse um caso real.
 */
export type DivergenciaDeTotal =
  | {
      houve: false;
      /** gravado − dito. Positivo = o cliente ouviu MENOS do que vai pagar. */
      diferenca: number;
      gravidade: "nenhuma";
      resumo: string;
    }
  | {
      houve: true;
      diferenca: number;
      gravidade: "centavos" | "real" | "grave";
      resumo: string;
    };

/**
 * Compara o `totalAmount` que o modelo mandou na tag com o total que o sistema
 * recalculou a partir do banco.
 *
 * Os dois números já estavam na mão do código (chatbot-ai.ts, no sync) e um era
 * descartado sem nunca ser comparado. O dito não manda em nada — quem grava é o
 * recalculado, e isso está certo. Mas quando os dois discordam, o cliente ouviu
 * um número e vai pagar outro, e ninguém ficava sabendo.
 *
 * "o cliente ouviu MENOS do que vai pagar" é o caso grave: é reclamação na
 * entrega. O contrário (ouviu mais, paga menos) é prejuízo da loja e também
 * conta.
 */
export function compararTotalDitoComGravado(e: {
  ditoPelaIa: unknown;
  gravadoPeloSistema: unknown;
}): DivergenciaDeTotal {
  const dito = Number(e.ditoPelaIa);
  const gravado = Number(e.gravadoPeloSistema);

  // Sem número dito não há o que comparar: a tag nem sempre traz totalAmount, e
  // ausência não é divergência.
  if (!Number.isFinite(dito) || dito <= 0 || !Number.isFinite(gravado)) {
    return { houve: false, diferenca: 0, gravidade: "nenhuma", resumo: "sem total dito para comparar" };
  }

  const diferenca = Math.round((gravado - dito) * 100) / 100;
  const absoluta = Math.abs(diferenca);
  const proporcao = gravado > 0 ? absoluta / gravado : 0;

  // Um centavo é arredondamento de ponto flutuante, não divergência.
  if (absoluta <= 0.01) {
    return { houve: false, diferenca, gravidade: "nenhuma", resumo: "total dito bate com o gravado" };
  }

  const gravidade: "centavos" | "real" | "grave" =
    absoluta <= 1 ? "centavos" : absoluta > 20 || proporcao > 0.25 ? "grave" : "real";

  const lado = diferenca > 0 ? "o cliente ouviu MENOS do que vai pagar" : "o cliente ouviu MAIS do que vai pagar";

  return {
    houve: true,
    diferenca,
    gravidade,
    resumo: `IA disse R$ ${dito.toFixed(2)}, sistema gravou R$ ${gravado.toFixed(2)} (${lado}, diferença R$ ${absoluta.toFixed(2)})`,
  };
}
