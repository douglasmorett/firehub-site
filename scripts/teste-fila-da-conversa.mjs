/**
 * Prova da rajada de mensagens e da vez por conversa (lib/fila-da-conversa.ts).
 *
 *   node scripts/teste-fila-da-conversa.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/fila-da-conversa.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { criarRajadas, juntarTextos } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let rejeicaoSolta = null;
process.on("unhandledRejection", (e) => { rejeicaoSolta = e; });

/**
 * O MESMO roteiro que o webhook segue para cada mensagem: entra, espera a
 * rajada assentar, desiste se chegou outra, pega a vez, tira tudo, atende.
 */
function simulador({ esperaMs = 40, atendimentoMs = 60, tetoMs = 2000 } = {}) {
  const r = criarRajadas();
  const atendimentos = []; // { chave, textos, inicio, fim }
  let emCurso = new Map();
  let sobrepos = false;
  const mensagem = async (chave, texto, opcoes = {}) => {
    const senha = r.entrar(chave, { texto, audio: !!opcoes.audio });
    if (!opcoes.audio) await espera(esperaMs); // áudio não espera a rajada assentar
    if (r.chegouOutraDepois(chave, senha)) return "agrupada";
    const liberar = await r.vez(chave, tetoMs);
    try {
      const itens = r.tirar(chave, senha, (i) => i.audio);
      if (itens.length === 0) return "ja-levada";
      const textos = itens.map((i) => i.texto);
      const comAudio = itens.some((i) => i.audio);
      if (emCurso.get(chave)) sobrepos = true;
      emCurso.set(chave, true);
      const a = { chave, textos, comAudio, portadorEhAudio: !!opcoes.audio, inicio: Date.now(), fim: 0 };
      atendimentos.push(a);
      await (opcoes.atender ? opcoes.atender() : espera(atendimentoMs));
      a.fim = Date.now();
      emCurso.set(chave, false);
      return "atendida";
    } finally {
      liberar();
    }
  };
  return { r, atendimentos, mensagem, sobrepos: () => sobrepos };
}

console.log("\n1) Três mensagens picadas viram UM atendimento, na ordem");
{
  const s = simulador();
  const a = s.mensagem("loja_cli", "oi");
  await espera(10);
  const b = s.mensagem("loja_cli", "quero 2 x-tudo");
  await espera(10);
  const c = s.mensagem("loja_cli", "e uma coca");
  const fins = await Promise.all([a, b, c]);
  conferir("as duas primeiras saem de cena", fins[0] === "agrupada" && fins[1] === "agrupada" && fins[2] === "atendida", fins);
  conferir("um atendimento só", s.atendimentos.length === 1, s.atendimentos.length);
  conferir("com os três textos, em ordem", JSON.stringify(s.atendimentos[0].textos) === JSON.stringify(["oi", "quero 2 x-tudo", "e uma coca"]), s.atendimentos[0]);
  await espera(5);
  conferir("nada fica guardado depois", s.r.tamanho() === 0, s.r.tamanho());
}

console.log("\n2) Mensagem que chega DURANTE o atendimento espera a vez — e nada é descartado");
{
  const s = simulador({ esperaMs: 20, atendimentoMs: 120 });
  const a = s.mensagem("k", "quero pizza");
  await espera(60); // A já está sendo atendida
  const b = s.mensagem("k", "de calabresa");
  await espera(10);
  const c = s.mensagem("k", "grande");
  const fins = await Promise.all([a, b, c]);
  conferir("A atendida; B agrupada em C; C atendida", fins[0] === "atendida" && fins[1] === "agrupada" && fins[2] === "atendida", fins);
  conferir("dois atendimentos", s.atendimentos.length === 2, s.atendimentos);
  conferir("o segundo leva B e C", JSON.stringify(s.atendimentos[1].textos) === JSON.stringify(["de calabresa", "grande"]), s.atendimentos[1]);
  conferir("o segundo só começa depois que o primeiro termina", s.atendimentos[1].inicio >= s.atendimentos[0].fim, s.atendimentos);
  conferir("nunca dois atendimentos ao mesmo tempo na conversa", s.sobrepos() === false);
}

