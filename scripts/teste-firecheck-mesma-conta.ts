/**
 * A mesma conta do FireHub no FireCheck (lib/firecheck-modulos/mesma-conta.ts).
 * Roda sem banco: npx tsx scripts/teste-firecheck-mesma-conta.ts
 */
import assert from "node:assert/strict";
import { linkDeEntradaNoFirecheck, mesmoEmail } from "../src/lib/firecheck-modulos/mesma-conta";

// E-mail: maiúscula e espaço não contam; vazio nunca confere (senão loja sem e-mail "conferia" com qualquer pedido vazio).
assert.equal(mesmoEmail("Dono@Pizzaria17.com.br ", "dono@pizzaria17.com.br"), true);
assert.equal(mesmoEmail("dono@pizzaria17.com.br", "outro@pizzaria17.com.br"), false);
assert.equal(mesmoEmail("", ""), false);
assert.equal(mesmoEmail(null, undefined), false);
assert.equal(mesmoEmail("  ", "  "), false);

// O link: bilhete depois do "#" (não vai ao servidor nem ao Referer), na tela de login, sem barra dobrada.
const bilhete = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinatura_+/=";
const link = linkDeEntradaNoFirecheck("https://www.firecheckapp.com.br/", bilhete);
assert.ok(link.startsWith("https://www.firecheckapp.com.br/login#firehub="), link);
assert.ok(!link.includes("?"), "o bilhete não pode ir na query");
assert.equal(new URLSearchParams(new URL(link).hash.slice(1)).get("firehub"), bilhete, "o FireCheck lê o bilhete de volta igual");
assert.equal(linkDeEntradaNoFirecheck("http://127.0.0.1:3185", "x"), "http://127.0.0.1:3185/login#firehub=x");

console.log("✅ mesma conta do FireCheck: todos os casos passaram");
