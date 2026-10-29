/**
 * O KEEPALIVE do iFood (sonda de presença/healthcheck, a cada 30 s) recebe
 * 202 Accepted, como pede a doc (Events › Presença); a sonda sem corpo segue
 * com 200. Sem banco nem rede.
 *
 *   npx tsx scripts/teste-ifood-webhook-keepalive.ts
 */
export {};

process.env.NEXTAUTH_SECRET ||= "teste";
process.env.DATABASE_URL ||= "postgresql://ninguem@localhost:1/nada";
(globalThis as any).prisma = {};

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

(async () => {
  const { NextRequest } = require("next/server");
  const { POST } = require("../src/app/api/ifood/webhook/route");
  const { chamadasRecentesWebhook } = require("../src/lib/ifood-webhook-registro");
  const post = (corpo: string) =>
    POST(new NextRequest("https://firehubfood.com.br/api/ifood/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "34.202.11.230" },
      body: corpo,
    }));

  const r1 = await post(JSON.stringify({ code: "KEEPALIVE", fullCode: "KEEPALIVE", id: "a38ba215-f949-4b2c-982a-0582a9d0c10e" }));
  confere("KEEPALIVE responde 202", r1.status, 202);
  confere("e aparece na tela de homologação com 202", chamadasRecentesWebhook()[0], { ...chamadasRecentesWebhook()[0], codigo: "KEEPALIVE", status: 202 });

  const r2 = await post("");
  confere("sonda sem corpo continua 200", r2.status, 200);

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})();