console.log("\n3) Quem pega a vez leva TAMBÉM o que chegou enquanto esperava");
{
  const s = simulador({ esperaMs: 20, atendimentoMs: 150 });
  const a = s.mensagem("k", "A");
  await espera(40);
  const b = s.mensagem("k", "B");   // assenta aos 60, espera a vez até ~170
  await espera(60);
  const c = s.mensagem("k", "C");   // assenta aos 120, também espera a vez
  const fins = await Promise.all([a, b, c]);
  conferir("B leva B e C", JSON.stringify(s.atendimentos[1]?.textos) === JSON.stringify(["B", "C"]), s.atendimentos);
  conferir("C encontra a rajada vazia e não atende de novo", fins[2] === "ja-levada" && s.atendimentos.length === 2, fins);
}

console.log("\n4) Conversas diferentes não esperam uma pela outra");
{
  const s = simulador({ esperaMs: 10, atendimentoMs: 100 });
  const t0 = Date.now();
  await Promise.all([s.mensagem("lojaA_cli1", "oi"), s.mensagem("lojaA_cli2", "oi"), s.mensagem("lojaB_cli1", "oi")]);
  conferir("três atendimentos", s.atendimentos.length === 3);
  conferir("em paralelo (não 3x o tempo)", Date.now() - t0 < 250, Date.now() - t0);
  conferir("cada um com o seu texto", s.atendimentos.every((a) => a.textos.length === 1));
}

console.log("\n5) Atendimento que TRAVA não cala a conversa para sempre");
{
  const s = simulador({ esperaMs: 10, atendimentoMs: 30, tetoMs: 120 });
  s.mensagem("k", "trava", { atender: () => new Promise(() => {}) }); // nunca termina, nunca libera
  await espera(40);
  const t0 = Date.now();
  const b = await s.mensagem("k", "segunda");
  const esperouB = Date.now() - t0;
  conferir("a segunda passa depois do teto", b === "atendida" && esperouB >= 100 && esperouB < 400, esperouB);
  const t1 = Date.now();
  const c = await s.mensagem("k", "terceira");
  const esperouC = Date.now() - t1;
  conferir("a TERCEIRA não paga o teto de novo (espera a segunda, não a travada)", c === "atendida" && esperouC < 100, esperouC);
}

console.log("\n6) Atendimento que LANÇA libera a vez (try/finally)");
{
  const s = simulador({ esperaMs: 10, atendimentoMs: 20 });
  const a = s.mensagem("k", "explode", { atender: async () => { throw new Error("falhou"); } }).catch((e) => "erro:" + e.message);
  await espera(15);
  const b = s.mensagem("k", "segue");
  const fins = await Promise.all([a, b]);
  conferir("o erro sobe para quem chamou", fins[0] === "erro:falhou", fins);
  conferir("a próxima é atendida sem esperar teto", fins[1] === "atendida", fins);
}

console.log("\n7) Liberar duas vezes não solta a vez de outro");
{
  const r = criarRajadas();
  const l1 = await r.vez("k", 1000);
  let segundoEntrou = false;
  const p2 = r.vez("k", 1000).then((l) => { segundoEntrou = true; return l; });
  l1(); l1();
  const l2 = await p2;
  let terceiroEntrou = false;
  const p3 = r.vez("k", 1000).then((l) => { terceiroEntrou = true; return l; });
  await espera(30);
  conferir("o segundo entrou", segundoEntrou === true);
  conferir("o terceiro NÃO entrou enquanto o segundo segura a vez", terceiroEntrou === false);
  l2();
  (await p3)();
  await espera(5);
  conferir("sem vazamento", r.tamanho() === 0, r.tamanho());
}

