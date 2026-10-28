import crypto from "crypto";
import { NextResponse } from "next/server";
import { anotarUsoLegado } from "@/lib/uso-legado";

/**
 * /src/lib/token-do-assistente.ts
 *
 * Credencial do Assistente de Impressão na fila da nuvem
 * (GET/POST /api/store/print-queue e POST /api/store/print-queue/ack).
 *
 * ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
 *
 * As três rotas escolhiam a loja pelo `franchiseeId`, e esse id NÃO é segredo:
 * vai no HTML de todo cardápio público. Qualquer um lia o pedido inteiro do
 * cliente (nome, telefone, endereço) pelo GET, enfileirava comanda falsa pelo
 * POST e calava a impressão pelo /ack.
 *
 * Agora a tela de Impressoras (e a faixa "Vincular agora" do painel) entrega
 * ao Assistente um token da loja ASSINADO com a chave das sessões
 * (`<lojaId>.<assinatura>`, mesmo desenho do token da extensão em
 * lib/extensao-token.ts, com prefixo próprio para um não valer pelo outro).
 * O Assistente 1.2.46+ manda o token no cabeçalho `x-firehub-assistente` em
 * toda chamada à fila da nuvem.
 *
 * ── DUAS FASES ──────────────────────────────────────────────────────────────
 *
 * Fase 1 (agora): token inválido ou de OUTRA loja → 403. Sem token → passa
 * como sempre (Assistente 1.2.45 e antes, navegador do painel, celular), e
 * fica contado/registrado em `semTokenDoAssistente`.
 *
 * Fase 2: `EXIGIR_TOKEN_DO_ASSISTENTE = true`. Ver o comentário da constante.
 * Até lá a sessão da loja (navegador do painel) já conta como credencial no
 * POST e no /ack (src/lib/sessao-da-loja-na-fila.ts).
 *
 * ── CONTINGÊNCIA ────────────────────────────────────────────────────────────
 *
 * O FireHub local (contingencia/supervisor/firehub-local.ts) roda com
 * FIREHUB_LOCAL=1 e com OUTRO NEXTAUTH_SECRET, gerado no computador da loja: o
 * token da nuvem nunca confere lá. Por isso no FireHub local o token é
 * ignorado (o servidor só escuta em 127.0.0.1) e a rota do token não entrega
 * token nenhum. O Assistente também não manda o token para a fila local.
 */

/**
 * Liga a exigência do token nas três rotas da fila.
 *
 * Credencial válida (fase 2 em diante): token do Assistente da loja OU, no
 * POST e no /ack, a SESSÃO do painel da loja (reimpressão e confirmação que o
 * navegador faz — ver `sessaoValeComoCredencial`). Sem nenhum dos dois: hoje
 * passa e conta; ligado, 401.
 *
 * O painel aberto entrega o token sozinho ao Assistente 1.2.46+ que está sem
 * ele (lib/print.ts, `deveMandarTokenAoAssistente`).
 *
 * CRITÉRIO PARA LIGAR: o log `[Fila sem token] ... sessao=nao` ZERADO por 2
 * dias seguidos de operação (todas as lojas, rotas fila/ack/reimpressao).
 * `sessao=sim` não conta: são chamadas do navegador com sessão da loja, que
 * continuam aceitas. Ligar com `sessao=nao` aparecendo PARA A IMPRESSÃO da
 * loja que aparece.
 */
export const EXIGIR_TOKEN_DO_ASSISTENTE = false;

/** Cabeçalho em que o Assistente manda o token. */
export const CABECALHO_DO_TOKEN_DO_ASSISTENTE = "x-firehub-assistente";

/** Marca no corpo do 403: o Assistente 1.2.46+ larga o token ao ver isto. */
export const RECUSA_DO_TOKEN = "token-do-assistente-recusado";

function chave(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar o token do Assistente.");
  return s;
}

function assinar(lojaId: string): string {
  return crypto.createHmac("sha256", chave()).update(`assistente:${lojaId}`).digest("hex").slice(0, 32);
}

/** Token entregue ao Assistente da loja: `<lojaId>.<assinatura>`. */
export function criarTokenDoAssistente(lojaId: string): string {
  return `${lojaId}.${assinar(lojaId)}`;
}

/** No FireHub local da contingência o token da nuvem não confere (outra chave). */
export function ehFirehubLocal(): boolean {
  return process.env.FIREHUB_LOCAL === "1";
}

export type ConferenciaDoToken = "valido" | "invalido" | "ausente" | "local";

/** Confere o token recebido contra a loja que a chamada pede. */
export function conferirTokenDoAssistente(token: string | null | undefined, lojaId: string | null | undefined): ConferenciaDoToken {
  const bruto = String(token || "").trim();
  if (!bruto) return "ausente";
  if (ehFirehubLocal()) return "local";
  const ponto = bruto.lastIndexOf(".");
  if (ponto <= 0 || bruto.length > 200) return "invalido";
  const doToken = bruto.slice(0, ponto);
  const assinatura = bruto.slice(ponto + 1);
  if (!lojaId || doToken !== lojaId) return "invalido";
  let esperada: string;
  try {
    esperada = assinar(doToken);
  } catch {
    // Sem a chave não há como conferir. Nunca derruba a impressão por isso.
    return "ausente";
  }
  const a = Buffer.from(esperada);
  const b = Buffer.from(assinatura);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? "valido" : "invalido";
}

