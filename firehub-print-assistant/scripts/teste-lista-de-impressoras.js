/**
 * scripts/teste-lista-de-impressoras.js
 *
 * A lista de impressoras do server.js (etapasDaListaDeImpressoras) roda de
 * dois jeitos: parada (rodarSincrono, só a primeiríssima leitura) e sem travar
 * o Assistente (rodarAssincrono, o resto — 14/10/2026). Aqui as duas recebem
 * as MESMAS saídas falsas de reg.exe/PowerShell e têm de chegar à mesma lista
 * e ao mesmo diagnóstico, inclusive quando as etapas falham e caem no
 * fallback. Não roda programa nenhum do Windows nem sobe o servidor: recorta
 * as funções do server.js e roda num contexto isolado.
 *
 *   node scripts/teste-lista-de-impressoras.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");

function recortar(cabeca) {
  const inicio = fonte.indexOf(cabeca);
  if (inicio < 0) throw new Error(`não achei "${cabeca}" em server.js`);
  let nivel = 0;
  let i = fonte.indexOf("{", inicio);
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  return fonte.slice(inicio, i + 1);
}
function linha(comeco) {
  const inicio = fonte.indexOf(comeco);
  if (inicio < 0) throw new Error(`não achei "${comeco}" em server.js`);
  return fonte.slice(inicio, fonte.indexOf("\n", inicio));
}

const codigo = [
  linha("const CHAVE_IMPRESSORAS_SISTEMA ="),
  linha("const PREFIXO_IMPRESSORAS_SISTEMA ="),
  linha("const CMD_REGISTRO_DO_USUARIO ="),
  "var diagnosticoImpressoras = [];",
  recortar("function safeJsonParse("),
  recortar("function dedupePrinters("),
  recortar("function comandoDoRegistroDoSistema("),
  recortar("function valorPorImpressoraNaSaida("),
  recortar("function* impressorasPeloRegistroDoSistema("),
  recortar("function* etapasDaListaDeImpressoras("),
  recortar("function rodarSincrono("),
  recortar("async function rodarAssincrono("),
  "this.api = { etapasDaListaDeImpressoras, rodarSincrono, rodarAssincrono, diag: () => diagnosticoImpressoras };",
].join("\n\n");

const contexto = { execSync: () => { throw new Error("execSync de verdade não"); }, exec: () => { throw new Error("exec de verdade não"); } };
vm.createContext(contexto);
vm.runInContext(codigo, contexto);
const { etapasDaListaDeImpressoras, rodarSincrono, rodarAssincrono, diag } = contexto.api;

let falhas = 0;
function confere(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`}`);
}

const PREFIXO = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\";
const SAIDAS = {
  porta: [`${PREFIXO}EPSON TM-T20`, "    Port    REG_SZ    USB001", "", `${PREFIXO}Microsoft Print to PDF`, "    Port    REG_SZ    PORTPROMPT:", `${PREFIXO}EPSON TM-T20\\DsDriver`, ""].join("\r\n"),
  driver: [`${PREFIXO}EPSON TM-T20`, "    Printer Driver    REG_SZ    EPSON TM-T20 Receipt", `${PREFIXO}Microsoft Print to PDF`, "    Printer Driver    REG_SZ    Microsoft Print To PDF", ""].join("\r\n"),
  usuario: ["HKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\PrinterPorts", "    EPSON TM-T20    REG_SZ    winspool,USB001,15,45", "    \\\\CAIXA\\ELGIN i9    REG_SZ    winspool,Ne01:,15,45", ""].join("\r\n"),
  getPrinter: JSON.stringify([{ Name: "ELGIN i9", DriverName: "ELGIN i9(USB)", PortName: "USB002" }]),
};

/** Um "Windows" falso: cada comando devolve a saída do cenário ou falha. */
function windowsFalso(cenario) {
  const responder = (cmd) => {
    if (cmd.includes('/v "Port"')) return cenario.porta;
    if (cmd.includes('/v "Printer Driver"')) return cenario.driver;
    if (cmd.includes("PrinterPorts")) return cenario.usuario;
    if (cmd.includes("Get-Printer | Select-Object")) return cenario.getPrinter;
    if (cmd.includes("Win32_Printer")) return cenario.wmi;
    if (cmd.includes("(Get-Printer).Name")) return cenario.nomes;
    return undefined;
  };
  const rodar = (cmd) => {
    const saida = responder(cmd);
    if (saida === undefined) throw new Error(`Command failed: ${cmd.slice(0, 20)}`);
    return saida;
  };
  return { sincrono: (cmd) => rodar(cmd), assincrono: async (cmd) => rodar(cmd) };
}

async function nosDoisJeitos(nome, cenario) {
  const w = windowsFalso(cenario);
  const parado = rodarSincrono(etapasDaListaDeImpressoras(), w.sincrono);
  const diagParado = diag();
  const semTravar = await rodarAssincrono(etapasDaListaDeImpressoras(), w.assincrono);
  const diagSemTravar = diag();
  confere(`${nome}: os dois jeitos dão a mesma lista`, semTravar, parado);
  confere(`${nome}: e o mesmo diagnóstico`, diagSemTravar, diagParado);
  return { lista: parado, diag: diagParado };
}

(async () => {
  const tudo = await nosDoisJeitos("registros ok", { porta: SAIDAS.porta, driver: SAIDAS.driver, usuario: SAIDAS.usuario });
  confere("registros ok: HKLM com porta e driver primeiro, HKCU soma a de rede", tudo.lista.map((p) => [p.name, p.port, p.driver]), [
    ["EPSON TM-T20", "USB001", "EPSON TM-T20 Receipt"],
    ["Microsoft Print to PDF", "PORTPROMPT:", "Microsoft Print To PDF"],
    ["\\\\CAIXA\\ELGIN i9", "Ne01:", ""],
  ]);

  const semDriver = await nosDoisJeitos("driver falhou", { porta: SAIDAS.porta, usuario: SAIDAS.usuario });
  confere("driver falhou: a lista sai sem driver, sem perder impressora", semDriver.lista.map((p) => [p.name, p.driver]), [["EPSON TM-T20", ""], ["Microsoft Print to PDF", ""], ["\\\\CAIXA\\ELGIN i9", ""]]);

  const ps = await nosDoisJeitos("registros falharam", { getPrinter: SAIDAS.getPrinter });
  confere("registros falharam: cai no Get-Printer", ps.lista.map((p) => [p.name, p.port]), [["ELGIN i9", "USB002"]]);
  confere("registros falharam: o diagnóstico conta cada etapa", ps.diag.map((d) => d.split(":")[0]), ["registro do sistema (HKLM)", "registro do usuario (HKCU)", "PowerShell Get-Printer"]);

  const nomes = await nosDoisJeitos("só o texto puro", { nomes: "ELGIN i9\r\nPOS-80\r\n" });
  confere("só o texto puro: último fallback", nomes.lista.map((p) => p.name), ["ELGIN i9", "POS-80"]);

  const nada = await nosDoisJeitos("tudo falhou", {});
  confere("tudo falhou: lista vazia e as cinco etapas no diagnóstico", [nada.lista.length, nada.diag.length], [0, 5]);

  console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error("TESTE QUEBROU:", e); process.exit(2); });
