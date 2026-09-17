/**
 * Cupons da loja — a regra num lugar só.
 *
 * ── O que um cupom pode ter ─────────────────────────────────────────────────
 *
 * O formato antigo (`code`, `type`, `discount`, `minOrderValue`, `active`)
 * continua valendo como está: nenhuma loja precisa mexer no que já cadastrou.
 * Em 17/09/2026 eram 5 cupons em 2 lojas, só com essas chaves. Entraram três
 * campos, todos opcionais, a pedido do dono:
 *
 *   validade        "YYYY-MM-DD" — o ÚLTIMO dia em que vale, no dia da loja.
 *   usosPorCliente  quantas vezes o MESMO telefone pode usar. 0/vazio = sem limite.
 *   primeiroPedido  vale só para quem nunca pediu pelo site desta loja — e o
 *                   site aplica sozinho e avisa, sem o cliente digitar código.
 *
 * `somentePrimeiroPedido` é o mesmo conceito vindo do cupom da campanha
 * "converter" (lib/campanha-converter.ts); aqui os dois são lidos como um só.
 *
 * ── Quem decide é o servidor ────────────────────────────────────────────────
 *
 * Três das regras dependem de coisas que o navegador não sabe (o dia da loja,
 * quantas vezes este telefone já usou, se já pediu por aqui). Por isso o site
 * NÃO calcula validade nem limite: ele pergunta a /api/validate-coupon, e o
 * checkout (api/customer-order) confere de novo na hora de gravar. As funções
 * aqui são puras — recebem os fatos e devolvem o veredito — para que os dois
 * lugares apliquem exatamente a mesma régua. Teste: scripts/teste-cupons.js.
 */

export type TipoDeCupom = "percent" | "fixed" | "free_shipping";

export type Cupom = {
  code: string;
  type: TipoDeCupom;
  discount: number;
  minOrderValue: number;
  active: boolean;
  /** Último dia válido, "YYYY-MM-DD" no dia da loja. Nulo = não vence. */
  validade: string | null;
  /** Quantas vezes o mesmo telefone pode usar. 0 = sem limite. */
  usosPorCliente: number;
  /** Só para quem nunca pediu pelo site desta loja; o site aplica sozinho. */
  primeiroPedido: boolean;
  /** Anunciável pelo robô do WhatsApp (já existia). */
  isPublic: boolean;
  /** "converter" quando vem da campanha da comanda. */
  origem: string | null;
  /** Texto pronto para o cliente, quando a origem dá um. */
  descricao: string | null;
};

/** Lê o que está gravado em `storeCoupons`, tolerando o formato antigo. */
export function lerCupom(bruto: unknown): Cupom | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const code = String(b.code ?? "").trim().toUpperCase();
  if (!code) return null;

  const type: TipoDeCupom =
    b.type === "fixed" || b.type === "free_shipping" || b.type === "percent" ? b.type : "percent";
  // `value` é o nome que o checkout antigo aceitava como reserva de `discount`.
  const discountBruto = typeof b.discount === "number" ? b.discount : Number(b.value);
  const discount = Number.isFinite(discountBruto) && discountBruto > 0 ? discountBruto : type === "free_shipping" ? 0 : 10;

  const validade = typeof b.validade === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.validade) ? b.validade : null;
  const usos = Math.floor(Number(b.usosPorCliente));

  return {
    code,
    type,
    discount,
    minOrderValue: Math.max(0, Number(b.minOrderValue) || 0),
    active: b.active !== false,
    validade,
    usosPorCliente: Number.isFinite(usos) && usos > 0 ? usos : 0,
    primeiroPedido: b.primeiroPedido === true || b.somentePrimeiroPedido === true,
    isPublic: b.isPublic === true,
    origem: typeof b.origem === "string" ? b.origem : null,
    descricao: typeof b.descricao === "string" ? b.descricao : null,
  };
}

export function lerCupons(lista: unknown): Cupom[] {
  if (!Array.isArray(lista)) return [];
  return lista.map(lerCupom).filter((c): c is Cupom => c !== null);
}

/** O cupom com este código, se existir e estiver ativo. */
export function acharCupom(lista: unknown, code: unknown): Cupom | null {
  const alvo = String(code ?? "").trim().toUpperCase();
  if (!alvo) return null;
  return lerCupons(lista).find((c) => c.code === alvo && c.active) ?? null;
}

/**
 * O cupom de primeiro pedido da loja, se houver um ativo.
 * Só o primeiro conta: dois ao mesmo tempo não fazem sentido, e a tela de
 * cupons não deixa cadastrar o segundo.
 */
export function cupomDePrimeiroPedido(lista: unknown): Cupom | null {
  return lerCupons(lista).find((c) => c.active && c.primeiroPedido) ?? null;
}

