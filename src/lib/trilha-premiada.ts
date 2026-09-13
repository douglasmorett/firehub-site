/**
 * Trilha Premiada — o cliente que volta ganha.
 *
 * Cada pedido é um passo. A loja escolhe em quais pedidos ficam os prêmios, o
 * que é cada um e em quanto tempo a trilha precisa ser percorrida.
 *
 * ── O que se guarda e o que se calcula ──────────────────────────────────────
 *
 * A CONFIGURAÇÃO fica em `User.storeLoyalty.trilha` — Json que já existe, sem
 * coluna nova.
 *
 * O PROGRESSO **não é guardado**: é contado dos pedidos do cliente na janela.
 * Contador guardado é contador que dessincroniza — pedido cancelado depois,
 * importação, correção manual — e aí o cliente vê um número e a loja vê outro.
 * Contar na hora sempre bate com o extrato.
 *
 * O RESGATE é guardado, esse sim, no pedido que usou o prêmio
 * (`CustomerOrder.trilhaPremio`). É história, não estado: fica auditável e
 * responde sozinho "este cliente já pegou o prêmio da 2ª parada?".
 *
 * ── A regra que evita reclamação ────────────────────────────────────────────
 *
 * Prêmio já ganho NUNCA é retirado. Se o prazo vence no meio da trilha, o
 * cliente perde o progresso — não o que já conquistou. Todo o resto do desenho
 * decorre disso.
 */

export type TipoDePremio = "produto" | "frete" | "desconto";

export type ParadaDaTrilha = {
  /** Em qual pedido da trilha este prêmio é liberado. 1 = já no primeiro. */
  pedidos: number;
  tipo: TipoDePremio;
  /** Só para `produto`: o id do MenuProduct que a loja escolheu. */
  produtoId?: string;
  /** Nome do produto no momento da escolha — o cardápio muda, a trilha não. */
  produtoNome?: string;
  /** Só para `desconto`: porcentagem sobre o pedido. */
  valor?: number;
};

export type TrilhaPremiada = {
  ativa: boolean;
  /** Dias para percorrer, contados do primeiro pedido. 0 = sem prazo. */
  janelaDias: number;
  paradas: ParadaDaTrilha[];
};

export const TRILHA_PADRAO: TrilhaPremiada = { ativa: false, janelaDias: 30, paradas: [] };

/** Acima disto a trilha fica longa demais para o cliente enxergar o fim. */
export const PEDIDOS_DEMAIS = 15;
/** Mais que isto vira cardápio de prêmios, não trilha. */
export const MAX_PARADAS = 12;

export function lerTrilha(storeLoyalty: unknown): TrilhaPremiada {
  const bruto = ((storeLoyalty as any)?.trilha ?? {}) as Partial<TrilhaPremiada>;
  const janela = Number(bruto.janelaDias);
  const paradas = (Array.isArray(bruto.paradas) ? bruto.paradas : [])
    .map((p: any): ParadaDaTrilha => {
      const pedidos = Math.max(1, Math.floor(Number(p?.pedidos) || 1));
      const tipo: TipoDePremio = p?.tipo === "frete" || p?.tipo === "desconto" ? p.tipo : "produto";
      const saida: ParadaDaTrilha = { pedidos, tipo };
      if (tipo === "produto") {
        saida.produtoId = String(p?.produtoId || "").trim() || undefined;
        saida.produtoNome = String(p?.produtoNome || "").trim() || undefined;
      }
      if (tipo === "desconto") {
        const v = Number(p?.valor);
        saida.valor = Number.isFinite(v) && v > 0 && v <= 100 ? v : 10;
      }
      return saida;
    })
    // Duas paradas no mesmo pedido dariam dois prêmios no mesmo passo, e a
    // primeira sumiria da trilha sem explicação. Vence a primeira da lista.
    .filter((p, i, todas) => todas.findIndex((x) => x.pedidos === p.pedidos) === i)
    .sort((a, b) => a.pedidos - b.pedidos)
    .slice(0, MAX_PARADAS);

  return {
    ativa: bruto.ativa === true && paradas.length > 0,
    janelaDias: Number.isFinite(janela) && janela >= 0 ? Math.floor(janela) : 30,
    paradas,
  };
}

