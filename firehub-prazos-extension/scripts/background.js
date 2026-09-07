/**
 * FireHub Prazos — service worker.
 *
 * O que ele faz, nesta ordem, o dia inteiro:
 *   1. recebe do leitor a soma das colunas marcadas no painel do lojista;
 *   2. pergunta ao servidor que prazo cabe (POST /api/prazos/calcular) — a
 *      tabela mora lá, junto com a conta e o status de pagamento;
 *   3. escreve o prazo no Portal do Parceiro, na aba de Configurações →
 *      Entrega que o lojista deixou aberta, e confere lendo de volta.
 *
 * Três regras que valem mais que qualquer código aqui:
 *   - coluna marcada que sumiu do painel NÃO vira zero: segura o último prazo
 *     e avisa (zero no pico = 28 min na hora errada);
 *   - servidor recusou (conta sem pagamento) = para de escrever, com o
 *     motivo na tela;
 *   - a extensão nunca abre aba do iFood sozinha: só o clique do lojista.
 *
 * A automação da página do iFood (applyEtaHeadless) é a mesma que roda na
 * extensão interna do FireHub desde 08/2026, provada em produção.
 */

const VERSAO = chrome.runtime.getManifest().version;
const ALARME = "FHPRAZOS_CICLO";
const SETTINGS_URL = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";
const SETTINGS_URL_MATCH = SETTINGS_URL + "*";
const SERVIDOR_PADRAO = "https://firehubfood.com.br";
const HISTERESE_MS = 3 * 60 * 1000;
const LEITURA_VELHA_MS = 120 * 1000;

let aplicando = false;

// ── ARMAZENAMENTO ─────────────────────────────────────────────────────

function get(keys) { return chrome.storage.local.get(keys); }
function set(obj) { return chrome.storage.local.set(obj); }

async function servidor() {
  const s = await get(["serverUrl"]);
  return (s.serverUrl || SERVIDOR_PADRAO).replace(/\/$/, "");
}

async function definirErro(texto) {
  await set({ erro: texto ? { texto: String(texto), em: Date.now() } : null });
}

function hhmm() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── SERVIDOR ──────────────────────────────────────────────────────────

/** POST /api/prazos/calcular. Devolve { ok, dados } ou { ok:false, bloqueado, erro }. */
async function calcularNoServidor(corpo) {
  const s = await get(["token"]);
  if (!s.token) return { ok: false, erro: "sem-login" };
  try {
    const res = await fetch((await servidor()) + "/api/prazos/calcular?token=" + encodeURIComponent(s.token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...corpo, versao: VERSAO }),
      signal: AbortSignal.timeout(8000),
    });
    const dados = await res.json().catch(() => ({}));
    if (res.status === 402) {
      // Conta sem pagamento: o servidor é quem manda parar.
      const conta = (await get(["conta"])).conta || {};
      await set({ conta: { ...conta, status: dados.status || "BLOQUEADO", podeUsar: false, motivoBloqueio: dados.error || "Conta bloqueada" } });
      return { ok: false, bloqueado: true, erro: dados.error || "Conta bloqueada" };
    }
    if (res.status === 401) return { ok: false, deslogado: true, erro: "Sessão inválida. Entre de novo na extensão." };
    if (!res.ok || !dados.success) return { ok: false, erro: dados.error || ("Servidor respondeu " + res.status) };
    return { ok: true, dados };
  } catch (e) {
    return { ok: false, erro: "Servidor indisponível: " + String(e && e.message ? e.message : e) };
  }
}

