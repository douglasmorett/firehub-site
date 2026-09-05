/**
 * FireHub Chrome Extension — Background Service Worker
 *
 * FONTE DE VERDADE para a contagem de pedidos:
 * 1. PRIMARIO: Bridge (le o DOM do FireHub em tempo real)
 * 2. FALLBACK: API do servidor (so quando o bridge nao esta ativo)
 *
 * ARQUITETURA DO AJUSTE DE PRAZO (headless):
 * O laco de espera vive AQUI, no service worker, que nao e um documento e por
 * isso nao sofre o throttling de aba oculta do Chrome. O content script virou
 * um efetor burro: o SW injeta funcoes pontuais via chrome.scripting.executeScript
 * e controla o ritmo. Resultado: o prazo muda com a aba apenas ABERTA, sem
 * precisar estar visivel nem focada.
 */

const ALARM_NAME = "FIREHUB_DYNAMIC_ETA_SYNC";
const SETTINGS_URL = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";
const SETTINGS_URL_MATCH = SETTINGS_URL + "*";

// Histerese: o alarme AVALIA a cada minuto, mas so ESCREVE no iFood quando a
// faixa muda de verdade ou quando passou o intervalo minimo. Evita um save por
// minuto num portal de terceiro (rate-limit / revisao).
const MIN_APPLY_INTERVAL_MS = 3 * 60 * 1000;
const BRIDGE_FRESH_MS = 30000;

// Lock em memoria contra corrida dentro do mesmo ciclo de vida do SW.
let applyInFlight = false;

// ── ESTADO DO BRIDGE (em storage.session: sobrevive a morte do SW) ──

async function setBridgeState(count) {
  try {
    await chrome.storage.session.set({ bridgeCount: count, bridgeLastUpdate: Date.now() });
  } catch (e) {}
}

async function getBridgeState() {
  try {
    const s = await chrome.storage.session.get(["bridgeCount", "bridgeLastUpdate"]);
    return { count: s.bridgeCount || 0, lastUpdate: s.bridgeLastUpdate || 0 };
  } catch (e) {
    return { count: 0, lastUpdate: 0 };
  }
}

// ── CICLO DE VIDA ──

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[FireHub Extension] Instalada com sucesso!");
  ensureAlarm();
});

// O alarme tambem precisa existir depois de reiniciar o Chrome.
chrome.runtime.onStartup.addListener(() => {
  console.log("[FireHub Extension] Chrome reiniciado, garantindo alarme...");
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runSyncProcess();
  }
});

// ── RECALCULAR QUANDO MOTOBOYS, MODO OU TOGGLE MUDAM ──
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  const triggerKeys = ["motoboysCount", "activeMode", "manualRules", "autoSyncEnabled", "manualSyncEnabled"];
  const changed = triggerKeys.some(key => key in changes);

  if (changed) {
    (async () => {
      const bridge = await getBridgeState();
      const store = await chrome.storage.local.get(["ordersInProduction"]);
      const count = bridge.count > 0 ? bridge.count : (store.ordersInProduction || 0);
      console.log("[FireHub] Config mudou, recalculando com " + count + " pedidos...");
      // Config mudou por acao do lojista: ignora a histerese.
      await calculateAndApply(count, { force: true });
    })();
  }
});