console.log("\n8) Áudio não espera a rajada, mas carrega os textos que já estavam nela");
{
  const s = simulador({ esperaMs: 50, atendimentoMs: 40 });
  const a = s.mensagem("k", "vou mandar áudio");
  await espera(10);
  const b = s.mensagem("k", "[áudio]", { audio: true });
  const fins = await Promise.all([a, b]);
  conferir("o texto sai de cena, o áudio atende", fins[0] === "agrupada" && fins[1] === "atendida", fins);
  conferir("o áudio leva o texto anterior junto", JSON.stringify(s.atendimentos[0].textos) === JSON.stringify(["vou mandar áudio", "[áudio]"]), s.atendimentos);
}

console.log("\n8b) Texto NUNCA leva o marcador de um áudio: o áudio se perderia");
{
  // T assentou e espera a vez atrás de X; o áudio chega depois e entra na fila atrás de T.
  const s = simulador({ esperaMs: 15, atendimentoMs: 120 });
  const x = s.mensagem("k", "X");
  await espera(30);
  const t = s.mensagem("k", "T");
  await espera(40);
  const a = s.mensagem("k", "[áudio]", { audio: true });
  const fins = await Promise.all([x, t, a]);
  conferir("três atendimentos: X, T e o áudio", fins.join() === "atendida,atendida,atendida" && s.atendimentos.length === 3, fins);
  conferir("T vai sem o marcador do áudio", JSON.stringify(s.atendimentos[1].textos) === JSON.stringify(["T"]) && s.atendimentos[1].comAudio === false, s.atendimentos[1]);
  conferir("o áudio é atendido pela PRÓPRIA chamada (a que tem os bytes)", s.atendimentos[2].portadorEhAudio === true && s.atendimentos[2].comAudio === true, s.atendimentos[2]);
  conferir("sem sobreposição", s.sobrepos() === false);
}
{
  // Dois áudios seguidos: cada um na sua chamada.
  const s = simulador({ esperaMs: 15, atendimentoMs: 60 });
  const a1 = s.mensagem("k", "[áudio 1]", { audio: true });
  await espera(5);
  const a2 = s.mensagem("k", "[áudio 2]", { audio: true });
  await Promise.all([a1, a2]);
  conferir("dois áudios = dois atendimentos", s.atendimentos.length === 2 && s.atendimentos.every((x) => x.textos.length === 1 && x.portadorEhAudio), s.atendimentos);
}
{
  // Áudio e, logo depois, um texto: o áudio (que não espera) leva o que já estava; o texto segue sozinho.
  const s = simulador({ esperaMs: 30, atendimentoMs: 80 });
  const a = s.mensagem("k", "[áudio]", { audio: true });
  await espera(10);
  const t = s.mensagem("k", "é pra entrega");
  const fins = await Promise.all([a, t]);
  conferir("nada se perde", s.atendimentos.flatMap((x) => x.textos).sort().join("|") === "[áudio]|é pra entrega", s.atendimentos);
  conferir("cada texto aparece uma vez só", s.atendimentos.flatMap((x) => x.textos).length === 2, fins);
  await espera(10);
  conferir("sem vazamento", s.r.tamanho() === 0, s.r.tamanho());
}

console.log("\n9) juntarTextos");
conferir("junta com quebra de linha", juntarTextos(["oi", "quero pizza"]) === "oi\nquero pizza");
conferir("ignora vazio e nulo", juntarTextos(["", null, "  ", "a", undefined]) === "a");
conferir("não repete a mesma linha em seguida (duplo toque)", juntarTextos(["oi", "oi", "tudo bem", "oi"]) === "oi\ntudo bem\noi");
conferir("lista vazia", juntarTextos([]) === "");

await espera(20);
conferir("nenhuma rejeição solta", rejeicaoSolta === null, String(rejeicaoSolta));

console.log(falhas === 0 ? "\nTUDO CERTO\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
