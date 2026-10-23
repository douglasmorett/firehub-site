/**
 * NOVIDADE DA LOJA — "alguma coisa da fila/painel mudou nesta loja desde X?"
 * respondido pela memória do processo, sem ir ao banco.
 *
 * Por que existe: no pico (sábado 17/10/2026, 19h–22h) o servidor recebia ~68
 * chamadas/s, quase todas perguntas repetidas de "tem novidade?" — fila do
 * Assistente a cada 3 s, painel de pedidos, avisos, acréscimos, transferências.
 * O perfil de 23/10 (60 s em produção) mostrou ~40 ms de CPU por chamada, e o
 * grosso é a consulta em si (motor do Prisma + o laço do Node), não a regra.
 * Quase todas essas perguntas voltam "nada": a resposta já estava guardada.
 *
 * Como funciona:
 *   • toda gravação de pedido, item, impressão avulsa, acréscimo ou
 *     transferência passa por lib/prisma.ts, que chama `marcarNovidade` com a
 *     loja (ou sem loja = "pode ter sido qualquer uma");
 *   • quem responde a pergunta repetida guarda a resposta junto com a hora em
 *     que foi ao banco; enquanto nenhuma novidade da loja chegou depois dessa
 *     hora, devolve a guardada.
 *
 * As duas travas que tornam isso seguro:
 *   • PRAZO: a guardada vale no máximo `PRAZO_MS` (15 s). Gravação que não
 *     passe pelo lib/prisma.ts (script no banco, outro processo, uma segunda
 *     instância) aparece com até 15 s de atraso — nunca se perde;
 *   • DEPOIS DO COMMIT: dentro de uma transação a gravação marca antes de o
 *     commit existir. Por isso cada marca se repete 2 s e 8 s depois — uma
 *     leitura que entrou no meio da transação fica inválida quando o commit
 *     já aconteceu.
 */

/** Quanto tempo uma resposta guardada vale, mesmo sem novidade nenhuma. */
export const PRAZO_MS = 15_000;
/** As repetições da marca, para a gravação que estava dentro de uma transação. */
const REPETIR_EM_MS = [2_000, 8_000];

const ultimaPorLoja = new Map<string, number>();
// O processo acabou de subir: tudo conta como "pode ter mudado".
let ultimaGeral = Date.now();

function marcarAgora(lojaId: string | null) {
  const agora = Date.now();
  if (lojaId) ultimaPorLoja.set(lojaId, agora);
  else ultimaGeral = agora;
}

/** Algo da loja mudou. Sem loja (gravação em lote, SQL direto): vale para todas. */
export function marcarNovidade(lojaId?: string | null) {
  const loja = typeof lojaId === "string" && lojaId ? lojaId : null;
  marcarAgora(loja);
  for (const ms of REPETIR_EM_MS) {
    const t = setTimeout(() => marcarAgora(loja), ms);
    (t as { unref?: () => void }).unref?.();
  }
}

/** A hora (ms) da última novidade que vale para alguma destas lojas. */
export function ultimaNovidade(lojaIds: readonly string[]): number {
  let ultima = ultimaGeral;
  for (const id of lojaIds) {
    const t = ultimaPorLoja.get(id);
    if (t !== undefined && t > ultima) ultima = t;
  }
  return ultima;
}

/** Nada mudou nestas lojas desde `desde` (ms)? */
export function nadaMudouDesde(lojaIds: readonly string[], desde: number): boolean {
  return ultimaNovidade(lojaIds) < desde;
}

type Guardada = { lidaEm: number; valor: unknown };
const guardadas = new Map<string, Guardada>();
const LIMITE_DE_GUARDADAS = 2_000;

/**
 * A resposta de `ler` para `chave`, reaproveitada enquanto nenhuma das
 * `lojaIds` teve novidade e o prazo não venceu. Cada chamada recebe uma
 * CÓPIA — quem mexer no objeto não mexe no guardado.
 *
 * `guardar` decide se o resultado pode ser guardado (ex.: só a fila vazia).
 * Erro em `ler` não guarda nada.
 */
export async function lerEnquantoNadaMuda<T>(
  chave: string,
  lojaIds: readonly string[],
  ler: () => Promise<T>,
  guardar: (valor: T) => boolean = () => true,
): Promise<T> {
  const agora = Date.now();
  const g = guardadas.get(chave);
  if (g && agora - g.lidaEm < PRAZO_MS && nadaMudouDesde(lojaIds, g.lidaEm)) {
    return structuredClone(g.valor) as T;
  }
  // A hora é anotada ANTES de ir ao banco: novidade gravada durante a leitura
  // fica depois dela e invalida o que for guardado.
  const lidaEm = Date.now();
  const valor = await ler();
  if (guardar(valor)) {
    if (guardadas.size >= LIMITE_DE_GUARDADAS) guardadas.clear();
    guardadas.set(chave, { lidaEm, valor: structuredClone(valor) });
  } else {
    guardadas.delete(chave);
  }
  return valor;
}

/** Só para teste. */
export function esquecerTudoDaNovidade() {
  ultimaPorLoja.clear();
  guardadas.clear();
  ultimaGeral = Date.now();
}

// ── QUEM GRAVA O QUÊ (usado por lib/prisma.ts) ──────────────────────────────

/** Os modelos cuja gravação conta como novidade para a fila e o painel. */
export const MODELOS_VIGIADOS = new Set(["CustomerOrder", "CustomerOrderItem", "PrintRequest"]);

const OPERACOES_QUE_GRAVAM = new Set([
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany", "updateManyAndReturn",
  "upsert", "delete", "deleteMany",
]);

export function operacaoGrava(operacao: string): boolean {
  return OPERACOES_QUE_GRAVAM.has(operacao);
}

/** SQL direto que grava numa tabela vigiada (inclui as que só existem por SQL). */
const SQL_QUE_GRAVA =
  /\b(?:insert\s+into|update|delete\s+from)\s+"?(?:CustomerOrder|CustomerOrderItem|PrintRequest|AcrescimoDoPedido|TransferenciaDoPedido)"?(?![A-Za-z])/i;

/** O texto de um SQL direto, como o Prisma entrega ao `query` do $extends. */
export function textoDoSql(args: unknown): string {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) {
    const primeiro = args[0];
    if (typeof primeiro === "string") return primeiro;
    if (Array.isArray(primeiro)) return primeiro.join("?");
    return "";
  }
  if (args && typeof args === "object") {
    const a = args as { strings?: unknown; sql?: unknown; text?: unknown };
    if (Array.isArray(a.strings)) return a.strings.join("?");
    if (typeof a.sql === "string") return a.sql;
    if (typeof a.text === "string") return a.text;
  }
  return "";
}

export function sqlGravaNaFila(args: unknown): boolean {
  return SQL_QUE_GRAVA.test(textoDoSql(args));
}

/**
 * A loja de uma gravação, quando dá para saber sem consulta: o
 * `franchiseeId` do resultado, do `data` ou do `where`. Sem isso, null
 * ("pode ser qualquer loja").
 */
export function lojaDaGravacao(args: unknown, resultado: unknown): string | null {
  const daqui = (o: unknown): string | null => {
    const v = o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>).franchiseeId : undefined;
    return typeof v === "string" && v ? v : null;
  };
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  return daqui(resultado) || daqui(a.data) || daqui(a.create) || daqui(a.where);
}
