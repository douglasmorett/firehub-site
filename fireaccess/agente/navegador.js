// FireAccess — modo navegador: o atendente mexe no Chrome/Edge do cliente por dentro (DevTools),
// lendo a página e clicando por seletor ou texto, sem depender de foto da tela. É o mesmo jeito que o
// Claude usa o navegador no PC do Douglas: rápido e sem errar o clique por alguns pixels.
//
// Abre um navegador SEPARADO, com perfil próprio do FireAccess (%LOCALAPPDATA%\FireHub\fireaccess-navegador):
// o Chrome não deixa depurar o perfil normal do cliente, e assim o suporte não mexe nos dados dele.
// Login que o portal pedir (iFood, 99, banco) quem digita é o cliente: "preencher" recusa campo de senha.
// A porta de depuração só escuta no próprio PC (127.0.0.1) e o navegador fecha junto com a sessão.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");

const PERFIL = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "FireHub", "fireaccess-navegador");
const TEXTO_MAX = 60_000;

let porta = null;
let proc = null;

function executavel() {
  const pf = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const candidatos = [];
  for (const base of pf) candidatos.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
  for (const base of pf) candidatos.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
  const achado = candidatos.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } });
  if (!achado) throw new Error("não achei Chrome nem Edge neste computador");
  return achado;
}

async function http(caminho, metodo = "GET") {
  const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, { method: metodo });
  if (!r.ok) throw new Error(`navegador respondeu ${r.status}`);
  return r.json();
}

async function vivo() {
  if (!porta) return false;
  try { await http("/json/version"); return true; } catch { return false; }
}

async function abrir(url) {
  const destino = url && /^https?:\/\//i.test(url) ? url : "about:blank";
  if (await vivo()) {
    await http(`/json/new?${encodeURIComponent(destino)}`, "PUT");
    return { aberto: destino, novo: false };
  }
  fs.mkdirSync(PERFIL, { recursive: true });
  porta = 9300 + Math.floor(Math.random() * 600);
  proc = spawn(executavel(), [
    `--remote-debugging-port=${porta}`, `--user-data-dir=${PERFIL}`,
    "--no-first-run", "--no-default-browser-check", "--start-maximized", destino,
  ], { detached: false, stdio: "ignore" });
  proc.on("exit", () => { proc = null; porta = null; });
  for (let i = 0; i < 40; i++) {
    if (await vivo()) return { aberto: destino, novo: true };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("o navegador não abriu a porta de controle a tempo");
}

async function abas() {
  if (!(await vivo())) throw new Error("o navegador do suporte não está aberto (use: nav abrir <link>)");
  return (await http("/json/list")).filter((t) => t.type === "page");
}

/** Manda um comando do DevTools para a aba (a primeira da lista é a que está na frente). */
async function cdp(aba, metodo, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(aba.webSocketDebuggerUrl, { perMessageDeflate: false });
    const prazo = setTimeout(() => { ws.terminate(); reject(new Error("a página não respondeu a tempo")); }, 25_000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: metodo, params })));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.id !== 1) return;
      clearTimeout(prazo);
      ws.close();
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    });
    ws.on("error", (e) => { clearTimeout(prazo); reject(e); });
  });
}

async function avaliar(aba, expressao) {
  const r = await cdp(aba, "Runtime.evaluate", { expression: expressao, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text);
  return r.result?.value;
}

// Acha o elemento por seletor CSS ou, se não for seletor, pelo texto visível (botão, link, rótulo).
// Antes de agir, contorna o elemento de vermelho por um instante: quem está olhando vê onde mexeu.
const ACHAR = `(alvo) => {
  let el = null;
  try { el = document.querySelector(alvo); } catch {}
  if (!el) {
    const t = alvo.trim().toLowerCase();
    const todos = [...document.querySelectorAll('button, a, [role=button], input[type=submit], input[type=button], label, [onclick], li, span, div, td')];
    const visivel = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    el = todos.find((e) => visivel(e) && (e.innerText || e.value || '').trim().toLowerCase() === t)
      || todos.find((e) => visivel(e) && (e.innerText || e.value || '').trim().toLowerCase().includes(t) && (e.innerText || '').length < t.length + 40);
  }
  if (!el) throw new Error('não achei: ' + alvo);
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const antes = el.style.outline;
  el.style.outline = '3px solid #e5372b';
  setTimeout(() => { el.style.outline = antes; }, 900);
  return el;
}`;

async function comando(c) {
  const a = String(c.acao || "");
  if (a === "abrir") return { ok: true, ...(await abrir(String(c.url || ""))) };
  if (a === "fechar") { parar(); return { ok: true }; }
  const lista = await abas();
  if (a === "abas") return { ok: true, abas: lista.map((t, i) => ({ i, titulo: t.title, url: t.url })) };
  const aba = lista[Number(c.aba) || 0];
  if (!aba) throw new Error("aba não encontrada");
  switch (a) {
    case "ir":
      await cdp(aba, "Page.navigate", { url: String(c.url) });
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: true, url: String(c.url) };
    case "texto": {
      const v = await avaliar(aba, `({ titulo: document.title, url: location.href, texto: document.body ? document.body.innerText : '' })`);
      return { ok: true, ...v, texto: String(v.texto || "").slice(0, TEXTO_MAX) };
    }
    case "js": return { ok: true, valor: await avaliar(aba, String(c.js || "")) };
    case "clicar": {
      const alvo = JSON.stringify(String(c.alvo || ""));
      await avaliar(aba, `(${ACHAR})(${alvo}).click(), true`);
      await new Promise((r) => setTimeout(r, Number(c.esperar) >= 0 ? Math.min(Number(c.esperar), 10_000) : 800));
      // Depois do clique a página pode ter mudado: lê o endereço de novo, já na aba da frente.
      const depois = (await abas())[Number(c.aba) || 0];
      return { ok: true, url: depois?.url || "" };
    }
    case "preencher": {
      const alvo = JSON.stringify(String(c.alvo || ""));
      const valor = JSON.stringify(String(c.valor ?? ""));
      await avaliar(aba, `(() => {
        const el = (${ACHAR})(${alvo});
        if ((el.type || '').toLowerCase() === 'password') throw new Error('campo de senha: quem digita é o cliente');
        el.focus();
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
        set.call(el, ${valor});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      return { ok: true };
    }
    case "foto": {
      const r = await cdp(aba, "Page.captureScreenshot", { format: "jpeg", quality: 60 });
      return { ok: true, jpeg: r.data, largura: 0, altura: 0 };
    }
    default: throw new Error(`ação do navegador desconhecida: ${a}`);
  }
}

function parar() {
  try { proc?.kill(); } catch {}
  proc = null;
  porta = null;
}

module.exports = { comando, parar };
