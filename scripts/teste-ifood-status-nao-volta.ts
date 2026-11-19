/**
 * scripts/teste-ifood-status-nao-volta.ts — evento do iFood nunca leva o pedido para trás.
 *
 *   npx tsx scripts/teste-ifood-status-nao-volta.ts
 *
 * Túlio Lanches, 06/11/2026: "dei pronto num iFood e ele voltou para em
 * preparo, mesmo pronto na plataforma". O "Saiu" do painel manda
 * readyToPickup ao iFood; o eco READY_TO_PICKUP chega pelo webhook/cron e era
 * gravado como PREPARANDO por cima do SAIU_ENTREGA. Aqui o `updateMany` é
 * simulado com o mesmo filtro que o cron (lib/ifood-eventos.ts) e o webhook
 * (api/ifood/webhook) mandam ao banco.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { semRebaixar } from "../src/lib/ifood-status-do-evento";

let falhas = 0;
let total = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

/** O updateMany do banco: grava só se o status atual não cai no notIn. */
function gravar(atual: string, doEvento: string): string {
  const filtro = semRebaixar(doEvento);
  return filtro.status?.notIn.includes(atual) ? atual : doEvento;
}

// Mapa dos dois caminhos (lib/ifood-eventos.ts e STATUS_MAP do webhook).
const PREPARATION_STARTED = "PREPARANDO";
const READY_TO_PICKUP = "PREPARANDO";
const DISPATCHED = "SAIU_ENTREGA";
const CONCLUDED = "ENTREGUE";
const CONFIRMED = "ACEITO";
const PLACED = "NOVO";

console.log("— o que travava a loja —");
confere("Saiu no painel + eco RTP: continua SAIU_ENTREGA", gravar("SAIU_ENTREGA", READY_TO_PICKUP), "SAIU_ENTREGA");
confere("Saiu no painel + eco PREPARATION_STARTED: continua SAIU_ENTREGA", gravar("SAIU_ENTREGA", PREPARATION_STARTED), "SAIU_ENTREGA");
confere("PRONTO + eco RTP: continua PRONTO", gravar("PRONTO", READY_TO_PICKUP), "PRONTO");
confere("ENTREGUE + DISPATCHED atrasado: continua ENTREGUE (#0018 do Túlio)", gravar("ENTREGUE", DISPATCHED), "ENTREGUE");
confere("PREPARANDO + CONFIRMED atrasado: continua PREPARANDO", gravar("PREPARANDO", CONFIRMED), "PREPARANDO");
confere("ACEITO + PLACED repetido: continua ACEITO", gravar("ACEITO", PLACED), "ACEITO");
confere("ENCERRADO (caixa fechado) + CONCLUDED: continua ENCERRADO", gravar("ENCERRADO", CONCLUDED), "ENCERRADO");
confere("CANCELADO + CONCLUDED: continua CANCELADO", gravar("CANCELADO", CONCLUDED), "CANCELADO");

console.log("— o que continua andando —");
confere("NOVO + CONFIRMED: ACEITO", gravar("NOVO", CONFIRMED), "ACEITO");
confere("ACEITO + PREPARATION_STARTED: PREPARANDO", gravar("ACEITO", PREPARATION_STARTED), "PREPARANDO");
confere("PREPARANDO + DISPATCHED: SAIU_ENTREGA", gravar("PREPARANDO", DISPATCHED), "SAIU_ENTREGA");
confere("SAIU_ENTREGA + CONCLUDED: ENTREGUE", gravar("SAIU_ENTREGA", CONCLUDED), "ENTREGUE");
confere("ENTREGUE + CANCELLED: CANCELADO (exceção)", gravar("ENTREGUE", "CANCELADO"), "CANCELADO");
confere("CANCELADO não tem filtro", semRebaixar("CANCELADO"), {});

console.log("— a sequência do Túlio —");
let s = "ACEITO";
s = "SAIU_ENTREGA"; // "Saiu" no painel → startPreparation + readyToPickup no iFood
for (const eco of [PREPARATION_STARTED, READY_TO_PICKUP, DISPATCHED]) s = gravar(s, eco);
confere("ecos do iFood depois do Saiu: SAIU_ENTREGA", s, "SAIU_ENTREGA");
s = gravar(s, CONCLUDED);
confere("CONCLUDED fecha: ENTREGUE", s, "ENTREGUE");

console.log("— os dois caminhos usam o filtro —");
const raiz = join(__dirname, "..");
const cron = readFileSync(join(raiz, "src/lib/ifood-eventos.ts"), "utf8");
const webhook = readFileSync(join(raiz, "src/app/api/ifood/webhook/route.ts"), "utf8");
confere("cron (lib/ifood-eventos.ts) grava status com semRebaixar", cron.includes("...semRebaixar(newStatus)"), true);
confere("webhook grava status com semRebaixar", webhook.includes("...semRebaixar(firehubStatus)"), true);
confere("webhook não grava mais o updateData inteiro", webhook.includes("data:  updateData,"), false);

console.log(`\n${total - falhas}/${total} ok`);
if (falhas) process.exit(1);