async function salvarReceitasNoServidor() {
  const s = await get(["token", "receitas"]);
  if (!s.token) return;
  try {
    await fetch((await servidor()) + "/api/prazos/config?token=" + encodeURIComponent(s.token), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receitas: s.receitas || {} }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {}
}

// ── O CICLO ───────────────────────────────────────────────────────────

/**
 * Avalia o que foi lido e, se couber, escreve no iFood.
 * `force` ignora a histerese (mudança feita pelo lojista no popup).
 */
async function avaliar(opts) {
  const options = opts || {};
  const s = await get(["token", "conta", "leitura", "receitas", "roboLigado", "ultimoDespachoMinutos", "ultimoDespachoEm", "ifoodDesconectado"]);
  if (!s.token) return { motivo: "sem-login" };

  const hosts = Object.keys(s.receitas || {}).filter((h) => (s.receitas[h].colunas || []).length > 0);
  if (hosts.length === 0) {
    await definirErro("Marque as colunas do seu painel de pedidos (botão Marcar coluna).");
    return { motivo: "sem-colunas" };
  }

  const leitura = s.leitura;
  if (!leitura || Date.now() - (leitura.em || 0) > LEITURA_VELHA_MS) {
    await definirErro("Sem leitura do painel há mais de 2 min: abra o painel de pedidos e deixe a aba aberta.");
    await calcularNoServidor({ erro: "painel sem leitura" });
    return { motivo: "leitura-velha" };
  }

  if (leitura.faltando && leitura.faltando.length > 0) {
    // Segura o prazo. Não manda `pedidos`: o servidor mantém o último número.
    const texto = "Coluna \"" + leitura.faltando[0] + "\" não encontrada no painel. Prazo mantido; abra a extensão e marque de novo.";
    await definirErro(texto);
    await calcularNoServidor({ erro: texto, host: leitura.host });
    return { motivo: "coluna-faltando" };
  }

  const resposta = await calcularNoServidor({
    pedidos: leitura.total,
    host: leitura.host,
    colunas: (leitura.colunas || []).map((c) => ({ rotulo: c.rotulo, n: c.n })),
    erro: null,
  });
  if (!resposta.ok) {
    await definirErro(resposta.erro);
    if (resposta.deslogado) await set({ token: null });
    return { motivo: resposta.bloqueado ? "bloqueado" : "servidor", erro: resposta.erro };
  }

  const d = resposta.dados;
  const prazo = { minutos: d.minutos, pausar: !!d.pausar, rotulo: d.rotulo, modo: d.modo, pedidos: d.pedidos, motoboys: d.motoboys, em: Date.now() };
  await set({ prazo });
  await definirErro(null);
  avisarPilulaDoIfood(prazo);

  if (!s.roboLigado) return { motivo: "robo-desligado", prazo };
  if (s.ifoodDesconectado) {
    await definirErro("Portal do Parceiro deslogado: entre de novo no iFood para o prazo mudar.");
    return { motivo: "ifood-deslogado", prazo };
  }

  const mesmaFaixa = s.ultimoDespachoMinutos === prazo.minutos;
  const desdeUltimo = Date.now() - (s.ultimoDespachoEm || 0);
  if (!options.force && mesmaFaixa && desdeUltimo < HISTERESE_MS) return { motivo: "histerese", prazo };

  const abas = await chrome.tabs.query({ url: SETTINGS_URL_MATCH });
  if (abas.length === 0 || !abas[0].id) {
    await definirErro("Abra Configurações → Entrega no Portal do Parceiro e deixe a aba aberta. O prazo só muda com ela aberta.");
    return { motivo: "sem-aba", prazo };
  }

  const resultado = await aplicarNoIfood(abas[0].id, prazo.minutos);
  if (resultado.ok) {
    await set({ ultimoDespachoMinutos: prazo.minutos, ultimoDespachoEm: Date.now(), ifoodAplicadoEm: hhmm(), ultimoAplicado: { minutos: prazo.minutos, em: Date.now() } });
    await definirErro(null);
    await calcularNoServidor({ aplicado: { minutos: prazo.minutos, ok: true }, erro: null });
  } else {
    await definirErro("iFood: " + (resultado.erro || resultado.motivo || "não aplicou"));
    await calcularNoServidor({ aplicado: { minutos: prazo.minutos, ok: false }, erro: "iFood: " + (resultado.erro || resultado.motivo) });
  }
  return { motivo: resultado.ok ? "aplicado" : "falhou", prazo, resultado };
}

async function avisarPilulaDoIfood(prazo) {
  try {
    const abas = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
    const erro = (await get(["erro"])).erro;
    for (const aba of abas) {
      if (aba.id) chrome.tabs.sendMessage(aba.id, { tipo: "PRAZOS_STATUS", prazo, erro: erro ? erro.texto : null }).catch(() => {});
    }
  } catch (e) {}
}

// ── FUNÇÕES INJETADAS NA PÁGINA DO IFOOD (autocontidas) ───────────────

function fnOutraExtensaoPresente() {
  return !!document.getElementById("firehub-corner-pill");
}

function fnReadBaseTime() {
  const allInputs = Array.from(document.querySelectorAll("input"));
  const matches = allInputs.filter(function (input) {
    const rawVal = (input.value || "").trim();
    if (rawVal.indexOf(",") !== -1 || rawVal.indexOf(".") !== -1) return false;
    const numVal = parseInt(rawVal, 10);
    if (isNaN(numVal) || numVal < 5 || numVal > 500) return false;
    let next = input.nextElementSibling;
    while (next) {
      const txt = (next.textContent || "").trim().toLowerCase();
      if (txt.indexOf("min") !== -1) return true;
      if (txt.indexOf("r$") !== -1 || txt.indexOf("taxa") !== -1) return false;
      next = next.nextElementSibling;
    }
    const parent = input.parentElement;
    if (parent) {
      const parentText = parent.textContent || "";
      if (parentText.indexOf("min") !== -1 && parentText.indexOf("R$") === -1) return true;
      const parentNext = parent.nextElementSibling;
      if (parentNext && (parentNext.textContent || "").trim().toLowerCase().indexOf("min") !== -1) return true;
    }
    return false;
  });
  const values = matches.map(function (i) { return parseInt(i.value, 10) || 0; }).filter(function (v) { return v > 0; });
  return values.length > 0 ? values[0] : null;
}

function fnClickOperacaoAtual() {
  const els = Array.from(document.querySelectorAll("button, a, [role='tab'], span"));
  const tab = els.find(function (el) {
    const txt = (el.textContent || "").trim().toLowerCase();
    return txt.indexOf("operacao atual") !== -1 || txt.indexOf("operação atual") !== -1;
  });
  if (!tab) return false;
  const isActive = tab.classList.contains("active") || tab.getAttribute("aria-selected") === "true";
  if (isActive) return true;
  try { tab.focus(); } catch (e) {}
  tab.click();
  return true;
}

function fnClickAdjust(isIncrease) {
  let btn = document.querySelector(isIncrease ? 'button[aria-label="add 5 min"]' : 'button[aria-label="subtract 5 min"]');
  if (!btn) {
    const buttons = Array.from(document.querySelectorAll("button"));
    btn = buttons.find(function (b) {
      const text = (b.textContent || "").trim();
      if (text.indexOf("5") === -1 || text.toLowerCase().indexOf("min") === -1) return false;
      if (isIncrease) return text.indexOf("+") !== -1;
      return text.indexOf("-") !== -1 || text.indexOf("–") !== -1 || text.indexOf("—") !== -1;
    });
  }
  if (!btn) return false;
  try { btn.focus(); } catch (e) {}
  try {
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  } catch (e) {}
  btn.click();
  return true;
}

function fnClickSalvar() {
  const buttons = Array.from(document.querySelectorAll("button"));
  const candidates = buttons.filter(function (b) { return (b.textContent || "").trim().toLowerCase() === "salvar"; });
  if (candidates.length === 0) return { clicked: false, reason: "botao Salvar nao encontrado" };
  const enabled = candidates.find(function (b) { return !b.disabled; });
  if (!enabled) return { clicked: false, reason: "nada a salvar (botao desabilitado)" };
  try { enabled.focus(); } catch (e) {}
  enabled.click();
  return { clicked: true };
}

function fnIsLoggedOut() {
  const href = window.location.href.toLowerCase();
  if (href.indexOf("openid-connect") !== -1 || href.indexOf("callback") !== -1 || href.indexOf("response_type=") !== -1) return false;
  const passwordInput = document.querySelector('input[type="password"]');
  const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
  const hasDisconnectText = bodyText.indexOf("fazer login") !== -1 || bodyText.indexOf("sessão expirou") !== -1 || bodyText.indexOf("entre com sua conta") !== -1;
  return !!(passwordInput && (hasDisconnectText || href.indexOf("login.ifood.com.br") !== -1));
}

// ── ORQUESTRADOR (mesmo desenho da extensão interna) ──────────────────

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function passo(tabId, func, args) {
  const r = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
  return r && r[0] ? r[0].result : undefined;
}

async function prepararAba(tabId) {
  try {
    const aba = await chrome.tabs.get(tabId);
    if (!aba) return false;
    if (aba.discarded) {
      await chrome.tabs.reload(tabId);
      await new Promise((resolve) => {
        const ouvinte = (id, info) => { if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(ouvinte); resolve(); } };
        chrome.tabs.onUpdated.addListener(ouvinte);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(ouvinte); resolve(); }, 20000);
      });
    }
    try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