// ── RECEPTOR DE MENSAGENS DO BRIDGE, DO CONTENT SCRIPT E DO POPUP ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "FIREHUB_LIVE_COUNT") {
    (async () => {
      await setBridgeState(msg.count);
      console.log("[FireHub Bridge] Contagem ao vivo: " + msg.count + " pedidos em producao");
      await calculateAndApply(msg.count);
      sendResponse({ success: true });
    })();
    return true;
  }

  // O popup NAO despacha mais direto pro iFood. Ele pede ao SW, que e o unico
  // despachante. Dois despachantes concorrentes eram parte do BUG 2.
  if (msg && msg.action === "FORCE_SYNC") {
    (async () => {
      const bridge = await getBridgeState();
      const store = await chrome.storage.local.get(["ordersInProduction"]);
      const count = typeof msg.count === "number"
        ? msg.count
        : (bridge.count > 0 ? bridge.count : (store.ordersInProduction || 0));
      const result = await calculateAndApply(count, { force: true });
      sendResponse({ success: true, result: result });
    })();
    return true;
  }

  if (msg && msg.action === "IFOOD_SESSION_DISCONNECTED") {
    console.warn("[FireHub] Notificacao de iFood Desconectado recebida!");
    chrome.storage.local.set({ ifoodDisconnected: true, ifoodDisconnectedTime: new Date().toLocaleTimeString("pt-BR") });
    notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: msg.reason || "Sessao expirada" });
    sendResponse({ success: true });
    return true;
  }

  if (msg && msg.action === "IFOOD_SESSION_CONNECTED") {
    console.log("[FireHub] iFood Conectado!");
    chrome.storage.local.set({ ifoodDisconnected: false });
    notifyBridgeTabs({ action: "IFOOD_CONNECTED_ALERT" });
    sendResponse({ success: true });
    return true;
  }

  if (msg && msg.action === "OPEN_DELIVERY_SETTINGS") {
    handleFocusOrOpenIfood(sendResponse, false); // false = nao rouba foco (background sync)
    return true;
  }

  if (msg && msg.action === "FOCUS_OR_OPEN_IFOOD") {
    handleFocusOrOpenIfood(sendResponse, true); // true = rouba foco (clique manual do lojista)
    return true;
  }
});

