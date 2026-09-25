/**
 * Trava a hora em que o Assistente pode se atualizar (lib/assistente-da-loja.ts).
 *
 *   npx tsx scripts/teste-assistente-da-loja.ts
 *
 * O caso é o de 24/09/2026: a 1.2.24 saiu às 21h e a Ragnar e a Divinos se
 * atualizaram no meio do jantar — o instalador fecha o Assistente e a
 * impressão para. A regra: só com a loja fora de operação.
 */
import { decidirAtualizacao, decidirSemLoja, estadoParaAtualizacao } from "../src/lib/assistente-da-loja";
import { relogioDaLoja } from "../src/lib/loja-aberta";

let falhas = 0;
const confere = (oQue: string, obtido: { pode: boolean; motivo: string }, esperado: boolean) => {
  const ok = obtido.pode === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue} — ${obtido.pode ? "atualiza" : "segura"} (${obtido.motivo})`);
};

const SP = "America/Sao_Paulo";
/** "21:00" de 24/09/2026 (quinta) no fuso de Brasília. */
const as = (hhmm: string, dia = "2026-09-24") => new Date(`${dia}T${hhmm}:00-03:00`);

// A mesma montagem de podeAtualizarAgora, sem o banco.
const decidir = (opts: { agora: Date; storeHours?: unknown; storePause?: unknown; pedidoHaMin: number | null }) => {
  const estado = estadoParaAtualizacao({ storeHours: opts.storeHours, storePause: opts.storePause, storeTimezone: SP }, opts.agora);
  const { minutos } = relogioDaLoja(SP, opts.agora);
  return decidirAtualizacao({ estado, minutosAgora: minutos, minutosDesdeOUltimoPedido: opts.pedidoHaMin });
};

// Sem horário cadastrado vale o padrão do FireHub: 18h às 23h, todo dia.
console.log("\n— Loja das 18h às 23h —");
confere("21:00, jantar, pedido há 2 min", decidir({ agora: as("21:00"), pedidoHaMin: 2 }), false);
confere("21:00, aberta mesmo sem pedido há 1 h", decidir({ agora: as("21:00"), pedidoHaMin: 60 }), false);
confere("17:30, abre em 30 min", decidir({ agora: as("17:30"), pedidoHaMin: null }), false);
confere("16:00, abre em 2 h e nada entrou", decidir({ agora: as("16:00"), pedidoHaMin: 900 }), true);
confere("23:20, fechou mas o último pedido foi há 15 min", decidir({ agora: as("23:20"), pedidoHaMin: 15 }), false);
confere("00:10, fechou e o último pedido foi há 60 min", decidir({ agora: as("00:10", "2026-09-25"), pedidoHaMin: 60 }), true);
confere("10:00, manhã seguinte, PC ligado agora", decidir({ agora: as("10:00", "2026-09-25"), pedidoHaMin: 660 }), true);

console.log("\n— Turno que passa da meia-noite (18h às 02h) —");
const madrugada = Array.from({ length: 7 }, (_, i) => ({
  day: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"][i],
  active: true, open: "18:00", close: "02:00", shifts: [{ open: "18:00", close: "02:00" }],
}));
confere("01:00, ainda no turno de ontem", decidir({ agora: as("01:00", "2026-09-25"), storeHours: madrugada, pedidoHaMin: 70 }), false);
confere("03:00, turno acabou e nada entrou há 2 h", decidir({ agora: as("03:00", "2026-09-25"), storeHours: madrugada, pedidoHaMin: 120 }), true);

console.log("\n— Interruptor do painel e férias —");
// O interruptor fecha o delivery na correria; a cozinha segue trabalhando.
// estadoParaAtualizacao nem o recebe: dentro do horário, segura.
confere("21:00, delivery pausado no painel e nada entrou há 1 h", decidir({ agora: as("21:00"), pedidoHaMin: 60 }), false);
const ferias = { active: true, from: "2026-09-20", to: "2026-09-30", reason: "reforma" };
confere("21:00, loja em férias (pausa programada)", decidir({ agora: as("21:00"), storePause: ferias, pedidoHaMin: null }), true);

console.log("\n— Assistente que não deu para reconhecer —");
confere("03h de Brasília", decidirSemLoja(3), true);
confere("09h de Brasília", decidirSemLoja(9), true);
confere("10h de Brasília (almoço vem aí)", decidirSemLoja(10), false);
confere("20h de Brasília", decidirSemLoja(20), false);
confere("00h de Brasília (fim de turno de muita loja)", decidirSemLoja(0), false);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