/** "YYYY-MM-DD" < "YYYY-MM-DD" funciona por comparação de texto. */
export function cupomVenceu(cupom: Cupom, hojeDaLoja: string): boolean {
  return !!cupom.validade && cupom.validade < hojeDaLoja;
}

/** "dd/mm" para a frase de vencimento. */
function diaCurto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** "10% de desconto", "R$ 15,00 de desconto", "frete grátis" — para o aviso. */
export function descreverBeneficio(cupom: Cupom): string {
  if (cupom.type === "free_shipping") return "frete grátis";
  if (cupom.type === "fixed") return `R$ ${cupom.discount.toFixed(2).replace(".", ",")} de desconto`;
  return `${cupom.discount}% de desconto`;
}

export type FatosDoCupom = {
  /** Soma dos itens da sacola, antes de taxa. */
  subtotal: number;
  /** Taxa de entrega em vigor (para o frete grátis saber quanto zera). */
  taxa: number;
  /** "YYYY-MM-DD" no fuso da loja. */
  hojeDaLoja: string;
  /**
   * Quantas vezes este telefone já usou este cupom nesta loja. `null` quando
   * o telefone ainda não é conhecido (sacola aberta, sem login nem checkout).
   */
  usosDoCliente: number | null;
  /** Este telefone já fez pedido pelo site desta loja? `null` = não sabemos ainda. */
  jaPediuPeloSite: boolean | null;
};

export type VereditoDoCupom = {
  ok: boolean;
  /** Frase pronta para o cliente. Só quando `ok` é false. */
  motivo?: string;
  /** Desconto em reais (0 para frete grátis — o efeito é `zeraTaxa`). */
  desconto: number;
  zeraTaxa: boolean;
  /**
   * true quando o cupom tem regra por telefone (limite de usos ou primeiro
   * pedido) e o telefone ainda não é conhecido: o site pode mostrar o desconto,
   * mas avisa que a confirmação vem no checkout.
   */
  dependeDoTelefone: boolean;
};

/**
 * O veredito. Recebe os fatos e não consulta nada — é o que permite ao site e
 * ao checkout darem a mesma resposta.
 */
export function avaliarCupom(cupom: Cupom | null, fatos: FatosDoCupom): VereditoDoCupom {
  const nada = { desconto: 0, zeraTaxa: false, dependeDoTelefone: false };

  if (!cupom || !cupom.active) return { ok: false, motivo: "Cupom inválido ou expirado.", ...nada };

  if (cupomVenceu(cupom, fatos.hojeDaLoja)) {
    return { ok: false, motivo: `Este cupom venceu em ${diaCurto(cupom.validade!)}.`, ...nada };
  }

  if (cupom.minOrderValue > 0 && fatos.subtotal < cupom.minOrderValue) {
    return {
      ok: false,
      motivo: `Válido para pedidos a partir de R$ ${cupom.minOrderValue.toFixed(2).replace(".", ",")}.`,
      ...nada,
    };
  }

  let dependeDoTelefone = false;

  if (cupom.primeiroPedido) {
    if (fatos.jaPediuPeloSite === true) {
      return {
        ok: false,
        motivo: `O cupom ${cupom.code} vale só no seu primeiro pedido pelo site, e este telefone já fez pedido por aqui.`,
        ...nada,
      };
    }
    if (fatos.jaPediuPeloSite === null) dependeDoTelefone = true;
  }

  if (cupom.usosPorCliente > 0) {
    if (fatos.usosDoCliente !== null && fatos.usosDoCliente >= cupom.usosPorCliente) {
      const vezes = cupom.usosPorCliente === 1 ? "1 vez" : `${cupom.usosPorCliente} vezes`;
      return {
        ok: false,
        motivo: `Este cupom pode ser usado ${vezes} por cliente, e este telefone já usou.`,
        ...nada,
      };
    }
    if (fatos.usosDoCliente === null) dependeDoTelefone = true;
  }

  if (cupom.type === "free_shipping") {
    return { ok: true, desconto: 0, zeraTaxa: true, dependeDoTelefone };
  }
  const bruto = cupom.type === "fixed" ? cupom.discount : fatos.subtotal * (cupom.discount / 100);
  const desconto = Math.round(Math.min(bruto, fatos.subtotal + fatos.taxa) * 100) / 100;
  return { ok: true, desconto, zeraTaxa: false, dependeDoTelefone };
}

/**
 * Os cupons que o robô do WhatsApp pode citar: públicos, ativos, não vencidos
 * e SEM regra de primeiro pedido — o robô não tem como saber se quem pergunta
 * já pediu, e prometer um desconto que o checkout vai recusar é pior que não
 * prometer.
 */
export function cuponsAnunciaveis(lista: unknown, hojeDaLoja: string): Cupom[] {
  return lerCupons(lista).filter((c) => c.active && c.isPublic && !c.primeiroPedido && !cupomVenceu(c, hojeDaLoja));
}
