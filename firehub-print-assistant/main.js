/**
 * FireHub Assistente de Impressão — processo principal (Electron)
 *
 * Ele vive NA BANDEJA, perto do relógio. Não é uma janela que a pessoa
 * mantém aberta: é um serviço, e a janela é só a tela de status.
 *
 * ── O que quebrava antes (20/09/2026) ─────────────────────────────────────
 *
 *  1. ÍCONE EM BRANCO. A bandeja recebia um PNG 16x16 genérico embutido em
 *     base64 aqui dentro. No Windows saía um quadradinho sem desenho, e o
 *     lojista não achava o programa entre os outros ícones — quando ele
 *     "sumia", ninguém sabia dizer se ainda estava rodando. Agora é a chama do
 *     FireHub (assets/icon.ico, gerado de public/firehub-flame.png por
 *     scripts/gerar-icone-do-assistente.js), nos oito tamanhos que o Windows
 *     escolhe conforme o DPI.
 *
 *  2. APARECIA NA BARRA DE TAREFAS. A janela nascia visível e com botão na
 *     barra. Botão na barra convida a ser fechado, e fechar programa de
 *     impressão no meio do movimento é loja sem comanda. Agora a janela nasce
 *     escondida, com `skipTaskbar`, e só aparece se alguém pedir pela bandeja.
 *
 *  3. FECHAVA SOZINHO. Três caminhos, todos fechados agora:
 *       • `window-all-closed` — o padrão do Electron no Windows é ENCERRAR o
 *         app quando a última janela fecha. Bastava um `destroy()` vindo de
 *         qualquer lugar e o Assistente ia embora calado. Agora o evento é
 *         interceptado e não encerra nada;
 *       • `uncaughtException` / `unhandledRejection` — erro solto derrubava o
 *         processo. Agora vira linha de log e a impressão continua;
 *       • a cópia nova MATAVA a antiga (um `taskkill` na porta 7891 logo no
 *         início do arquivo), enquanto a trava do server.js mandava a cópia
 *         nova sair. As duas se anulavam e, dependendo de quem ganhasse a
 *         corrida, a loja ficava sem nenhuma. Agora quem manda é a trava de
 *         instância do Electron, com uma regra só: QUEM ESTÁ VIVO FICA.
 *
 *  4. NÃO SUBIA COM O PC de forma confiável. O registro de inicialização era
 *     feito uma vez e nunca conferido. Agora é reescrito a cada boot e
 *     confirmado no log — e sobe escondido, direto para a bandeja.
 */
