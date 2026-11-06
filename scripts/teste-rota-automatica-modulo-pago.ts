/**
 * Rota 100% automatizada, Fase 4 — o MÓDULO PAGO (lib/roteirizacao-automatica/assinatura.ts):
 * R$ 97/mês, 7 dias grátis na primeira ativação, pela regra dos módulos pagos
 * (lib/modulo-pago.ts, a mesma do Multimarcas):
 *
 *   [1] a conta do mês (puro): mês parcial cobra 97 inteiro; teste não cobra; desligou, o mês seguinte zero;
 *   [2] liga/desliga com um banco falso: primeira ativação dá 7 dias; sem o termo não liga; desligar no
 *       teste para na hora (R$ 0, o teste não volta); ligar sem teste = mês inteiro; desligar depois do
 *       teste marca a virada do mês ("desliga em") e "Continuar ligada" desmarca;
 *   [3] isenta (Hakim, demonstração, planPercent 0) = R$ 0 e sempre ligada;
 *   [4] nada de graça (Douglas, 06/11): a Bom Cheff, que ia entrar pela lista fixa, não tem caminho
 *       próprio — sem ativar com o termo, nada liga, nada é gravado e nada é cobrado;
 *   [5] o cron: uma consulta só para todas as lojas, e só as ligadas de verdade;
 *   [6] `liberadaPara` vale para qualquer loja.
 *
 *   npx tsx scripts/teste-rota-automatica-modulo-pago.ts
 *
 * Sem banco: o Prisma é falso (globalThis.prisma, que lib/prisma.ts reaproveita
 * fora de produção) e faz o papel da tabela RotaAutomaticaAssinatura e do User.
 * O mês corrente sai do relógio de verdade (como no Multimarcas): as datas do
 * teste são contadas a partir de agora.
 */
export {};

