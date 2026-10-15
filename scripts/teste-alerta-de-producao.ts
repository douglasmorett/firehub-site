/**
 * Alertas de Produção: pelo prazo do cliente ou pelo tempo em preparo
 * (lib/alerta-de-producao.ts).  npx tsx scripts/teste-alerta-de-producao.ts
 */
import { lerConfigDoAlerta, corDoAlerta, avisoDasFaixas, faixasDoModo } from "../src/lib/alerta-de-producao";

let ok = 0, falha = 0;
function conferir(nome: string, veio: unknown, esperado: unknown) {
  const igual = JSON.stringify(veio) === JSON.stringify(esperado);
  if (igual) ok++; else falha++;
  console.log(`${igual ? "✅" : "❌"} ${nome}${igual ? "" : ` — veio ${JSON.stringify(veio)}, esperado ${JSON.stringify(esperado)}`}`);
}

// Sem nada gravado: o padrão de sempre (entrega 10/5).
const vazio = lerConfigDoAlerta(null);
conferir("sem config: modo entrega", vazio.modo, "entrega");
conferir("sem config: 10 e 5", [vazio.yellowMinutes, vazio.redMinutes], [10, 5]);
conferir("sem config: preparo 20 e 30", [vazio.preparo.yellowMinutes, vazio.preparo.redMinutes], [20, 30]);

// Config antiga (sem modo) segue entrega, com os números dela.
const antiga = lerConfigDoAlerta({ yellowEnabled: true, yellowMinutes: 15, redEnabled: false, redMinutes: 5 });
conferir("antiga: modo entrega", antiga.modo, "entrega");
conferir("antiga: vermelho desligado", antiga.redEnabled, false);
conferir("antiga: 14 restantes = amarelo", corDoAlerta(antiga, { minutosRestantes: 14, minutosEmPreparo: 3 }), "amarelo");
conferir("antiga: 2 restantes = amarelo (vermelho desligado)", corDoAlerta(antiga, { minutosRestantes: 2, minutosEmPreparo: 3 }), "amarelo");
conferir("antiga: 20 restantes = nada", corDoAlerta(antiga, { minutosRestantes: 20, minutosEmPreparo: 30 }), null);

// Entrega, padrão: o mesmo que o cartão fazia.
conferir("entrega: 11 restantes = nada", corDoAlerta(vazio, { minutosRestantes: 11, minutosEmPreparo: 99 }), null);
conferir("entrega: 10 restantes = amarelo", corDoAlerta(vazio, { minutosRestantes: 10, minutosEmPreparo: 0 }), "amarelo");
conferir("entrega: 5 restantes = vermelho", corDoAlerta(vazio, { minutosRestantes: 5, minutosEmPreparo: 0 }), "vermelho");
conferir("entrega: atrasado = vermelho", corDoAlerta(vazio, { minutosRestantes: -8, minutosEmPreparo: 0 }), "vermelho");
conferir("entrega: sem prazo (mesa) = nada", corDoAlerta(vazio, { minutosRestantes: null, minutosEmPreparo: 50 }), null);

// Preparo.
const prep = lerConfigDoAlerta({ yellowEnabled: true, yellowMinutes: 10, redEnabled: true, redMinutes: 5, modo: "preparo", preparo: { yellowEnabled: true, yellowMinutes: 15, redEnabled: true, redMinutes: 25 } });
conferir("preparo: faixas do modo", faixasDoModo(prep).yellowMinutes, 15);
conferir("preparo: 14 min = nada (mesmo com 2 restantes)", corDoAlerta(prep, { minutosRestantes: 2, minutosEmPreparo: 14 }), null);
conferir("preparo: 15 min = amarelo", corDoAlerta(prep, { minutosRestantes: 40, minutosEmPreparo: 15 }), "amarelo");
conferir("preparo: 25 min = vermelho", corDoAlerta(prep, { minutosRestantes: 40, minutosEmPreparo: 25 }), "vermelho");
conferir("preparo: sem carimbo = nada", corDoAlerta(prep, { minutosRestantes: -5, minutosEmPreparo: null }), null);
conferir("preparo: os números de entrega ficam guardados", [prep.yellowMinutes, prep.redMinutes], [10, 5]);

// Faixas trocadas.
conferir("aviso: preparo certo", avisoDasFaixas(prep), null);
conferir("aviso: entrega certa", avisoDasFaixas(vazio), null);
conferir("aviso: preparo trocado", typeof avisoDasFaixas({ ...prep, preparo: { ...prep.preparo, redMinutes: 10 } }), "string");
conferir("aviso: entrega trocada", typeof avisoDasFaixas({ ...vazio, redMinutes: 12 }), "string");
conferir("aviso: um desligado não avisa", avisoDasFaixas({ ...vazio, redMinutes: 12, redEnabled: false }), null);

// Lixo gravado não quebra.
const lixo = lerConfigDoAlerta({ yellowMinutes: "abc", redMinutes: -3, modo: "outro", preparo: [1, 2] });
conferir("lixo: modo entrega", lixo.modo, "entrega");
conferir("lixo: minutos", [lixo.yellowMinutes, lixo.redMinutes], [10, 0]);
conferir("lixo: preparo padrão", lixo.preparo.yellowMinutes, 20);

console.log(`\n${ok} ok, ${falha} falha(s)`);
if (falha) process.exit(1);
