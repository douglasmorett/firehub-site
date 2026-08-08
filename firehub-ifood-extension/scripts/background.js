/**
 * FireHub Chrome Extension — Background Service Worker
 * 
 * FONTE DE VERDADE para a contagem de pedidos:
 * 1. PRIMÁRIO: Bridge (lê o DOM do FireHub em tempo real, a cada 1s)
 * 2. FALLBACK: API do servidor (só quando o bridge não está ativo)
 * 
 * Prevenção de Abas Duplicadas:
 * - Nunca abre múltiplas abas do iFood.
 * - Reutiliza a mesma aba existente.
 * - Detecta desconexão do iFood e alerta o lojista no FireHub sem ficar abrindo abas.
 */

const ALARM_NAME = "FIREHUB_DYNAMIC_ETA_SYNC";

// ── ESTADO DO BRIDGE ──
let bridgeLastUpdate = 0;
let bridgeCount = 0;

chrome.runtime.onInstalled.addListener(() => {
  console.log("[FireHub Extension] 🚀 Instalada com sucesso!");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
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
    chrome.storage.local.get(["ordersInProduction"], (store) => {
      const count = bridgeCount > 0 ? bridgeCount : (store.ordersInProduction || 0);
      console.log(`[FireHub] 🔄 Config mudou → Recalculando com ${count} pedidos...`);
      calculateAndApply(count);
    });
  }
});

// ── RECEPTOR DE MENSAGENS DO BRIDGE E DO CONTENT SCRIPT ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "FIREHUB_LIVE_COUNT") {
    bridgeLastUpdate = Date.now();
    bridgeCount = msg.count;
    console.log(`[FireHub Bridge] ⚡ Contagem ao vivo: ${msg.count} pedidos em produção`);
    calculateAndApply(msg.count);
    sendResponse({ success: true });
  }

  if (msg && msg.action === "IFOOD_SESSION_DISCONNECTED") {
    console.warn("[FireHub] 🔴 Notificação de iFood Desconectado recebida!");
    chrome.storage.local.set({ ifoodDisconnected: true, ifoodDisconnectedTime: new Date().toLocaleTimeString("pt-BR") });
    notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: msg.reason || "Sessão expirada" });
    sendResponse({ success: true });
  }

  if (msg && msg.action === "IFOOD_SESSION_CONNECTED") {
    console.log("[FireHub] 🟢 iFood Conectado!");
    chrome.storage.local.set({ ifoodDisconnected: false });
    notifyBridgeTabs({ action: "IFOOD_CONNECTED_ALERT" });
    sendResponse({ success: true });
  }

  if (msg && msg.action === "OPEN_DELIVERY_SETTINGS" || msg.action === "FOCUS_OR_OPEN_IFOOD") {
    handleFocusOrOpenIfood(sendResponse);
    return true; // async sendResponse
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
        "https://hakimriodasostras.com.br/*",
        "https://*.hakimriodasostras.com.br/*",
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
async function handleFocusOrOpenIfood(sendResponse) {
  const settingsUrl = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";
  const portalBaseUrl = "https://portal.ifood.com.br/";

  // 1. Procura se já existe a aba exata de configurações de entrega
  const settingsTabs = await chrome.tabs.query({ url: "https://portal.ifood.com.br/merchant-delivery-core-portal-experience*" });
  if (settingsTabs.length > 0 && settingsTabs[0].id) {
    console.log(`[FireHub] 📌 Focando na aba de configurações existente (tab ${settingsTabs[0].id})...`);
    await chrome.tabs.update(settingsTabs[0].id, { active: true });
    if (settingsTabs[0].windowId) {
      await chrome.windows.update(settingsTabs[0].windowId, { focused: true });
    }
    if (sendResponse) sendResponse({ success: true, tabId: settingsTabs[0].id });
    return;
  }

  // 2. Se não tem a de configurações, procura QUALQUER aba do iFood
  const anyIfoodTabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
  if (anyIfoodTabs.length > 0 && anyIfoodTabs[0].id) {
    console.log(`[FireHub] 📌 Direcionando aba iFood existente para configurações (tab ${anyIfoodTabs[0].id})...`);
    await chrome.tabs.update(anyIfoodTabs[0].id, { url: settingsUrl, active: true });
    if (anyIfoodTabs[0].windowId) {
      await chrome.windows.update(anyIfoodTabs[0].windowId, { focused: true });
    }
    if (sendResponse) sendResponse({ success: true, tabId: anyIfoodTabs[0].id });
    return;
  }

  // 3. Se não tem nenhuma aba aberta, abre APENAS 1 aba
  console.log("[FireHub] 🚀 Abrindo 1 única aba do portal iFood...");
  const newTab = await chrome.tabs.create({ url: settingsUrl, active: true });
  if (sendResponse) sendResponse({ success: true, tabId: newTab.id });
}

// ── FUNÇÃO CENTRAL: Calcula ETA e aplica ──
async function calculateAndApply(count) {
  try {
    const store = await chrome.storage.local.get([
      "motoboysCount", "activeMode", "manualRules",
      "autoSyncEnabled", "manualSyncEnabled", "ifoodDisconnected"
    ]);

    // Se o iFood foi marcado como desconectado, avisa os logs e não fica tentando se o estado for permanente
    if (store.ifoodDisconnected) {
      console.log("[FireHub] ⚠️ iFood está desconectado. Aguardando o lojista reconectar...");
      notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: "Sessão do portal iFood encerrada" });
    }

    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";
    const syncEnabled = store.autoSyncEnabled || store.manualSyncEnabled;

    let recommendedMinutes = 38;
    let etaRangeFormatted = "38 min";
    let shouldPauseStore = false;

    if (mode === "manual" && Array.isArray(store.manualRules) && store.manualRules.length > 0) {
      const sorted = [...store.manualRules].sort((a, b) => (a.maxOrders || 0) - (b.maxOrders || 0));
      const matched = sorted.find(r => count <= r.maxOrders) || sorted[sorted.length - 1];
      if (matched) {
        recommendedMinutes = matched.minutes || 58;
        shouldPauseStore = !!matched.pause;
        etaRangeFormatted = shouldPauseStore ? "⚠️ PAUSAR LOJA" : `${recommendedMinutes} min`;
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
        recommendedMinutes = 78;
        shouldPauseStore = true;
        etaRangeFormatted = "⚠️ PAUSAR LOJA (40 MIN)";
      }
    }

    const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    await chrome.storage.local.set({
      ordersInProduction: count,
      lastEtaFormatted: etaRangeFormatted,
      recommendedMinutes,
      lastSyncTime: nowStr,
      shouldPauseStore,
    });

    console.log(`[FireHub] 📊 ${count} ped. | ${motoboys} motoboys | ${mode} → ${etaRangeFormatted}`);

    // ── DESPACHAR PRO IFOOD SE SYNC ATIVO ──
    if (syncEnabled) {
      const payload = {
        action: "SET_DELIVERY_TIME",
        minMinutes: recommendedMinutes,
        maxMinutes: recommendedMinutes,
        formatted: etaRangeFormatted,
        mode,
        shouldPause: shouldPauseStore,
      };

      const settingsTabs = await chrome.tabs.query({ url: "https://portal.ifood.com.br/merchant-delivery-core-portal-experience*" });
      console.log(`[FireHub] 📤 Despachando ${recommendedMinutes} min | Abas de Config: ${settingsTabs.length}`);

      if (settingsTabs.length > 0) {
        for (const tab of settingsTabs) {
          if (tab.id) {
            try {
              await chrome.tabs.sendMessage(tab.id, payload);
              console.log(`[FireHub] ✅ Enviado para a aba em segundo plano (tab ${tab.id})`);
            } catch (err) {
              console.warn(`[FireHub] ⚠️ Falha tab ${tab.id}: ${err.message}. Reinjetando...`);
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["scripts/content.js"]
                });
                await new Promise(r => setTimeout(r, 1500));
                await chrome.tabs.sendMessage(tab.id, payload);
              } catch (e2) {}
            }
          }
        }
      } else {
        // Se NENHUMA aba de configurações está aberta:
        // Verifica se iFood não está marcado como desconectado ANTES de abrir
        if (!store.ifoodDisconnected) {
          const anyIfood = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
          if (anyIfood.length === 0) {
            console.log("[FireHub] 🚀 Nenhuma aba do iFood aberta. Criando 1 única aba em segundo plano...");
            chrome.storage.local.set({ pendingETA: recommendedMinutes });
            chrome.tabs.create({
              url: "https://portal.ifood.com.br/merchant-delivery-core-portal-experience",
              active: false
            });
          } else {
            console.log(`[FireHub] 📌 Aba iFood já existe (tab ${anyIfood[0].id}). Não criando aba duplicada.`);
          }
        }
      }
    }

  } catch (err) {
    console.warn("[FireHub calculateAndApply Error]", err);
  }
}