Object.assign(process.env, { NODE_ENV: "development" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

const HAKIM = "cmpx96phr0000ujf0sb0qk5vr";
const DEMO = "cmupkiesh0000ujmcjwtpd706";
const BOM_CHEFF = "cmvvl39a004wns807o0ck8uk3";

// ── Banco falso ──────────────────────────────────────────────────────────────
type Usuario = { id: string; email: string | null; planPercent: number; isFranqueadoHakim: boolean; storeTimezone: string; deliveryConfig: any; storeLatLng: any };
type LinhaDaAssinatura = { ativo: boolean; testeAte: Date | null; trechos: any[] };
const usuarios = new Map<string, Usuario>();
const assinaturas = new Map<string, LinhaDaAssinatura>();
const leituras: string[] = [];
const usuario = (id: string, extra: Partial<Usuario> = {}) =>
  usuarios.set(id, { id, email: `${id}@loja.com`, planPercent: 2, isFranqueadoHakim: false, storeTimezone: "America/Sao_Paulo", deliveryConfig: { roteirizacaoAutomatica: { ativo: true } }, storeLatLng: { lat: -22.5, lng: -41.9 }, ...extra });

const juntar = (u: Usuario) => {
  const a = assinaturas.get(u.id);
  return { ...u, testeAte: a?.testeAte ?? null, trechos: a ? JSON.parse(JSON.stringify(a.trechos)) : null };
};

(globalThis as any).prisma = {
  user: {
    findUnique: async (q: any) => usuarios.get(q.where.id) ?? null,
  },
  $queryRawUnsafe: async (sql: string, ...p: any[]) => {
    leituras.push(sql.replace(/\s+/g, " ").slice(0, 60));
    if (/LEFT JOIN "RotaAutomaticaAssinatura"/.test(sql) && /WHERE u\."id" = \$1/.test(sql)) {
      const u = usuarios.get(p[0]);
      return u ? [juntar(u)] : [];
    }
    if (/LEFT JOIN "RotaAutomaticaAssinatura"/.test(sql)) {
      return [...usuarios.values()].filter((u) => u.deliveryConfig?.roteirizacaoAutomatica?.ativo === true).map(juntar);
    }
    if (/FROM "RotaAutomaticaAssinatura" WHERE "franchiseeId" = \$1/.test(sql)) {
      const a = assinaturas.get(p[0]);
      return a ? [{ ativo: a.ativo, testeAte: a.testeAte, trechos: JSON.parse(JSON.stringify(a.trechos)) }] : [];
    }
    throw new Error(`consulta inesperada: ${sql}`);
  },
  $executeRawUnsafe: async (sql: string, ...p: any[]) => {
    if (/CREATE TABLE/.test(sql)) return 0;
    if (/INSERT INTO "RotaAutomaticaAssinatura"/.test(sql) && /DO NOTHING/.test(sql)) {
      if (assinaturas.has(p[0])) return 0;
      assinaturas.set(p[0], { ativo: true, testeAte: new Date(p[1]), trechos: JSON.parse(p[2]) });
      return 1;
    }
    if (/INSERT INTO "RotaAutomaticaAssinatura"/.test(sql)) {
      assinaturas.set(p[0], { ativo: true, testeAte: new Date(p[1]), trechos: JSON.parse(p[2]) });
      return 1;
    }
    if (/UPDATE "RotaAutomaticaAssinatura"/.test(sql)) {
      const a = assinaturas.get(p[0]);
      if (!a) return 0;
      a.ativo = p[1];
      a.trechos = JSON.parse(p[2]);
      return 1;
    }
    throw new Error(`gravação inesperada: ${sql}`);
  },
};

const DIA = 24 * 60 * 60 * 1000;

async function main() {
  const A = await import("../src/lib/roteirizacao-automatica/assinatura");
  const { VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA, CLAUSULAS_DO_TERMO_DA_ROTA_AUTOMATICA } = await import("../src/lib/roteirizacao-automatica/termo");
  const { liberadaPara } = await import("../src/lib/roteirizacao-automatica/liberacao");
  const { intervaloDoMes, getCurrentYearMonth } = await import("../src/lib/billing");
  const { ligadoAgora } = await import("../src/lib/modulo-pago");
  const aceite = { versao: VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA, email: "dono@loja.com", ip: "1.2.3.4", userAgent: "teste" };
  const mes = intervaloDoMes(getCurrentYearMonth(0, "America/Sao_Paulo"), "America/Sao_Paulo");
  const agora = new Date();

  console.log("\n[1] a conta do mês");
  {
    const ini = new Date("2026-11-01T03:00:00Z"); // 1º/11 00h em Brasília
    const fim = new Date("2026-12-01T03:00:00Z");
    const depois = new Date("2026-12-05T12:00:00Z");
    const t = (de: string, ate: string | null, valor = 97) => ({ de, ate, valor });
    conferir("preço 97 e 7 dias de teste", A.PRECO_DA_ROTA_AUTOMATICA === 97 && A.DIAS_DE_TESTE_DA_ROTA_AUTOMATICA === 7);
    conferir("mês parcial: ligou no dia 29, sem teste → 97 inteiro", A.valorDaRotaAutomaticaNoMes([t("2026-11-29T15:00:00Z", null)], "2026-10-01T12:00:00Z", ini, fim, depois) === 97);
    conferir("ligou e desligou duas vezes no mesmo dia → uma vez só", A.valorDaRotaAutomaticaNoMes([t("2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z"), t("2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z")], "2026-10-01T12:00:00Z", ini, fim, depois) === 97);
    conferir("teste até 02/12 cobrindo o resto de novembro → 0", A.valorDaRotaAutomaticaNoMes([t("2026-11-25T12:00:00Z", null)], "2026-12-02T12:00:00Z", ini, fim, depois) === 0);
    conferir("teste acabou em 05/11 e seguiu ligada → 97", A.valorDaRotaAutomaticaNoMes([t("2026-10-29T12:00:00Z", null)], "2026-11-05T12:00:00Z", ini, fim, depois) === 97);
    conferir("desligou no teste → 0", A.valorDaRotaAutomaticaNoMes([t("2026-11-01T12:00:00Z", "2026-11-04T12:00:00Z")], "2026-11-08T12:00:00Z", ini, fim, depois) === 0);
    conferir("desligou na virada de outubro → novembro 0", A.valorDaRotaAutomaticaNoMes([t("2026-10-01T12:00:00Z", "2026-11-01T03:00:00Z")], "2026-10-08T12:00:00Z", ini, fim, depois) === 0);
    conferir("o preço gravado no trecho vale (reajuste não muda o combinado)", A.valorDaRotaAutomaticaNoMes([t("2026-10-01T12:00:00Z", null, 79)], null, ini, fim, depois) === 79);
    conferir("o termo diz o preço, que é à parte e a regra de desligar",
      CLAUSULAS_DO_TERMO_DA_ROTA_AUTOMATICA.some((c) => /R\$ 97,00/.test(c) && /boleto/.test(c))
        && CLAUSULAS_DO_TERMO_DA_ROTA_AUTOMATICA.some((c) => /À PARTE/.test(c) && /mensalidade/.test(c))
        && CLAUSULAS_DO_TERMO_DA_ROTA_AUTOMATICA.some((c) => /durante os 7 dias grátis/.test(c) && /na hora/.test(c) && /virada/.test(c) && /proporcional/.test(c)));
  }

  console.log("\n[2] liga e desliga");
  {
    const L = "loja-nova";
    usuario(L);
    let lancou = false;
    try { await A.ligarOuDesligarRotaAutomatica(L, true, null, agora); } catch (e) { lancou = e instanceof A.TermoNaoAceitoError; }
    conferir("sem o termo não liga (TermoNaoAceitoError) e nada é gravado", lancou && !assinaturas.has(L));
    lancou = false;
    try { await A.ligarOuDesligarRotaAutomatica(L, true, { ...aceite, versao: "2020-01-01" }, agora); } catch (e) { lancou = e instanceof A.TermoNaoAceitoError; }
    conferir("termo de versão velha não vale", lancou && !assinaturas.has(L));

    const e1 = await A.ligarOuDesligarRotaAutomatica(L, true, aceite, agora);
    const testeAte = assinaturas.get(L)?.testeAte;
    conferir("primeira ativação: 7 dias grátis", !!testeAte && Math.abs(testeAte.getTime() - (agora.getTime() + 7 * DIA)) < 1000 && e1.emTeste && e1.ativo && !e1.isento, e1);
    conferir("… o trecho guarda o preço e o aceite (versão, quem, IP)", (() => { const tr = assinaturas.get(L)!.trechos[0]; return tr.valor === 97 && tr.ate === null && tr.aceite?.versao === VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA && tr.aceite?.email === "dono@loja.com" && tr.aceite?.ip === "1.2.3.4"; })());
    conferir("… no teste o mês não cobra (o teste vai até depois de agora)", (await A.cobrancaDaRotaAutomaticaNoMes(L, mes.monthStart, new Date(agora.getTime() + 1))) === 0);

    const e2 = await A.ligarOuDesligarRotaAutomatica(L, false, null, new Date(agora.getTime() + 60_000));
    conferir("desligar no teste: para na hora, sem 'desliga em'", !e2.ativo && e2.desligaEm === null && e2.jaTestou && !ligadoAgora(assinaturas.get(L)!.trechos, new Date(agora.getTime() + 120_000)), e2);
    conferir("… R$ 0 no mês", (await A.cobrancaDaRotaAutomaticaNoMes(L, mes.monthStart, mes.monthEnd)) === 0);

    const religa = new Date(agora.getTime() + 120_000);
    const e3 = await A.ligarOuDesligarRotaAutomatica(L, true, aceite, religa);
    conferir("religar: o teste não volta (mesmo testeAte, sem teste novo)", assinaturas.get(L)!.testeAte?.getTime() === testeAte?.getTime() && e3.ativo && e3.jaTestou);
    // Conta do mês olhando depois do teste (o trecho novo segue ligado): mês inteiro.
    const depoisDoTeste = new Date(testeAte!.getTime() + DIA);
    conferir("ligar sem teste disponível: o mês em que o teste acaba entra inteiro (97)",
      A.valorDaRotaAutomaticaNoMes(A.lerTrechos(assinaturas.get(L)!.trechos), testeAte, new Date(testeAte!.getTime() - DIA), new Date(testeAte!.getTime() + 2 * DIA), depoisDoTeste) === 97);

    // Loja que já usou o teste há tempo e liga hoje: o mês corrente cobra inteiro.
    const V = "loja-veterana";
    usuario(V);
    assinaturas.set(V, { ativo: false, testeAte: new Date(agora.getTime() - 40 * DIA), trechos: [{ de: new Date(agora.getTime() - 45 * DIA).toISOString(), ate: new Date(agora.getTime() - 41 * DIA).toISOString(), valor: 97 }] });
    const e4 = await A.ligarOuDesligarRotaAutomatica(V, true, aceite, agora);
    conferir("já testou e liga hoje: cobrando este mês (97 inteiro), sem teste", e4.ativo && !e4.emTeste && e4.cobradoEsteMes && (await A.cobrancaDaRotaAutomaticaNoMes(V, mes.monthStart, mes.monthEnd)) === 97, e4);

    const e5 = await A.ligarOuDesligarRotaAutomatica(V, false, null, agora);
    conferir("desligar depois do teste: continua ligada até a virada do mês ('desliga em' = início do mês seguinte)",
      e5.ativo && e5.desligaEm === mes.monthEnd.toISOString() && assinaturas.get(V)!.ativo === true, e5);
    conferir("… o mês segue inteiro no boleto (97), sem proporcional", (await A.cobrancaDaRotaAutomaticaNoMes(V, mes.monthStart, mes.monthEnd)) === 97);
    const trechosV = A.lerTrechos(assinaturas.get(V)!.trechos);
    conferir("… desliga sozinha na virada, sem cron (os trechos decidem)", ligadoAgora(trechosV, new Date(mes.monthEnd.getTime() - 1)) && !ligadoAgora(trechosV, mes.monthEnd)
      && !A.rotaLigadaDeVerdade(true, false, trechosV, mes.monthEnd));
    const proximo = { ini: mes.monthEnd, fim: new Date(mes.monthEnd.getTime() + 31 * DIA) };
    conferir("… e o mês seguinte não é cobrado", A.valorDaRotaAutomaticaNoMes(trechosV, assinaturas.get(V)!.testeAte, proximo.ini, proximo.fim, new Date(proximo.ini.getTime() + DIA)) === 0);

    const e6 = await A.ligarOuDesligarRotaAutomatica(V, true, null, agora);
    conferir("'Continuar ligada' desmarca a virada sem novo termo", e6.ativo && e6.desligaEm === null && A.lerTrechos(assinaturas.get(V)!.trechos).filter((t) => t.ate === null).length === 1 && assinaturas.get(V)!.trechos.length === 2, e6);
  }

  console.log("\n[3] isenta");
  {
    usuario(HAKIM, { email: "contatohakim@gmail.com" });
    usuario(DEMO);
    usuario("loja-isenta", { planPercent: 0 });
    for (const [nome, id] of [["Hakim Centro", HAKIM], ["loja de demonstração", DEMO], ["planPercent 0 (isenta pela mensalidade)", "loja-isenta"]] as const) {
      const e = await A.ligarOuDesligarRotaAutomatica(id, true, null, agora);
      conferir(`${nome}: ligada sem termo, sem gravar trecho, R$ 0`, e.isento && e.ativo && !assinaturas.has(id) && (await A.cobrancaDaRotaAutomaticaNoMes(id, mes.monthStart, mes.monthEnd)) === 0, e);
    }
    conferir("isenta de verdade: ligada só com a regra ligada", A.rotaLigadaDeVerdade(true, true, [], agora) && !A.rotaLigadaDeVerdade(false, true, [], agora));
    conferir("isenção pela lista ou pela mensalidade", A.rotaAutomaticaIsentaPor(HAKIM, false) && A.rotaAutomaticaIsentaPor(DEMO, false) && A.rotaAutomaticaIsentaPor("x", true) && !A.rotaAutomaticaIsentaPor(BOM_CHEFF, false));
  }

  console.log("\n[4] nada de graça (Bom Cheff)");
  {
    usuario(BOM_CHEFF); // a regra ligada no JSON, sem assinatura
    const e = await A.estadoDaRotaAutomatica(BOM_CHEFF, { agora });
    const daLoja = await A.rotaAutomaticaDaLoja(BOM_CHEFF, agora);
    conferir("sem ativar: desligada, sem teste começado, nada gravado, R$ 0",
      !e.ativo && !e.emTeste && !e.jaTestou && !e.isento && !daLoja.ligada && !assinaturas.has(BOM_CHEFF)
        && (await A.cobrancaDaRotaAutomaticaNoMes(BOM_CHEFF, mes.monthStart, mes.monthEnd)) === 0, e);
    let lancou = false;
    try { await A.ligarOuDesligarRotaAutomatica(BOM_CHEFF, true, null, agora); } catch (x) { lancou = x instanceof A.TermoNaoAceitoError; }
    conferir("… ligar sem o termo não vale", lancou && !assinaturas.has(BOM_CHEFF));
    const ligou = await A.ligarOuDesligarRotaAutomatica(BOM_CHEFF, true, aceite, agora);
    conferir("… ativando com o termo: 7 dias grátis, como qualquer loja", ligou.ativo && ligou.emTeste && assinaturas.get(BOM_CHEFF)?.trechos[0]?.aceite?.versao === VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA, ligou);
  }

  console.log("\n[5] o cron");
  {
    usuarios.clear();
    assinaturas.clear();
    usuario(HAKIM, { email: "contatohakim@gmail.com" });                         // isenta, sem linha → roda
    usuario("paga-ligada");                                                       // trecho ligado → roda
    assinaturas.set("paga-ligada", { ativo: true, testeAte: new Date(agora.getTime() - 20 * DIA), trechos: [{ de: new Date(agora.getTime() - 27 * DIA).toISOString(), ate: null, valor: 97 }] });
    usuario("paga-que-virou");                                                    // desligou e o mês virou → não roda
    assinaturas.set("paga-que-virou", { ativo: true, testeAte: new Date(agora.getTime() - 60 * DIA), trechos: [{ de: new Date(agora.getTime() - 67 * DIA).toISOString(), ate: new Date(agora.getTime() - DIA).toISOString(), valor: 97 }] });
    usuario("so-o-json");                                                         // regra ligada no JSON, sem assinatura → não roda
    usuario("desligada", { deliveryConfig: { roteirizacaoAutomatica: { ativo: false } } });
    assinaturas.set("desligada", { ativo: true, testeAte: null, trechos: [{ de: new Date(agora.getTime() - DIA).toISOString(), ate: null, valor: 97 }] }); // regra desligada → não roda
    usuario(BOM_CHEFF);                                                           // regra ligada no JSON, sem assinatura → não roda (nada de graça)
    leituras.length = 0;
    const lojas = await A.lojasComARotaAutomaticaLigada(agora);
    conferir("só as ligadas de verdade (isenta, trecho ligado)", JSON.stringify([...lojas].sort()) === JSON.stringify([HAKIM, "paga-ligada"].sort()), lojas);
    conferir("uma consulta só para todas as lojas (nenhuma a mais por loja)", leituras.length === 1, leituras);
    conferir("… e nada foi gravado para a Bom Cheff", !assinaturas.has(BOM_CHEFF));
    const de1 = await A.rotaAutomaticaDaLoja("paga-ligada", agora);
    const de2 = await A.rotaAutomaticaDaLoja("so-o-json", agora);
    conferir("uma loja numa consulta só (empurrão, carimbo, rodar agora)", de1.ligada && de1.configAtivo && !de2.ligada && de2.configAtivo && !!de1.storeLatLng);
  }

  console.log("\n[6] liberação");
  conferir("qualquer loja liberada; sem loja, não", liberadaPara("qualquer-loja") && liberadaPara(BOM_CHEFF) && !liberadaPara(null) && !liberadaPara(undefined));

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exitCode = falhou ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 20));
