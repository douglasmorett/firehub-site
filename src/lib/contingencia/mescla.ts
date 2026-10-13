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
