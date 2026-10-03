/**
 * O que o Assistente ainda imprime sozinho quando volta (lib/volta-do-assistente.ts).
 *
 *   npx tsx scripts/teste-volta-do-assistente.ts
 *
 * Regra do dono (27/09/2026): "ativou o Assistente, ele só imprime o que entrar
 * depois dele ativo" — para qualquer versão, não só a 1.2.25+.
 */
import { corteDaVolta, esquecerAssistentes, ligouHaMs, ATUALIZA_AO_ABRIR_MS } from "../src/lib/volta-do-assistente";

let falhas = 0;
const confere = (oQue: string, obtido: number | null, esperado: number | null) => {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  const fmt = (v: number | null) => (v == null ? "sem corte" : `corte em ${v / 1000}s`);
  console.log(`${ok ? "✅" : "❌"} ${oQue} — ${fmt(obtido)}${ok ? "" : ` (esperado ${fmt(esperado)})`}`);
};
const s = (seg: number) => seg * 1000;
/** Consultas a cada 3 s de `de` até `ate` (em segundos), sem abertoHaSeg. */
const pollsAntigos = (chave: string, de: number, ate: number) => {
  let ultimo: number | null = null;
  for (let t = de; t <= ate; t += 3) ultimo = corteDaVolta(chave, null, s(t));
  return ultimo;
};

const T0 = 1_000_000; // segundos: um instante qualquer

console.log("\n— Assistente antigo (não diz há quanto tempo está aberto) —");
esquecerAssistentes();
confere("consultando a cada 3 s, sem parar", pollsAntigos("A", T0, T0 + 60), null);
confere("reiniciou: 40 s sem consultar → corta na consulta anterior", corteDaVolta("A", null, s(T0 + 100)), s(T0 + 60));
confere("…e o corte continua nas consultas seguintes", pollsAntigos("A", T0 + 103, T0 + 200), s(T0 + 60));
confere("…até a meia hora passar (o teto de 30 min já cobre)", pollsAntigos("A", T0 + 203, T0 + 100 + 1801), null);

esquecerAssistentes();
pollsAntigos("B", T0, T0 + 60);
confere("PC desligado 2 h e ligado de novo → só o que entrar agora", corteDaVolta("B", null, s(T0 + 60 + 7200)), s(T0 + 60 + 7200 - 10));
confere("internet piscou 15 s (menos que 20 s) → nada muda", (pollsAntigos("C", T0, T0 + 30), corteDaVolta("C", null, s(T0 + 45))), null);
confere("primeira consulta depois de um deploy do servidor → sem corte (não engole pedido)", corteDaVolta("D", null, s(T0)), null);

console.log("\n— Assistente 1.2.25+ (manda abertoHaSeg) —");
esquecerAssistentes();
pollsAntigos("E", T0, T0 + 60); // a versão velha rodando…
confere("atualizou: a nova abriu 30 s depois da última consulta da velha → corta na consulta da velha",
  corteDaVolta("E", 5, s(T0 + 95)), s(T0 + 60));
confere("…a mesma abertura nas consultas seguintes não muda o corte", corteDaVolta("E", 8, s(T0 + 98)), s(T0 + 60));
confere("fechou e reabriu 10 min depois → só o que entrar agora", corteDaVolta("E", 2, s(T0 + 700)), s(T0 + 698 - 10));
esquecerAssistentes();
confere("servidor sem memória (deploy) e Assistente aberto há 60 s → teto zero de sempre", corteDaVolta("F", 60, s(T0)), s(T0 - 60 - 10));
esquecerAssistentes();
confere("aberto há 2 h, primeira consulta que o servidor vê → sem corte (o teto de 30 min basta)", corteDaVolta("G", 7200, s(T0)), null);
esquecerAssistentes();
pollsAntigos("H", T0, T0 + 60);
confere("1.2.25+ com internet caída 5 min (mesmo processo) → não é reabertura",
  (corteDaVolta("H", 30, s(T0 + 30)), corteDaVolta("H", 330, s(T0 + 330))), s(T0 - 10));

// ── LIGOU, ATUALIZA (03/10/2026) ─────────────────────────────────────────────
// A rota da versão libera a atualização nos primeiros 20 min depois de o
// Assistente abrir de verdade — e só então.
console.log("\n— Acabou de ligar? (libera a atualização sem esperar a loja parar) —");
const confereLigou = (oQue: string, obtido: number | null, esperadoSeg: number | null) => {
  const ok = obtido === (esperadoSeg == null ? null : s(esperadoSeg));
  if (!ok) falhas++;
  const fmt = (v: number | null) => (v == null ? "não ligou agora" : `ligou há ${v / 1000}s`);
  console.log(`${ok ? "✅" : "❌"} ${oQue} — ${fmt(obtido)}${ok ? "" : ` (esperado ${fmt(esperadoSeg == null ? null : s(esperadoSeg))})`}`);
};
esquecerAssistentes();
pollsAntigos("L1", T0, T0 + 60);
corteDaVolta("L1", null, s(T0 + 60 + 8 * 3600));
confereLigou("antigo: PC desligado a noite toda e ligado → 90 s depois", ligouHaMs("L1", s(T0 + 60 + 8 * 3600 + 90)), 90);
confereLigou("…e 25 min depois já passou da janela de 20", (() => {
  const t = T0 + 60 + 8 * 3600 + 25 * 60;
  const ms = ligouHaMs("L1", s(t));
  return ms != null && ms <= ATUALIZA_AO_ABRIR_MS ? ms : null;
})(), null);
esquecerAssistentes();
pollsAntigos("L2", T0, T0 + 60);
corteDaVolta("L2", null, s(T0 + 120));
confereLigou("antigo: internet caiu 1 min no meio do jantar → NÃO é ligar", ligouHaMs("L2", s(T0 + 130)), null);
esquecerAssistentes();
pollsAntigos("L3", T0, T0 + 60);
confereLigou("antigo: ligado o dia todo, consultando sem parar → NÃO é ligar", ligouHaMs("L3", s(T0 + 61)), null);
esquecerAssistentes();
confereLigou("antigo: primeira consulta depois de um deploy do servidor → não sabe, NÃO libera", (corteDaVolta("L4", null, s(T0)), ligouHaMs("L4", s(T0 + 5))), null);
esquecerAssistentes();
corteDaVolta("L5", 40, s(T0));
confereLigou("1.2.25+ aberto há 40 s (mesmo depois de deploy) → ligou", ligouHaMs("L5", s(T0 + 50)), 90);
esquecerAssistentes();
corteDaVolta("L6", 7200, s(T0));
confereLigou("1.2.25+ aberto há 2 h → NÃO é ligar", ligouHaMs("L6", s(T0 + 3)), null);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