/** A trilha está de pé e vale a pena mostrar? */
export function trilhaValida(t: TrilhaPremiada): boolean {
  if (!t.ativa || t.paradas.length === 0) return false;
  // Parada de produto sem produto escolhido não premia nada — a tela avisa, mas
  // aqui a trilha inteira não pode ir ao ar prometendo o que não existe.
  return t.paradas.every((p) => p.tipo !== "produto" || !!p.produtoId);
}

/**
 * O que impede esta trilha de ir ao ar, em português para a tela mostrar.
 *
 * Roda sobre o que a loja ACABOU de digitar, não sobre o que `lerTrilha`
 * devolveria: a leitura conserta calada (colapsa parada repetida, corrige
 * desconto fora da faixa), e conserto calado numa tela de configuração é a
 * loja salvar quatro paradas e encontrar três depois, sem saber por quê.
 */
export function problemasDaTrilha(t: TrilhaPremiada): string[] {
  const p: string[] = [];
  if (!t.paradas.length) {
    p.push("A trilha precisa de pelo menos um prêmio.");
    return p;
  }
  const repetidos = t.paradas
    .map((x) => x.pedidos)
    .filter((n, i, todos) => todos.indexOf(n) !== i);
  if (repetidos.length) {
    p.push(`Tem mais de um prêmio no ${Array.from(new Set(repetidos)).join("º e no ")}º pedido. Cada pedido libera um prêmio só.`);
  }
  const semProduto = t.paradas.filter((x) => x.tipo === "produto" && !x.produtoId);
  for (const x of semProduto) {
    p.push(`Escolha qual produto o cliente ganha no ${x.pedidos}º pedido.`);
  }
  return p;
}

/**
 * Conselho, não impedimento. A loja decide — mas decide vendo.
 *
 * Separado de `problemasDaTrilha` de propósito: bloquear a loja de premiar no
 * 20º pedido seria o sistema achando que sabe do negócio dela mais do que ela.
 */
export function avisosDaTrilha(t: TrilhaPremiada): string[] {
  const a: string[] = [];
  const longe = t.paradas.filter((x) => x.pedidos > PEDIDOS_DEMAIS);
  if (longe.length) {
    a.push(`Prêmio no ${longe[0].pedidos}º pedido é longe: acima de ${PEDIDOS_DEMAIS} pedidos o cliente costuma não enxergar o fim da trilha.`);
  }
  if (t.janelaDias > 0 && tamanhoDaTrilha(t) > t.janelaDias) {
    a.push(`São ${tamanhoDaTrilha(t)} pedidos em ${t.janelaDias} dias — mais de um por dia. Talvez valha aumentar o prazo ou aproximar os prêmios.`);
  }
  if (t.paradas.some((x) => x.tipo === "desconto" && (x.valor || 0) >= 50)) {
    a.push("Desconto de 50% ou mais: confira se o pedido premiado ainda paga a conta.");
  }
  return a;
}

/** Quantos pedidos a trilha inteira tem. */
export function tamanhoDaTrilha(t: TrilhaPremiada): number {
  return t.paradas.length ? t.paradas[t.paradas.length - 1].pedidos : 0;
}

// ── Progresso ───────────────────────────────────────────────────────────────

export type PedidoDaTrilha = {
  id: string;
  createdAt: Date | string;
  status?: string | null;
  source?: string | null;
  /** O que este pedido resgatou da trilha, se resgatou (`CustomerOrder.trilhaPremio`). */
  trilhaPremio?: unknown;
};

/** Pedido que conta um passo: entregue ou a caminho, nunca cancelado. */
const STATUS_QUE_NAO_CONTA = new Set([
  "CANCELADO", "CANCELED", "AGUARDANDO_PAGAMENTO", "RECUSADO", "CRIANDO_IA",
]);

