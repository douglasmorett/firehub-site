/**
 * scripts/teste-avaliacao-no-google.ts
 *
 * O link de avaliação no Google que a loja cola na tela do robô e que vai no
 * agradecimento do pedido entregue (lib/avaliacao-no-google.ts). Trava os
 * formatos que o Google entrega e recusa o que não é do Google.
 *
 *   npx tsx scripts/teste-avaliacao-no-google.ts
 */
import { linkDeAvaliacaoNoGoogle } from "../src/lib/avaliacao-no-google";

let falhas = 0;
function confere(entrada: unknown, esperado: string | null) {
  const obtido = linkDeAvaliacaoNoGoogle(entrada);
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${JSON.stringify(entrada)} → ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

// Formatos do Google
confere("https://g.page/r/CQx1abc/review", "https://g.page/r/CQx1abc/review");
confere("https://maps.app.goo.gl/AbCdEf123", "https://maps.app.goo.gl/AbCdEf123");
confere("https://search.google.com/local/writereview?placeid=ChIJ123", "https://search.google.com/local/writereview?placeid=ChIJ123");
confere("https://www.google.com/maps/place/R%26D+Pizzaria", "https://www.google.com/maps/place/R%26D+Pizzaria");
confere("https://www.google.com.br/maps/place/Loja", "https://www.google.com.br/maps/place/Loja");
confere("https://g.co/kgs/xYz", "https://g.co/kgs/xYz");

// Colado sem https, com espaço nas pontas, com http
confere("  g.page/r/CQx1abc/review  ", "https://g.page/r/CQx1abc/review");
confere("http://g.page/r/CQx1abc/review", "https://g.page/r/CQx1abc/review");

// Vazio e lixo
confere("", null);
confere("   ", null);
confere(undefined, null);
confere(null, null);
confere(42, null);
confere("minha loja no google", null);

// Não é do Google — inclusive os que só parecem
confere("https://firehubfood.com.br/loja/r-d", null);
confere("https://instagram.com/rafascheef", null);
confere("https://google.com.golpe.xyz/review", null);
confere("https://naogoogle.com/review", null);
confere("https://g.page.golpe.com/r/x", null);
confere("javascript:alert(1)", null);
confere("ftp://g.page/r/x", null);

if (falhas > 0) {
  console.error(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\ntudo certo");
