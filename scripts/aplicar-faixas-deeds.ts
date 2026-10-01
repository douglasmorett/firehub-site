/**
 * Cadastra na Deeds Delivery (Londrina) a tabela de entrega por km percorrido
 * que a loja usava no sistema anterior (foto enviada pela Paula em 01/10/2026).
 * O tempo lá era "a consultar": ficou 40 / 50 / 60 min, ajustável no painel.
 *
 *   km de rua : 0,5  1    2    3    4    4,5  5    6    7    7,5
 *   taxa (R$) : 2,99 2,99 2,99 2,99 3,99 4,99 5,99 6,99 7,99 7,99
 *
 * A loja estava gravada como raio (KM) com a tabela de exemplo da tela.
 * Passa pela MESMA normalização da tela (lib/cadastro-da-entrega.ts): se ela
 * recusar alguma faixa, nada é gravado. Não mexe no repasse do motoboy.
 *
 *   npx tsx scripts/aplicar-faixas-deeds.ts            (só mostra)
 *   npx tsx scripts/aplicar-faixas-deeds.ts --gravar   (grava)
 */
import { readFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { normalizarFaixasDeKm } from "../src/lib/cadastro-da-entrega";

const LOJA = "cmufs5onv002dk801m56rpp5b";
const GRAVAR = process.argv.includes("--gravar");

const TABELA: [km: number, taxa: number, minutos: number][] = [
  [0.5, 2.99, 40], [1, 2.99, 40], [2, 2.99, 40], [3, 2.99, 40], [4, 3.99, 50],
  [4.5, 4.99, 50], [5, 5.99, 50], [6, 6.99, 60], [7, 7.99, 60], [7.5, 7.99, 60],
];

function urlDoBanco(): string {
  for (const arq of ["C:/Users/Micro/Documents/firehub-site/.env", ".env"]) {
    if (!existsSync(arq)) continue;
    const m = readFileSync(arq, "utf8").match(/^DATABASE_URL="?([^"\n]+)/m);
    if (m) return m[1];
  }
  throw new Error("sem DATABASE_URL");
}

(async () => {
  const sql = neon(urlDoBanco());
  const [loja] = await sql`SELECT "storeName","deliveryZoneType","deliveryZones","storeLatLng" FROM "User" WHERE id = ${LOJA}`;
  if (!loja) throw new Error("loja não encontrada");

  const r = normalizarFaixasDeKm(TABELA.map(([km, fee, time]) => ({ km, fee, time }))) as any;
  const erros = r.ok ? [] : (r.problemas || []).filter((p: any) => p.nivel === "erro");
  if (erros.length) {
    console.log("A normalização da tela recusou a tabela — nada gravado:");
    for (const e of erros) console.log("  ✖", e.mensagem || JSON.stringify(e));
    process.exit(1);
  }
  const faixas = r.zonas;
  if (!Array.isArray(faixas) || faixas.length !== TABELA.length) {
    console.log("Formato inesperado da normalização:", JSON.stringify(r).slice(0, 400));
    process.exit(1);
  }

  console.log(`Loja: ${loja.storeName}  (modo atual: ${loja.deliveryZoneType}, pino: ${JSON.stringify(loja.storeLatLng)})`);
  console.log("Faixas atuais:", JSON.stringify(loja.deliveryZones));
  console.log("Faixas novas: ", JSON.stringify(faixas));
  if (!GRAVAR) { console.log("\n(simulação — use --gravar)"); return; }

  await sql`UPDATE "User" SET "deliveryZoneType" = 'ROTA', "deliveryZones" = ${JSON.stringify(faixas)}::jsonb WHERE id = ${LOJA}`;
  const [depois] = await sql`SELECT "deliveryZoneType","deliveryZones" FROM "User" WHERE id = ${LOJA}`;
  console.log("\nGRAVADO. Conferência:", depois.deliveryZoneType, JSON.stringify(depois.deliveryZones));
})().catch((e) => { console.error(e); process.exit(1); });