async function aplicarNoIfood(tabId, alvo) {
  if (aplicando) return { ok: false, motivo: "ja-aplicando" };
  aplicando = true;
  try {
    if (!(await prepararAba(tabId))) return { ok: false, motivo: "aba indisponível" };

    // A extensão interna do FireHub na mesma aba escreveria o prazo também:
    // duas mãos no mesmo campo. Uma só por conta do iFood.
    if (await passo(tabId, fnOutraExtensaoPresente)) {
      return { ok: false, motivo: "a extensão FireHub interna está ativa nesta aba; use só uma" };
    }

    if (await passo(tabId, fnIsLoggedOut)) {
      await set({ ifoodDesconectado: true });
      return { ok: false, motivo: "portal deslogado" };
    }

    await passo(tabId, fnClickOperacaoAtual);
    await esperar(1200);

    let atual = await passo(tabId, fnReadBaseTime);
    if (atual === null || atual === undefined) { await esperar(2500); atual = await passo(tabId, fnReadBaseTime); }
    if (atual === null || atual === undefined) return { ok: false, motivo: "campos de tempo não encontrados na tela" };

    if (Math.abs(alvo - atual) <= 2) return { ok: true, depois: atual, inalterado: true };

    let ultimo = null;
    for (let i = 0; i < 25; i++) {
      const v = await passo(tabId, fnReadBaseTime);
      if (!v) return { ok: false, motivo: "prazo ilegível durante o ajuste" };
      if (Math.abs(alvo - v) <= 2) break;
      if (v === ultimo) return { ok: false, motivo: "o portal ignorou o clique de ±5 min", depois: v };
      ultimo = v;
      if (!(await passo(tabId, fnClickAdjust, [alvo > v]))) return { ok: false, motivo: "botão ±5 min não encontrado" };
      await esperar(450);
    }

    const salvar = await passo(tabId, fnClickSalvar);
    if (!salvar || !salvar.clicked) return { ok: false, motivo: salvar ? salvar.reason : "Salvar falhou" };
    await esperar(2500);

    const depois = await passo(tabId, fnReadBaseTime);
    const ok = depois !== null && depois !== undefined && Math.abs(depois - alvo) <= 2;
    return ok ? { ok: true, depois } : { ok: false, motivo: "não confirmou: alvo " + alvo + " min, tela " + depois + " min", depois };
  } catch (e) {
    return { ok: false, motivo: "exceção", erro: String(e && e.message ? e.message : e) };
  } finally {
    aplicando = false;
  }
}

