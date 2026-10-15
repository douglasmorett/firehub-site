/**
 * A VOLTA da contingência, linha por linha: o que a loja fez durante a queda
 * contra o que está na nuvem agora. Sem banco — a rota de subida
 * (app/api/contingencia/subida) busca a linha da nuvem e executa a decisão.
 *
 * As regras (Obsidian: Projetos/FireHub - Modo Contingência.md, item 6):
 *   - linha nova da loja entra (o id é cuid, não colide com nada);
 *   - coluna que só a loja mudou vai como a loja deixou;
 *   - coluna que a loja E a nuvem mudaram: estoque SOMA a diferença, o
 *     contador do número do pedido fica com o MAIOR, e o resto VALE A LOJA —
 *     com o conflito anotado para o painel mostrar;
 *   - linha que a loja apagou sai da nuvem (se a nuvem tinha mudado, anota);
 *   - coluna que não desce (senha, chave de fora) nunca sobe: no computador
 *     ela é um enfeite.
 */
import type { TabelaDaCopia } from "./catalogo";

export type LinhaDaSaida = {
  seq: string;
  tabela: string;
  registro: string;
  operacao: "INSERT" | "UPDATE" | "DELETE";
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
};

export type Conflito = { coluna: string | null; valorDaLoja: unknown; valorDaNuvem: unknown; decisao: string };

export type Decisao =
  | { tipo: "inserir"; linha: Record<string, unknown>; conflitos: Conflito[] }
  | { tipo: "atualizar"; mudar: Record<string, unknown>; conflitos: Conflito[] }
  | { tipo: "apagar"; conflitos: Conflito[] }
  | { tipo: "nada"; motivo: string }
  | { tipo: "recusar"; motivo: string };

/** Colunas que mudam sozinhas e nunca contam como conflito. */
const SEM_CONFLITO = new Set(["updatedAt"]);

/** Igualdade de valores vindos de `to_jsonb` (objeto com chaves em outra ordem é igual). */
export function iguais(a: unknown, b: unknown): boolean {
  return canonico(a) === canonico(b);
}

function canonico(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
}

function semProibidas(linha: Record<string, unknown>, proibidas: Set<string>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) if (!proibidas.has(k)) saida[k] = v;
  return saida;
}

/**
 * @param naNuvem a linha como está na nuvem agora (`null` = não existe).
 * @param proibidas colunas que nunca sobem (as que não descem).
 */
export function decidir(
  t: TabelaDaCopia,
  s: LinhaDaSaida,
  naNuvem: Record<string, unknown> | null,
  proibidas: Set<string>,
): Decisao {
  const chave = new Set(t.chave);

  if (s.operacao === "DELETE") {
    if (!naNuvem) return { tipo: "nada", motivo: "já não existia na nuvem" };
    const mudou = s.antes && Object.keys(naNuvem).some((k) => !SEM_CONFLITO.has(k) && !proibidas.has(k) && !iguais(naNuvem[k], s.antes![k]));
    return {
      tipo: "apagar",
      conflitos: mudou ? [{ coluna: null, valorDaLoja: null, valorDaNuvem: naNuvem, decisao: "apagada pela loja; a nuvem tinha mudado a linha" }] : [],
    };
  }

  const depois = s.depois || {};
  if (!naNuvem) {
    if (t.semLinhaNova) return { tipo: "recusar", motivo: `${t.nome}: a contingência não cria linha nova` };
    const conflitos: Conflito[] =
      s.operacao === "UPDATE"
        ? [{ coluna: null, valorDaLoja: depois, valorDaNuvem: null, decisao: "a nuvem tinha apagado; a loja mudou e a linha voltou" }]
        : [];
    return { tipo: "inserir", linha: semProibidas(depois, proibidas), conflitos };
  }

  // INSERT de uma linha que a nuvem já tem: vale como mudança sem "antes"
  // (cada coluna diferente é um conflito, e vale a loja).
  const antes = s.operacao === "INSERT" ? null : s.antes;
  const mudar: Record<string, unknown> = {};
  const conflitos: Conflito[] = [];
  // O pulso do Assistente (User.printQueuePolledAt a cada consulta da fila) é
  // do computador, não da loja: não sobe nem vira conflito.
  const ignorar = new Set(t.ignorarMudancaDe || []);
  for (const [coluna, valorDaLoja] of Object.entries(depois)) {
    if (chave.has(coluna) || proibidas.has(coluna)) continue;
    if (ignorar.has(coluna) && !SEM_CONFLITO.has(coluna)) continue;
    if (antes && iguais(antes[coluna], valorDaLoja)) continue; // a loja não mexeu
    const valorDaNuvem = naNuvem[coluna];
    if (iguais(valorDaNuvem, valorDaLoja)) continue; // os dois chegaram ao mesmo
    if (SEM_CONFLITO.has(coluna) || (antes && iguais(valorDaNuvem, antes[coluna]))) {
      mudar[coluna] = valorDaLoja; // só a loja mexeu
      continue;
    }
    const regra = t.mescla?.[coluna];
    if (regra === "soma" && antes && typeof valorDaLoja === "number" && typeof valorDaNuvem === "number" && typeof antes[coluna] === "number") {
      mudar[coluna] = valorDaNuvem + (valorDaLoja - (antes[coluna] as number));
      continue;
    }
    if (regra === "maior" && typeof valorDaLoja === "number" && typeof valorDaNuvem === "number") {
      mudar[coluna] = Math.max(valorDaLoja, valorDaNuvem);
      continue;
    }
    mudar[coluna] = valorDaLoja;
    conflitos.push({ coluna, valorDaLoja, valorDaNuvem, decisao: "a loja e a nuvem mudaram; valeu a loja" });
  }
  if (!Object.keys(mudar).length) return { tipo: "nada", motivo: "nada a mudar" };
  // Sobrou só o updatedAt que a consulta da fila carimbou: centenas de linhas
  // assim por queda, e nenhuma é mudança da loja.
  if (Object.keys(mudar).every((c) => ignorar.has(c))) return { tipo: "nada", motivo: "só o pulso do Assistente" };
  return { tipo: "atualizar", mudar, conflitos };
}