// ── Contador das chamadas sem token ─────────────────────────────────────────
// Em memória (por processo) e com log de no máximo uma linha por loja e rota a
// cada 30 min: o GET roda a cada 3 s por loja, e um log por consulta afogaria
// o resto. É o que diz quando a fase 2 pode ser ligada.

const INTERVALO_DO_LOG_MS = 30 * 60_000;
const contagem = new Map<string, { vezes: number; logadoEm: number }>();

/** Quantas chamadas sem token cada `rota|loja|sessao` teve neste processo. */
export function semTokenDoAssistente(): ReadonlyMap<string, { vezes: number; logadoEm: number }> {
  return contagem;
}

function anotarSemToken(rota: string, lojaId: string, comSessao: boolean, agora = Date.now()) {
  const k = `${rota}|${lojaId}|${comSessao ? "sim" : "nao"}`;
  const c = contagem.get(k) || { vezes: 0, logadoEm: 0 };
  c.vezes++;
  if (agora - c.logadoEm >= INTERVALO_DO_LOG_MS) {
    console.log(`[Fila sem token] rota=${rota} loja=${lojaId} sessao=${comSessao ? "sim" : "nao"} chamadas=${c.vezes}`);
    c.logadoEm = agora;
  }
  contagem.set(k, c);
  // No banco, por loja e dia (lib/uso-legado.ts): o log zera a cada deploy.
  anotarUsoLegado("assistente-sem-token", lojaId, `rota=${rota} sessao=${comSessao ? "sim" : "nao"}`);
  // Teto de memória: muitas lojas × rotas cabem; lixo de id inventado não cresce sem fim.
  if (contagem.size > 5000) contagem.delete(contagem.keys().next().value as string);
}

/** Cookie de sessão do NextAuth presente (é o navegador do painel, não o Assistente). */
function temCookieDeSessao(cabecalhos: Headers): boolean {
  return /(^|;\s*)(__Secure-)?next-auth\.session-token(\.\d+)?=/.test(cabecalhos.get("cookie") || "");
}

/**
 * A sessão do painel vale como credencial da loja pedida? A loja da conta
 * (`ownerId || id`) ou, para quem não é funcionário, uma loja do mesmo grupo
 * (`grupo`, de lib/loja-ativa.ts `lojasDoGrupo`): em "Todas as lojas" a
 * sessão fica na principal e o navegador confirma pedidos das filiais com o
 * franchiseeId do pedido. Mesma regra do `?loja=` de api/store/printer-config.
 */
export function sessaoValeComoCredencial(
  conta: { id: string; ownerId?: string | null; role?: string | null } | null | undefined,
  lojaId: string | null | undefined,
  grupo: readonly string[] = [],
): boolean {
  if (!conta?.id || !lojaId) return false;
  if ((conta.ownerId || conta.id) === lojaId) return true;
  if (String(conta.role || "").toUpperCase() === "STAFF") return false;
  return grupo.includes(lojaId);
}

/**
 * A porta das três rotas da fila. Devolve a resposta de recusa (403/401) ou
 * `null` para seguir como sempre.
 *
 * `sessaoDaLoja` (POST e /ack): confere a sessão do painel só quando não veio
 * token e há cookie de sessão — o Assistente nunca paga essa consulta.
 */
export async function barrarChamadaDaFila(
  cabecalhos: Headers,
  lojaId: string | null | undefined,
  rota: "fila" | "reimpressao" | "ack",
  sessaoDaLoja?: () => Promise<boolean>,
): Promise<NextResponse | null> {
  const conferencia = conferirTokenDoAssistente(cabecalhos.get(CABECALHO_DO_TOKEN_DO_ASSISTENTE), lojaId);
  if (conferencia === "valido" || conferencia === "local") return null;
  if (conferencia === "invalido") {
    console.warn(`[Fila] token do Assistente recusado: rota=${rota} loja=${lojaId || "-"}`);
    return NextResponse.json({ error: "Credencial do Assistente inválida para esta loja.", motivo: RECUSA_DO_TOKEN }, { status: 403 });
  }
  if (ehFirehubLocal()) return null;
  let comSessao = false;
  if (sessaoDaLoja && temCookieDeSessao(cabecalhos)) {
    try { comSessao = await sessaoDaLoja(); } catch { comSessao = false; }
  }
  // `sessao=sim` = sessão da própria loja (vale como credencial); `nao` = o
  // que a fase 2 recusa.
  anotarSemToken(rota, String(lojaId || "-"), comSessao);
  if (comSessao) return null;
  if (EXIGIR_TOKEN_DO_ASSISTENTE) {
    return NextResponse.json({ error: "Credencial do Assistente ausente. Abra Impressoras no painel e salve." }, { status: 401 });
  }
  return null;
}
