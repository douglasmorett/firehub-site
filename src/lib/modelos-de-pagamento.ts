/**
 * Modelos de pagamento do entregador — o acerto cadastrado UMA VEZ e reusado.
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 *
 * O acerto de entregador é o mesmo para quase todo mundo na loja: "até 1 km
 * R$ 5, até 2 km R$ 6, até 3 km R$ 7". Como a tabela vivia só dentro de cada
 * entregador, cadastrar o segundo, o terceiro e o décimo era redigitar a mesma
 * escada inteira — e um dígito diferente numa linha qualquer vira diferença no
 * acerto do fim do dia, que ninguém encontra depois.
 *
 * Aqui o acerto vira MODELO com nome. O lojista monta "Tabela padrão" uma vez e
 * nos próximos entregadores só escolhe o nome.
 *
 * ── Por que o modelo é COPIADO, e não apontado ──────────────────────────────
 *
 * Escolher um modelo grava os valores DENTRO do entregador. Se o modelo fosse
 * um ponteiro, mexer nele mudaria, calado, quanto dez pessoas recebem — e a
 * mudança valeria inclusive para as entregas que já aconteceram e ainda não
 * foram acertadas. Pagamento não pode mudar sozinho.
 *
 * O entregador guarda também o NOME do modelo que veio (`modeloDePagamento`),
 * que é o que permite a tela dizer "5 entregadores usam a Tabela padrão" e
 * oferecer aplicar a mudança — com a loja mandando, nunca por tabela.
 */

import {
  lerFaixasDoMotoboy, explicarFaixas, problemasDasFaixas, type FaixaDoMotoboy,
} from "./faixas-do-motoboy";

/** Os tipos de acerto que a loja pode gravar num modelo. */
export const TIPOS_DE_ACERTO = [
  { valor: "PER_DELIVERY", rotulo: "Por entrega (fixo por corrida)" },
  { valor: "DAILY_RATE", rotulo: "Diária fixa" },
  { valor: "BOTH", rotulo: "Diária + por entrega" },
  { valor: "DAILY_PLUS_FEE", rotulo: "Diária + taxa do pedido" },
  { valor: "PER_KM", rotulo: "Por km percorrido (R$ por km rodado)" },
  // Mesmo nome do cadastro de entregador (MotoboyManager) e do relatório de
  // acerto: o mesmo modelo tinha três nomes diferentes em três telas, e o
  // lojista não tinha como saber que eram a mesma coisa.
  { valor: "FAIXA_KM", rotulo: "Diária + valor para cada km percorrido" },
] as const;

export type ModeloDePagamento = {
  /** Estável para sempre: é por ele que o entregador lembra de onde veio. */
  id: string;
  nome: string;
  paymentType: string;
  dailyRate?: number | null;
  perDeliveryRate?: number | null;
  perKmRate?: number | null;
  faixasDeKm?: FaixaDoMotoboy[];
};

/** Os campos de acerto de um entregador — o que o modelo grava e lê. */
export type AcertoDoEntregador = {
  paymentType?: string | null;
  dailyRate?: number | null;
  perDeliveryRate?: number | null;
  perKmRate?: number | null;
  faixasDeKm?: unknown;
};

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

const TIPOS = new Set(TIPOS_DE_ACERTO.map((t) => t.valor as string));

/** Lê e saneia o que está gravado em `User.modelosDePagamento`. */
export function lerModelosDePagamento(bruto: unknown): ModeloDePagamento[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  return lista
    .map((m: any, i: number): ModeloDePagamento => ({
      id: String(m?.id || "").trim() || `modelo-${i + 1}`,
      nome: String(m?.nome || m?.name || "").trim(),
      paymentType: TIPOS.has(String(m?.paymentType)) ? String(m.paymentType) : "PER_DELIVERY",
      dailyRate: numero(m?.dailyRate),
      perDeliveryRate: numero(m?.perDeliveryRate),
      perKmRate: numero(m?.perKmRate),
      faixasDeKm: lerFaixasDoMotoboy(m?.faixasDeKm),
    }))
    .filter((m) => m.nome.length > 0)
    // Dois modelos com o mesmo id fariam o entregador apontar para o errado.
    .filter((m, i, todos) => todos.findIndex((x) => x.id === m.id) === i)
    .slice(0, 40);
}

/**
 * Os campos a gravar no entregador ao escolher o modelo.
 *
 * Devolve TODOS os campos de acerto, inclusive os que este modelo não usa — com
 * `null`. Sem isso, trocar um entregador de "Diária" para "Por entrega" deixava
 * a diária antiga gravada embaixo: invisível na tela, viva no cálculo.
 */
export type AcertoAplicado = {
  /** Sempre um tipo válido: quem aplica um modelo nunca fica sem tipo. */
  paymentType: string;
  dailyRate: number | null;
  perDeliveryRate: number | null;
  perKmRate: number | null;
  faixasDeKm: FaixaDoMotoboy[];
  modeloDePagamento: string;
};

