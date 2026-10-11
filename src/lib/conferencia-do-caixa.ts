/**
 * A CONFERÊNCIA DE UM CAIXA, como ela foi gravada — lida do mesmo jeito no
 * Histórico de caixas, na 2ª via do papel e no aviso ao dono.
 *
 * ── Campo em branco não é "contei zero" ─────────────────────────────────────
 *
 * A tela de fechamento fazia `Number("") || 0`: a forma que o operador deixava
 * em branco era gravada como R$ 0,00 CONTADO, e a diferença acusava falta do
 * tamanho do esperado dela. Na auditoria de 11/10/2026, em 30 dias, 67 de 270
 * caixas tinham as cinco linhas em zero (−R$ 108.653 de "falta" gravada e
 * avisada no WhatsApp do dono; Ragnar, 10/10, −R$ 7.369,37) e outros 17 tinham
 * só algumas em zero (R$ 13.282,79 — a Delícia de Casa conta o dinheiro e deixa
 * os cartões em branco). Desde então:
 *   • forma em branco = NÃO CONFERIDA: grava `closingX = null` e fica fora da
 *     diferença;
 *   • tudo em branco = SEM CONFERÊNCIA: grava `difference = null`, como o caixa
 *     que se encerra sozinho quando outro é aberto.
 * O caixa gravado antes disso não muda. Para ele, a leitura segura (pedido do
 * dono): as cinco linhas contadas em zero, com o sistema esperando dinheiro
 * nelas e a diferença igual a menos o esperado, é "sem conferência" — ninguém
 * contou; a "falta" gravada não aconteceu.
 *
 * ── Igual com igual ─────────────────────────────────────────────────────────
 *
 * `expectedTotal` leva o pago online, o troco de abertura e as sangrias; as
 * colunas de contado, só as cinco formas. O Histórico comparava os dois ("R$
 * 2.505,21 | R$ 1.045,20 | +R$ 0,18", Hakim 10/10). Aqui o conferido é só o
 * das formas contadas, dos dois lados, e o online é linha à parte.
 *
 * Puro, sem banco: recebe a linha da CashSession.
 */

export type ChaveDaConferencia = "cash" | "debit" | "credit" | "pix" | "voucher";

export const FORMAS_DA_CONFERENCIA: { chave: ChaveDaConferencia; nome: string; esperado: string; contado: string }[] = [
  { chave: "cash", nome: "Dinheiro", esperado: "expectedCash", contado: "closingCash" },
  { chave: "debit", nome: "Débito", esperado: "expectedDebit", contado: "closingDebit" },
  { chave: "credit", nome: "Crédito", esperado: "expectedCredit", contado: "closingCredit" },
  { chave: "pix", nome: "Pix", esperado: "expectedPix", contado: "closingPix" },
  { chave: "voucher", nome: "Vale-refeição", esperado: "expectedVoucher", contado: "closingVoucher" },
];

/** Quem fecha sozinho ao abrir outro caixa grava isto em `closedBy` (api/cash-session, POST). */
export const FECHADO_PELO_SISTEMA = "sistema — encerrado ao abrir outro caixa";

export type LinhaConferida = {
  chave: ChaveDaConferencia;
  nome: string;
  esperado: number;
  /** null = a forma não foi conferida (ficou em branco, ou o caixa não teve conferência). */
  contado: number | null;
  /** contado − esperado; null quando não houve contagem. */
  diferenca: number | null;
  /** Caixa antigo: contado R$ 0,00 com o sistema esperando dinheiro — pode ter ficado em branco. */
  talvezEmBranco: boolean;
};

export type ConferenciaGravada = {
  /** CONFERIDO: todas as formas com valor foram contadas; PARCIAL: alguma ficou em branco; SEM_CONFERENCIA: nenhuma. */
  situacao: "CONFERIDO" | "PARCIAL" | "SEM_CONFERENCIA";
  /** Por que não houve conferência. TUDO_ZERO é a leitura do caixa antigo (as cinco linhas em zero). */
  motivo: "ABRIU_OUTRO" | "SEM_CONTAGEM" | "TUDO_ZERO" | null;
  linhas: LinhaConferida[];
  /** Σ do esperado das formas CONTADAS (o lado de lá da diferença). */
  esperadoConferido: number;
  /** Σ do contado. */
  contado: number;
  /** A diferença do caixa: a gravada; null sem conferência. */
  diferenca: number | null;
  /** A diferença pelas linhas (contado − esperado das formas contadas). Difere da gravada quando a tela de quem fechou estava velha no online. */
  diferencaDasLinhas: number | null;
  /** O que o caixa antigo gravou como diferença e não é falta (TUDO_ZERO). */
  diferencaGravadaQueNaoVale: number | null;
  /** As formas com valor esperado que ninguém contou. */
  naoConferidas: LinhaConferida[];
  /** Σ do esperado das cinco formas. */
  esperadoNasFormas: number;
  /** O que o total esperado tem além das cinco formas: o pago online e o cobrado pelo app (travados). */
  online: number;
  /** `expectedTotal`, como gravado. */
  total: number;
};

