/**
 * Rota 100% automatizada — o planejador (lib/roteirizacao-automatica/planejador.ts),
 * a leitura da regra (config.ts), a liberação (liberacao.ts) e o prazo (prazo.ts).
 *
 * Fase 0 do plano (vault "FireHub - Plano despacho automático"): nada liga de
 * verdade, mas a decisão tem de estar certa antes de o Douglas ver a prévia.
 * Os casos são os da lista da Fase 0: semente por prazo; priorizado à mão
 * antes do menor prazo; raio; desvio; janela de prazo; rota cheia; sem ponto;
 * agendado; crescer rota aberta; não mexer em chamada; espera estourada tira
 * os não prontos; chamada escolhe quem chegou primeiro; ninguém na loja →
 * motoboyId null; cancelado sai; rota vazia apaga; determinismo.
 *
 *   npx tsx scripts/teste-roteirizacao-automatica.ts
 *
 * Sem banco e sem rede. O prazo.ts importa lib/painel-do-dono (que importa o
 * Prisma): o Prisma é simulado em globalThis.prisma, como em
 * teste-fila-do-mapa.ts, e o import é dinâmico, depois do DATABASE_URL falso.
 */
// Módulo (e não script): o tsconfig inclui scripts/, e sem isto as variáveis
// deste arquivo colidiriam com as de outros testes no mesmo escopo global.
export {};

process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";
(globalThis as any).prisma = {};

type Ponto = { lat: number; lng: number };

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

// Hakim Centro, mais ou menos.
const LOJA: Ponto = { lat: -22.52, lng: -41.94 };
/** Um ponto a `leste` km a leste e `norte` km ao norte da loja. */
const em = (leste: number, norte = 0): Ponto => ({
  lat: LOJA.lat + norte / 111.32,
  lng: LOJA.lng + leste / (111.32 * Math.cos((LOJA.lat * Math.PI) / 180)),
});

const AGORA = new Date("2026-10-22T22:00:00.000Z");
const min = (m: number) => new Date(AGORA.getTime() + m * 60_000);