/**
 * Pedido de marketplace NÃO anda na trilha.
 *
 * Dois motivos, nesta ordem: a loja já paga comissão ali (contar seria pagar o
 * prêmio em cima da comissão), e o prêmio não tem como ser resgatado lá — o
 * cliente veria "você ganhou" numa tela onde não dá para usar. Balcão, mesa,
 * totem e WhatsApp contam: é venda da própria loja, e o resgate acontece no
 * pedido seguinte pelo site ou pelo robô.
 */
const FONTES_DE_MARKETPLACE = new Set(["IFOOD", "99FOOD", "JOTAJA", "BRENDI", "WABIZ"]);

export function pedidoConta(p: PedidoDaTrilha): boolean {
  if (STATUS_QUE_NAO_CONTA.has(String(p.status || "").toUpperCase().trim())) return false;
  return !FONTES_DE_MARKETPLACE.has(String(p.source || "ONLINE").toUpperCase().trim());
}

export type ProgressoNaTrilha = {
  /** Passos dados no ciclo atual. */
  passos: number;
  /** Quando o ciclo atual começou (o primeiro pedido dele). */
  cicloComecouEm: Date | null;
  /** Quando o ciclo expira. `null` = sem prazo. */
  cicloExpiraEm: Date | null;
  /** A próxima parada a conquistar, ou `null` se completou a trilha. */
  proxima: ParadaDaTrilha | null;
  /** Quantos pedidos faltam para a próxima parada. */
  faltam: number;
  /** Paradas já conquistadas neste ciclo. */
  conquistadas: ParadaDaTrilha[];
  /** Completou a trilha inteira neste ciclo? */
  completou: boolean;
};

const DIA = 24 * 60 * 60 * 1000;

/**
 * Onde o cliente está na trilha.
 *
 * ── Por que o ciclo é recalculado, e não guardado ───────────────────────────
 *
 * A janela começa no primeiro pedido e vale N dias. Quando vence, o ciclo
 * seguinte começa no primeiro pedido DEPOIS do vencimento — não "hoje". Assim
 * quem pediu ontem e some por dois meses volta com o ciclo começando no pedido
 * de volta, não num marco invisível.
 *
 * `pedidos` pode vir em qualquer ordem; a função ordena.
 */
/** Os pedidos que andam na trilha, em ordem e com a data já resolvida. */
function pedidosEmOrdem(pedidos: PedidoDaTrilha[]) {
  return (pedidos || [])
    .filter(pedidoConta)
    .map((p) => ({ ...p, quando: new Date(p.createdAt) }))
    .filter((p) => Number.isFinite(p.quando.getTime()))
    .sort((a, b) => a.quando.getTime() - b.quando.getTime());
}

type Ciclo = { comecouEm: Date; passos: number };

/**
 * A história inteira do cliente dividida em ciclos.
 *
 * Um ciclo fecha por prazo (passou da janela) ou por bandeira (percorreu a
 * trilha toda). O próximo começa NO pedido que o fechou — nunca "hoje", senão
 * quem volta depois de dois meses acharia um ciclo já correndo sem ter pedido.
 */
function ciclosDaTrilha(trilha: TrilhaPremiada, validos: { quando: Date }[]): Ciclo[] {
  const tamanho = tamanhoDaTrilha(trilha);
  const ciclos: Ciclo[] = [];
  for (const p of validos) {
    const atual = ciclos[ciclos.length - 1];
    const venceu = !!atual && trilha.janelaDias > 0
      && p.quando.getTime() - atual.comecouEm.getTime() > trilha.janelaDias * DIA;
    if (!atual || venceu || atual.passos >= tamanho) {
      ciclos.push({ comecouEm: p.quando, passos: 1 });
      continue;
    }
    atual.passos++;
  }
  return ciclos;
}