// ── ALARME: FALLBACK QUANDO O BRIDGE NÃO ESTÁ ATIVO ──
async function runSyncProcess() {
  try {
    const bridgeIsActive = (Date.now() - bridgeLastUpdate) < 30000;

    if (bridgeIsActive) {
      console.log(`[FireHub Alarm] Bridge ativo (${bridgeCount} ped.), usando contagem do bridge.`);
      await calculateAndApply(bridgeCount);
      return;
    }

    console.log("[FireHub Alarm] Bridge inativo, buscando contagem da API...");

    const store = await chrome.storage.local.get(["serverUrl", "motoboysCount", "activeMode", "manualRules", "authToken"]);
    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";

    const candidates = store.serverUrl
      ? [store.serverUrl, "https://firehubfood.com.br", "https://firehub-site.vercel.app", "https://www.hakimriodasostras.com.br", "http://localhost:3001", "http://localhost:3000"]
      : ["https://firehubfood.com.br", "https://firehub-site.vercel.app", "https://www.hakimriodasostras.com.br", "http://localhost:3001", "http://localhost:3000"];

    const uniqueUrls = Array.from(new Set(candidates.map(u => u.replace(/\/$/, ""))));

    let data = null;
    let workingUrl = null;

    for (const baseUrl of uniqueUrls) {
      try {
        let apiUrl = `${baseUrl}/api/store/dynamic-eta?mode=${mode}&motoboys=${motoboys}`;
        if (store.authToken) {
          apiUrl += `&token=${store.authToken}`;
        }
        if (mode === "manual" && Array.isArray(store.manualRules)) {
          apiUrl += `&rules=${encodeURIComponent(JSON.stringify(store.manualRules))}`;
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
      console.log(`[FireHub Alarm API] Em Produção=${data.ordersInProduction} | ${mode} → ${data.etaRangeFormatted}`);
      await calculateAndApply(data.ordersInProduction);
    }

  } catch (err) {
    console.error("[FireHub Alarm Error]", err);
  }
}
