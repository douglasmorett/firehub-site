/**
 * JotaJá fora do ar (lib/jotaja-instavel-regras.ts): quando avisar, o que
 * dizer, nova tentativa da fila e a ordem das ações pendentes.
 *
 *   npx tsx scripts/teste-jotaja-instavel.ts
 */
import {
  comNovaTentativa,
  deveAvisarQueda,
  separarAcoes,
  textoDaQueda,
  textoDaVolta,
  TENTATIVAS_DA_ACAO,
  VALIDADE_DA_ACAO_MS,
} from "../src/lib/jotaja-instavel-regras";

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}

async function main() {
  // ── Quando avisar ─────────────────────────────────────────────────────────
  confere("1ª falha não avisa", deveAvisarQueda(1, null) === false);
  confere("2ª falha seguida avisa", deveAvisarQueda(2, null) === true);
  confere("já avisado não repete", deveAvisarQueda(5, Date.now()) === false);

  // ── Textos com a hora da loja ─────────────────────────────────────────────
  const desde = Date.UTC(2026, 9, 24, 21, 49); // 18:49 em São Paulo
  const agora = Date.UTC(2026, 9, 24, 22, 47); // 19:47
  const queda = textoDaQueda("Duga Burguer", desde, "events:polling HTTP 500", "America/Sao_Paulo");
  confere("queda diz a loja, a hora e o erro", queda.includes("Duga Burguer") && queda.includes("18:49") && queda.includes("HTTP 500"), queda);
  confere("queda manda olhar o portal", /portal do JotaJá/.test(queda), queda);
  const volta = textoDaVolta("Duga Burguer", desde, agora, "America/Sao_Paulo");
  confere("volta diz o período", volta.includes("18:49") && volta.includes("19:47"), volta);

  // ── Nova tentativa na fila ────────────────────────────────────────────────
  let chamadas = 0;
  const r1 = await comNovaTentativa(async () => { chamadas++; return new Response(null, { status: chamadas < 3 ? 500 : 204 }); }, 3, 1);
  confere("5xx repete e pega a resposta boa na 3ª", r1.status === 204 && chamadas === 3, { status: r1.status, chamadas });

  chamadas = 0;
  const r2 = await comNovaTentativa(async () => { chamadas++; return new Response(null, { status: 500 }); }, 3, 1);
  confere("5xx em todas devolve a última (quem chama trata o !ok)", r2.status === 500 && chamadas === 3, { status: r2.status, chamadas });

  chamadas = 0;
  const r3 = await comNovaTentativa(async () => { chamadas++; return new Response(null, { status: 401 }); }, 3, 1);
  confere("4xx não repete", r3.status === 401 && chamadas === 1, { status: r3.status, chamadas });

  chamadas = 0;
  let erro = "";
  try {
    await comNovaTentativa(async () => { chamadas++; throw new Error("fetch failed"); }, 3, 1);
  } catch (e: any) { erro = e.message; }
  confere("rede caída repete 3x e sobe o erro", erro === "fetch failed" && chamadas === 3, { erro, chamadas });

  chamadas = 0;
  const r4 = await comNovaTentativa(async () => { chamadas++; if (chamadas === 1) throw new Error("fetch failed"); return new Response(null, { status: 200 }); }, 3, 1);
  confere("rede caída e depois ok", r4.status === 200 && chamadas === 2, { status: r4.status, chamadas });

  // ── Ações pendentes: ordem e validade ─────────────────────────────────────
  const t0 = Date.now();
  const { reenviar, descartar } = separarAcoes(
    [
      { id: 2, rotulo: "dispatch", tentativas: 3, criadoEmMs: t0 - 60_000 },
      { id: 1, rotulo: "confirm", tentativas: 3, criadoEmMs: t0 - 120_000 },
      { id: 3, rotulo: "delivered", tentativas: 0, criadoEmMs: t0 - VALIDADE_DA_ACAO_MS - 1 },
      { id: 4, rotulo: "confirm", tentativas: TENTATIVAS_DA_ACAO, criadoEmMs: t0 - 10_000 },
    ],
    t0,
  );
  confere("reenvia na ordem em que aconteceram (confirm antes de dispatch)", reenviar.map((a) => a.id).join(",") === "1,2", reenviar.map((a) => a.id));
  confere("descarta a vencida e a que esgotou as tentativas", descartar.map((a) => a.id).sort().join(",") === "3,4", descartar.map((a) => a.id));

  console.log(falhas === 0 ? "\n🎉 tudo certo" : `\n💥 ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
