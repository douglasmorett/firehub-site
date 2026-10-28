/**
 * Teste do "só motoboy online" no Despachar Rota (lib/motoboy-online.ts) e da
 * opção no App Motoboys (lib/app-motoboy-config.ts). Rodar:
 * npx tsx scripts/teste-motoboy-online.ts
 */
import { estaOnlineNoApp } from "../src/lib/motoboy-online";
import { lerAppMotoboyConfig } from "../src/lib/app-motoboy-config";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const agora = new Date("2026-10-28T01:00:00-03:00").getTime();
const minAtras = (m: number) => new Date(agora - m * 60_000).toISOString();

confere("mandou GPS agora", estaOnlineNoApp({ lastLocationUpdate: minAtras(0) }, agora), true);
confere("há 30 min ainda vale", estaOnlineNoApp({ lastLocationUpdate: minAtras(30) }, agora), true);
confere("há 31 min não", estaOnlineNoApp({ lastLocationUpdate: minAtras(31) }, agora), false);
confere("ontem não", estaOnlineNoApp({ lastLocationUpdate: minAtras(60 * 24) }, agora), false);
confere("apertou Sair (posição apagada)", estaOnlineNoApp({ lastLocationUpdate: null }, agora), false);
confere("nunca abriu o app", estaOnlineNoApp({}, agora), false);
confere("data quebrada", estaOnlineNoApp({ lastLocationUpdate: "x" }, agora), false);
confere("Date em vez de texto", estaOnlineNoApp({ lastLocationUpdate: new Date(agora - 5 * 60_000) }, agora), true);

// A lista da Frangoso em 28/10 ~01h: só os dois com GPS recente ficam.
const frangoso = [
  { name: "Douglas", lastLocationUpdate: minAtras(1) },
  { name: "gulherme texeira", lastLocationUpdate: minAtras(8) },
  { name: "luis alberto", lastLocationUpdate: minAtras(60 * 24 - 30) },
  { name: "Pedro Henrique", lastLocationUpdate: minAtras(60 * 48) },
  { name: "Lucas Pimenta", lastLocationUpdate: minAtras(60 * 24 * 6) },
  { name: "gabriel nascimento", lastLocationUpdate: null },
];
confere("Frangoso: só quem está no app", frangoso.filter((m) => estaOnlineNoApp(m, agora)).map((m) => m.name), ["Douglas", "gulherme texeira"]);

confere("opção nasce desligada", lerAppMotoboyConfig(null).despachoSoOnline, false);
confere("opção ligada é lida", lerAppMotoboyConfig({ despachoSoOnline: true }).despachoSoOnline, true);
confere("valor que não é booleano é ignorado", lerAppMotoboyConfig({ despachoSoOnline: "sim" }).despachoSoOnline, false);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\ntudo ok");