// Envia mensagem para abas do FireHub ativas
async function notifyBridgeTabs(payload) {
  try {
    const bridgeTabs = await chrome.tabs.query({
      url: [
        "https://firehubfood.com.br/*",
        "https://*.firehubfood.com.br/*",
        "https://firehub.com.br/*",
        "https://*.firehub.com.br/*",
        "http://localhost:3001/*",
        "http://localhost:3000/*"
      ]
    });
    for (const tab of bridgeTabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch (e) {}
}

// ── REAPROVEITAMENTO E FOCO DE ABA DO IFOOD (Evita abas duplicadas) ──
async function handleFocusOrOpenIfood(sendResponse, forceFocus) {
  const settingsTabs = await chrome.tabs.query({ url: SETTINGS_URL_MATCH });

  if (settingsTabs.length > 0 && settingsTabs[0].id) {
    if (forceFocus) {
      console.log("[FireHub] Focando na aba de configuracoes existente...");
      await chrome.tabs.update(settingsTabs[0].id, { active: true });
      if (settingsTabs[0].windowId) {
        await chrome.windows.update(settingsTabs[0].windowId, { focused: true });
      }
    } else {
      // Antes esse ramo so imprimia "despachando" e nao despachava nada:
      // o pendingETA ficava orfao ate a aba ser recarregada. Agora aplica.
      const pending = await chrome.storage.local.get("pendingETA");
      if (typeof pending.pendingETA === "number") {
        console.log("[FireHub] Aba de config ja existe. Aplicando pendingETA=" + pending.pendingETA);
        await chrome.storage.local.remove("pendingETA");
        applyEtaHeadless(settingsTabs[0].id, pending.pendingETA).catch(() => {});
      }
    }
    if (sendResponse) sendResponse({ success: true, tabId: settingsTabs[0].id });
    return;
  }

  if (!forceFocus) {
    // Sem gesto do lojista a extensao NAO abre aba. Antes abria em segundo plano com
    // cooldown e, quando o portal caia no login (URL diferente da de configuracoes),
    // a busca nao achava a aba e outra era criada a cada 2 minutos — dezenas de abas.
    avisarAbaFaltando();
    if (sendResponse) sendResponse({ success: false, reason: "sem-aba" });
    return;
  }

  const anyIfoodTabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
  if (anyIfoodTabs.length > 0 && anyIfoodTabs[0].id) {
    console.log("[FireHub] Direcionando aba iFood existente para configuracoes...");
    await chrome.tabs.update(anyIfoodTabs[0].id, { url: SETTINGS_URL, active: true });
    if (anyIfoodTabs[0].windowId) {
      await chrome.windows.update(anyIfoodTabs[0].windowId, { focused: true });
    }
    if (sendResponse) sendResponse({ success: true, tabId: anyIfoodTabs[0].id });
    return;
  }

  console.log("[FireHub] Abrindo aba do portal iFood ativa...");
  const newTab = await chrome.tabs.create({ url: SETTINGS_URL, active: true });
  if (sendResponse) sendResponse({ success: true, tabId: newTab.id });
}

/**
 * A aba de configuracoes do iFood NUNCA e criada automaticamente (decisao de
 * 04/09/2026). A extensao so trabalha com a aba que o lojista deixou aberta;
 * sem ela, avisa no painel do FireHub e no popup, e nada mais.
 */
function avisarAbaFaltando() {
  chrome.storage.local.set({
    ifoodApplyError: "Abra a tela Configuracoes > Entrega do portal iFood e deixe a aba aberta"
  });
  notifyBridgeTabs({
    action: "IFOOD_TAB_MISSING_ALERT",
    reason: "A aba de Configurações de entrega do portal iFood não está aberta. O prazo não muda até você abrir e deixar aberta."
  });
}

// ── FUNCOES INJETADAS NA PAGINA DO IFOOD ──
// Precisam ser autocontidas: rodam no contexto da aba, sem acesso a este escopo.

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
  // Sequencia completa de ponteiro: alguns componentes React ignoram click puro.
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
  const candidates = buttons.filter(function (b) {
    return (b.textContent || "").trim().toLowerCase() === "salvar";
  });
  if (candidates.length === 0) return { clicked: false, reason: "nao-encontrado" };
  const enabled = candidates.find(function (b) { return !b.disabled; });
  if (!enabled) {
    // Botao desabilitado significa que nao ha alteracao pendente.
    // Forcar o clique aqui so produzia falso "SALVO!".
    return { clicked: false, reason: "desabilitado" };
  }
  try { enabled.focus(); } catch (e) {}
  enabled.click();
  return { clicked: true };
}

function fnIsLoggedOut() {
  const href = window.location.href.toLowerCase();
  if (href.indexOf("openid-connect") !== -1 || href.indexOf("callback") !== -1 || href.indexOf("response_type=") !== -1) {
    return false;
  }
  const passwordInput = document.querySelector('input[type="password"]');
  const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
  const hasDisconnectText = bodyText.indexOf("fazer login") !== -1 ||
    bodyText.indexOf("sessão expirou") !== -1 ||
    bodyText.indexOf("entre com sua conta") !== -1;
  return !!(passwordInput && (hasDisconnectText || href.indexOf("login.ifood.com.br") !== -1));
}

// ── ORQUESTRADOR HEADLESS ──

function hhmm() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// No service worker isto NAO sofre throttling de aba oculta.
function wait(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function step(tabId, func, args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: func,
    args: args || []
  });
  return results && results[0] ? results[0].result : undefined;
}