// ── A linha que o banco da nuvem não aceita ─────────────────────────────────
//
// A subida era tudo-ou-nada: uma linha com erro de SQL (o pedido apontando
// para a rota que nunca subiu, um NOT NULL, um único) desfazia o lote inteiro,
// a rota respondia 500 e o computador ficava em "voltando" para sempre — as
// telas presas numa cópia congelada. Agora cada linha roda num SAVEPOINT
// (subida-linha-a-linha.ts) e estas regras dizem o que fazer com a que falhou.

/** O código do Postgres (SQLSTATE) e a mensagem, venha o erro do Prisma ($executeRawUnsafe → P2010) ou do pg. */
export function erroDoBanco(e: unknown): { codigo: string | null; mensagem: string; texto: string } {
  const x = (e || {}) as {
    code?: unknown;
    meta?: { code?: unknown; message?: unknown; field_name?: unknown };
    message?: unknown;
    detail?: unknown;
    constraint?: unknown;
  };
  const textos = [x.meta?.message, x.message, x.detail, x.constraint, x.meta?.field_name].filter((t): t is string => typeof t === "string" && !!t);
  const texto = textos.join(" | ") || String(e);
  // "P2010"/"P2003" são códigos do Prisma, não do Postgres (que só usa P0001–P0004).
  const sqlstate = (v: unknown) => (typeof v === "string" && /^[0-9A-Z]{5}$/.test(v) && !/^P[1-9]\d{3}$/.test(v) ? v : null);
  // P2003 = o Prisma já traduziu a chave estrangeira (o nome da restrição vem em meta.field_name).
  const codigo =
    sqlstate(x.meta?.code) ?? sqlstate(x.code) ?? /Code: `([0-9A-Z]{5})`/.exec(texto)?.[1] ?? (x.code === "P2003" ? "23503" : null);
  // A mensagem do Prisma começa com "Invalid `prisma.$executeRawUnsafe()` invocation": o que interessa é a do Postgres.
  const doPostgres = /Message: `(?:ERROR: )?([^`]+)`/.exec(texto)?.[1];
  // No Prisma de verdade (P2010) a mensagem é SÓ o DETAIL ("Failing row
  // contains (…)"), sem a frase do erro: tirado o dado do cliente, não sobra
  // nada — aí o código diz o que houve (visto num Postgres 17 em 15/10).
  const mensagem = (semDadoDoCliente((doPostgres || textos[0] || texto).replace(/\s+/g, " ").trim()) || oQueOCodigoDiz(codigo)).slice(0, 300);
  return { codigo, mensagem, texto };
}

/** O que o código do Postgres quer dizer, quando a mensagem não diz nada sem o dado do cliente. */
function oQueOCodigoDiz(codigo: string | null): string {
  const porCodigo: Record<string, string> = {
    "23502": "campo obrigatório vazio",
    "23503": "a linha-pai não está na nuvem",
    "23505": "valor repetido onde não pode repetir",
    "23514": "valor fora da regra do banco",
  };
  if (codigo && porCodigo[codigo]) return porCodigo[codigo];
  if (codigo?.startsWith("22")) return "valor inválido para a coluna";
  return "recusada pelo banco da nuvem";
}

/**
 * A `mensagem` vai para o log da nuvem (Coolify), o log do computador e o
 * painel. O Prisma junta o DETAIL do Postgres na mensagem, e o DETAIL traz os
 * VALORES da linha: "Failing row contains (… nome, telefone, endereço …)" no
 * NOT NULL, "Key (phone)=(119…)" no único. Fica só o que o banco disse, sem
 * os valores. (O `texto` inteiro segue só para achar a coluna da chave
 * estrangeira, e não é gravado em lugar nenhum.)
 */
function semDadoDoCliente(m: string): string {
  // Também em português: o Postgres local responde no idioma do Windows
  // ("DETALHE: Registro que falhou contém (…)").
  return m
    .replace(/\s*(\bDETAIL\b|\bDETALHE\b|\bHINT\b|\bDICA\b|\bFailing row contains\b|\bRegistro que falhou cont[ée]m)[\s\S]*$/i, "")
    .replace(/\)=\([^)]*\)/g, ")=(…)")
    .trim();
}

/** 23503 = chave estrangeira violada (a linha-pai não existe na nuvem). */
const CHAVE_ESTRANGEIRA = "23503";

export type OQueFazerComOErro =
  | { tipo: "anular"; coluna: string }
  | { tipo: "recusar"; motivo: string };

/**
 * A linha falhou na nuvem. Se foi chave estrangeira numa coluna anulável que a
 * tabela declara (`paiQuePodeFaltar`) e a linha tem valor nela, tenta de novo
 * com a coluna vazia — o pedido sobe sem a rota, e não deixa de subir. Senão,
 * a linha é recusada (vira conflito "recusada" no painel) e as outras seguem.
 *
 * @param jaAnuladas colunas que já foram esvaziadas nas tentativas anteriores desta linha.
 */
export function oQueFazerComOErro(
  t: TabelaDaCopia | undefined,
  s: LinhaDaSaida,
  erro: unknown,
  jaAnuladas: string[] = [],
): OQueFazerComOErro {
  const { codigo, mensagem, texto } = erroDoBanco(erro);
  const motivo = codigo ? `erro ${codigo}: ${mensagem}` : mensagem;
  if (!t || codigo !== CHAVE_ESTRANGEIRA || s.operacao === "DELETE" || !s.depois) return { tipo: "recusar", motivo };
  for (const coluna of t.paiQuePodeFaltar || []) {
    if (jaAnuladas.includes(coluna) || t.chave.includes(coluna)) continue;
    const valor = s.depois[coluna];
    if (valor === null || valor === undefined) continue;
    // O Prisma nomeia a restrição "<Tabela>_<coluna>_fkey"; o Postgres conta a coluna em "Key (<coluna>)=(…)".
    if (texto.includes(`${t.nome}_${coluna}_fkey`) || texto.includes(`(${coluna})=`)) return { tipo: "anular", coluna };
  }
  return { tipo: "recusar", motivo };
}

/**
 * A mesma linha da saída SEM a coluna (a tentativa seguinte de
 * `oQueFazerComOErro`). Tirar, e não pôr null: na linha nova a coluna fica
 * vazia do mesmo jeito (o INSERT só grava as colunas que vieram); na linha que
 * a nuvem já tem, `decidir` não mexe nela e o valor da nuvem fica — com null,
 * o pedido que a loja trocou para a rota que não subiu perderia também a rota
 * boa que tinha na nuvem.
 */
export function comColunaVazia(s: LinhaDaSaida, coluna: string): LinhaDaSaida {
  if (!s.depois) return s;
  const depois = { ...s.depois };
  delete depois[coluna];
  return { ...s, depois };
}