const c2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function conferenciaGravada(s: Record<string, unknown>): ConferenciaGravada {
  const diferencaGravada = num(s.difference);
  const pelaTrocaDeCaixa = String(s.closedBy || "").startsWith("sistema");
  const brutas = FORMAS_DA_CONFERENCIA.map((f) => ({ ...f, esperado: num(s[f.esperado]) ?? 0, contado: num(s[f.contado]) }));
  const esperadoNasFormas = c2(brutas.reduce((t, l) => t + l.esperado, 0));
  const total = num(s.expectedTotal) ?? 0;
  const online = c2(total - esperadoNasFormas);

  // O caixa antigo que ninguém contou: cinco zeros, esperado nas formas, e a
  // diferença gravada é exatamente menos esse esperado.
  const tudoZero =
    diferencaGravada != null &&
    brutas.every((l) => (l.contado ?? 0) === 0) &&
    Math.abs(esperadoNasFormas) > 0.01 &&
    Math.abs(diferencaGravada + esperadoNasFormas) < 0.02;
  const semConferencia = diferencaGravada == null || tudoZero;

  const linhas: LinhaConferida[] = brutas.map((l) => {
    const contado = semConferencia ? null : l.contado;
    return {
      chave: l.chave,
      nome: l.nome,
      esperado: c2(l.esperado),
      contado,
      diferenca: contado == null ? null : c2(contado - l.esperado),
      talvezEmBranco: !semConferencia && contado === 0 && l.esperado > 0.005,
    };
  });
  const contadas = linhas.filter((l) => l.contado != null);
  const naoConferidas = linhas.filter((l) => l.contado == null && Math.abs(l.esperado) > 0.005);
  const esperadoConferido = c2(contadas.reduce((t, l) => t + l.esperado, 0));
  const contado = c2(contadas.reduce((t, l) => t + (l.contado as number), 0));

  return {
    situacao: semConferencia ? "SEM_CONFERENCIA" : naoConferidas.length > 0 ? "PARCIAL" : "CONFERIDO",
    motivo: !semConferencia ? null : tudoZero ? "TUDO_ZERO" : pelaTrocaDeCaixa ? "ABRIU_OUTRO" : "SEM_CONTAGEM",
    linhas,
    esperadoConferido,
    contado,
    diferenca: semConferencia ? null : diferencaGravada,
    diferencaDasLinhas: semConferencia ? null : c2(contado - esperadoConferido),
    diferencaGravadaQueNaoVale: tudoZero ? diferencaGravada : null,
    naoConferidas,
    esperadoNasFormas,
    online,
    total,
  };
}

/** A frase do "sem conferência", pelo motivo. */
export function porQueSemConferencia(motivo: ConferenciaGravada["motivo"]): string {
  if (motivo === "ABRIU_OUTRO") return "O caixa foi encerrado sozinho quando outro caixa foi aberto: ninguém contou a gaveta.";
  if (motivo === "TUDO_ZERO") return "As cinco formas foram gravadas em zero: ninguém digitou a contagem. A \"falta\" gravada não aconteceu.";
  return "Fechado sem conferir: ninguém digitou a contagem.";
}

// ── O FECHAMENTO QUE CHEGA AGORA (api/cash-session, PUT) ─────────────────────

/**
 * O contado como a tela mandou: número, ou null para a forma deixada em
 * branco. A tela antiga (aberta antes da atualização, sem F5) manda 0 no
 * branco — esse continua valendo como "contei zero", como sempre valeu.
 */