export function calcularProgresso(
  trilha: TrilhaPremiada,
  pedidos: PedidoDaTrilha[],
  agora: Date = new Date(),
): ProgressoNaTrilha {
  const vazio: ProgressoNaTrilha = {
    passos: 0, cicloComecouEm: null, cicloExpiraEm: null,
    proxima: trilha.paradas[0] || null,
    faltam: trilha.paradas[0]?.pedidos || 0,
    conquistadas: [], completou: false,
  };
  if (!trilhaValida(trilha)) return { ...vazio, proxima: null, faltam: 0 };

  const validos = pedidosEmOrdem(pedidos);
  if (validos.length === 0) return vazio;

  const tamanho = tamanhoDaTrilha(trilha);
  const ciclos = ciclosDaTrilha(trilha, validos);
  const { comecouEm: inicio, passos } = ciclos[ciclos.length - 1];

  // O ciclo pode ter vencido DEPOIS do último pedido — sem pedido novo para
  // reabrir, o cliente está em zero, e a tela precisa dizer isso.
  const expira = trilha.janelaDias > 0 ? new Date(inicio.getTime() + trilha.janelaDias * DIA) : null;
  if (expira && agora.getTime() > expira.getTime()) {
    return { ...vazio, cicloComecouEm: null, cicloExpiraEm: null };
  }

  const conquistadas = trilha.paradas.filter((p) => passos >= p.pedidos);
  const proxima = trilha.paradas.find((p) => p.pedidos > passos) || null;
  return {
    passos,
    cicloComecouEm: inicio,
    cicloExpiraEm: expira,
    proxima,
    faltam: proxima ? proxima.pedidos - passos : 0,
    conquistadas,
    completou: !proxima && passos >= tamanho,
  };
}

// ── Prêmio a receber ────────────────────────────────────────────────────────

/**
 * O que fica gravado em `CustomerOrder.trilhaPremio` quando um pedido usa um
 * prêmio. É história, não estado: guarda o que foi dado e quanto valeu, para o
 * relatório da loja e para a conferência com o cliente meses depois.
 */
export type ResgateDaTrilha = {
  /** Qual parada foi resgatada (o `pedidos` dela). */
  pedidos: number;
  tipo: TipoDePremio;
  produtoId?: string;
  produtoNome?: string;
  /** Porcentagem, quando o prêmio é desconto. */
  valor?: number;
  /** Quanto o prêmio custou à loja neste pedido, em reais. */
  valorAplicado: number;
  /** Como o prêmio aparece para o cliente. */
  descricao: string;
  em: string;
};

export function lerResgate(bruto: unknown): ResgateDaTrilha | null {
  const r = bruto as any;
  if (!r || typeof r !== "object") return null;
  const pedidos = Math.floor(Number(r.pedidos));
  if (!Number.isFinite(pedidos) || pedidos < 1) return null;
  const tipo: TipoDePremio = r.tipo === "frete" || r.tipo === "desconto" ? r.tipo : "produto";
  return {
    pedidos, tipo,
    produtoId: r.produtoId ? String(r.produtoId) : undefined,
    produtoNome: r.produtoNome ? String(r.produtoNome) : undefined,
    valor: Number.isFinite(Number(r.valor)) ? Number(r.valor) : undefined,
    valorAplicado: Number(r.valorAplicado) || 0,
    descricao: String(r.descricao || ""),
    em: String(r.em || ""),
  };
}

/**
 * Os prêmios que o cliente ganhou e ainda não usou.
 *
 * ── Por que contar em vez de marcar ─────────────────────────────────────────
 *
 * Ganho e resgate são contados como QUANTIDADE por parada, nunca como uma
 * marca de "já pegou". O ciclo é recalculado a cada consulta, então um pedido
 * cancelado semanas depois muda as fronteiras dos ciclos — uma marca ficaria
 * apontando para um ciclo que não existe mais. Contagem se ajusta sozinha: se
 * o cancelamento desfaz uma conquista, o pendente cai; se o cliente já tinha
 * usado, o saldo simplesmente chega a zero e nada é cobrado de volta.
 *
 * A promessa "prêmio já ganho continua seu" mora aqui: a conta é sobre a
 * história INTEIRA, não sobre o ciclo atual. Vencer o prazo zera a contagem de
 * passos; não tira da mão o que já foi conquistado.
 */