async function ensureTabReady(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return false;

    // Memory Saver pode descartar a aba: recarrega e espera terminar.
    if (tab.discarded) {
      await chrome.tabs.reload(tabId);
      await new Promise(function (resolve) {
        const listener = function (id, info) {
          if (id === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(function () {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 20000);
      });
    }

    // Impede que o Chrome descarte a aba enquanto ela e nossa efetora.
    try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Aplica o prazo dirigindo a pagina de fora. O laco vive aqui no SW,
 * entao funciona com a aba apenas aberta (oculta, minimizada ou coberta).
 * Termina SEMPRE com verificacao real: le o valor de volta da tela.
 */
async function applyEtaHeadless(tabId, target) {
  if (applyInFlight) return { ok: false, reason: "ja-aplicando" };
  applyInFlight = true;

  try {
    const ready = await ensureTabReady(tabId);
    if (!ready) return { ok: false, reason: "aba-indisponivel" };

    const loggedOut = await step(tabId, fnIsLoggedOut);
    if (loggedOut) {
      await chrome.storage.local.set({ ifoodDisconnected: true });
      notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: "Sessao do portal iFood encerrada" });
      return { ok: false, reason: "deslogado" };
    }

    await step(tabId, fnClickOperacaoAtual);
    await wait(1200);

    let current = await step(tabId, fnReadBaseTime);
    if (current === null || current === undefined) {
      await wait(2500);
      current = await step(tabId, fnReadBaseTime);
    }
    if (current === null || current === undefined) {
      await chrome.storage.local.set({ ifoodApplyError: "Campos de tempo nao encontrados na tela" });
      return { ok: false, reason: "input" };
    }

    if (Math.abs(target - current) <= 2) {
      await chrome.storage.local.set({ lastAppliedETA: target, ifoodLastApply: hhmm(), ifoodApplyError: null });
      return { ok: true, after: current, unchanged: true };
    }

    let last = null;
    for (let i = 0; i < 25; i++) {
      const v = await step(tabId, fnReadBaseTime);
      if (v === null || v === undefined || v === 0) {
        await chrome.storage.local.set({ ifoodApplyError: "Valor do prazo ilegivel durante o ajuste" });
        return { ok: false, reason: "input" };
      }
      if (Math.abs(target - v) <= 2) break;

      // Clique morto: o valor nao mexeu desde a iteracao anterior.
      if (v === last) {
        await chrome.storage.local.set({ ifoodApplyError: "Portal ignorou o clique de +/- 5 min" });
        return { ok: false, reason: "clique-ignorado", after: v };
      }
      last = v;

      const clicked = await step(tabId, fnClickAdjust, [target > v]);
      if (!clicked) {
        await chrome.storage.local.set({ ifoodApplyError: "Botao +/- 5 min nao encontrado" });
        return { ok: false, reason: "botao-ajuste" };
      }
      await wait(450);
    }

    const salvar = await step(tabId, fnClickSalvar);
    if (!salvar || !salvar.clicked) {
      const reason = salvar ? salvar.reason : "falhou";
      await chrome.storage.local.set({ ifoodApplyError: "Salvar: " + reason });
      return { ok: false, reason: reason };
    }

    await wait(2500);

    // VERIFICACAO REAL: antes o codigo gravava "SALVO!" sem nunca conferir.
    const after = await step(tabId, fnReadBaseTime);
    const ok = after !== null && after !== undefined && Math.abs(after - target) <= 2;

    await chrome.storage.local.set(ok
      ? { lastAppliedETA: target, ifoodLastApply: hhmm(), ifoodApplyError: null }
      : { ifoodApplyError: "Nao confirmou: alvo " + target + " min, tela " + after + " min" });

    console.log(ok
      ? "[FireHub] CONFIRMADO " + target + " min no iFood (tela: " + after + ")"
      : "[FireHub] Falha ao aplicar: alvo " + target + ", tela " + after);

    return { ok: ok, after: after };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    await chrome.storage.local.set({ ifoodApplyError: message });
    console.warn("[FireHub applyEtaHeadless]", err);
    return { ok: false, reason: "excecao", error: message };
  } finally {
    applyInFlight = false;
  }
}

// ── FUNCAO CENTRAL: Calcula ETA e aplica ──
async function calculateAndApply(count, opts) {
  const options = opts || {};
  try {
    const store = await chrome.storage.local.get([
      "motoboysCount", "activeMode", "manualRules",
      "autoSyncEnabled", "manualSyncEnabled", "ifoodDisconnected",
      "lastDispatchedMinutes", "lastDispatchTime"
    ]);

    const syncEnabled = !!(store.autoSyncEnabled || store.manualSyncEnabled);

    // REGRESSAO CORRIGIDA: o commit 6febead removeu estas duas linhas e o resto
    // da funcao seguiu lendo as variaveis, gerando ReferenceError em toda
    // chamada e matando tudo daqui pra baixo (storage.set e despacho).
    const mode = store.activeMode || "auto";
    const motoboys = store.motoboysCount || 2;

    if (store.ifoodDisconnected && syncEnabled) {
      console.log("[FireHub] iFood desconectado e sync ativo. Avisando o lojista...");
      notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: "Sessao do portal iFood encerrada" });
    } else if (!store.ifoodDisconnected) {
      notifyBridgeTabs({ action: "IFOOD_CONNECTED_ALERT" });
    }

    let recommendedMinutes = 38;
    let etaRangeFormatted = "38 min";
    let shouldPauseStore = false;

    if (mode === "manual" && Array.isArray(store.manualRules) && store.manualRules.length > 0) {
      const sorted = store.manualRules.slice().sort(function (a, b) {
        return (a.maxOrders || 0) - (b.maxOrders || 0);
      });
      const matched = sorted.find(function (r) { return count <= r.maxOrders; }) || sorted[sorted.length - 1];
      if (matched) {
        recommendedMinutes = matched.minutes || 58;
        shouldPauseStore = !!matched.pause;
        etaRangeFormatted = shouldPauseStore
          ? recommendedMinutes + " min + PAUSAR"
          : recommendedMinutes + " min";
      }
    } else {
      const max28 = 1 * motoboys;
      const max38 = 2 * motoboys;
      const max58 = 3 * motoboys;
      const max78 = 4 * motoboys;

      if (count <= max28) {
        recommendedMinutes = 28;
        etaRangeFormatted = "28 min";
      } else if (count <= max38) {
        recommendedMinutes = 38;
        etaRangeFormatted = "38 min";
      } else if (count <= max58) {
        recommendedMinutes = 58;
        etaRangeFormatted = "58 min";
      } else if (count <= max78) {
        recommendedMinutes = 78;
        etaRangeFormatted = "78 min";
      } else {
        // ANTES: shouldPause impedia QUALQUER aplicacao, entao no pico o prazo
        // ficava congelado no valor antigo (o pior comportamento possivel).
        // AGORA: aplica o teto E alerta o lojista para pausar.
        recommendedMinutes = 78;
        shouldPauseStore = true;
        etaRangeFormatted = "78 min + PAUSAR LOJA";
      }
    }

    await chrome.storage.local.set({
      ordersInProduction: count,
      lastEtaFormatted: etaRangeFormatted,
      recommendedMinutes: recommendedMinutes,
      lastSyncTime: hhmm(),
      shouldPauseStore: shouldPauseStore
    });

    console.log("[FireHub] " + count + " ped. | " + motoboys + " motoboys | " + mode + " -> " + etaRangeFormatted);

    notifyBridgeTabs({
      action: "ETA_UPDATED",
      formatted: etaRangeFormatted,
      ordersInProduction: count,
      mode: mode,
      shouldPause: shouldPauseStore
    });

    if (!syncEnabled) return { dispatched: false, reason: "sync-desligado", recommendedMinutes: recommendedMinutes };
    if (store.ifoodDisconnected) return { dispatched: false, reason: "ifood-desconectado", recommendedMinutes: recommendedMinutes };

    // ── HISTERESE: so escreve no iFood quando a faixa muda de fato ──
    const sameTier = store.lastDispatchedMinutes === recommendedMinutes;
    const sinceLast = Date.now() - (store.lastDispatchTime || 0);
    if (!options.force && sameTier && sinceLast < MIN_APPLY_INTERVAL_MS) {
      return { dispatched: false, reason: "histerese", recommendedMinutes: recommendedMinutes };
    }

    const settingsTabs = await chrome.tabs.query({ url: SETTINGS_URL_MATCH });
    console.log("[FireHub] Despachando " + recommendedMinutes + " min | Abas de Config: " + settingsTabs.length);

    if (settingsTabs.length === 0 || !settingsTabs[0].id) {
      avisarAbaFaltando();
      return { dispatched: false, reason: "sem-aba", recommendedMinutes: recommendedMinutes };
    }

    const tabId = settingsTabs[0].id;
    notifyBridgeTabs({ action: "IFOOD_TAB_PRESENT" });

    // Avisa a pilula da aba do iFood (so display, nao automacao).
    chrome.tabs.sendMessage(tabId, {
      action: "ETA_STATUS",
      formatted: etaRangeFormatted,
      ordersInProduction: count,
      mode: mode,
      shouldPause: shouldPauseStore
    }).catch(function () {});

    const result = await applyEtaHeadless(tabId, recommendedMinutes);

    if (result.ok) {
      await chrome.storage.local.set({
        lastDispatchedMinutes: recommendedMinutes,
        lastDispatchTime: Date.now()
      });
    }

    return {
      dispatched: true,
      ok: result.ok,
      reason: result.reason,
      after: result.after,
      recommendedMinutes: recommendedMinutes
    };

  } catch (err) {
    // Antes era so console.warn, e por isso o ReferenceError passou meses
    // invisivel. Agora o erro fica no storage e aparece no popup.
    const message = String(err && err.message ? err.message : err);
    console.error("[FireHub calculateAndApply Error]", err);
    try {
      await chrome.storage.local.set({ lastBackgroundError: hhmm() + " - " + message });
    } catch (e) {}
    return { dispatched: false, reason: "erro", error: message };
  }
}

