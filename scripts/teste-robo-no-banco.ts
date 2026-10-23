/**
 * O estado do robô que o painel lê, no banco (lib/robo-no-banco.ts) — com UM
 * processo, contra um Postgres LOCAL de verdade. A prova com dois processos é
 * scripts/teste-robo-duas-instancias.ts.
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55501/robo NEXTAUTH_SECRET=x npx tsx scripts/teste-robo-no-banco.ts
 *
 * O banco precisa do schema (`npx prisma db push --skip-generate` contra ele).
 * Recusa qualquer DATABASE_URL que não seja 127.0.0.1/localhost: apaga linhas.
 *
 * O que trava:
 *  - pausa: a gravação vale na hora para quem confere depois (mesmo sem await),
 *    retomar apaga do banco, vence sozinha, a lista sai numa consulta, outro
 *    servidor gravando direto no banco é visto, banco fora cai na memória;
 *  - fila humana: a mesma regra do Map de antes (ACTIVE fica, motivo antigo
 *    fica, "só pela queda da IA"), atômica com mensagens simultâneas, encerrar
 *    devolve o motivo, a lista não traz as fechadas;
 *  - saúde da IA: incidente e fim no banco, e a mesma falha repetida não regrava;
 *  - eco do número do FireHub: o envio fica no banco antes de sair, e o eco
 *    gravado por OUTRO servidor é reconhecido;
 *  - aviso único: uma vez por prazo, devolvido quando o envio falha.
 */
export {};