const { app, Tray, Menu, nativeImage, BrowserWindow, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

const PASTA_DADOS = path.join(process.env.APPDATA || os.homedir(), "FireHub");
const VERSAO = require("./package.json").version;

function log(msg) {
  const linha = `[${new Date().toISOString()}] ${msg}`;
  console.log("[Main]", msg);
  try {
    fs.mkdirSync(PASTA_DADOS, { recursive: true });
    fs.appendFileSync(path.join(PASTA_DADOS, "assistente.log"), linha + "\n");
  } catch {}
}

/* ── 1. ERRO SOLTO NÃO DERRUBA A IMPRESSÃO ──────────────────────────────
 *
 * Qualquer exceção não tratada no processo principal encerrava o Electron
 * inteiro — a bandeja sumia e a loja só descobria quando a comanda não saiu.
 * Nada aqui é tão importante quanto continuar imprimindo: o erro vira log. */
process.on("uncaughtException", (err) => {
  if (err && (err.code === "EADDRINUSE" || String(err.message || "").includes("EADDRINUSE"))) {
    log("Porta já em uso por outro Assistente ativo — seguindo assim mesmo.");
    return;
  }
  log(`ERRO não tratado (seguindo em frente): ${err?.stack || err}`);
});
process.on("unhandledRejection", (motivo) => {
  log(`Promessa rejeitada sem tratamento (seguindo em frente): ${motivo}`);
});

/* ── 2. UMA CÓPIA SÓ — E É A QUE ESTÁ VIVA QUE FICA ─────────────────────
 *
 * Duas cópias imprimem a mesma comanda duas vezes (o cache de "já impresso"
 * vive na memória de cada processo). Mas o contrário é pior: matar a cópia
 * que está funcionando e ficar com uma travada é a loja sem comanda nenhuma.
 *
 * Por isso a decisão não é "quem chegou primeiro", é "quem responde":
 *   • a cópia que já está no ar responde em /status  -> esta aqui sai calada;
 *   • ninguém responde (processo travado ou zumbi)   -> derruba e assume.
 *
 * `--assumindo` evita laço: a cópia que já tentou assumir uma vez desiste em
 * vez de ficar se matando e reabrindo para sempre. */
const PORTAS = [7899, 7900, 7901, 7891];
const souOPrimeiro = app.requestSingleInstanceLock();

async function outroAssistenteRespondendo() {
  for (const porta of PORTAS) {
    try {
      const res = await fetch(`http://127.0.0.1:${porta}/status`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const info = await res.json();
      if (info && info.app === "FireHub-Thermal-Printer-v2" && info.pid !== process.pid) return porta;
    } catch {}
  }
  return null;
}

function derrubarOsOutros() {
  return new Promise((resolve) => {
    const exe = path.basename(process.execPath);
    execFile(
      "taskkill",
      ["/F", "/IM", exe, "/FI", `PID ne ${process.pid}`],
      { windowsHide: true },
      (err, saida) => {
        log(`Derrubando cópias travadas de ${exe}: ${err ? err.message : String(saida).trim()}`);
        setTimeout(resolve, 1500);
      }
    );
  });
}

if (!souOPrimeiro) {
  (async () => {
    const porta = await outroAssistenteRespondendo();
    if (porta) {
      log(`Já existe um Assistente vivo na porta ${porta}. Esta cópia sai para não imprimir em dobro.`);
      app.exit(0);
      return;
    }
    if (process.argv.includes("--assumindo")) {
      log("Já tentei assumir uma vez e o lugar continua ocupado. Desisto para não entrar em laço.");
      app.exit(0);
      return;
    }
    log("Existe uma cópia presa (não responde em /status). Derrubando e assumindo o lugar dela.");
    await derrubarOsOutros();
    app.relaunch({ args: process.argv.slice(1).concat(["--assumindo"]) });
    app.exit(0);
  })();
} else {
  iniciar();
}

function iniciar() {
  // Só depois de garantir que esta é A cópia: subir o servidor antes disso
  // faria duas instâncias brigarem pela porta durante a checagem.
  require("./server.js");

  /* ── 3. SOBE COM O WINDOWS, ESCONDIDO ────────────────────────────────
   *
   * Reescrito a cada boot de propósito: atualização, reinstalação ou uma
   * limpeza de inicialização feita pelo lojista apagam a entrada, e antes
   * ninguém conferia de novo. `--hidden` faz ele ir direto para a bandeja,
   * sem piscar janela na cara de quem acabou de ligar o PC. */
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      path: process.execPath,
      args: ["--hidden"],
    });
    const conf = app.getLoginItemSettings({ path: process.execPath, args: ["--hidden"] });
    log(`Inicialização com o Windows: ${conf.openAtLogin ? "ligada" : "NÃO confirmada"} (${process.execPath})`);
  } catch (e) {
    log(`Não consegui registrar a inicialização com o Windows: ${e?.message}`);
  }

  app.whenReady().then(() => {
    criarJanela();
    criarBandeja();
    log(`FireHub Assistente de Impressão ${VERSAO} no ar, na bandeja.`);
  });

  /* ── 4. NUNCA ENCERRAR POR CONTA PRÓPRIA ─────────────────────────────
   *
   * No Windows o padrão do Electron é encerrar o app quando a última janela
   * fecha. Como a janela daqui é descartável (é só o status) e o serviço é
   * que importa, o evento é interceptado e não faz nada. Quem encerra é o
   * item "Sair" da bandeja — e ele pergunta antes. */
  app.on("window-all-closed", () => {
    log("Janela fechada; o Assistente continua na bandeja, imprimindo.");
  });

  app.on("before-quit", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      log("Alguém pediu para encerrar sem passar pela bandeja — ignorado.");
    }
  });

  // Alguém abriu o atalho de novo: em vez de subir uma segunda cópia, mostra
  // a janela desta aqui. É o que a pessoa queria de qualquer jeito.
  app.on("second-instance", () => {
    log("Atalho aberto de novo — mostrando a janela desta cópia.");
    mostrarJanela();
  });
}

let tray = null;
let mainWindow = null;

function arquivoDeIcone(nome) {
  const dentroDoApp = path.join(__dirname, "assets", nome);
  if (fs.existsSync(dentroDoApp)) return dentroDoApp;
  const naBuild = path.join(__dirname, "build", nome);
  if (fs.existsSync(naBuild)) return naBuild;
  return null;
}

