/**
 * Prova do filtro de mensagem repetida do gateway (whatsapp-gateway/mensagem-repetida.js).
 *
 *   node scripts/teste-mensagem-repetida.mjs
 *
 * O caso real (Pizzaria 17, 12/10/2026 19h10): o Baileys 7 entregou o mesmo
 * "Gostaria de reservar uma mesa para 14 pessoas" duas vezes no mesmo
 * milissegundo, e a cliente recebeu as regras, as 2 fotos e a ficha em dobro.
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { criarFiltroDeRepetidas, JANELA_MS } = require("../whatsapp-gateway/mensagem-repetida.js");

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe === undefined ? "" : " — " + JSON.stringify(detalhe)));
};

let relogio = 1_000_000;
const jaVista = criarFiltroDeRepetidas({ agora: () => relogio, limite: 3 });
const msg = (id, remoteJid = "200416813912297@lid", fromMe = false) => ({ key: { id, remoteJid, fromMe }, message: { conversation: "oi" } });

conferir("a primeira passa", jaVista("firehub_01xymt7yxg", msg("A1")) === false);
conferir("a mesma, no mesmo milissegundo, é barrada", jaVista("firehub_01xymt7yxg", msg("A1")) === true);
relogio += 5 * 60 * 1000;
conferir("a mesma 5 min depois ainda é barrada", jaVista("firehub_01xymt7yxg", msg("A1")) === true);
relogio += JANELA_MS;
conferir("passada a janela, passa de novo", jaVista("firehub_01xymt7yxg", msg("A1")) === false);
conferir("outro id passa", jaVista("firehub_01xymt7yxg", msg("A2")) === false);
conferir("o mesmo id em outra loja passa", jaVista("firehub_019zyc9s4g", msg("A2")) === false);
conferir("o mesmo id de outro contato passa", jaVista("firehub_01xymt7yxg", msg("A2", "5522999990000@s.whatsapp.net")) === false);
conferir("sem id não barra nada", jaVista("firehub_01xymt7yxg", { key: {} }) === false && jaVista("firehub_01xymt7yxg", { key: {} }) === false);

// Limite 3: a mais antiga sai quando a rajada passa do limite (a memória não cresce sem fim).
const cheio = criarFiltroDeRepetidas({ agora: () => relogio, limite: 3 });
["B1", "B2", "B3", "B4"].forEach((id) => cheio("x", msg(id)));
conferir("rajada maior que o limite: a mais antiga é esquecida", cheio("x", msg("B1")) === false && cheio("x", msg("B4")) === true);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