export function lerContado(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const brl = (v: number) => `R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * O aviso de "Caixa Fechado" no WhatsApp do dono.
 *
 * Era "Diferença no caixa: R$ -274,32" — sem dizer se faltou ou sobrou, contra
 * o quê, nem quanto o turno vendeu; e o caixa que ninguém contou chegava como
 * falta do tamanho do esperado (Ragnar, 10/10: "R$ -7.369,37"). O dono lê no
 * celular e decide se liga para a loja: a mensagem diz o que aconteceu.
 */
export function mensagemDoCaixaFechado(e: {
  loja: string;
  fechadoAs: string;
  abertoAs?: string | null;
  esperado: Record<ChaveDaConferencia, number>;
  contado: Record<ChaveDaConferencia, number | null>;
  trocoInicial: number;
  online: number;
  vendas?: { qtd: number; valor: number } | null;
}): string {
  const { diferenca, semConferencia, naoConferidas } = conferirFechamento(e.esperado, e.contado);
  const contadas = FORMAS_DA_CONFERENCIA.filter((f) => e.contado[f.chave] != null);
  const esperadoConferido = c2(contadas.reduce((t, f) => t + (e.esperado[f.chave] || 0), 0));
  const contado = c2(contadas.reduce((t, f) => t + (e.contado[f.chave] as number), 0));
  const comTroco = e.contado.cash != null && e.trocoInicial > 0.005 ? ` (com ${brl(e.trocoInicial)} de troco inicial)` : "";
  const linhas: string[] = [
    "🔴 *Caixa Fechado*",
    "",
    `Olá chefe! O caixa da loja *${e.loja || "sua loja"}* acabou de ser *FECHADO* às ${e.fechadoAs}${e.abertoAs ? ` (aberto às ${e.abertoAs})` : ""}.`,
    "",
  ];
  if (semConferencia) {
    const esperado = c2(FORMAS_DA_CONFERENCIA.reduce((t, f) => t + (e.esperado[f.chave] || 0), 0));
    linhas.push("⚪ *Fechado SEM conferir a gaveta* — ninguém digitou a contagem, então não há falta nem sobra registrada.");
    linhas.push(`O sistema esperava ${brl(esperado)} em dinheiro, cartões e Pix${e.trocoInicial > 0.005 ? ` (com ${brl(e.trocoInicial)} de troco inicial)` : ""}.`);
  } else {
    const d = diferenca ?? 0;
    linhas.push(Math.abs(d) < 0.01 ? "✅ *Conferiu certinho.*" : d < 0 ? `⚠️ *Faltou ${brl(d)}* na conferência.` : `💰 *Sobrou ${brl(d)}* na conferência.`);
    linhas.push(`Esperado nas formas contadas: ${brl(esperadoConferido)}${comTroco}`);
    linhas.push(`Contado: ${brl(contado)}`);
    if (naoConferidas.length > 0) {
      linhas.push(`Não conferido (ficou em branco): ${naoConferidas.map((l) => `${l.nome} ${brl(l.esperado)}`).join(", ")}.`);
    }
  }
  linhas.push("");
  if (e.vendas && e.vendas.qtd > 0) linhas.push(`🧾 Vendas do turno: ${brl(e.vendas.valor)} (${e.vendas.qtd} ${e.vendas.qtd === 1 ? "venda" : "vendas"})`);
  if (e.online > 0.005) linhas.push(`📲 Pago no app/site e cobrado pelo entregador do app (não passa pela gaveta): ${brl(e.online)}`);
  linhas.push("", "_Ass: Seu Assistente FireHub 🔥_");
  return linhas.join("\n");
}

/**
 * A conferência de um fechamento: a diferença é só das formas contadas, contra
 * o esperado delas (o online é travado e fica fora dos dois lados). Sem
 * nenhuma forma com valor contada, não há conferência: diferença nula.
 */
export function conferirFechamento(
  esperado: Record<ChaveDaConferencia, number>,
  contado: Record<ChaveDaConferencia, number | null>,
): { diferenca: number | null; semConferencia: boolean; naoConferidas: { chave: ChaveDaConferencia; nome: string; esperado: number }[] } {
  const linhas = FORMAS_DA_CONFERENCIA.map((f) => ({ chave: f.chave, nome: f.nome, esperado: esperado[f.chave] || 0, contado: contado[f.chave] }));
  const naoConferidas = linhas.filter((l) => l.contado == null && Math.abs(l.esperado) > 0.005).map(({ chave, nome, esperado: e }) => ({ chave, nome, esperado: c2(e) }));
  const contouAlgo = linhas.some((l) => l.contado != null && (Math.abs(l.contado) > 0.005 || Math.abs(l.esperado) > 0.005));
  const semConferencia = !contouAlgo && naoConferidas.length > 0;
  const diferenca = semConferencia
    ? null
    : c2(linhas.filter((l) => l.contado != null).reduce((t, l) => t + (l.contado as number) - l.esperado, 0));
  return { diferenca, semConferencia, naoConferidas };
}