function criarJanela() {
  const icone = arquivoDeIcone("icon.ico") || arquivoDeIcone("icon.png");
  mainWindow = new BrowserWindow({
    width: 520,
    height: 460,
    resizable: false,
    autoHideMenuBar: true,
    // Nasce escondida e SEM botão na barra de tarefas: o Assistente é um
    // serviço da bandeja, não um programa que a pessoa deixa aberto.
    show: false,
    skipTaskbar: true,
    icon: icone || undefined,
    title: "FireHub Assistente de Impressão",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>FireHub Assistente de Impressão</title>
    <style>
      body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0F172A; color: #F8FAFC; margin: 0; padding: 24px; text-align: center; }
      .card { background: #1E293B; border-radius: 16px; padding: 24px; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
      .badge { background: #D1FAE5; color: #065F46; font-weight: 800; padding: 6px 16px; border-radius: 20px; display: inline-block; font-size: 0.85rem; margin-bottom: 12px; letter-spacing: 0.05em; }
      h2 { margin: 8px 0 6px; font-size: 1.3rem; color: #FFF; }
      .ver { color: #64748B; font-size: 0.8rem; margin-bottom: 14px; }
      p { color: #94A3B8; font-size: 0.88rem; line-height: 1.55; margin: 8px 0; }
      .footer { font-size: 0.78rem; color: #64748B; margin-top: 18px; line-height: 1.5; }
      strong { color: #CBD5E1; }
    </style></head>
    <body>
      <div class="card">
        <div style="font-size: 44px; margin-bottom: 6px;">🔥</div>
        <div class="badge">STATUS: CONECTADO E ATIVO</div>
        <h2>FireHub Assistente de Impressão</h2>
        <div class="ver">versão ${VERSAO}</div>
        <p>O servidor local está pronto em <strong>http://localhost:7899</strong>.</p>
        <p>Você pode fechar esta janela à vontade: o Assistente <strong>continua imprimindo</strong> em segundo plano.</p>
      </div>
      <div class="footer">
        Ele fica na bandeja do Windows, perto do relógio, com o ícone da chama 🔥.<br>
        Sobe sozinho quando o computador liga e se atualiza sozinho quando tem internet.
      </div>
    </body></html>
  `;
  mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

  // Fechar a janela ESCONDE. Nunca encerra o serviço.
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function mostrarJanela() {
  if (!mainWindow || mainWindow.isDestroyed()) criarJanela();
  mainWindow.show();
  mainWindow.focus();
}

function criarBandeja() {
  // .ico primeiro: ele carrega os oito tamanhos e o Windows escolhe o certo
  // para o DPI da máquina. O PNG de 32 px é a rede de segurança.
  const caminho = arquivoDeIcone("icon.ico") || arquivoDeIcone("tray.png");
  let icone = caminho ? nativeImage.createFromPath(caminho) : nativeImage.createEmpty();
  if (icone.isEmpty()) {
    log(`AVISO: não consegui carregar o ícone da bandeja (${caminho || "nenhum arquivo"}).`);
  }

  tray = new Tray(icone);
  tray.setToolTip(`FireHub Assistente de Impressão ${VERSAO} — ativo`);

  const menu = Menu.buildFromTemplate([
    { label: `FireHub Assistente ${VERSAO}`, enabled: false },
    { label: "Imprimindo normalmente", enabled: false },
    { type: "separator" },
    { label: "Abrir janela de status", click: mostrarJanela },
    { label: "Ver impressoras encontradas", click: () => shell.openExternal("http://localhost:7899/printers") },
    { type: "separator" },
    {
      label: "Procurar atualização agora",
      click: async () => {
        for (const porta of PORTAS) {
          try {
            const r = await fetch(`http://127.0.0.1:${porta}/atualizar-agora`, { method: "POST", signal: AbortSignal.timeout(3000) });
            if (r.ok) {
              const info = await r.json().catch(() => ({}));
              dialog.showMessageBox({
                type: "info",
                title: "FireHub Assistente",
                message: info?.mensagem || "Procurando atualização em segundo plano.",
                detail: `Versão instalada: ${VERSAO}`,
              });
              return;
            }
          } catch {}
        }
        dialog.showMessageBox({ type: "warning", title: "FireHub Assistente", message: "Não consegui falar com o serviço local agora. Ele tenta sozinho a cada 6 horas." });
      },
    },
    { type: "separator" },
    {
      // Sair pergunta antes: era um clique de distância fechar a impressão da
      // loja inteira no meio do movimento.
      label: "Sair do Assistente",
      click: async () => {
        const { response } = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Manter rodando", "Sair mesmo assim"],
          defaultId: 0,
          cancelId: 0,
          title: "Sair do FireHub Assistente?",
          message: "Se você sair, a loja PARA DE IMPRIMIR comandas.",
          detail: "Só saia se for desligar o computador ou se alguém do suporte pediu.",
        });
        if (response !== 1) return;
        log("Encerrado pelo item 'Sair' da bandeja, com confirmação.");
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on("double-click", mostrarJanela);
  tray.on("click", mostrarJanela);
}