// ── LEITOR NO PAINEL DO LOJISTA ───────────────────────────────────────

function idDoLeitor(host) { return "fhprazos-leitor-" + host.replace(/[^a-z0-9.-]/gi, "_"); }

/** Registra o leitor para um site (persiste entre reinícios do Chrome). */
async function registrarLeitor(origem) {
  const host = new URL(origem).host;
  const id = idDoLeitor(host);
  const existentes = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
  const def = { id, matches: [origem.replace(/\/$/, "") + "/*"], js: ["scripts/leitor.js"], runAt: "document_idle", persistAcrossSessions: true };
  if (existentes && existentes.length) await chrome.scripting.updateContentScripts([def]);
  else await chrome.scripting.registerContentScripts([def]);
}

/** Depois de instalar/reiniciar: religa o leitor em todo site marcado que ainda tem permissão. */
async function religarLeitores() {
  const s = await get(["receitas"]);
  for (const host of Object.keys(s.receitas || {})) {
    for (const esquema of ["https", "http"]) {
      const origem = esquema + "://" + host;
      try {
        if (await chrome.permissions.contains({ origins: [origem + "/*"] })) { await registrarLeitor(origem); break; }
      } catch (e) {}
    }
  }
}

async function garantirLeitorNaAba(tabId) {
  const ping = await chrome.tabs.sendMessage(tabId, { tipo: "PRAZOS_PING" }).catch(() => null);
  if (ping && ping.ok) return true;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["scripts/leitor.js"] });
  return true;
}