const URL_DO_BANCO = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_DO_BANCO)) {
  console.error("Recuso: DATABASE_URL não é um Postgres local (127.0.0.1/localhost). Este teste apaga linhas.");
  process.exit(2);
}
// O gateway do número do FireHub: porta fechada, sem chave — nada sai daqui.
process.env.EVOLUTION_API_URL = "http://127.0.0.1:9";
delete process.env.EVOLUTION_API_KEY;

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}\n      esperado: ${JSON.stringify(esperado)}\n      veio:     ${JSON.stringify(real)}`); }
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { garantirTabelasDoRobo } = await import("../src/lib/robo-no-banco");
  const P = await import("../src/lib/pausa-do-robo");
  const F = await import("../src/lib/fila-de-atendimento-humano");
  const S = await import("../src/lib/saude-da-ia");
  const { ehEcoDoFireHub, enviarTexto } = await import("../src/lib/atendimento/whatsapp");
  const { pegarAvisoUnico, devolverAvisoUnico } = await import("../src/lib/aviso-unico");

  conferir("as tabelas do robô nascem", await garantirTabelasDoRobo(), true);
  await prisma.$executeRawUnsafe(`DELETE FROM "PausaDoRobo"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "AtendimentoHumano"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "SaudeDaIa"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "EcoDoAtendimento"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "Vez" WHERE "chave" LIKE 'aviso:%'`);
  const linhasDaPausa = async (u: string) =>
    Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "PausaDoRobo" WHERE "userId" = $1`, u))[0].n);

  console.log("\npausa do robô");
  const U = `loja-${Date.now()}`;
  const J = "5522999990001@s.whatsapp.net";
  conferir("conversa nova não está pausada", await P.roboEstaPausado(U, J), false);
  // Sem await, como o webhook faz "antes dos awaits": quem confere depois já vê.
  void P.pausarRobo(U, J);
  conferir("pausa sem await: a conferência seguinte já enxerga", await P.roboEstaPausado(U, J), true);
  conferir("a pausa está no banco", await linhasDaPausa(U), 1);
  await P.retomarRobo(U, J);
  conferir("retomar: livre", await P.roboEstaPausado(U, J), false);
  conferir("retomar apaga do banco", await linhasDaPausa(U), 0);

  const agora = Date.now();
  await P.pausarRobo(U, J, 60_000, agora);
  conferir("pausa de 1 min: pausado agora", await P.roboEstaPausado(U, J, agora + 1_000), true);
  conferir("pausa de 1 min: livre depois de vencer", await P.roboEstaPausado(U, J, agora + 61_000), false);

  const J2 = "5522999990002@s.whatsapp.net";
  const J3 = "5522999990003@s.whatsapp.net";
  await P.pausarRobo(U, J2);
  await P.pausarRobo(U, J3, 1);
  await espera(20);
  const lista = await P.conversasPausadas(U);
  conferir("lista das pausadas numa consulta (a vencida fica de fora)", [...lista].sort(), [J, J2].sort());

  // Outro servidor gravando direto no banco.
  const J4 = "5522999990004@s.whatsapp.net";
  await prisma.$executeRawUnsafe(`INSERT INTO "PausaDoRobo" ("userId", "remoteJid", "ate") VALUES ($1, $2, now() + interval '1 hour')`, U, J4);
  conferir("pausa gravada por OUTRO servidor é vista", await P.roboEstaPausado(U, J4), true);
  await prisma.$executeRawUnsafe(`DELETE FROM "PausaDoRobo" WHERE "userId" = $1 AND "remoteJid" = $2`, U, J4);
  conferir("logo depois, o cache de 2 s ainda responde pausado", await P.roboEstaPausado(U, J4), true);
  await espera(2_100);
  conferir("retomada por OUTRO servidor é vista depois do cache", await P.roboEstaPausado(U, J4), false);

  // Banco fora: a tabela some de baixo dos pés — vale a memória.
  const J5 = "5522999990005@s.whatsapp.net";
  await prisma.$executeRawUnsafe(`ALTER TABLE "PausaDoRobo" RENAME TO "PausaDoRoboFora"`);
  const avisos: string[] = [];
  const warnOriginal = console.warn;
  console.warn = (...a: any[]) => { avisos.push(a.join(" ")); };
  await P.pausarRobo(U, J5);
  console.warn = warnOriginal;
  conferir("banco fora: a gravação falha com aviso", avisos.some((a) => a.includes("vale a memória")), true);
  conferir("banco fora: a pausa vale pela memória", await P.roboEstaPausado(U, J5), true);
  conferir("banco fora: a lista sai da memória", (await P.conversasPausadas(U)).has(J5), true);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PausaDoRoboFora" RENAME TO "PausaDoRobo"`);
  conferir("banco de volta: a pausa que o banco não sabe continua valendo", await P.roboEstaPausado(U, J5), true);
  await P.retomarRobo(U, J5);
  conferir("banco de volta: retomar funciona", await P.roboEstaPausado(U, J5), false);

  console.log("\nfila de atendimento humano");
  const IA = "IA fora do ar";
  const base = { userId: U, telefone: "+55 22999990001", nomeDoCliente: "Ana", motivoDaIaForaDoAr: IA };
  const msg = (t: string) => [{ sender: "user" as const, text: t, timestamp: Date.now() }];
  await F.entrarNaFila({ ...base, jid: J, textoDoCliente: "cadê meu pedido?", mensagens: msg("cadê meu pedido?"), motivo: "Reclamação" });
  let c = await F.chamadoDaConversa(U, J);
  conferir("entrada nova: PENDING, 1 não lida, motivo, não é só pela IA", [c?.status, c?.unreadCount, c?.motivo, c?.soPorIaForaDoAr], ["PENDING", 1, "Reclamação", false]);
  await F.entrarNaFila({ ...base, jid: J, textoDoCliente: "oi??", mensagens: msg("oi??") });
  c = await F.chamadoDaConversa(U, J);
  conferir("entrada sem motivo: motivo antigo fica, mensagens acumulam", [c?.motivo, c?.unreadCount, c?.messages.length, c?.lastMessage], ["Reclamação", 2, 2, "oi??"]);
  await F.marcarLido(U, J);
  await F.entrarNaFila({ ...base, jid: J, textoDoCliente: "e aí", mensagens: msg("e aí") });
  c = await F.chamadoDaConversa(U, J);
  conferir("quem a atendente assumiu continua ACTIVE", [c?.status, c?.unreadCount], ["ACTIVE", 1]);

  await F.entrarNaFila({ ...base, jid: J2, textoDoCliente: "oi", mensagens: msg("oi"), motivo: IA });
  c = await F.chamadoDaConversa(U, J2);
  conferir("entrada pela queda da IA: só pela IA", c?.soPorIaForaDoAr, true);
  await F.entrarNaFila({ ...base, jid: J2, textoDoCliente: "oi de novo", mensagens: msg("oi de novo"), motivo: IA });
  conferir("de novo pela IA: continua só pela IA", (await F.chamadoDaConversa(U, J2))?.soPorIaForaDoAr, true);
  await F.entrarNaFila({ ...base, jid: J2, textoDoCliente: "quero atendente", mensagens: msg("quero atendente"), motivo: "Pediu atendente" });
  c = await F.chamadoDaConversa(U, J2);
  conferir("outro motivo derruba o 'só pela IA' (e troca o motivo)", [c?.soPorIaForaDoAr, c?.motivo], [false, "Pediu atendente"]);
  conferir("tirar 'se só pela IA' não tira quem pediu atendente", await F.tirarSeSoPelaQuedaDaIa(U, J2), false);

  await F.entrarNaFila({ ...base, jid: J3, textoDoCliente: "x", mensagens: msg("x"), motivo: IA });
  conferir("a IA voltou: quem estava só pela queda sai", await F.tirarSeSoPelaQuedaDaIa(U, J3), true);
  conferir("…e não está mais lá", await F.chamadoDaConversa(U, J3), null);

  // Atômico: vinte mensagens do mesmo cliente ao mesmo tempo.
  const antes = (await F.chamadoDaConversa(U, J))!;
  await Promise.all(Array.from({ length: 20 }, (_, i) => F.acrescentarDoCliente(U, J, `m${i}`)));
  c = await F.chamadoDaConversa(U, J);
  conferir("20 mensagens simultâneas: nenhuma se perde", [c!.messages.length - antes.messages.length, c!.unreadCount - antes.unreadCount], [20, 20]);

  conferir("resposta pelo balãozinho entra no chamado", await F.respostaDaLoja(U, J, "já vou ver"), true);
  c = await F.chamadoDaConversa(U, J);
  conferir("…como a última, do atendente", [c?.lastMessage, c?.messages.at(-1)?.sender, c?.status], ["já vou ver", "attendant", "ACTIVE"]);

  const abertos = await F.chamadosAbertos(U);
  conferir("a lista traz as abertas, a mais recente primeiro", abertos.map((x) => x.jid), [J, J2]);
  conferir("encerrar devolve o motivo", await F.encerrarChamado(U, J2), { existia: true, motivo: "Pediu atendente" });
  conferir("a fechada sai da lista", (await F.chamadosAbertos(U)).map((x) => x.jid), [J]);
  conferir("cliente escrevendo em conversa fechada não reabre por aqui", await F.acrescentarDoCliente(U, J2, "oi"), false);
  conferir("resposta pela aba do robô não mexe em chamado fechado", await F.respostaDaLoja(U, J2, "oi", { peloRobo: true }), false);
  conferir("encerrar conversa que não está na fila", await F.encerrarChamado(U, "5522000000000@s.whatsapp.net"), { existia: false });
  conferir("contatos do marketing: só desta loja, inclusive fechadas", (await F.contatosDaFila(U)).map((x) => x.jid).sort(), [J, J2].sort());
  conferir("contatos de outra loja: nada", (await F.contatosDaFila(`${U}-outra`)).length, 0);
  conferir("expirou: sai da fila", await F.tirarDaFila(U, J), true);

  console.log("\nsaúde da IA");
  const L = `${U}-ia`;
  conferir("de pé", (await S.saudeDaIa(L)).foraDoAr, false);
  S.registrarIncidenteDaIa(L, { resumo: "crédito esgotado", exigeAcao: true, doSistema: false });
  await espera(200);
  const s1 = await S.saudeDaIa(L);
  conferir("incidente: fora do ar, exige ação", [s1.foraDoAr, s1.exigeAcao, s1.resumo], [true, true, "crédito esgotado"]);
  const lerLinha = async (chave: string) =>
    (await prisma.$queryRawUnsafe<{ ultimaFalhaEm: Date }[]>(`SELECT "ultimaFalhaEm" FROM "SaudeDaIa" WHERE "chave" = $1`, chave))[0];
  const gravada = await lerLinha(L);
  conferir("incidente gravado no banco", Boolean(gravada), true);
  S.registrarIncidenteDaIa(L, { resumo: "crédito esgotado", exigeAcao: true, doSistema: false }, Date.now() + 5_000);
  await espera(200);
  conferir("a mesma falha 5 s depois NÃO regrava", (await lerLinha(L)).ultimaFalhaEm.getTime(), gravada.ultimaFalhaEm.getTime());
  S.registrarIncidenteDaIa(L, { resumo: "crédito esgotado", exigeAcao: true, doSistema: false }, Date.now() + 61_000);
  await espera(200);
  conferir("…1 min depois regrava a hora da falha", (await lerLinha(L)).ultimaFalhaEm.getTime() > gravada.ultimaFalhaEm.getTime(), true);
  S.registrarSucessoDaIa(L);
  await espera(200);
  conferir("sucesso: de pé e fora do banco", [(await S.saudeDaIa(L)).foraDoAr, Boolean(await lerLinha(L))], [false, false]);
  S.registrarIncidenteDaIa(L, { resumo: "chave inválida", exigeAcao: true, doSistema: true });
  await espera(200);
  conferir("incidente do SISTEMA vale para qualquer loja", (await S.saudeDaIa(`${U}-qualquer`)).foraDoAr, true);
  S.registrarSucessoDaIa(`${U}-qualquer`);
  await espera(200);
  conferir("sucesso de qualquer loja encerra o do sistema", (await S.saudeDaIa(L)).foraDoAr, false);

  console.log("\neco do número do FireHub");
  const r = await enviarTexto("5522988887777@s.whatsapp.net", "Bom dia! Tudo certo com a loja?");
  conferir("o envio falha (gateway de mentira) — mas foi registrado antes", r.ok, false);
  const ecoNoBanco = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "EcoDoAtendimento"`);
  conferir("o registro foi para o banco", Number(ecoNoBanco[0].n), 1);
  conferir("eco do que este servidor mandou", await ehEcoDoFireHub(["5522988887777@s.whatsapp.net"], "Bom dia! Tudo certo com a loja?"), true);
  conferir("o mesmo texto em OUTRA conversa não é eco", await ehEcoDoFireHub(["5522911112222@s.whatsapp.net"], "Bom dia! Tudo certo com a loja?"), false);
  // O que OUTRO servidor mandou: só no banco.
  const { createHash } = await import("crypto");
  const hash = createHash("sha1").update("Mandado pela tela em B").digest("hex");
  await prisma.$executeRawUnsafe(`INSERT INTO "EcoDoAtendimento" ("hash", "conversa", "em") VALUES ($1, '11112222', now())`, hash);
  conferir("eco do que OUTRO servidor mandou (só no banco)", await ehEcoDoFireHub(["5522911112222@s.whatsapp.net"], "Mandado pela tela em B"), true);
  await prisma.$executeRawUnsafe(`UPDATE "EcoDoAtendimento" SET "em" = now() - interval '4 minutes' WHERE "hash" = $1`, hash);
  conferir("…passados 3 min já não é eco (é o celular)", await ehEcoDoFireHub(["5522911112222@s.whatsapp.net"], "Mandado pela tela em B"), false);

  console.log("\naviso uma vez só");
  const chave = `teste:${U}`;
  const d1 = await pegarAvisoUnico(chave, 60_000);
  const d2 = await pegarAvisoUnico(chave, 60_000);
  conferir("o primeiro avisa, o segundo não", [Boolean(d1), d2], [true, null]);
  await devolverAvisoUnico(chave, d1!);
  conferir("envio falhou e foi devolvido: o próximo avisa", Boolean(await pegarAvisoUnico(chave, 60_000)), true);
  const curto = `teste-curto:${U}`;
  await pegarAvisoUnico(curto, 300);
  await espera(400);
  conferir("passado o prazo, avisa de novo", Boolean(await pegarAvisoUnico(curto, 300)), true);

  console.log(`\n${ok} ✓, ${falhou} ✗`);
  await prisma.$disconnect();
  process.exit(falhou ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
