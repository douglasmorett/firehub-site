/**
 * O ROBÔ COM DOIS SERVIDORES — dois processos node (cada um com o seu pool de
 * conexões e a sua memória, como A e B atrás do balanceador) apontando para o
 * MESMO Postgres local. O que um grava, o outro tem que enxergar.
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55501/robo NEXTAUTH_SECRET=x npx tsx scripts/teste-robo-duas-instancias.ts
 *
 * Recusa DATABASE_URL que não seja 127.0.0.1/localhost. O banco precisa do
 * schema (`npx prisma db push --skip-generate`).
 *
 * A faz o papel do webhook do robô (fixo nele); B, o do painel da loja e da
 * tela do atendimento (que caem em qualquer um). Roteiro, em ms depois da
 * largada (folga de 2–3 s entre os passos: a gravação "sem await" do webhook
 * leva centenas de ms com a máquina ocupada):
 *     0  A: cliente pediu atendente → pausa o robô e põe na fila
 *  2000  B: o painel vê a conversa pausada e na fila
 *  4000  B: o lojista encerra e devolve ao robô
 *  6000  A: o webhook vê o robô livre e o chamado fechado   ← era o defeito: mudo 12 h
 *  8000  A: a IA cai (incidente)
 * 11000  B: a faixa "IA fora do ar" aparece no painel em B
 * 13000  B: a tela do atendimento manda uma mensagem pelo número do FireHub
 * 16000  A: o eco dela chega ao webhook e é reconhecido   ← era "digitado no celular"
 * 18000  A: a IA volta
 * 20000  B: o lojista pausa o robô numa conversa pelo painel
 * 23000  A: o webhook vê a pausa
 * 25000+ A e B disputam 20 avisos "uma vez só" no mesmo instante: um vence cada
 * 34000  B: a faixa some (depois do cache de 15 s da leitura)
 */
import { spawn } from "node:child_process";

const URL_DO_BANCO = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_DO_BANCO)) {
  console.error("Recuso: DATABASE_URL não é um Postgres local (127.0.0.1/localhost). Este teste grava e apaga linhas.");
  process.exit(2);
}
// O gateway do número do FireHub: porta fechada, sem chave — nada sai daqui.
process.env.EVOLUTION_API_URL = "http://127.0.0.1:9";
delete process.env.EVOLUTION_API_KEY;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ateHora = (t: number) => espera(Math.max(0, t - Date.now()));

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}\n      esperado: ${JSON.stringify(esperado)}\n      veio:     ${JSON.stringify(real)}`); }
}

const RODADAS = 20;
const TEXTO_DA_TELA = "Oi! Aqui é a equipe do FireHub, já vou te ajudar.";

/** Roda este arquivo num processo novo e devolve a última linha JSON que ele imprimir. */
function filho(papel: "A" | "B", t0: number, U: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", "scripts/teste-robo-duas-instancias.ts", "filho", papel, String(t0), U], {
      shell: true,
      env: { ...process.env, INSTANCIA: papel.toLowerCase() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    p.stdout.on("data", (c) => { saida += c; });
    p.stderr.on("data", (c) => { saida += c; });
    p.on("close", (codigo) => {
      const linha = saida.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      if (!linha) return reject(new Error(`filho ${papel} saiu ${codigo} sem JSON:\n${saida.slice(-3000)}`));
      resolve(JSON.parse(linha));
    });
  });
}

async function modoFilho(papel: string, t0: number, U: string) {
  const { prisma } = await import("../src/lib/prisma");
  const { garantirTabelasDoRobo } = await import("../src/lib/robo-no-banco");
  const P = await import("../src/lib/pausa-do-robo");
  const F = await import("../src/lib/fila-de-atendimento-humano");
  const S = await import("../src/lib/saude-da-ia");
  const { ehEcoDoFireHub, enviarTexto } = await import("../src/lib/atendimento/whatsapp");
  const { pegarAvisoUnico } = await import("../src/lib/aviso-unico");
  const { idDaInstancia } = await import("../src/lib/instancia");
  await garantirTabelasDoRobo();
  await prisma.$queryRawUnsafe("SELECT 1"); // conexão aberta antes da largada

  const J = "5522999991001@s.whatsapp.net";
  const J2 = "5522999991002@s.whatsapp.net";
  const L = `${U}-loja`;
  const r: Record<string, unknown> = { papel, instancia: idDaInstancia() };
  const tempos: string[] = [];
  const atrasos: string[] = [];
  r.tempos = tempos;
  r.atrasos = atrasos;
  const em = async (ms: number, fn: () => Promise<void> | void) => {
    await ateHora(t0 + ms);
    const inicio = Date.now() - t0;
    await fn();
    tempos.push(`${ms}: ${inicio}→${Date.now() - t0}`);
    if (inicio - ms > 1500) atrasos.push(`${ms} começou em ${inicio}`);
  };

  if (papel === "A") {
    await em(0, async () => {
      void P.pausarRobo(U, J); // o webhook pausa "antes dos awaits"
      await F.entrarNaFila({
        userId: U, jid: J, telefone: "+55 22999991001", nomeDoCliente: "Bia", textoDoCliente: "quero falar com atendente",
        mensagens: [{ sender: "user", text: "quero falar com atendente", timestamp: Date.now() }],
        motivo: "Pediu atendente", motivoDaIaForaDoAr: "IA fora do ar",
      });
      r.pausadoLogoDepois = await P.roboEstaPausado(U, J);
    });
    await em(6000, async () => {
      r.pausadoDepoisDeBDevolver = await P.roboEstaPausado(U, J);
      r.chamadoDepoisDeBEncerrar = (await F.chamadoDaConversa(U, J))?.status ?? null;
    });
    await em(8000, async () => {
      S.registrarIncidenteDaIa(L, { resumo: "crédito esgotado", exigeAcao: true, doSistema: false });
      // A gravação sai sem await (o webhook não espera): quando ela chegou ao banco?
      for (let i = 0; i < 40; i++) {
        const n = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "SaudeDaIa" WHERE "chave" = $1`, L);
        if (Number(n[0].n) > 0) { r.incidenteNoBancoEm = Date.now() - t0; break; }
        await espera(25);
      }
    });
    await em(16000, async () => {
      r.ecoDaTelaEmB = await ehEcoDoFireHub([J], TEXTO_DA_TELA);
      r.digitadoNoCelular = await ehEcoDoFireHub([J], "isso foi digitado no celular");
    });
    await em(18000, () => S.registrarSucessoDaIa(L));
    await em(23000, async () => { r.vePausaDoPainel = await P.roboEstaPausado(U, J2); });
  } else {
    await em(2000, async () => {
      r.vePausa = await P.roboEstaPausado(U, J);
      r.listaPausadas = [...(await P.conversasPausadas(U))];
      r.fila = (await F.chamadosAbertos(U)).map((c) => [c.jid, c.status, c.motivo]);
    });
    await em(4000, async () => {
      await P.retomarRobo(U, J);
      r.encerrou = await F.encerrarChamado(U, J);
    });
    await em(11000, async () => { r.faixa = (await S.saudeDaIa(L)).foraDoAr; });
    await em(13000, async () => { r.envio = (await enviarTexto(J, TEXTO_DA_TELA)).ok; });
    await em(20000, () => P.pausarRobo(U, J2, 2 * 60 * 60 * 1000));
  }

  const avisos: boolean[] = [];
  for (let i = 0; i < RODADAS; i++) {
    await ateHora(t0 + 25_000 + i * 50);
    avisos.push(Boolean(await pegarAvisoUnico(`corrida:${U}:${i}`, 60_000)));
  }
  r.avisos = avisos;

  if (papel === "B") await em(34_000, async () => { r.faixaDepois = (await S.saudeDaIa(L)).foraDoAr; });
  console.log(JSON.stringify(r));
  await prisma.$disconnect();
  process.exit(0);
}

