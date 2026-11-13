/**
 * A JANELA "FireHub" — o sistema inteiro numa janela própria, aberta pelo
 * ícone FireHub da área de trabalho (instalador completo, pedido do Douglas
 * em 12/11/2026: "ter o sistema sólido completo no PC").
 *
 * ── Nuvem quando há internet, o computador quando não há ────────────────────
 * A janela abre SEMPRE o FireHub de sempre (https://firehubfood.com.br/store).
 * Não é "sempre o local com sincronização": a nuvem é a única que recebe o
 * iFood, o site, o robô, o Pix e a nota, e a cópia do computador só sobe o que
 * a loja fez NA QUEDA (com as regras de conflito da volta). Trabalhar sempre
 * no local faria TODA gravação do dia passar por essas regras — mais conflito,
 * não menos. Por isso a troca é a mesma das telas do navegador, já provada:
 *   - com internet, a nuvem;
 *   - sem internet (ou com o nosso servidor fora), a rede de segurança da
 *     página (public/sw-contingencia.js, o bilhete guardado) leva ao FireHub
 *     deste computador, sem senha — e volta sozinha;
 *   - se a página nunca abriu com internet nesta janela (sem rede de
 *     segurança ainda), a janela mesma vai para a porta da loja
 *     (http://127.0.0.1:7890), que atende com a cópia ou manda para a nuvem.
 *
 * A sessão é própria ("persist:firehub"): cookie, bilhete e rede de segurança
 * ficam guardados entre aberturas, separados do navegador do caixa.
 */
const ENDERECO_DA_NUVEM = "https://firehubfood.com.br";
const PORTA_DA_LOJA = "http://127.0.0.1:7890";
const PARTICAO = "persist:firehub";

/** Erros do Chromium que querem dizer "não alcancei o servidor" (net_error_list.h). */
const ERROS_DE_REDE = new Set([
  -2, // FAILED
  -7, // TIMED_OUT
  -15, // SOCKET_NOT_CONNECTED
  -21, // NETWORK_CHANGED
  -100, // CONNECTION_CLOSED
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -104, // CONNECTION_FAILED
  -105, // NAME_NOT_RESOLVED
  -106, // INTERNET_DISCONNECTED
  -109, // ADDRESS_UNREACHABLE
  -118, // CONNECTION_TIMED_OUT
  -130, // PROXY_CONNECTION_FAILED
  -137, // NAME_RESOLUTION_FAILED
]);

/** Para onde a janela vai quando `url` falhou com `codigo`. null = fica (mostra o aviso). */
function seguirDepoisDaFalha(url, codigo) {
  if (codigo === -3) return null; // ABORTED: a própria página navegou para outro lugar
  if (!ERROS_DE_REDE.has(codigo)) return null;
  if (String(url).startsWith(ENDERECO_DA_NUVEM)) return `${PORTA_DA_LOJA}/`;
  return "aviso";
}

/** Abre dentro da janela só o FireHub (nuvem, este computador ou a rede da loja); o resto vai para o navegador. */
function abreNaJanela(url) {
  try {
    const u = new URL(url);
    if (u.origin === ENDERECO_DA_NUVEM || u.origin === "https://www.firehubfood.com.br") return true;
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return true;
    return false;
  } catch {
    return false;
  }
}

function paginaDeAviso() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>FireHub</title>
<style>body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#0F172A;color:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh}
.c{max-width:520px;padding:32px;text-align:center}.f{font-size:52px}h1{font-size:22px;margin:10px 0}p{color:#CBD5E1;line-height:1.55}</style></head>
<body><div class="c"><div class="f">🔥</div><h1>Sem internet agora</h1>
<p>O FireHub deste computador ainda está se preparando, ou esta janela ainda não foi aberta com internet nenhuma vez.</p>
<p>Assim que houver conexão, ou o FireHub do computador ficar pronto, a janela entra sozinha. Tentando de novo a cada 10 segundos…</p></div>
<script>setTimeout(function(){location.replace(${JSON.stringify(`${ENDERECO_DA_NUVEM}/store`)})},10000)</script></body></html>`)}`;
}

let janela = null;

