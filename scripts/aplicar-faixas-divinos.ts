/**
 * Cadastra na Divinos Burger a tabela real de entrega por km percorrido
 * (tabela que o dono usava no sistema anterior, 25/09/2026):
 *
 *   km de rua : taxa ao cliente • motoboy recebe
 *   1   R$ 5 • R$ 4      1,5 R$ 8 • R$ 7      2   R$ 10 • R$ 9
 *   2,5 R$ 12 • R$ 11    3   R$ 15 • R$ 14    3,5 R$ 17 • R$ 16
 *   4   R$ 18 • R$ 17    4,5 R$ 19 • R$ 18    5   R$ 20 • R$ 19
 *
 * SÓ RODAR DEPOIS DO DEPLOY da entrega por km (commit 794ca591 em diante). Com
 * o código antigo, endereço "não localizado" pagava a faixa MAIS CARA — com
 * esta tabela, R$ 20 para quem mora a 300 m.
 *
 * Passa pela MESMA normalização da tela (lib/cadastro-da-entrega.ts): se ela
 * recusar alguma faixa, nada é gravado.
 *
 *   npx tsx scripts/aplicar-faixas-divinos.ts            (só mostra)
 *   npx tsx scripts/aplicar-faixas-divinos.ts --gravar   (grava)
 */
import { readFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { normalizarFaixasDeKm } from "../src/lib/cadastro-da-entrega";

const LOJA = "cmudbzcus0008ka010pmo1e0w";
const GRAVAR = process.argv.includes("--gravar");

const TABELA: [km: number, taxa: number, motoboy: number, minutos: number][] = [
  [1, 5, 4, 30], [1.5, 8, 7, 30], [2, 10, 9, 35], [2.5, 12, 11, 35], [3, 15, 14, 40],
  [3.5, 17, 16, 40], [4, 18, 17, 45], [4.5, 19, 18, 45], [5, 20, 19, 50],
];

function urlDoBanco(): string {
  for (const arq of ["scratch/check-firehub-db-clean.js", "C:/Users/Micro/Documents/firehub-site/.env", ".env"]) {
    if (!existsSync(arq)) continue;
    const t = readFileSync(arq, "utf8");
    const m = t.match(/^DATABASE_URL="?([^"\n]+)/m) || t.match(/postgresql:\/\/[^"'\s]*/);
    if (m) return m[1] || m[0];
  }
  throw new Error("sem DATABASE_URL");
}

(async () => {
  const sql = neon(urlDoBanco());
  const [loja] = await sql`SELECT "storeName","deliveryZoneType","deliveryZones","deliveryConfig","storeLatLng" FROM "User" WHERE id = ${LOJA}`;
  if (!loja) throw new Error("loja não encontrada");

  const bruto = TABELA.map(([km, fee, motoboyFee, time]) => ({ km, fee, motoboyFee, time }));
  const r = normalizarFaixasDeKm(bruto) as any;
  const erros = r.ok ? [] : (r.problemas || []).filter((p: any) => p.nivel === "erro");
  if (erros.length) {
    console.log("A normalização da tela recusou a tabela — nada gravado:");
    for (const e of erros) console.log("  ✖", e.mensagem || JSON.stringify(e));
    process.exit(1);
  }
  const faixas = r.zonas;
  if (!Array.isArray(faixas) || faixas.length !== 9) {
    console.log("Formato inesperado da normalização:", JSON.stringify(r).slice(0, 400));
    process.exit(1);
  }

  const deliveryConfig = {
    ...(loja.deliveryConfig || {}),
    repasseDoEntregador: { ...((loja.deliveryConfig || {}).repasseDoEntregador || {}), separado: true },
  };

  console.log(`Loja: ${loja.storeName}  (modo atual: ${loja.deliveryZoneType}, pino: ${JSON.stringify(loja.storeLatLng)})`);
  console.log("Faixas atuais:", JSON.stringify(loja.deliveryZones));
  console.log("Faixas novas: ", JSON.stringify(faixas));
  console.log("Repasse:      ", JSON.stringify(deliveryConfig.repasseDoEntregador));
  if (!GRAVAR) { console.log("\n(simulação — use --gravar)"); return; }

  await sql`UPDATE "User" SET "deliveryZoneType" = 'ROTA', "deliveryZones" = ${JSON.stringify(faixas)}::jsonb,
            "deliveryConfig" = ${JSON.stringify(deliveryConfig)}::jsonb WHERE id = ${LOJA}`;
  const [depois] = await sql`SELECT "deliveryZones" FROM "User" WHERE id = ${LOJA}`;
  console.log("\nGRAVADO. Conferência:", JSON.stringify(depois.deliveryZones));
})().catch((e) => { console.error(e); process.exit(1); });
