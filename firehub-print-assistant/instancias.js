/**
 * Quantos Assistentes estão no ar neste PC, e qual fica (main.js, itens 5 e 6).
 *
 * Fora do main.js para dar para testar sem subir o Electron
 * (scripts/teste-instancias.js): aqui não há `app`, janela nem log — só a
 * decisão e o que ela precisa perguntar ao Windows.
 */
const { execFile } = require("child_process");

const APP_ID = "FireHub-Thermal-Printer-v2";

function compararVersoes(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Qual das duas fica. Uma regra só, para a abertura e para a conferência de
 * minuto em minuto: a de versão mais nova; na mesma versão, a que abriu
 * primeiro — a cópia que já estava imprimindo não cai por causa de uma igual
 * que chegou depois. Devolve o que ESTA cópia faz com a outra.
 */
function oQueFazerComAOutra({ minhaVersao, meuInicio, outra }) {
  const cmp = compararVersoes(outra.versao, minhaVersao);
  if (cmp < 0) return "derrubar";
  if (cmp > 0) return "sair";
  return outra.iniciadoEm && meuInicio && outra.iniciadoEm > meuInicio ? "derrubar" : "sair";
}

/** O PID de quem escuta na porta, pelo `netstat` (Assistentes anteriores à 1.2.7 não mandam o pid no /status). */
function pidDaPorta(porta, { ignorarPid = process.pid, executar = execFile } = {}) {
  return new Promise((resolve) => {
    executar("netstat", ["-ano", "-p", "TCP"], { windowsHide: true }, (err, saida) => {
      if (err) return resolve(null);
      resolve(pidNaSaidaDoNetstat(String(saida), porta, ignorarPid));
    });
  });
}

function pidNaSaidaDoNetstat(saida, porta, ignorarPid) {
  for (const linha of saida.split(/\r?\n/)) {
    const partes = linha.trim().split(/\s+/);
    if (partes.length < 5 || !/LISTEN/i.test(partes[3])) continue;
    if (!partes[1].endsWith(`:${porta}`)) continue;
    const pid = Number(partes[4]);
    if (pid && pid !== ignorarPid) return pid;
  }
  return null;
}

/** Os outros Assistentes que respondem nas portas — de qualquer instalação e versão. */
async function outrasCopiasNoAr(portas, { meuPid = process.pid, buscar = fetch, pidPelaPorta = pidDaPorta } = {}) {
  const achadas = new Map();
  for (const porta of portas) {
    try {
      const res = await buscar(`http://127.0.0.1:${porta}/status`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const info = await res.json();
      if (!info || info.app !== APP_ID || info.pid === meuPid) continue;
      const pid = Number(info.pid) || (await pidPelaPorta(porta, { ignorarPid: meuPid }));
      if (!pid || pid === meuPid || achadas.has(pid)) continue;
      achadas.set(pid, {
        pid,
        porta,
        versao: String(info.version || "0"),
        iniciadoEm: Date.parse(info.iniciadoEm || "") || 0,
      });
    } catch {}
  }
  return [...achadas.values()];
}

/**
 * Derruba pelo PID, nunca pelo nome: o executável de outra instalação pode ter
 * outro nome, e um `taskkill /IM` com o nome desta pegaria esta junto.
 */
function derrubarPeloPid(pid, { executar = execFile, esperarMs = 1500 } = {}) {
  return new Promise((resolve) => {
    executar("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, (err) => {
      setTimeout(() => resolve(!err), esperarMs);
    });
  });
}

/**
 * A tarefa da vigia no Agendador do Windows, em XML (o `/TR` da linha de
 * comando não aguenta caminho com espaço e aspas). Ver main.js, item 6.
 */
function xmlDaVigia({ usuario, executavel, habilitada = true }) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ligada = habilitada ? "true" : "false";
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Mantém o FireHub Assistente de Impressão rodando: abre no logon e confere a cada 5 minutos.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>${ligada}</Enabled>
      <UserId>${esc(usuario)}</UserId>
      <Delay>PT1M</Delay>
    </LogonTrigger>
    <TimeTrigger>
      <Enabled>${ligada}</Enabled>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${esc(usuario)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>${ligada}</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${esc(executavel)}</Command>
      <Arguments>--hidden --vigia</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/** O XML no formato que o `schtasks /XML` aceita: UTF-16 com BOM. */
function arquivoDaVigia(opcoes) {
  return Buffer.from("\ufeff" + xmlDaVigia(opcoes), "utf16le");
}

module.exports = {
  APP_ID,
  compararVersoes,
  oQueFazerComAOutra,
  pidDaPorta,
  pidNaSaidaDoNetstat,
  outrasCopiasNoAr,
  derrubarPeloPid,
  xmlDaVigia,
  arquivoDaVigia,
};
