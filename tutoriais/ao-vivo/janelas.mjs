// As janelas da gravação ao vivo: um navegador que este roteiro controla,
// separado do Chrome do dia a dia (nenhuma aba pessoal aparece no vídeo).
//
// A área gravada é 1600×900 a partir do canto (0,0) do monitor principal: fora
// dela fica a marca d'água "Ativar o Windows", no canto de baixo. A janela é
// posta 8 px para fora em cada lado porque a borda invisível do Windows deixava
// aparecer a janela de trás numa tira de 8 px.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

export const AREA = { x: 0, y: 0, w: 1600, h: 900 };
const aqui = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSAO_DEV = path.resolve(aqui, "../../firehub-ifood-extension");
const CHROMIUM = "C:/Users/Micro/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";

const SEM = ["--no-sandbox", "--enable-automation", "--disable-extensions", "--disable-component-extensions-with-background-pages", "--disable-default-apps"];

/** Abre o navegador num perfil próprio. `extensao`: carrega a versão de desenvolvimento (só o Chromium aceita). */
export async function abrirNavegador(perfil, { chrome = false, extensao = false, porta = 0, x = -8, y = 0, w = AREA.w + 16, h = AREA.h + 8 } = {}) {
  const args = [`--window-position=${x},${y}`, `--window-size=${w},${h}`, "--lang=pt-BR", "--no-first-run", "--no-default-browser-check", "--hide-crash-restore-bubble"];
  if (porta) args.push(`--remote-debugging-port=${porta}`);
  if (extensao) args.push(`--load-extension=${EXTENSAO_DEV}`, `--disable-extensions-except=${EXTENSAO_DEV}`);
  const contexto = await chromium.launchPersistentContext(perfil, {
    ...(chrome ? { channel: "chrome" } : { executablePath: CHROMIUM }),
    headless: false, viewport: null, args, ignoreDefaultArgs: SEM,
  });
  return contexto;
}

/** O processo principal do navegador daquele perfil (é dele que o Windows lê os botões). */
export function pidDoPerfil(trecho, exe = "chrome.exe") {
  const saida = execFileSync("powershell", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='${exe}'" | Where-Object { $_.CommandLine -like '*${trecho}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -ExpandProperty ProcessId`]).toString().trim();
  return Number(saida.split(/\s+/)[0]);
}

/** Onde a página começa na tela (para converter a caixa de um elemento em ponto do Windows). */
export async function origemDaPagina(pagina) {
  const t = await pagina.evaluate(() => ({ sx: window.screenX, sy: window.screenY, bx: (window.outerWidth - window.innerWidth) / 2, top: window.outerHeight - window.innerHeight }));
  return { x: t.sx + t.bx, y: t.sy + t.top - t.bx };
}

/** Centro de um elemento da página em coordenadas da tela, já rolado para aparecer. */
export async function pontoDe(pagina, locator) {
  await locator.scrollIntoViewIfNeeded();
  const c = await locator.boundingBox();
  if (!c) throw new Error("elemento sem caixa (está visível?)");
  const o = await origemDaPagina(pagina);
  return { x: o.x + c.x + c.width / 2, y: o.y + c.y + c.height / 2, caixa: { x: o.x + c.x, y: o.y + c.y, w: c.width, h: c.height } };
}
