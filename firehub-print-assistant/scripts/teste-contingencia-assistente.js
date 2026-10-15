/**
 * scripts/teste-contingencia-assistente.js
 *
 * O Modo Contingência dentro do Assistente (contingencia.js), sem Electron e
 * sem nuvem — tudo num APPDATA de mentira na pasta temporária:
 *   • a regra da troca de versão da cópia (decidirTroca): nuvem estável há
 *     5 min, modo normal, expediente só segura com o mesmo esquema do banco;
 *   • o esquema achado na lista do pacote, a faxina de objetos/ e o tasklist;
 *   • DE VERDADE: monta uma versão com milhares de arquivos e põe a pasta de
 *     lado para apagar, medindo o atraso do processo e o tempo de resposta de
 *     um /status servido NESTE processo (o que a vigia pergunta). Em 14/10 o
 *     rmSync da cópia deixou o Assistente ~10 s surdo; aqui tem de ficar
 *     abaixo de 500 ms.
 *
 *   node scripts/teste-contingencia-assistente.js           (3.000 arquivos)
 *   node scripts/teste-contingencia-assistente.js --cheio   (9.170, como a versão real)
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

// Antes do require: o contingencia.js monta as pastas a partir do APPDATA.
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), "firehub-contingencia-teste-"));
process.env.APPDATA = RAIZ;
const c = require("../contingencia");

let falhas = 0;
function confere(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`}`);
}

const LIMITE_MS = 500;

/** Mede, enquanto `trabalho` roda: o maior atraso do relógio do processo e o /status mais lento. */
async function medir(trabalho) {
  const servidor = http.createServer((_req, res) => res.end(JSON.stringify({ ok: true })));
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${servidor.address().port}/status`;
  let maiorAtraso = 0;
  let ultimo = performance.now();
  const relogio = setInterval(() => {
    const agora = performance.now();
    maiorAtraso = Math.max(maiorAtraso, agora - ultimo - 20);
    ultimo = agora;
  }, 20);
  let terminou = false;
  let maiorStatus = 0;
  let perguntas = 0;
  const vigia = (async () => {
    while (!terminou) {
      const t0 = performance.now();
      try {
        await fetch(url, { signal: AbortSignal.timeout(5000) });
      } catch {
        maiorStatus = Math.max(maiorStatus, 5000);
      }
      maiorStatus = Math.max(maiorStatus, performance.now() - t0);
      perguntas++;
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  const t0 = performance.now();
  await trabalho();
  const duracao = performance.now() - t0;
  terminou = true;
  await vigia;
  clearInterval(relogio);
  servidor.close();
  return { duracao, maiorAtraso, maiorStatus, perguntas };
}

async function esperarSumir(caminho, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (!fs.existsSync(caminho)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !fs.existsSync(caminho);
}

async function main() {
  // ── A regra da troca ────────────────────────────────────────────────
  const agora = 10_000_000;
  const normal = { modo: "normal", pendentes: 0, falhas: 0 };
  const estavel = agora - c.NUVEM_ESTAVEL_MS - 1000;
  const troca = (o) => c.decidirTroca({ vivo: true, estado: normal, agora, nuvemInstavelEm: estavel, adiar: null, mesmoEsquema: true, ...o }).trocar;
  confere("sem supervisor de pé: troca já", troca({ vivo: false, estado: null, nuvemInstavelEm: agora }), true);
  confere("loja em paz, nuvem estável há 5 min: troca", troca({}), true);
  confere("nuvem instável há 1 min: espera", troca({ nuvemInstavelEm: agora - 60_000 }), false);
  confere("supervisor vendo falha agora: espera", troca({ estado: { ...normal, falhas: 2 } }), false);
  confere("em contingência: espera", troca({ estado: { ...normal, modo: "contingencia" } }), false);
  confere("voltando: espera", troca({ estado: { ...normal, modo: "voltando" } }), false);
  confere("mudanças para subir: espera", troca({ estado: { ...normal, pendentes: 3 } }), false);
  confere("supervisor não respondeu: espera", troca({ estado: null }), false);
  confere("expediente com o mesmo esquema: espera", troca({ adiar: "loja aberta até 23:30", mesmoEsquema: true }), false);
  confere("expediente com esquema novo: troca já", troca({ adiar: "loja aberta até 23:30", mesmoEsquema: false }), true);
  confere("expediente com esquema novo e nuvem instável: espera", troca({ adiar: "loja aberta", mesmoEsquema: false, nuvemInstavelEm: agora - 1000 }), false);
  confere("supervisor antigo (sem o campo falhas): troca", troca({ estado: { modo: "normal", pendentes: 0 } }), true);
  const espera = c.decidirTroca({ vivo: true, estado: normal, agora, nuvemInstavelEm: agora - 60_000, adiar: null, mesmoEsquema: true });
  confere("nuvem instável: tenta de novo quando completar 5 min", espera.tentarDeNovoEmMs > 0 && espera.tentarDeNovoEmMs <= c.NUVEM_ESTAVEL_MS, true);

  // ── O esquema dentro da lista do pacote ─────────────────────────────
  const h = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const lista = [
    { caminho: "server.js", hash: h("a") },
    { caminho: ".next/node_modules/@prisma/client-abc/node_modules/.prisma/client/schema.prisma", hash: h("b") },
    { caminho: "node_modules/.prisma/client/schema.prisma", hash: h("c") },
  ];
  confere("esquema: o schema.prisma do node_modules da raiz", c.hashDoEsquemaNaLista(lista), h("c"));
  confere("esquema: lista sem schema.prisma → null", c.hashDoEsquemaNaLista([{ caminho: "x.js", hash: h("x") }]), null);

  // ── Faxina de objetos/ ──────────────────────────────────────────────
  const ficam = new Set([h("1"), h("2")]);
  confere(
    "objetos: sai o hash que nenhuma versão usa e o .baixando; fica o resto",
    c.objetosQueSobram([h("1"), h("2"), h("3"), `${h("4")}.baixando`, "leia-me.txt"], ficam),
    [h("3"), `${h("4")}.baixando`],
  );

  // ── tasklist ────────────────────────────────────────────────────────
  const saida = '"node.exe","4321","Console","1","45.000 K"\r\n';
  confere("tasklist: é o node.exe do pid", c.pidEhNode(saida, 4321), true);
  confere("tasklist: outro pid", c.pidEhNode(saida, 432), false);
  confere("tasklist: outro programa no pid", c.pidEhNode('"chrome.exe","4321","Console","1","45.000 K"', 4321), false);
  confere("tasklist: nenhum (pt-BR)", c.pidEhNode("INFORMAÇÕES: Não há tarefas em execução que correspondam aos critérios especificados.", 4321), false);

  // ── De verdade: montar e apagar sem travar o processo ───────────────
  const n = process.argv.includes("--cheio") ? 9170 : 3000;
  const objetos = path.join(RAIZ, "objetos");
  fs.mkdirSync(objetos, { recursive: true });
  const arquivos = [];
  for (let i = 0; i < n; i++) {
    const conteudo = `arquivo ${i}\n`;
    const hash = h(conteudo);
    fs.writeFileSync(path.join(objetos, hash), conteudo);
    arquivos.push({ caminho: `node_modules/pacote${i % 60}/lib${i % 7}/arquivo${i}.js`, hash });
  }
  // O mesmo conteúdo em dois caminhos (acontece no pacote real).
  arquivos.push({ caminho: "copia/de/arquivo0.js", hash: arquivos[0].hash });
  arquivos.push({ caminho: "node_modules/.prisma/client/schema.prisma", hash: arquivos[1].hash });

  const dir = path.join(RAIZ, "app", "V1");
  const montar = await medir(() => c.montarVersao("V1", arquivos, dir, objetos, () => {}));
  console.log(
    `     montar ${arquivos.length} arquivos: ${Math.round(montar.duracao)} ms; maior atraso do processo ${Math.round(montar.maiorAtraso)} ms; /status mais lento ${Math.round(montar.maiorStatus)} ms (${montar.perguntas} perguntas)`,
  );
  confere("montou a versão inteira (arquivo, cópia do mesmo hash, .completo)", [
    fs.readFileSync(path.join(dir, "node_modules/pacote5/lib5/arquivo5.js"), "utf8"),
    fs.readFileSync(path.join(dir, "copia/de/arquivo0.js"), "utf8"),
    fs.existsSync(path.join(dir, ".completo")),
    fs.existsSync(`${dir}.montando`),
  ], ["arquivo 5\n", "arquivo 0\n", true, false]);
  const gravada = JSON.parse(fs.readFileSync(path.join(dir, ".lista.json"), "utf8"));
  confere("a lista da versão fica gravada (hashes sem repetir e o esquema)", [gravada.versao, gravada.hashes.length, gravada.esquema], ["V1", n, arquivos[1].hash]);
  confere(`montar: /status responde em menos de ${LIMITE_MS} ms`, montar.maiorStatus < LIMITE_MS, true);
  confere(`montar: o processo nunca fica ${LIMITE_MS} ms parado`, montar.maiorAtraso < LIMITE_MS, true);

  // Montar de novo por cima (versão refeita): a velha sai do caminho sem travar.
  fs.rmSync(path.join(dir, ".completo"));
  await c.montarVersao("V1", arquivos.slice(0, 10), dir, objetos, () => {});
  confere("remontar troca a pasta inteira (só os 10 arquivos novos)", fs.existsSync(path.join(dir, "node_modules/pacote50/lib1/arquivo50.js")), false);

  const segunda = path.join(RAIZ, "app", "V2");
  await c.montarVersao("V2", arquivos, segunda, objetos, () => {});
  let deLado = null;
  const apagar = await medir(async () => {
    await c.tirarDoCaminho(segunda);
    deLado = fs.readdirSync(path.join(RAIZ, "app")).find((v) => v.startsWith("V2.apagar-"));
  });
  console.log(`     pôr de lado ${arquivos.length} arquivos: ${Math.round(apagar.duracao)} ms; maior atraso ${Math.round(apagar.maiorAtraso)} ms`);
  confere("pôr de lado: o caminho fica livre na hora", fs.existsSync(segunda), false);
  confere("pôr de lado: virou <nome>.apagar-<hora>", !!deLado, true);
  const sumiu = await medir(() => esperarSumir(path.join(RAIZ, "app", deLado || "x"), 120_000));
  console.log(
    `     apagar em segundo plano: ${Math.round(sumiu.duracao)} ms; maior atraso ${Math.round(sumiu.maiorAtraso)} ms; /status mais lento ${Math.round(sumiu.maiorStatus)} ms`,
  );
  confere("apagar em segundo plano: terminou", fs.existsSync(path.join(RAIZ, "app", deLado || "x")), false);
  confere(`apagar: /status responde em menos de ${LIMITE_MS} ms`, sumiu.maiorStatus < LIMITE_MS, true);
  confere(`apagar: o processo nunca fica ${LIMITE_MS} ms parado`, sumiu.maiorAtraso < LIMITE_MS, true);
  confere("os objetos continuam (hardlink)", fs.readFileSync(path.join(objetos, arquivos[7].hash), "utf8"), "arquivo 7\n");

  // Comparação (não é critério): o jeito antigo, rmSync de uma vez.
  const velha = path.join(RAIZ, "app", "V3");
  await c.montarVersao("V3", arquivos, velha, objetos, () => {});
  const t0 = performance.now();
  fs.rmSync(velha, { recursive: true, force: true });
  console.log(`     (antes: rmSync da mesma pasta deixava o processo ${Math.round(performance.now() - t0)} ms parado)`);

  await c.apagarArvore(RAIZ).catch(() => {});
  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error("TESTE QUEBROU:", e);
  process.exit(2);
});