/**
 * Abre (ou traz para a frente) a janela do FireHub.
 * `inicio`: o caminho da primeira página (ex.: "/store/contingencia?instalado=1").
 */
function abrirJanelaDoFireHub({ BrowserWindow, shell, icone, log, inicio = "/store" }) {
  if (janela && !janela.isDestroyed()) {
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
    return janela;
  }
  janela = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 360,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    title: "FireHub",
    icon: icone || undefined,
    backgroundColor: "#0F172A",
    webPreferences: {
      partition: PARTICAO,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const w = janela;
  w.once("ready-to-show", () => {
    w.maximize();
    w.show();
  });

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (abreNaJanela(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: icone || undefined, webPreferences: { partition: PARTICAO, contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (!abreNaJanela(url) && /^https?:/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });
  // F5 recarrega, como no navegador (a janela não tem a barra de menu).
  w.webContents.on("before-input-event", (e, entrada) => {
    if (entrada.type === "keyDown" && entrada.key === "F5") {
      e.preventDefault();
      w.webContents.reload();
    }
  });
  w.webContents.on("did-fail-load", (_e, codigo, descricao, url, principal) => {
    if (!principal) return;
    const seguir = seguirDepoisDaFalha(url, codigo);
    if (!seguir) return;
    log(`Janela do FireHub: ${url} não abriu (${codigo} ${descricao}); ${seguir === "aviso" ? "mostrando o aviso" : `indo para ${seguir}`}.`);
    w.loadURL(seguir === "aviso" ? paginaDeAviso() : seguir).catch(() => {});
  });
  w.on("closed", () => {
    if (janela === w) janela = null;
  });

  w.loadURL(`${ENDERECO_DA_NUVEM}${inicio}`).catch(() => {});
  log(`Janela do FireHub aberta (${inicio}).`);
  return w;
}

// ── O ícone "FireHub" na área de trabalho ───────────────────────────────────

/** A marca do atalho .url que o supervisor da contingência cria (contingencia/supervisor/atalho.ts). */
const MARCA_DO_ATALHO_DO_NAVEGADOR = "CriadoPor=Modo Contingencia";

/**
 * Garante o FireHub.lnk (abre esta janela). Se o supervisor tinha criado o
 * FireHub.url (navegador), ele sai — o supervisor vê o .lnk e não recria.
 * Atalho "FireHub" que a loja fez à mão fica como está.
 */
function garantirAtalhoDaJanela({ shell, fs, path, areaDeTrabalho, executavel, log }) {
  const lnk = path.join(areaDeTrabalho, "FireHub.lnk");
  const url = path.join(areaDeTrabalho, "FireHub.url");
  const opcoes = {
    target: executavel,
    args: "--abrir-firehub",
    icon: executavel,
    iconIndex: 0,
    description: "FireHub — funciona com e sem internet",
  };
  try {
    if (fs.existsSync(lnk)) {
      let atual = null;
      try {
        atual = shell.readShortcutLink(lnk);
      } catch {
        /* atalho ilegível: fica o da loja */
      }
      if (!atual || !String(atual.args || "").includes("--abrir-firehub")) return "da-loja";
      if (atual.target === executavel) return "ja-tinha";
      shell.writeShortcutLink(lnk, "update", opcoes);
      return "atualizado";
    }
    if (fs.existsSync(url)) {
      const conteudo = fs.readFileSync(url, "latin1");
      if (!conteudo.includes(MARCA_DO_ATALHO_DO_NAVEGADOR)) return "da-loja";
      fs.unlinkSync(url);
    }
    shell.writeShortcutLink(lnk, "create", opcoes);
    log(`Ícone "FireHub" na área de trabalho (${lnk}).`);
    return "criado";
  } catch (e) {
    log(`Ícone "FireHub": não deu para criar (${e?.message || e}).`);
    return "erro";
  }
}

module.exports = {
  abrirJanelaDoFireHub,
  garantirAtalhoDaJanela,
  // Para os testes (scripts/teste-janela-do-firehub.js):
  seguirDepoisDaFalha,
  abreNaJanela,
  ENDERECO_DA_NUVEM,
  PORTA_DA_LOJA,
};