export function premiosPendentes(trilha: TrilhaPremiada, pedidos: PedidoDaTrilha[]): ParadaDaTrilha[] {
  if (!trilhaValida(trilha)) return [];
  const validos = pedidosEmOrdem(pedidos);
  if (!validos.length) return [];

  const ganhos = new Map<number, number>();
  for (const ciclo of ciclosDaTrilha(trilha, validos)) {
    for (const parada of trilha.paradas) {
      if (ciclo.passos >= parada.pedidos) ganhos.set(parada.pedidos, (ganhos.get(parada.pedidos) || 0) + 1);
    }
  }

  // Resgate conta mesmo em pedido cancelado depois: o prêmio saiu da loja.
  for (const p of pedidos || []) {
    const r = lerResgate(p.trilhaPremio);
    if (r) ganhos.set(r.pedidos, (ganhos.get(r.pedidos) || 0) - 1);
  }

  const pendentes: ParadaDaTrilha[] = [];
  for (const parada of trilha.paradas) {
    for (let i = 0; i < (ganhos.get(parada.pedidos) || 0); i++) pendentes.push(parada);
  }
  return pendentes;
}

/** O prêmio que entra no próximo pedido — um por pedido, na ordem em que foi ganho. */
export function premioDaVez(trilha: TrilhaPremiada, pedidos: PedidoDaTrilha[]): ParadaDaTrilha | null {
  return premiosPendentes(trilha, pedidos)[0] || null;
}

/**
 * Quanto o prêmio vale neste pedido, em reais.
 *
 * `frete` zera a entrega; `desconto` é porcentagem sobre os itens (nunca sobre
 * a taxa — desconto em cima da entrega vira prejuízo escondido); `produto` vale
 * o preço do produto, e quem soma o item é quem monta o pedido.
 */
export function valorDoPremio(
  parada: ParadaDaTrilha,
  conta: { subtotal: number; taxaDeEntrega: number; precoDoProduto?: number },
): number {
  const arredondar = (n: number) => Math.round(Math.max(0, n) * 100) / 100;
  if (parada.tipo === "frete") return arredondar(conta.taxaDeEntrega);
  if (parada.tipo === "desconto") return arredondar((conta.subtotal * (parada.valor || 10)) / 100);
  return arredondar(conta.precoDoProduto || 0);
}

export type EfeitoDoPremio = {
  /** Quanto abater do pedido, em reais (frete e desconto). */
  descontoExtra: number;
  /** A taxa de entrega vai a zero. */
  zeraTaxa: boolean;
  /** Produto a somar ao pedido com preço zero. */
  produtoGratis: { id: string; nome: string; preco: number } | null;
  /** O que gravar em `CustomerOrder.trilhaPremio`. */
  resgate: ResgateDaTrilha;
};

/**
 * O prêmio cabe neste pedido? Se não couber, ele NÃO é consumido.
 *
 * Frete grátis em pedido de retirada é o caso real: dar por cumprido um prêmio
 * que não valeu nada seria tirar do cliente o que ele conquistou. Fica
 * pendente, e entra no próximo pedido com entrega.
 */
export function efeitoDoPremio(
  parada: ParadaDaTrilha,
  conta: {
    subtotal: number;
    taxa: number;
    entrega: boolean;
    /** O produto do prêmio, como está HOJE no cardápio. */
    produto?: { id: string; name: string; price: number; active?: boolean } | null;
  },
): EfeitoDoPremio | null {
  if (parada.tipo === "frete") {
    if (!conta.entrega || !(conta.taxa > 0)) return null;
    const valor = valorDoPremio(parada, { subtotal: conta.subtotal, taxaDeEntrega: conta.taxa });
    return {
      descontoExtra: valor,
      zeraTaxa: true,
      produtoGratis: null,
      resgate: gravar(parada, valor),
    };
  }

  if (parada.tipo === "desconto") {
    if (!(conta.subtotal > 0)) return null;
    const valor = valorDoPremio(parada, { subtotal: conta.subtotal, taxaDeEntrega: conta.taxa });
    if (!(valor > 0)) return null;
    return {
      descontoExtra: Math.min(valor, conta.subtotal),
      zeraTaxa: false,
      produtoGratis: null,
      resgate: gravar(parada, Math.min(valor, conta.subtotal)),
    };
  }

  // Produto: o cardápio muda depois da trilha ser montada. Produto apagado ou
  // desativado não vira erro no checkout — o prêmio fica guardado, e a loja
  // resolve escolhendo outro na configuração.
  const p = conta.produto;
  if (!p || p.active === false) return null;
  const valor = valorDoPremio(parada, {
    subtotal: conta.subtotal, taxaDeEntrega: conta.taxa, precoDoProduto: Number(p.price) || 0,
  });
  return {
    descontoExtra: 0,
    zeraTaxa: false,
    produtoGratis: { id: p.id, nome: p.name, preco: Number(p.price) || 0 },
    resgate: { ...gravar(parada, valor), produtoId: p.id, produtoNome: p.name },
  };
}