export function aplicarModelo(modelo: ModeloDePagamento): AcertoAplicado {
  const usa = (tipos: string[]) => tipos.includes(modelo.paymentType);
  return {
    paymentType: modelo.paymentType,
    dailyRate: usa(["DAILY_RATE", "BOTH", "DAILY_PLUS_FEE"]) ? modelo.dailyRate ?? null : null,
    perDeliveryRate: usa(["PER_DELIVERY", "BOTH"]) ? modelo.perDeliveryRate ?? null : null,
    perKmRate: usa(["PER_KM"]) ? modelo.perKmRate ?? null : null,
    faixasDeKm: usa(["FAIXA_KM"]) ? lerFaixasDoMotoboy(modelo.faixasDeKm) : [],
    modeloDePagamento: modelo.id,
  };
}

/** O contrário: pegar o acerto que está na tela e virar modelo para salvar. */
export function modeloDoAcerto(nome: string, acerto: AcertoDoEntregador, id?: string): ModeloDePagamento {
  return {
    id: (id || "").trim() || `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nome: String(nome || "").trim(),
    paymentType: TIPOS.has(String(acerto.paymentType)) ? String(acerto.paymentType) : "PER_DELIVERY",
    dailyRate: numero(acerto.dailyRate),
    perDeliveryRate: numero(acerto.perDeliveryRate),
    perKmRate: numero(acerto.perKmRate),
    faixasDeKm: lerFaixasDoMotoboy(acerto.faixasDeKm),
  };
}

/** O que impede este modelo de ser salvo, em português para a tela. */
export function problemasDoModelo(m: ModeloDePagamento, outros: ModeloDePagamento[] = []): string[] {
  const p: string[] = [];
  if (!m.nome.trim()) p.push("O modelo precisa de um nome — é por ele que você vai escolher depois.");
  if (outros.some((o) => o.id !== m.id && o.nome.trim().toLowerCase() === m.nome.trim().toLowerCase())) {
    p.push(`Já existe um modelo chamado "${m.nome.trim()}".`);
  }
  const exige = (campo: number | null | undefined, oQue: string) => {
    if (!(Number(campo) > 0)) p.push(`Falta ${oQue}.`);
  };
  if (["DAILY_RATE", "BOTH", "DAILY_PLUS_FEE"].includes(m.paymentType)) exige(m.dailyRate, "o valor da diária");
  if (["PER_DELIVERY", "BOTH"].includes(m.paymentType)) exige(m.perDeliveryRate, "o valor por entrega");
  if (m.paymentType === "PER_KM") exige(m.perKmRate, "o valor por km");
  if (m.paymentType === "FAIXA_KM") {
    const faixas = lerFaixasDoMotoboy(m.faixasDeKm);
    if (!faixas.length) p.push("Falta pelo menos uma faixa de distância preenchida.");
    p.push(...problemasDasFaixas(faixas));
  }
  return p;
}

const reais = (v: number | null | undefined) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

/** Como o modelo aparece na lista, para o lojista conferir sem abrir. */
export function explicarModelo(m: ModeloDePagamento): string {
  switch (m.paymentType) {
    case "DAILY_RATE":
      return `Diária de ${reais(m.dailyRate)}`;
    case "BOTH":
      return `Diária de ${reais(m.dailyRate)} + ${reais(m.perDeliveryRate)} por entrega`;
    case "DAILY_PLUS_FEE":
      return `Diária de ${reais(m.dailyRate)} + a taxa de entrega do pedido`;
    case "PER_KM":
      return `${reais(m.perKmRate)} por km rodado`;
    case "FAIXA_KM":
      return explicarFaixas(lerFaixasDoMotoboy(m.faixasDeKm)) || "Faixas de distância (nenhuma preenchida)";
    default:
      return `${reais(m.perDeliveryRate)} por entrega`;
  }
}

/**
 * O acerto deste entregador é igual ao do modelo?
 *
 * É o que deixa a tela avisar "este entregador saiu da Tabela padrão" em vez de
 * continuar exibindo um nome de modelo que não corresponde mais aos valores.
 */
export function acertoSegueOModelo(acerto: AcertoDoEntregador, modelo: ModeloDePagamento): boolean {
  const alvo = aplicarModelo(modelo);
  const mesmo = (a: unknown, b: unknown) => (numero(a) ?? null) === (numero(b) ?? null);
  if (String(acerto.paymentType || "") !== alvo.paymentType) return false;
  if (!mesmo(acerto.dailyRate, alvo.dailyRate)) return false;
  if (!mesmo(acerto.perDeliveryRate, alvo.perDeliveryRate)) return false;
  if (!mesmo(acerto.perKmRate, alvo.perKmRate)) return false;
  const a = lerFaixasDoMotoboy(acerto.faixasDeKm);
  const b = alvo.faixasDeKm;
  if (a.length !== b.length) return false;
  return a.every((f, i) => f.ate === b[i].ate && f.valor === b[i].valor);
}
