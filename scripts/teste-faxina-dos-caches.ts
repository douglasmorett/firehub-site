/**
 * A faxina dos caches do mapa (src/lib/faxina-dos-caches.ts).
 *
 *   npx tsx scripts/teste-faxina-dos-caches.ts
 */
import { DIAS_SEM_USO, faxinaDosCaches, sqlDaFaxina } from "../src/lib/faxina-dos-caches";

export {};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe ?? ""); }
}

confere("90 dias por padrão", DIAS_SEM_USO === 90);
confere("apaga pelo ÚLTIMO USO, não pela criação",
  sqlDaFaxina("GeocodeCache") === `DELETE FROM "GeocodeCache" WHERE "ultimoUso" < NOW() - INTERVAL '90 days'`, sqlDaFaxina("GeocodeCache"));
confere("rotas também", sqlDaFaxina("RotaCache", 30) === `DELETE FROM "RotaCache" WHERE "ultimoUso" < NOW() - INTERVAL '30 days'`);
confere("dias que não são inteiro positivo viram o padrão",
  [0, -5, 1.5, NaN].every((d) => sqlDaFaxina("RotaCache", d).includes("'90 days'")));
let recusou = false;
try { sqlDaFaxina("User" as never); } catch { recusou = true; }
confere("tabela fora da lista é recusada (nunca apaga outra coisa)", recusou);

async function rodar() {
  const pedidos: string[] = [];
  const r = await faxinaDosCaches(async (sql) => { pedidos.push(sql); return sql.includes("Geocode") ? 12 : 3; });
  confere("as duas tabelas, com o que cada uma apagou", r.GeocodeCache === 12 && r.RotaCache === 3 && pedidos.length === 2, r);
  const avisoOriginal = console.warn;
  console.warn = () => {};
  const r2 = await faxinaDosCaches(async (sql) => { if (sql.includes("Geocode")) throw new Error("relation does not exist"); return 1; });
  console.warn = avisoOriginal;
  confere("uma tabela que falha não impede a outra", r2.GeocodeCache === null && r2.RotaCache === 1, r2);
}

rodar()
  .catch((e) => { falhas++; console.log("✖ estourou", e); })
  .finally(() => {
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
  });