async function principal() {
  const U = `loja-duas-${Date.now()}`;
  console.log(`Postgres local: ${URL_DO_BANCO.replace(/:[^:@/]+@/, ":***@")}`);
  console.log("Dois processos (A = webhook, B = painel), mesmo banco — ~55 s");
  const t0 = Date.now() + 20_000;
  const [A, B] = await Promise.all([filho("A", t0, U), filho("B", t0, U)]);
  console.log(`      tempos A: ${A.tempos.join(" | ")}
      tempos B: ${B.tempos.join(" | ")}`);
  conferir("dois processos de verdade (ids diferentes)", A.instancia !== B.instancia, true);
  // Processo que subiu atrasado embaralha o roteiro: aí o teste não prova nada.
  conferir("nenhum passo saiu atrasado do roteiro", [...A.atrasos, ...B.atrasos], []);

  console.log("\npausa do robô e fila de atendimento humano");
  conferir("A: pausou e já enxerga a pausa", A.pausadoLogoDepois, true);
  conferir("B (painel): vê a conversa que A pausou", B.vePausa, true);
  conferir("B (painel): a lista de pausadas também", B.listaPausadas, ["5522999991001@s.whatsapp.net"]);
  conferir("B (painel): o balãozinho mostra o chamado que A pôs na fila", B.fila, [["5522999991001@s.whatsapp.net", "PENDING", "Pediu atendente"]]);
  conferir("B: encerrar devolve o motivo do chamado", B.encerrou, { existia: true, motivo: "Pediu atendente" });
  conferir("A (webhook): o robô voltou depois de B devolver", A.pausadoDepoisDeBDevolver, false);
  conferir("A (webhook): o chamado está fechado", A.chamadoDepoisDeBEncerrar, "CLOSED");
  conferir("A (webhook): vê a pausa que o painel (B) ligou", A.vePausaDoPainel, true);

  console.log("\nsaúde da IA");
  console.log(`      incidente no banco ${A.incidenteNoBancoEm} ms depois da largada (B lê aos 11000)`);
  conferir("B (painel): a faixa aparece com o incidente gravado por A", B.faixa, true);
  conferir("B (painel): a faixa some depois que A registrou a volta", B.faixaDepois, false);

  console.log("\neco do número do FireHub");
  conferir("B: o envio (gateway de mentira) não saiu — mas foi registrado", B.envio, false);
  conferir("A (webhook): o eco do que a tela mandou em B é reconhecido", A.ecoDaTelaEmB, true);
  conferir("A (webhook): o que foi digitado no celular não é eco", A.digitadoNoCelular, false);

  console.log("\naviso uma vez só, disputado no mesmo instante");
  const vencedores = A.avisos.map((a: boolean, i: number) => Number(a) + Number(B.avisos[i]));
  console.log(`      A avisou ${A.avisos.filter(Boolean).length}, B avisou ${B.avisos.filter(Boolean).length}`);
  conferir(`exatamente UM aviso em cada uma das ${RODADAS} rodadas`, vencedores.filter((n: number) => n === 1).length, RODADAS);

  console.log(`\n${ok} ✓, ${falhou} ✗`);
  process.exit(falhou ? 1 : 0);
}

const [, , modo, ...args] = process.argv;
if (modo === "filho") {
  modoFilho(args[0], Number(args[1]), args[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  principal().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
