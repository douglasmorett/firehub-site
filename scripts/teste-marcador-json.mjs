/**
 * Prova da extração de JSON dos marcadores do robô ([[PEDIDO_IA]], [[ACRESCIMO_PEDIDO]]).
 *
 *   node scripts/teste-marcador-json.mjs
 *
 * A função saiu de dentro de chatbot-ai.ts. Para provar que a mudança de lugar
 * não mudou o comportamento, o bloco ORIGINAL está copiado abaixo, literal, e
 * as duas versões são comparadas em respostas inteiras e cortadas em cada
 * posição possível.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/marcador-json.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { extrairJsonDoMarcador, removerMarcador } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

// ── Cópia literal do bloco que existia em chatbot-ai.ts (PEDIDO_IA) ─────────
function original(textoOriginalDoModelo) {
  let rawJsonPayload = "";
  const m = textoOriginalDoModelo.match(/\[\[\s*PEDIDO_IA\b/i);
  if (m && m.index !== undefined) {
    const aposMarcador = textoOriginalDoModelo.substring(m.index);
    const jsonStart = aposMarcador.indexOf("{");
    if (jsonStart !== -1) {
      let fim = -1;
      const pilha = [];
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
      if (fim !== -1) {
        rawJsonPayload = aposMarcador.substring(jsonStart, fim + 1);
      } else {
        let parcial = aposMarcador
          .substring(jsonStart)
          .replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}\[\]]*$/, "")
          .replace(/,\s*$/, "");
        if (emString) parcial += '"';
        rawJsonPayload = parcial + pilha.reverse().join("");
      }
    }
  }
  return rawJsonPayload;
}

const resposta =
  'Perfeito, Gabi! Anotei tudo 😊 [[PEDIDO_IA: {"status": "NOVO", "items": [{"name": "Pastel de Carne", "quantity": 2, "options": ["Catupiry"]}, ' +
  '{"name": "Coca-Cola 2L", "quantity": 1}], "customerName": "Gabi", "address": "Rua {Nova} Friburgo, 264 \\"casa\\" ]] fundos", ' +
  '"paymentMethod": "Pix", "deliveryFee": 4.99, "totalAmount": 35.39, "finalized": true}]] Obrigada!';

console.log("\n1) Igual ao código antigo em toda posição de corte");
let divergencias = 0;
for (let corte = 0; corte <= resposta.length; corte++) {
  const trecho = resposta.slice(0, corte);
  if (original(trecho) !== extrairJsonDoMarcador(trecho, "PEDIDO_IA").json) divergencias++;
}
conferir(`${resposta.length + 1} cortes comparados, nenhuma divergência`, divergencias === 0, `${divergencias} divergência(s)`);

console.log("\n2) Resposta inteira");
const inteira = extrairJsonDoMarcador(resposta, "PEDIDO_IA");
let objeto = null;
try { objeto = JSON.parse(inteira.json); } catch {}
conferir("JSON completo faz parse", objeto !== null);
conferir("chave e colchete dentro de string não fecham o JSON", objeto?.address === 'Rua {Nova} Friburgo, 264 "casa" ]] fundos');
conferir("não marcou como truncado", inteira.truncado === false);

console.log("\n3) Resposta cortada no meio");
const cortada = extrairJsonDoMarcador('Anotei! [[PEDIDO_IA: {"items": [{"name": "Coca", "quantity": 2}, {"name": "Past', "PEDIDO_IA");
let reparado = null;
try { reparado = JSON.parse(cortada.json); } catch {}
conferir("JSON reparado faz parse", reparado !== null, cortada.json);
conferir("o item completo sobrevive", reparado?.items?.[0]?.name === "Coca");
conferir("marcou truncado e fechou objeto, lista e item abertos (3)", cortada.truncado === true && cortada.fechamentos === 3, JSON.stringify(cortada));

console.log("\n4) Marcadores diferentes na mesma resposta");
const duas = 'Vou conferir com a cozinha! [[ACRESCIMO_PEDIDO: {"pedido": 48, "items": [{"name": "Coca-Cola 2L", "quantity": 1}]}]]';
const acrescimo = extrairJsonDoMarcador(duas, "ACRESCIMO_PEDIDO");
conferir("acha o ACRESCIMO_PEDIDO", JSON.parse(acrescimo.json).pedido === 48);
conferir("PEDIDO_IA ausente devolve vazio", extrairJsonDoMarcador(duas, "PEDIDO_IA").json === "");
conferir("marcador em minúsculas também vale", extrairJsonDoMarcador('[[acrescimo_pedido: {"pedido": 7}]]', "ACRESCIMO_PEDIDO").json === '{"pedido": 7}');
conferir("marcador sem JSON devolve vazio", extrairJsonDoMarcador("[[ACRESCIMO_PEDIDO]]", "ACRESCIMO_PEDIDO").json === "");
conferir("PEDIDO_IA não casa com PEDIDO_IAX", extrairJsonDoMarcador('[[PEDIDO_IAX: {"a": 1}]]', "PEDIDO_IA").json === "");

console.log("\n5) Tirar o marcador do texto do cliente");
conferir("remove e mantém o texto em volta", removerMarcador("Vou conferir! [[ACRESCIMO_PEDIDO: {\"pedido\": 48}]] Já te aviso.", "ACRESCIMO_PEDIDO") === "Vou conferir!  Já te aviso.");
conferir("truncado: remove até o fim", removerMarcador('Vou conferir! [[ACRESCIMO_PEDIDO: {"pedido": 4', "ACRESCIMO_PEDIDO") === "Vou conferir!");
conferir("sem marcador: texto intacto", removerMarcador("Oi, tudo bem?", "ACRESCIMO_PEDIDO") === "Oi, tudo bem?");
conferir("não mexe em outro marcador", removerMarcador("Oi [[CHAMAR_ATENDENTE]]", "ACRESCIMO_PEDIDO") === "Oi [[CHAMAR_ATENDENTE]]");

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