async function main() {
  const { planejar, ordenarParadas, RECHAMAR_DEPOIS_MIN } = await import("../src/lib/roteirizacao-automatica/planejador");
  const { lerRoteirizacaoAutomatica, limparRoteirizacaoAutomatica, ROTEIRIZACAO_AUTOMATICA_PADRAO } = await import("../src/lib/roteirizacao-automatica/config");
  const { liberadaPara, lojaDoUsuario } = await import("../src/lib/roteirizacao-automatica/liberacao");
  const { prazoDoPedido, agendadoParaDepois } = await import("../src/lib/roteirizacao-automatica/prazo");
  type Pedido = import("../src/lib/roteirizacao-automatica/planejador").PedidoParaDespacho;
  type Rota = import("../src/lib/roteirizacao-automatica/planejador").RotaAberta;
  type Motoboy = import("../src/lib/roteirizacao-automatica/planejador").MotoboyLivre;
  type Acao = import("../src/lib/roteirizacao-automatica/planejador").Acao;

  const CFG = { ...ROTEIRIZACAO_AUTOMATICA_PADRAO, ativo: true };

  /** Pedido de teste: id = "p" + número; prazo em minutos a partir de AGORA. */
  const pedido = (numero: number, ponto: Ponto | null, prazoMin: number, extra: Partial<Pedido> = {}): Pedido => ({
    id: `p${String(numero).padStart(2, "0")}`,
    numero,
    ponto,
    prazo: min(prazoMin),
    criadoEm: min(prazoMin - 45),
    pronto: false,
    prontoEm: null,
    rotaId: null,
    prioridadeManual: false,
    ...extra,
  });
  const pronto = (haMin: number): Partial<Pedido> => ({ pronto: true, prontoEm: min(-haMin) });
  const rota = (id: string, pedidos: Pedido[], extra: Partial<Rota> = {}): Rota => ({
    id, routeNumber: `Rota #${id}`, pedidos: pedidos.map((p) => ({ ...p, rotaId: id })), chamadaEm: null, ...extra,
  });
  const plano = (pedidos: Pedido[], rotasAbertas: Rota[] = [], motoboys: Motoboy[] = [], config = CFG) =>
    planejar({ loja: LOJA, config, pedidos, rotasAbertas, motoboys, agora: AGORA });
  const criadas = (acoes: Acao[]) => acoes.filter((a): a is Extract<Acao, { tipo: "criar-rota" }> => a.tipo === "criar-rota").map((a) => a.pedidos);
  const chamadas = (acoes: Acao[]) => acoes.filter((a): a is Extract<Acao, { tipo: "chamar" }> => a.tipo === "chamar");
  const motivoDe = (r: ReturnType<typeof plano>, id: string) => r.descartados.find((d) => d.pedidoId === id)?.motivo;
  const mesmoConjunto = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

  console.log("\n== Semente e agrupamento ==");
  {
    // Dois pedidos prontos longe um do outro: duas rotas de 1, a do menor prazo primeiro.
    const r = plano([pedido(1, em(3), 40, pronto(1)), pedido(2, em(-3), 20, pronto(1))]);
    const c = criadas(r.acoes);
    conferir("semente = menor prazo: a primeira rota criada é a do #2", c.length === 2 && c[0][0] === "p02", c);
  }
  {
    // O #3 tem prioridade pedida à mão e o maior prazo: é ele a semente.
    const r = plano([
      pedido(1, em(1), 10), pedido(2, em(1.2), 12), pedido(3, em(1.1), 30, { prioridadeManual: true }),
    ], [], [], { ...CFG, maxEntregasPorRota: 2, janelaDePrazoMin: 30 });
    const a = r.acoes.find((x) => x.tipo === "criar-rota") as Extract<Acao, { tipo: "criar-rota" }> | undefined;
    conferir("priorizado à mão vira semente antes do menor prazo", !!a && a.pedidos.includes("p03") && /prioridade/.test(a.motivo), a);
  }
  {
    // Candidato a 1,5 km da semente (raio 2): entra.
    const r = plano([pedido(1, em(3), 20), pedido(2, em(3, 1.5), 25)]);
    conferir("raio: candidato a 1,5 km da semente entra na rota", mesmoConjunto(criadas(r.acoes)[0] ?? [], ["p01", "p02"]), r.acoes);
  }
  {
    // Candidato a 4 km da semente, do outro lado: não entra; nenhum dos dois está pronto.
    const r = plano([pedido(1, em(2), 20), pedido(2, em(-2), 25)]);
    conferir("fora do raio: ninguém pronto e longe → nenhuma rota", criadas(r.acoes).length === 0, r.acoes);
    conferir("… e o motivo é fora-do-raio", motivoDe(r, "p02") === "fora-do-raio" && motivoDe(r, "p01") === "fora-do-raio", r.descartados);
  }
  {
    // Semente a 5 km; candidato a 2,5 km no caminho (2,5 km da semente > raio 2), desvio ~0.
    const r = plano([pedido(1, em(5), 20), pedido(2, em(2.5, 0.1), 25)]);
    conferir("desvio: pedido no caminho entra mesmo fora do raio da semente", mesmoConjunto(criadas(r.acoes)[0] ?? [], ["p01", "p02"]), r.acoes);
    conferir("… e a ordem das paradas é o do caminho primeiro", (criadas(r.acoes)[0] ?? []).join() === "p02,p01", r.acoes);
  }
  {
    // Perto, mas prazo 20 min depois da semente (janela 15).
    const r = plano([pedido(1, em(1), 20), pedido(2, em(1.3), 40)]);
    conferir("janela de prazo: prazo 20 min depois não entra", criadas(r.acoes).length === 0, r.acoes);
    conferir("… motivo prazo-incompativel", motivoDe(r, "p02") === "prazo-incompativel", r.descartados);
  }
  {
    // Três vizinhos, máximo 2: o terceiro fica de fora por rota cheia.
    const r = plano([pedido(1, em(1), 20), pedido(2, em(1.1), 21), pedido(3, em(1.2), 22)], [], [], { ...CFG, maxEntregasPorRota: 2 });
    const c = criadas(r.acoes);
    conferir("rota cheia: só 2 por rota", c.length === 1 && c[0].length === 2 && c[0].includes("p01"), c);
    conferir("… o que sobrou é rota-cheia", motivoDe(r, "p03") === "rota-cheia", r.descartados);
  }
  {
    const r = plano([pedido(1, null, 20, pronto(5))]);
    conferir("sem ponto: não entra e diz sem-ponto", criadas(r.acoes).length === 0 && motivoDe(r, "p01") === "sem-ponto", r);
  }
  {
    const r = plano([
      pedido(1, em(1), 20, { fora: "agendado" }), pedido(2, em(1), 20, { fora: "parceiro" }),
      pedido(3, em(1), 20, { fora: "ja-com-motoboy" }), pedido(4, em(1), 20, { fora: "rota-manual" }),
    ]);
    conferir("agendado / parceiro / com motoboy / rota manual: só relatados",
      criadas(r.acoes).length === 0 && motivoDe(r, "p01") === "agendado" && motivoDe(r, "p02") === "parceiro" &&
      motivoDe(r, "p03") === "ja-com-motoboy" && motivoDe(r, "p04") === "rota-manual", r);
  }
  {
    const r1 = plano([pedido(1, em(2), 20)]);
    conferir("sozinho e na cozinha: não cria rota (espera companhia)", criadas(r1.acoes).length === 0 && motivoDe(r1, "p01") === "esperando-companhia", r1);
    const r2 = plano([pedido(1, em(2), 20, pronto(0))]);
    conferir("sozinho e pronto: vira rota de 1", criadas(r2.acoes).length === 1 && criadas(r2.acoes)[0].join() === "p01", r2.acoes);
  }

  console.log("\n== Rota aberta ==");
  {
    const aberta = rota("R1", [pedido(1, em(2), 20)]);
    const r = plano([pedido(2, em(1, 0.2), 25)], [aberta]);
    const a = r.acoes.find((x) => x.tipo === "acrescentar") as Extract<Acao, { tipo: "acrescentar" }> | undefined;
    conferir("crescer rota aberta: o pedido novo que cabe entra", !!a && a.rotaId === "R1" && a.pedidoId === "p02", r.acoes);
    conferir("… na posição certa (mais perto da loja = 1ª parada)", a?.posicao === 1 && a?.ordem.join() === "p02,p01", a);
    conferir("… e não cria rota nova", criadas(r.acoes).length === 0, r.acoes);
  }
  {
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(2))], { chamadaEm: min(-5), chamadaMotoboyId: "m1" });
    const r = plano([pedido(2, em(2.1), 22)], [chamada]);
    conferir("não mexe em rota chamada: nada é acrescentado nem chamado de novo",
      !r.acoes.some((x) => "rotaId" in x && x.rotaId === "R1"), r.acoes);
  }
  {
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(70))], { chamadaEm: min(-(RECHAMAR_DEPOIS_MIN + 1)) });
    const r = plano([], [chamada], [{ id: "m1", nome: "Maicon", naLojaDesde: min(-3), gpsFresco: true }]);
    const c = chamadas(r.acoes);
    conferir("chamada há mais de 60 min sem ninguém puxar: chama de novo", c.length === 1 && c[0].rotaId === "R1" && c[0].motoboyId === "m1", r.acoes);
  }
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(1)), pedido(2, em(2.2), 22, pronto(0))])]);
    conferir("todos prontos (2): chama", chamadas(r.acoes).length === 1, r.acoes);
  }
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(3))])]);
    conferir("rota de 1 pronta há 3 min (espera 8): ainda espera companhia", chamadas(r.acoes).length === 0, r.acoes);
    const r2 = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(9))])]);
    conferir("rota de 1 pronta há 9 min: chama", chamadas(r2.acoes).length === 1, r2.acoes);
  }
  {
    // O mais urgente pronto há 10 min, o outro ainda na chapa: o outro sai e a rota é chamada.
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(10)), pedido(2, em(2.2), 25)])]);
    const tirados = r.acoes.filter((x) => x.tipo === "tirar-da-rota");
    conferir("espera estourada: o não pronto sai da rota", tirados.length === 1 && (tirados[0] as any).pedidoId === "p02" && (tirados[0] as any).motivo === "espera-estourada", r.acoes);
    conferir("… e a rota é chamada com o pronto", chamadas(r.acoes).length === 1 && chamadas(r.acoes)[0].rotaId === "R1", r.acoes);
    conferir("… o que saiu volta ao bolo (sozinho e na cozinha: esperando)", motivoDe(r, "p02") === "esperando-companhia", r.descartados);
    const r2 = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(3)), pedido(2, em(2.2), 25)])]);
    conferir("espera NÃO estourada (3 min): nada muda", r2.acoes.length === 0, r2.acoes);
  }

  console.log("\n== Quem é chamado ==");
  const prontaR = (id: string, prazo: number) => rota(id, [pedido(prazo, em(2), prazo, pronto(1)), pedido(prazo + 1, em(2.1), prazo, pronto(1))]);
  {
    const motoboys: Motoboy[] = [
      { id: "m1", nome: "Kaio", naLojaDesde: min(-10), gpsFresco: true },
      { id: "m2", nome: "Maicon", naLojaDesde: min(-20), gpsFresco: true },
      { id: "m3", nome: "Na rua", naLojaDesde: null, gpsFresco: true },
    ];
    const r = plano([], [prontaR("R1", 20)], motoboys);
    conferir("chamada escolhe quem chegou primeiro na loja (naLojaDesde mais antigo)", chamadas(r.acoes)[0]?.motoboyId === "m2", r.acoes);
    const r2 = plano([], [prontaR("R1", 20)], motoboys.map((m) => (m.id === "m2" ? { ...m, gpsFresco: false } : m)));
    conferir("GPS parado há mais de 3 min não conta como na loja", chamadas(r2.acoes)[0]?.motoboyId === "m1", r2.acoes);
    const r3 = plano([], [prontaR("R1", 20), prontaR("R2", 30), prontaR("R3", 40)], motoboys);
    const c3 = chamadas(r3.acoes);
    conferir("três rotas, dois na loja: a mais urgente leva o primeiro, a 2ª o segundo, a 3ª avisa todos",
      c3.map((c) => `${c.rotaId}:${c.motoboyId}`).join() === "R1:m2,R2:m1,R3:null", c3);
    const ocupada = rota("R0", [pedido(80, em(4), 80, pronto(1))], { chamadaEm: min(-2), chamadaMotoboyId: "m2" });
    const r4 = plano([], [ocupada, prontaR("R1", 20)], motoboys);
    conferir("motoboy já chamado para outra rota não é chamado de novo", chamadas(r4.acoes).find((c) => c.rotaId === "R1")?.motoboyId === "m1", r4.acoes);
  }
  {
    const r = plano([], [prontaR("R1", 20)], [{ id: "m3", nome: "Na rua", naLojaDesde: null, gpsFresco: true }]);
    conferir("ninguém na loja → chamar com motoboyId null (avisa todos os livres)", chamadas(r.acoes).length === 1 && chamadas(r.acoes)[0].motoboyId === null, r.acoes);
  }

  console.log("\n== Limpeza ==");
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, { cancelado: true }), pedido(2, em(2.1), 22)])]);
    const t = r.acoes.find((x) => x.tipo === "tirar-da-rota") as any;
    conferir("cancelado sai da rota", t?.pedidoId === "p01" && t?.motivo === "cancelado", r.acoes);
    conferir("… e a rota não é apagada (ainda tem o #2)", !r.acoes.some((x) => x.tipo === "apagar-rota"), r.acoes);
  }
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, { cancelado: true })])]);
    conferir("rota que ficou vazia é apagada", r.acoes.some((x) => x.tipo === "apagar-rota" && x.rotaId === "R1"), r.acoes);
  }
  {
    const r = plano([pedido(3, em(2.05), 21, pronto(20))], [rota("R1", [pedido(1, em(2), 20, { fora: "ja-com-motoboy" }), pedido(2, em(2.1), 22, pronto(20))])]);
    conferir("rota com um pedido já puxado: não cresce nem é chamada", !r.acoes.some((x) => "rotaId" in x && x.rotaId === "R1"), r.acoes);
  }

  console.log("\n== Ordem das paradas e determinismo ==");
  {
    const ordem = ordenarParadas(LOJA, [{ id: "c", ponto: em(3) }, { id: "a", ponto: em(1) }, { id: "x", ponto: null }, { id: "b", ponto: em(2) }]);
    conferir("vizinho mais próximo a partir da loja; sem ponto vai para o fim", ordem.join() === "a,b,c,x", ordem);
  }
  {
    const pedidos = [
      pedido(1, em(1), 20), pedido(2, em(1.2, 0.3), 24), pedido(3, em(-2), 18, pronto(2)), pedido(4, em(-2.3), 30),
      pedido(5, em(0.5, 2), 22, { prioridadeManual: true }), pedido(6, null, 15), pedido(7, em(4), 60),
    ];
    const rotas = [rota("R9", [pedido(8, em(3, 1), 25, pronto(1))])];
    const motoboys: Motoboy[] = [{ id: "m1", nome: "A", naLojaDesde: min(-4), gpsFresco: true }, { id: "m2", nome: "B", naLojaDesde: min(-4), gpsFresco: true }];
    const a = plano(pedidos, rotas, motoboys);
    const b = plano(pedidos, rotas, motoboys);
    const c = plano([...pedidos].reverse(), [...rotas].reverse(), [...motoboys].reverse());
    conferir("mesma entrada → mesma saída", JSON.stringify(a) === JSON.stringify(b));
    conferir("entrada em outra ordem → mesma saída", JSON.stringify(a) === JSON.stringify(c), { a, c });
  }

  console.log("\n== A regra gravada (config.ts) ==");
  {
    conferir("sem nada gravado: o padrão", JSON.stringify(lerRoteirizacaoAutomatica(null)) === JSON.stringify(ROTEIRIZACAO_AUTOMATICA_PADRAO));
    const lida = lerRoteirizacaoAutomatica({ freteGratis: 50, roteirizacaoAutomatica: { ativo: true, maxEntregasPorRota: 12, raioDoGrupoKm: 0.1, esperaMaxMin: "abc", quemPuxa: "qualquer", lixo: 1 } });
    conferir("lê a chave do deliveryConfig e prende nos limites", lida.ativo && lida.maxEntregasPorRota === 6 && lida.raioDoGrupoKm === 0.5 && lida.esperaMaxMin === 8 && lida.quemPuxa === "qualquer", lida);
    conferir("… e não copia chave desconhecida", !("lixo" in lida));
    conferir("quemPuxa inválido vira 'chamado'; ativo só com true", limparRoteirizacaoAutomatica({ quemPuxa: "todos", ativo: "true" }).quemPuxa === "chamado" && limparRoteirizacaoAutomatica({ ativo: "true" }).ativo === false);
    conferir("deliveryConfig com chave 'ativo' solta não liga nada", lerRoteirizacaoAutomatica({ ativo: true }).ativo === false);
  }

  console.log("\n== Liberação e prazo ==");
  {
    conferir("Hakim Centro liberada", liberadaPara("cmpx96phr0000ujf0sb0qk5vr"));
    conferir("loja de demonstração liberada (ensaio com o simulador)", liberadaPara("cmupkiesh0000ujmcjwtpd706"));
    conferir("outra loja não", !liberadaPara("loja-qualquer-fora-da-lista") && !liberadaPara(null));
    conferir("funcionário resolve para a loja do dono", lojaDoUsuario({ id: "func", ownerId: "cmpx96phr0000ujf0sb0qk5vr" }) === "cmpx96phr0000ujf0sb0qk5vr");
    const criado = "2026-10-22T21:00:00.000Z";
    conferir("prazo = criação + tempoEntregaMin", prazoDoPedido({ createdAt: criado, deliveryType: "DELIVERY", tempoEntregaMin: 40 }, []).toISOString() === "2026-10-22T21:40:00.000Z");
    conferir("sem tempo gravado: o maior tempo das áreas", prazoDoPedido({ createdAt: criado, deliveryType: "DELIVERY" }, [{ time: 30 }, { time: 50 }]).toISOString() === "2026-10-22T21:50:00.000Z");
    conferir("prazo do parceiro (scheduledDatetime) vale primeiro", prazoDoPedido({ createdAt: criado, deliveryType: "DELIVERY", scheduledDatetime: "2026-10-22T21:35:00.000Z", tempoEntregaMin: 60 }, []).toISOString() === "2026-10-22T21:35:00.000Z");
    const agendado = { createdAt: criado, deliveryType: "DELIVERY", agendado: true, scheduledDatetime: "2026-10-23T01:00:00.000Z" };
    conferir("agendado para daqui a 3 h (libera 60 min antes): fora", agendadoParaDepois(agendado, 60, AGORA));
    conferir("agendado para daqui a 50 min: já entra", !agendadoParaDepois({ ...agendado, scheduledDatetime: "2026-10-22T22:50:00.000Z" }, 60, AGORA));
  }

  // ── Fase 1: o que GRAVAR (gravacoes.ts) a partir das ações ───────────────
  const { gravacoesDasAcoes } = await import("../src/lib/roteirizacao-automatica/gravacoes");
  const { pedePrioridadeNaRota } = await import("../src/lib/rotas-da-loja");
  const { pontoParaRotaAutomatica } = await import("../src/lib/roteirizacao-automatica/ponto");
  type Passo = import("../src/lib/roteirizacao-automatica/gravacoes").Passo;
  const lidas = (rotas: Rota[]) => rotas.map((r) => ({ id: r.id, pedidoIds: r.pedidos.map((p) => p.id) }));
  const tipos = (passos: Passo[]) => passos.map((p) => p.tipo).join(",");

  console.log("\n== Fase 1: as gravações ==");
  {
    const r = plano([pedido(1, em(1), 20), pedido(2, em(1.2), 22)]);
    const g = gravacoesDasAcoes(r.acoes, []);
    const criar = g.passos.find((p) => p.tipo === "criar-rota") as Extract<Passo, { tipo: "criar-rota" }> | undefined;
    conferir("criar-rota vira UMA rota nova com os pedidos na ordem das paradas (sequência = posição)",
      g.passos.length === 1 && criar?.pedidoIds.join() === (criadas(r.acoes)[0] ?? []).join() && criar?.pedidoIds.join() === "p01,p02", g);
  }
  {
    // Rota aberta R1 com o #1; o #2 (mais perto da loja) entra na frente.
    const aberta = rota("R1", [pedido(1, em(2), 20)]);
    const r = plano([pedido(2, em(1, 0.2), 25)], [aberta]);
    const g = gravacoesDasAcoes(r.acoes, lidas([aberta]));
    const seq = g.passos.find((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }> | undefined;
    conferir("acrescentar: o pedido entra e a sequência da rota INTEIRA é regravada na ordem nova",
      tipos(g.passos) === "entrar-na-rota,sequencia" && seq?.rotaId === "R1" && seq?.pedidoIds.join() === "p02,p01", g);
  }
  {
    // Duas entradas na mesma rota no mesmo ciclo: uma sequência só, com a última ordem.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 1, ordem: ["p02", "p01"] },
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p03", posicao: 2, ordem: ["p02", "p03", "p01"] },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const seqs = g.passos.filter((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }>[];
    conferir("duas entradas na mesma rota: uma sequência, a última, depois das entradas",
      tipos(g.passos) === "entrar-na-rota,entrar-na-rota,sequencia" && seqs.length === 1 && seqs[0].pedidoIds.join() === "p02,p03,p01", g);
  }
  {
    // Rota que não está entre as AUTO abertas lidas (a manual, a que saiu): não se mexe.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "MANUAL1", pedidoId: "p02", posicao: 1, ordem: ["p02"] },
      { tipo: "tirar-da-rota", rotaId: "MANUAL1", pedidoId: "p01", motivo: "cancelado" },
      { tipo: "apagar-rota", rotaId: "MANUAL1" },
      { tipo: "chamar", rotaId: "MANUAL1", motoboyId: null },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p09"] }]);
    conferir("rota fora das AUTO abertas (manual): nenhuma gravação, nada pendente",
      g.passos.length === 0 && g.pendentes.length === 0 && g.ignoradas.length === 4 && g.ignoradas.every((i) => i.motivo === "rota-desconhecida"), g);
  }
  {
    // Cancelado sozinho na rota: sai, e a rota (vazia) é apagada.
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, { cancelado: true })])]);
    const g = gravacoesDasAcoes(r.acoes, lidas([rota("R1", [pedido(1, em(2), 20)])]));
    conferir("cancelado sai e a rota vazia é apagada (nesta ordem)", tipos(g.passos) === "sair-da-rota,apagar-rota", g);
  }
  {
    // apagar-rota de rota que ainda tem pedido: recusada.
    const g = gravacoesDasAcoes([{ tipo: "apagar-rota", rotaId: "R1" }], [{ id: "R1", pedidoIds: ["p01", "p02"] }]);
    conferir("apagar-rota só se vazia: com pedido, não apaga", g.passos.length === 0 && g.ignoradas[0]?.motivo === "rota-com-pedido", g);
    const g2 = gravacoesDasAcoes(
      [{ tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p01", motivo: "cancelado" }, { tipo: "apagar-rota", rotaId: "R1" }],
      [{ id: "R1", pedidoIds: ["p01", "p02"] }],
    );
    conferir("… tirar um de dois e mandar apagar: sai um, a rota fica", tipos(g2.passos) === "sair-da-rota" && g2.ignoradas[0]?.motivo === "rota-com-pedido", g2);
  }
  {
    // Espera estourada: o não pronto sai; a chamada fica para a Fase 2.
    const aberta = rota("R1", [pedido(1, em(2), 20, pronto(10)), pedido(2, em(2.2), 25)]);
    const r = plano([], [aberta]);
    const g = gravacoesDasAcoes(r.acoes, lidas([aberta]));
    const sai = g.passos[0] as Extract<Passo, { tipo: "sair-da-rota" }> | undefined;
    conferir("espera estourada: o não pronto sai da rota", tipos(g.passos) === "sair-da-rota" && sai?.pedidoId === "p02" && sai?.motivo === "espera-estourada", g);
    conferir("chamar NÃO é gravado nesta fase: fica pendente", g.pendentes.length === 1 && g.pendentes[0].tipo === "chamar" && !g.passos.some((p) => (p as any).tipo === "chamar"), g);
  }
  {
    // Pedido que entrou numa rota aberta não entra também numa rota nova; tirar quem não está na rota é ignorado.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 2, ordem: ["p01", "p02"] },
      { tipo: "criar-rota", pedidos: ["p02", "p03"], motivo: "teste" },
      { tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p07", motivo: "cancelado" },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const criar = g.passos.find((p) => p.tipo === "criar-rota") as Extract<Passo, { tipo: "criar-rota" }> | undefined;
    conferir("pedido repetido no ciclo: só a primeira rota leva", criar?.pedidoIds.join() === "p03", g);
    conferir("tirar pedido que não está na rota: ignorado", g.ignoradas.some((i) => i.motivo === "fora-da-rota") && !g.passos.some((p) => p.tipo === "sair-da-rota"), g);
  }
  {
    // Saída depois de entrada na mesma rota: a sequência não leva quem saiu.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 1, ordem: ["p02", "p01"] },
      { tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p01", motivo: "cancelado" },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const seq = g.passos.find((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }> | undefined;
    conferir("sequência regravada só com quem ficou na rota", seq?.pedidoIds.join() === "p02", g);
  }
  {
    conferir("prioridade no KDS: na cozinha pede, pronto/saiu/entregue não",
      pedePrioridadeNaRota("ACEITO") && pedePrioridadeNaRota("PREPARANDO") && !pedePrioridadeNaRota("PRONTO") && !pedePrioridadeNaRota("SAIU_ENTREGA") && !pedePrioridadeNaRota("ENTREGUE"));
    const area = { centro: LOJA, raioKm: 8, raioDoParceiroKm: 12, base: "faixas" as const };
    const p = em(1.5);
    conferir("ponto da rota automática: o do cliente vale", !!pontoParaRotaAutomatica({ ...p, origem: "pino" }, false, area));
    conferir("… o centro do bairro NÃO (D3)", pontoParaRotaAutomatica({ ...p, origem: "bairro" }, false, area) === null);
    conferir("… sem nada gravado, nada", pontoParaRotaAutomatica(null, false, area) === null);
  }

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exitCode = falhou ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 20));
