/**
 * O alarme de memória pelo PISO contra o teto real (lib/memoria-do-servidor.ts).
 *
 * O antigo comparava o instante com 512 MB (/api/health) e 450 MB (WhatsApp a
 * cada 5 min): o serrote normal da coleta de lixo — 276 a 669 MB no pico de
 * sexta, 16/10/2026 — dava "degraded" em um terço das leituras. O novo avisa
 * quando o que SOBRA depois da limpeza passa de 60% do teto (atenção) e de
 * 80% (crítico), ou quando o instante encosta em 90%.
 *
 *   npx tsx scripts/teste-alarme-de-memoria.ts
 */
import { avaliarMemoria, textoDoAvisoDeMemoria, type AmostraDeMemoria } from "../src/lib/memoria-do-servidor";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

const MB = 1024 * 1024;
const TETO = 2096 * MB; // o heap_size_limit do Node 20 no droplet de 8 GB
const AGORA = 1_800_000_000_000;
/** Uma amostra a cada 15 s nos últimos `minutos`, com os valores em MB dados (repetidos em ciclo). */
const amostras = (minutos: number, valoresMB: number[]): AmostraDeMemoria[] => {
  const n = Math.round((minutos * 60) / 15);
  return Array.from({ length: n }, (_, i) => ({ em: AGORA - (n - i) * 15_000, usado: valoresMB[i % valoresMB.length] * MB }));
};

console.log("\n[1] O serrote de sexta, 16/10 — o que o alarme antigo chamava de 'degraded'");
const serrote = [444, 614, 287, 488, 657, 276, 477, 641, 280];
const l1 = avaliarMemoria(amostras(5, serrote), AGORA, TETO, 641 * MB);
console.log("  →", JSON.stringify(l1));
confere(l1.nivel === "ok", "nível ok (o pico é lixo esperando a coleta)");
confere(l1.pisoMB === 276, `piso = 276 MB, o fundo do serrote (veio ${l1.pisoMB})`);
confere(l1.pctDoPiso === 13, `piso em 13% do teto (veio ${l1.pctDoPiso}%)`);
confere(textoDoAvisoDeMemoria(l1) === null, "ok não manda WhatsApp");
confere(641 > 450 && 641 > 512, "(o alarme antigo daria 'Memória alta' nesta mesma leitura)");

console.log("\n[2] Vazamento: o piso sobe para 62% do teto");
const l2 = avaliarMemoria(amostras(5, [1300, 1500, 1350]), AGORA, TETO, 1400 * MB);
console.log("  →", textoDoAvisoDeMemoria(l2));
confere(l2.nivel === "atencao", "atenção — avisa ANTES de dar problema");
confere(/🟡/.test(textoDoAvisoDeMemoria(l2) || "") && /1300 MB de 2096 MB \(62%\)/.test(textoDoAvisoDeMemoria(l2) || ""), "o aviso diz piso, teto e %");

console.log("\n[3] Piso em 81% do teto");
const l3 = avaliarMemoria(amostras(5, [1700, 1800]), AGORA, TETO, 1750 * MB);
console.log("  →", textoDoAvisoDeMemoria(l3));
confere(l3.nivel === "critico" && /🔴/.test(textoDoAvisoDeMemoria(l3) || ""), "crítico, com 🔴 (o cron conta como 'critical')");

console.log("\n[4] Piso baixo, mas o instante a 91% do teto");
const l4 = avaliarMemoria(amostras(5, serrote), AGORA, TETO, 1910 * MB);
confere(l4.nivel === "critico", "crítico: colado no teto não espera o piso");

console.log("\n[5] Logo depois de ligar (1 min de amostras)");
const l5 = avaliarMemoria(amostras(1, [900, 1300]), AGORA, TETO, 1300 * MB);
confere(l5.aquecendo && l5.pisoMB === null && l5.nivel === "ok", "aquecendo: sem piso, e 62% no instante não alarma");
const l5b = avaliarMemoria(amostras(1, [900]), AGORA, TETO, 1950 * MB);
confere(l5b.nivel === "critico" && /agora/.test(textoDoAvisoDeMemoria(l5b) || ""), "aquecendo mas a 93% no instante: crítico, dito pelo instante");

console.log("\n[6] Amostra velha não segura o piso lá embaixo");
const velhas: AmostraDeMemoria[] = [{ em: AGORA - 20 * 60_000, usado: 200 * MB }];
const l6 = avaliarMemoria([...velhas, ...amostras(5, [1300, 1400])], AGORA, TETO, 1350 * MB);
confere(l6.pisoMB === 1300 && l6.nivel === "atencao", "só os últimos 5 minutos contam");

console.log("\n[7] Os limiares");
const em = (pisoMB: number) => avaliarMemoria(amostras(5, [pisoMB]), AGORA, TETO, pisoMB * MB).nivel;
confere(em(Math.floor(2096 * 0.59)) === "ok" && em(Math.ceil(2096 * 0.6)) === "atencao", "60% vira atenção");
confere(em(Math.floor(2096 * 0.79)) === "atencao" && em(Math.ceil(2096 * 0.8)) === "critico", "80% vira crítico");

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
