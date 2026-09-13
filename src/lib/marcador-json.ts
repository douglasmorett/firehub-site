/**
 * /src/lib/marcador-json.ts
 *
 * Tira o JSON de um marcador que o modelo escreve na resposta:
 * `[[PEDIDO_IA: {...}]]`, `[[ACRESCIMO_PEDIDO: {...}]]`. Sem banco e sem rede:
 * é provado por scripts/teste-marcador-json.mjs.
 *
 * Era um bloco dentro de chatbot-ai.ts, só para o PEDIDO_IA. Saiu para cá
 * quando o acréscimo precisou do mesmo cuidado — duas cópias do balanceamento
 * iam divergir no primeiro conserto.
 *
 * ── Por que balancear, e não `lastIndexOf("}")` ─────────────────────────────
 *
 * O `lastIndexOf("}")` antigo pegava qualquer `}` posterior do texto quando o
 * `]]` faltava, e o "reparo" fixo `+"}]}]}"` só fechava um formato específico
 * de truncamento. Aqui chaves e colchetes são contados de verdade, respeitando
 * strings; resposta cortada no meio tem o rabo incompleto descartado e o que a
 * pilha diz que ficou aberto é fechado — na ordem certa.
 */

export type JsonDoMarcador = {
  /** O JSON cru, pronto para JSON.parse (vazio quando o marcador não existe). */
  json: string;
  /** A resposta veio cortada e o JSON foi fechado à força. */
  truncado: boolean;
  /** Quantos fechamentos o reparo acrescentou. */
  fechamentos: number;
};

export function extrairJsonDoMarcador(texto: string, marcador: string): JsonDoMarcador {
  const vazio = { json: "", truncado: false, fechamentos: 0 };
  const nome = marcador.replace(/[^A-Z0-9_]/gi, "");
  const m = String(texto || "").match(new RegExp(`\\[\\[\\s*${nome}\\b`, "i"));
  if (!m || m.index === undefined) return vazio;

  const aposMarcador = texto.substring(m.index);
  const jsonStart = aposMarcador.indexOf("{");
  if (jsonStart === -1) return vazio;

  let fim = -1;
  const pilha: string[] = [];
  let emString = false;
  let escapado = false;
  for (let i = jsonStart; i < aposMarcador.length; i++) {
    const ch = aposMarcador[i];
    if (escapado) { escapado = false; continue; }
    if (ch === "\\") { escapado = true; continue; }
    if (ch === '"') { emString = !emString; continue; }
    if (emString) continue;
    if (ch === "{") pilha.push("}");
    else if (ch === "[") pilha.push("]");
    else if (ch === "}" || ch === "]") {
      pilha.pop();
      if (pilha.length === 0) { fim = i; break; }
    }
  }

  if (fim !== -1) return { json: aposMarcador.substring(jsonStart, fim + 1), truncado: false, fechamentos: 0 };

  let parcial = aposMarcador
    .substring(jsonStart)
    .replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}\[\]]*$/, "")
    .replace(/,\s*$/, "");
  if (emString) parcial += '"';
  return { json: parcial + pilha.reverse().join(""), truncado: true, fechamentos: pilha.length };
}

/**
 * Tira o marcador do texto que o cliente lê: do "[[NOME" até o "]]" que o
 * fecha; sem "]]" (truncado), até o fim — não há texto legítimo depois de um
 * JSON que nem terminou.
 */
export function removerMarcador(texto: string, marcador: string): string {
  const nome = marcador.replace(/[^A-Z0-9_]/gi, "");
  const inicio = String(texto || "").search(new RegExp(`\\[\\[\\s*${nome}\\b`, "i"));
  if (inicio === -1) return texto;
  const fechamento = texto.indexOf("]]", inicio);
  return (texto.substring(0, inicio) + (fechamento !== -1 ? texto.substring(fechamento + 2) : "")).trim();
}