// ── ALARME: FALLBACK QUANDO O BRIDGE NAO ESTA ATIVO ──
async function runSyncProcess() {
  try {
    const bridge = await getBridgeState();
    const bridgeIsActive = (Date.now() - bridge.lastUpdate) < BRIDGE_FRESH_MS;

    if (bridgeIsActive) {
      console.log("[FireHub Alarm] Bridge ativo (" + bridge.count + " ped.), usando contagem do bridge.");
      await calculateAndApply(bridge.count);
      return;
    }

    console.log("[FireHub Alarm] Bridge inativo, buscando contagem da API...");

    const store = await chrome.storage.local.get(["serverUrl", "motoboysCount", "activeMode", "manualRules", "authToken"]);
    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";

    // PRODUCAO E COOLIFY (firehubfood.com.br). O deploy da Vercel virou zumbi e
    // servia contagem de outro ambiente, entao nao entra mais na lista.
    const candidates = store.serverUrl
      ? [store.serverUrl, "https://firehubfood.com.br", "http://localhost:3001", "http://localhost:3000"]
      : ["https://firehubfood.com.br", "http://localhost:3001", "http://localhost:3000"];

    const uniqueUrls = Array.from(new Set(candidates.map(function (u) { return u.replace(/\/$/, ""); })));

    let data = null;
    let workingUrl = null;

    for (const baseUrl of uniqueUrls) {
      try {
        let apiUrl = baseUrl + "/api/store/dynamic-eta?mode=" + mode + "&motoboys=" + motoboys;
        if (store.authToken) {
          apiUrl += "&token=" + store.authToken;
        }
        if (mode === "manual" && Array.isArray(store.manualRules)) {
          apiUrl += "&rules=" + encodeURIComponent(JSON.stringify(store.manualRules));
        }
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(3500) });
        if (res.ok) {
          const json = await res.json();
          if (json && json.success) {
            data = json;
            workingUrl = baseUrl;
            break;
          }
        }
      } catch (e) {}
    }

    if (workingUrl) {
      await chrome.storage.local.set({ serverUrl: workingUrl });
    }

    if (data && data.success) {
      console.log("[FireHub Alarm API] Em Producao=" + data.ordersInProduction + " | " + mode + " -> " + data.etaRangeFormatted);
      await calculateAndApply(data.ordersInProduction);
    } else {
      await chrome.storage.local.set({ lastBackgroundError: hhmm() + " - API nao respondeu em nenhum servidor" });
    }

  } catch (err) {
    console.error("[FireHub Alarm Error]", err);
  }
}