function gravar(parada: ParadaDaTrilha, valorAplicado: number): ResgateDaTrilha {
  return {
    pedidos: parada.pedidos,
    tipo: parada.tipo,
    produtoId: parada.produtoId,
    produtoNome: parada.produtoNome,
    valor: parada.valor,
    valorAplicado,
    descricao: nomeDoPremio(parada),
    em: new Date().toISOString(),
  };
}

// ── Texto ───────────────────────────────────────────────────────────────────

export function nomeDoPremio(p: ParadaDaTrilha): string {
  if (p.tipo === "frete") return "Frete grátis";
  if (p.tipo === "desconto") return `${p.valor || 10}% de desconto`;
  return p.produtoNome || "Prêmio da loja";
}

/**
 * A chamada curta, a que aparece no topo do cardápio.
 *
 * Escrita a partir do estado, nunca fixa: texto fixo vira mentira no dia em que
 * a loja muda a configuração, e é assim que nasce reclamação.
 */
export function chamadaDaTrilha(p: ProgressoNaTrilha): string {
  if (p.completou) return "Você percorreu a trilha inteira! Ela recomeça no próximo pedido.";
  if (!p.proxima) return "";
  const premio = nomeDoPremio(p.proxima);
  if (p.passos === 0) return `Faça seu primeiro pedido e comece a Trilha Premiada — ${p.proxima.pedidos} pedidos até ${premio}.`;
  return p.faltam === 1
    ? `Falta 1 pedido para você ganhar ${premio}.`
    : `Faltam ${p.faltam} pedidos para você ganhar ${premio}.`;
}

/**
 * As regras, geradas do que a loja configurou.
 *
 * Escrever isto à mão foi descartado de propósito: a loja muda o prazo e o
 * texto vira mentira. Aqui o que está escrito é sempre o que está valendo.
 */
export function regrasDaTrilha(t: TrilhaPremiada): string[] {
  const r = ["Cada pedido entregue e pago é um passo na trilha."];
  if (t.paradas.length) {
    r.push(
      `São ${t.paradas.length} ${t.paradas.length === 1 ? "prêmio" : "prêmios"}: ` +
      t.paradas.map((p) => `${p.pedidos}º pedido → ${nomeDoPremio(p)}`).join("; ") + ".",
    );
  }
  r.push(
    t.janelaDias > 0
      ? `Você tem ${t.janelaDias} dias a partir do primeiro pedido para percorrer a trilha. Passou o prazo, a contagem volta ao começo — e o que você já ganhou continua seu.`
      : "A trilha não expira: você percorre no seu tempo.",
  );
  r.push("O prêmio entra sozinho no seu pedido seguinte pelo site da loja, e vale por um pedido só.");
  r.push("É um prêmio por pedido: se você juntar mais de um, eles entram na ordem em que foram ganhos.");
  r.push("Pedido cancelado ou não entregue não conta.");
  r.push("Valem os pedidos feitos direto com a loja — pelo site, pelo WhatsApp, no balcão ou na mesa. Pedido por iFood ou 99Food não anda na trilha.");
  r.push("Ao chegar na bandeira, a trilha recomeça e você pode percorrer de novo.");
  r.push("A loja pode mudar ou encerrar a trilha a qualquer momento; o prêmio já ganho continua valendo.");
  return r;
}