async function avisarLeitores(msg) {
  const s = await get(["receitas"]);
  for (const host of Object.keys(s.receitas || {})) {
    const abas = await chrome.tabs.query({ url: ["https://" + host + "/*", "http://" + host + "/*"] }).catch(() => []);
    for (const aba of abas) if (aba.id) chrome.tabs.sendMessage(aba.id, msg).catch(() => {});
  }
}

// ── ABA DO IFOOD (só por clique do lojista) ───────────────────────────

async function focarOuAbrirIfood() {
  const abas = await chrome.tabs.query({ url: SETTINGS_URL_MATCH });
  if (abas.length && abas[0].id) {
    await chrome.tabs.update(abas[0].id, { active: true });
    if (abas[0].windowId) await chrome.windows.update(abas[0].windowId, { focused: true });
    return;
  }
  const qualquer = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
  if (qualquer.length && qualquer[0].id) {
    await chrome.tabs.update(qualquer[0].id, { url: SETTINGS_URL, active: true });
    return;
  }
  await chrome.tabs.create({ url: SETTINGS_URL, active: true });
}

// ── CICLO DE VIDA E MENSAGENS ─────────────────────────────────────────

async function garantirAlarme() {
  const existe = await chrome.alarms.get(ALARME);
  if (!existe) chrome.alarms.create(ALARME, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { garantirAlarme(); religarLeitores(); });
chrome.runtime.onStartup.addListener(() => { garantirAlarme(); religarLeitores(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARME) avaliar().catch(() => {}); });

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (!msg || !msg.tipo) return;

  if (msg.tipo === "PRAZOS_LEITURA") {
    (async () => {
      await set({ leitura: { host: msg.host, total: msg.total, colunas: msg.colunas, faltando: msg.faltando || [], marcadas: msg.marcadas, em: Date.now() } });
      const r = await avaliar();
      responder({ ok: true, r });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_COLUNA_MARCADA") {
    (async () => {
      await salvarReceitasNoServidor();
      if (sender.tab && sender.tab.id) chrome.tabs.sendMessage(sender.tab.id, { tipo: "PRAZOS_LER_AGORA" }).catch(() => {});
      responder({ ok: true });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_INICIAR_MARCACAO") {
    (async () => {
      try {
        await registrarLeitor(msg.origem);
        await garantirLeitorNaAba(msg.tabId);
        await chrome.tabs.sendMessage(msg.tabId, { tipo: "PRAZOS_MODO_MARCAR" });
        responder({ ok: true });
      } catch (e) {
        responder({ ok: false, erro: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_REMOVER_COLUNA") {
    (async () => {
      const s = await get(["receitas"]);
      const todas = s.receitas || {};
      if (todas[msg.host]) {
        todas[msg.host].colunas = (todas[msg.host].colunas || []).filter((c) => c.id !== msg.id);
        if (todas[msg.host].colunas.length === 0) delete todas[msg.host];
      }
      await set({ receitas: todas });
      await salvarReceitasNoServidor();
      await avisarLeitores({ tipo: "PRAZOS_RECEITA_ATUALIZADA" });
      responder({ ok: true });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_RECALCULAR") {
    avaliar({ force: !!msg.force }).then((r) => responder({ ok: true, r })).catch((e) => responder({ ok: false, erro: String(e) }));
    return true;
  }

  if (msg.tipo === "PRAZOS_ABRIR_IFOOD") {
    focarOuAbrirIfood().then(() => responder({ ok: true })).catch(() => responder({ ok: false }));
    return true;
  }

  if (msg.tipo === "IFOOD_SESSAO") {
    (async () => {
      await set({ ifoodDesconectado: !msg.conectado });
      responder({ ok: true });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_ENTROU") {
    // Login feito no popup: religa leitores (as receitas vieram do servidor) e avalia.
    (async () => { await religarLeitores(); await avisarLeitores({ tipo: "PRAZOS_RECEITA_ATUALIZADA" }); responder({ ok: true }); })();
    return true;
  }

  if (msg.tipo === "PRAZOS_SAIU") {
    (async () => {
      await set({ token: null, conta: null, prazo: null, leitura: null, erro: null, ultimoDespachoMinutos: null, ultimoDespachoEm: null });
      responder({ ok: true });
    })();
    return true;
  }
});
