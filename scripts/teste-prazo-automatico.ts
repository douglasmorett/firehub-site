// Prazo automático iFood e 99 (lib/prazo-automatico.ts): o prazo no site e a cobrança do mês.
//   npx tsx scripts/teste-prazo-automatico.ts
import {
  acrescimoNoSite,
  comPrazoAplicado,
  comPrazoDaExtensao,
  prazoDaExtensaoAgora,
  valorDoPrazoNoMes,
  PRECO_DO_PRAZO_AUTOMATICO,
} from "../src/lib/prazo-automatico";

let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe?: unknown) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${cond ? "" : ` → ${JSON.stringify(detalhe)}`}`);
};

const agora = new Date("2026-11-10T23:00:00Z");
const minAtras = (m: number) => new Date(agora.getTime() - m * 60000).toISOString();
const cfg = (minutos: number, em: string) => ({ motoboysCount: 3, prazoNoSite: { minutos, em } });

// ── prazo valendo ──
ok(prazoDaExtensaoAgora(cfg(58, minAtras(1)), agora) === 58, "prazo de 1 min atrás vale");
ok(prazoDaExtensaoAgora(cfg(58, minAtras(16)), agora) === null, "16 min sem sinal: volta ao tempo das áreas");
ok(prazoDaExtensaoAgora({ motoboysCount: 3 }, agora) === null, "sem extensão: nada");
ok(prazoDaExtensaoAgora(null, agora) === null, "etaConfig nulo: nada");

// ── acréscimo: a área mais rápida vira o prazo do iFood, as outras sobem junto ──
ok(acrescimoNoSite(cfg(58, minAtras(1)), [30, 40, 50], agora) === 28, "58 com áreas 30/40/50 → +28");
ok(acrescimoNoSite(cfg(28, minAtras(1)), [30, 40, 50], agora) === 0, "prazo menor que a área: não promete menos");
ok(acrescimoNoSite(cfg(58, minAtras(1)), [], agora) === 0, "loja sem tempo nas áreas: nada a somar");

const loja = {
  deliveryZones: [{ name: "Centro", fee: 5, time: 30 }, { name: "Longe", fee: 9, time: 50 }, { name: "Sem tempo", fee: 7 }],
  etaConfig: cfg(58, minAtras(1)),
};
const somada = comPrazoDaExtensao(loja, agora);
const tempos = (somada.deliveryZones as any[]).map((z) => z.time);
ok(JSON.stringify(tempos) === JSON.stringify([58, 78, undefined]), "zonas 30/50 → 58/78, zona sem tempo fica sem", tempos);
ok(somada.etaConfig === null, "devolve etaConfig nulo");
const duasVezes = comPrazoDaExtensao(somada, agora);
ok((duasVezes.deliveryZones as any[])[0].time === 58, "passar duas vezes não soma duas vezes");
ok((loja.deliveryZones[0] as any).time === 30, "não mexe no objeto original");
const semExtensao = { deliveryZones: [{ time: 30 }] };
ok(comPrazoDaExtensao(semExtensao, agora) === semExtensao, "loja sem etaConfig passa intacta");

// ── o que a extensão grava ──
const primeiro = comPrazoAplicado({ motoboysCount: 3 }, 58, "2026-11", agora);
ok(!!primeiro && primeiro.prazoNoSite?.minutos === 58 && primeiro.usoPorMes?.["2026-11"] === agora.toISOString(), "primeiro envio grava prazo e uso do mês", primeiro);
ok((primeiro as any).motoboysCount === 3, "mantém os motoboys");
const umMinDepois = new Date(agora.getTime() + 60000);
ok(comPrazoAplicado(primeiro, 58, "2026-11", umMinDepois) === null, "mesmo prazo 1 min depois: não regrava");
const mudou = comPrazoAplicado(primeiro, 78, "2026-11", umMinDepois);
ok(mudou?.prazoNoSite?.minutos === 78 && mudou?.usoPorMes?.["2026-11"] === agora.toISOString(), "prazo mudou: regrava, uso do mês fica o primeiro", mudou);
const seisMin = new Date(agora.getTime() + 6 * 60000);
ok(comPrazoAplicado(primeiro, 58, "2026-11", seisMin)?.prazoNoSite?.em === seisMin.toISOString(), "mesmo prazo depois de 5 min: renova o sinal");

// ── cobrança ──
const nov = { inicio: new Date("2026-11-01T03:00:00Z"), fim: new Date("2026-12-01T03:00:00Z") };
const usou = { usoPorMes: { "2026-11": "2026-11-10T23:00:00.000Z" } };
ok(valorDoPrazoNoMes(usou, "2026-11", nov.inicio, nov.fim) === PRECO_DO_PRAZO_AUTOMATICO, "usou em novembro: R$ 29,90");
ok(valorDoPrazoNoMes({}, "2026-11", nov.inicio, nov.fim) === 0, "não usou: nada");
ok(valorDoPrazoNoMes({ usoPorMes: { "2026-10": "2026-10-20T23:00:00.000Z" } }, "2026-11", nov.inicio, nov.fim) === 0, "uso de outubro não cobra novembro");
const out = { inicio: new Date("2026-10-01T03:00:00Z"), fim: new Date("2026-11-01T03:00:00Z") };
ok(valorDoPrazoNoMes({ usoPorMes: { "2026-10": "2026-10-20T23:00:00.000Z" } }, "2026-10", out.inicio, out.fim) === 0, "outubro (mês do anúncio): grátis");

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
