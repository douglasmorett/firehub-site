/**
 * scripts/teste-instancias.js
 *
 * Um Assistente por PC (main.js item 5) e a vigia do Windows (item 6), sem
 * subir o Electron. O fim do teste é de verdade, não simulado:
 *   • sobe dois "Assistentes" falsos em portas livres, cada um num processo,
 *     e confere que `outrasCopiasNoAr` acha os dois e `derrubarPeloPid`
 *     derruba o certo (e só ele);
 *   • registra a tarefa da vigia DESLIGADA no Agendador deste PC, lê de volta
 *     e apaga — é o Agendador que diz se o XML vale.
 *
 *   node scripts/teste-instancias.js
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const {
  APP_ID, compararVersoes, oQueFazerComAOutra, pidNaSaidaDoNetstat,
  outrasCopiasNoAr, derrubarPeloPid, arquivoDaVigia,
} = require("../instancias");

let falhas = 0;
function confere(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`}`);
}

async function main() {
  // ── Versões ─────────────────────────────────────────────────────────
  confere("1.2.27 > 1.2.26", compararVersoes("1.2.27", "1.2.26"), 1);
  confere("1.2.9 < 1.2.10 (número, não texto)", compararVersoes("1.2.9", "1.2.10"), -1);
  confere("1.2 = 1.2.0", compararVersoes("1.2", "1.2.0"), 0);
  confere("sem versão < qualquer", compararVersoes(undefined, "1.0.0"), -1);

  // ── Quem fica ───────────────────────────────────────────────────────
  const eu = { minhaVersao: "1.2.27", meuInicio: 1000 };
  confere("outra mais antiga: derrubar", oQueFazerComAOutra({ ...eu, outra: { versao: "1.2.19", iniciadoEm: 1 } }), "derrubar");
  confere("outra mais nova: sair", oQueFazerComAOutra({ ...eu, outra: { versao: "1.2.28", iniciadoEm: 5000 } }), "sair");
  confere("mesma versão, outra abriu antes: sair", oQueFazerComAOutra({ ...eu, outra: { versao: "1.2.27", iniciadoEm: 500 } }), "sair");
  confere("mesma versão, outra abriu depois: derrubar", oQueFazerComAOutra({ ...eu, outra: { versao: "1.2.27", iniciadoEm: 2000 } }), "derrubar");
  confere("mesma versão, outra sem hora: sair (não derruba no escuro)", oQueFazerComAOutra({ ...eu, outra: { versao: "1.2.27", iniciadoEm: 0 } }), "sair");
  // As duas cópias rodando a mesma regra chegam a respostas opostas — nunca as duas saem nem as duas ficam.
  const a = { versao: "1.2.27", iniciadoEm: 100 }, b = { versao: "1.2.27", iniciadoEm: 200 };
  confere("regra simétrica (A fica, B sai)", [
    oQueFazerComAOutra({ minhaVersao: a.versao, meuInicio: a.iniciadoEm, outra: b }),
    oQueFazerComAOutra({ minhaVersao: b.versao, meuInicio: b.iniciadoEm, outra: a }),
  ], ["derrubar", "sair"]);

  // ── netstat (Assistente antigo sem pid no /status) ──────────────────
  const saida = [
    "  Proto  Endereço local         Endereço externo       Estado         PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1180",
    "  TCP    0.0.0.0:7899           0.0.0.0:0              LISTENING       4321",
    "  TCP    127.0.0.1:7899         127.0.0.1:55012        ESTABLISHED     4321",
    "  TCP    [::]:7900              [::]:0                 LISTENING       8765",
    "  TCP    127.0.0.1:17899        0.0.0.0:0              LISTENING       999",
  ].join("\r\n");
  confere("netstat: porta 7899 → 4321", pidNaSaidaDoNetstat(saida, 7899, 1), 4321);
  confere("netstat: IPv6 7900 → 8765", pidNaSaidaDoNetstat(saida, 7900, 1), 8765);
  confere("netstat: 7899 não casa com 17899", pidNaSaidaDoNetstat(saida.replace(/.*:7899 .*LISTENING.*\r\n/, ""), 7899, 1), null);
  confere("netstat: o próprio pid não conta", pidNaSaidaDoNetstat(saida, 7899, 4321), null);

  // ── De verdade: dois Assistentes falsos, cada um no seu processo ────
  const portas = [];
  const filhos = [];
  for (const versao of ["1.2.19", "1.2.28"]) {
    const filho = spawn(process.execPath, ["-e", `
      const http = require("http");
      const s = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ app: ${JSON.stringify(APP_ID)}, version: ${JSON.stringify(versao)}, pid: process.pid, iniciadoEm: new Date().toISOString() }));
      });
      s.listen(0, "127.0.0.1", () => console.log(s.address().port));
    `], { stdio: ["ignore", "pipe", "inherit"] });
    const porta = await new Promise((resolve) => filho.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
    filhos.push(filho);
    portas.push(porta);
  }
  // Uma porta com outro programa (não é Assistente) e uma porta vazia.
  const intruso = http.createServer((req, res) => res.end(JSON.stringify({ app: "outra-coisa", pid: 1 })));
  await new Promise((r) => intruso.listen(0, "127.0.0.1", r));
  const portaVazia = 1; // ninguém escuta na 1

  const achadas = await outrasCopiasNoAr([...portas, intruso.address().port, portaVazia]);
  confere("achou os dois Assistentes (e só eles)", achadas.map((c) => [c.versao, c.pid]).sort(), filhos.map((f, i) => [["1.2.19", "1.2.28"][i], f.pid]).sort());
  confere("a própria cópia não conta", (await outrasCopiasNoAr(portas, { meuPid: filhos[0].pid })).map((c) => c.pid), [filhos[1].pid]);

  const antigo = achadas.find((c) => c.versao === "1.2.19");
  confere("derrubou o antigo", await derrubarPeloPid(antigo.pid), true);
  const depois = await outrasCopiasNoAr(portas);
  confere("sobrou só o mais novo", depois.map((c) => c.versao), ["1.2.28"]);
  confere("derrubar pid que não existe diz que não conseguiu", await derrubarPeloPid(999999, { esperarMs: 0 }), false);

  filhos.forEach((f) => { try { f.kill(); } catch {} });
  intruso.close();

  // ── De verdade: o Agendador aceita a tarefa da vigia? ──────────────
  if (process.platform === "win32") {
    const nome = `FireHub TESTE vigia ${process.pid}`;
    const arquivo = path.join(os.tmpdir(), `vigia-teste-${process.pid}.xml`);
    const usuario = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
    // DESLIGADA: o teste valida o XML sem nada rodar. Caminho com espaço e
    // "&" de propósito — é o que quebrava o /TR da linha de comando.
    fs.writeFileSync(arquivo, arquivoDaVigia({ usuario, executavel: "C:\\Program Files\\Pasta & Teste\\FireHub.exe", habilitada: false }));
    try {
      execFileSync("schtasks", ["/Create", "/F", "/TN", nome, "/XML", arquivo], { stdio: "pipe" });
      const lido = execFileSync("schtasks", ["/Query", "/TN", nome, "/XML"], { encoding: "utf8" });
      confere("Agendador aceitou e guardou o executável com espaço e &", lido.includes("C:\\Program Files\\Pasta &amp; Teste\\FireHub.exe"), true);
      confere("argumentos --hidden --vigia", lido.includes("<Arguments>--hidden --vigia</Arguments>"), true);
      confere("sem limite de tempo (PT0S)", lido.includes("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"), true);
      confere("repete a cada 5 min", lido.includes("<Interval>PT5M</Interval>"), true);
      confere("instâncias em paralelo", lido.includes("<MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>"), true);
      confere("roda na bateria", lido.includes("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"), true);
    } catch (e) {
      falhas++;
      console.log(`FALHOU Agendador recusou a tarefa: ${String(e.stderr || e.message).trim()}`);
    } finally {
      try { execFileSync("schtasks", ["/Delete", "/F", "/TN", nome], { stdio: "pipe" }); } catch {}
      try { fs.unlinkSync(arquivo); } catch {}
    }
  }

  if (falhas > 0) {
    console.error(`\n${falhas} falha(s)`);
    process.exit(1);
  }
  console.log("\ntudo certo");
}

main().catch((e) => { console.error(e); process.exit(1); });
