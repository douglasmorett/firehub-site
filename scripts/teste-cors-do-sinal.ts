/**
 * Trava o CORS do /api/contingencia/sinal (Modo Contingência).
 *
 * A tela que está no computador da loja (http://<ip>:7890) pergunta à nuvem
 * se ela voltou (components/contingencia/TrocaDeContingencia.tsx). A rota
 * responde `access-control-allow-origin: *`, mas o Next mantém o cabeçalho
 * que o proxy pôs e descarta o da rota: com o `https://firehubfood.com.br` do
 * proxy, o navegador recusava a resposta e a tela nunca voltava para a nuvem
 * (revisão de 14/10/2026). O proxy deixa essa rota com o CORS dela.
 *
 *   npx tsx scripts/teste-cors-do-sinal.ts
 */
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

const pedir = (caminho: string, origin: string, method = "GET") =>
  proxy(new NextRequest(`https://firehubfood.com.br${caminho}`, { method, headers: { origin, host: "firehubfood.com.br" } }));

(async () => {
  const daLoja = "http://192.168.15.106:7890";
  const sinal = await pedir("/api/contingencia/sinal", daLoja);
  confere("sinal: o proxy não põe o CORS dele (vale o * da rota)", !sinal?.headers.get("access-control-allow-origin"), sinal?.headers.get("access-control-allow-origin"));
  const pre = await pedir("/api/contingencia/sinal", daLoja, "OPTIONS");
  confere("sinal: o OPTIONS vai para a rota (não é respondido pelo proxy)", !pre?.headers.get("access-control-allow-origin"), pre?.headers.get("access-control-allow-origin"));
  const outra = await pedir("/api/contingencia/bilhete", daLoja);
  confere("outras rotas continuam com o CORS do proxy (só o domínio do FireHub)", outra?.headers.get("access-control-allow-origin") === "https://firehubfood.com.br", outra?.headers.get("access-control-allow-origin"));
  const www = await pedir("/api/qualquer", "https://www.firehubfood.com.br");
  confere("o www continua liberado nas outras rotas", www?.headers.get("access-control-allow-origin") === "https://www.firehubfood.com.br");
  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  if (falhas) process.exit(1);
})();
