/**
 * FireHub Chrome Extension — Background Service Worker
 * Mantém um alarme de 3 minutos ativo para buscar o tempo de entrega no FireHub e atualizar no iFood.
 * Se a aba do Portal do iFood não estiver aberta, o bot a abre automaticamente no navegador!
 */

const ALARM_NAME = "FIREHUB_DYNAMIC_ETA_SYNC";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[FireHub Extension] 🚀 Instalada com sucesso!");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runSyncProcess();
  }
});

// ── RECEPTOR EM TEMPO REAL (FIREHUB WEB BRIDGE) ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "FIREHUB_LIVE_COUNT") {
    console.log(`[FireHub Real-Time] ⚡ Atualização ao vivo: ${msg.count} pedidos em produção`);
    handleLiveCountUpdate(msg.count);
    sendResponse({ success: true });
  }
});

async function handleLiveCountUpdate(count) {
  try {
    const store = await chrome.storage.local.get(["motoboysCount", "activeMode", "manualRules"]);
    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";

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
      const max38 = 2 * motoboys;
      const max58 = 3 * motoboys;
      const max78 = 4 * motoboys;

      if (count <= max38) {
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

    const payload = {
      action: "SET_DELIVERY_TIME",
      minMinutes: recommendedMinutes,
      maxMinutes: recommendedMinutes,
      formatted: etaRangeFormatted,
      mode,
      shouldPause: shouldPauseStore,
    };

    const syncStore = await chrome.storage.local.get(["autoSyncEnabled", "manualSyncEnabled"]);
    const syncEnabled = syncStore.autoSyncEnabled || syncStore.manualSyncEnabled;
    if (!syncEnabled) {
      console.log("[FireHub] Sync desativado, apenas atualizando valores.");
      return;
    }

    const tabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
    if (tabs && tabs.length > 0) {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn("[FireHub Live Sync Error]", err);
  }
}

async function runSyncProcess() {
  try {
    const store = await chrome.storage.local.get(["serverUrl", "motoboysCount", "activeMode", "manualRules", "authToken"]);
    const savedUrl = store.serverUrl;
    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";

    const candidates = savedUrl
      ? [savedUrl, "http://localhost:3001", "http://localhost:3000", "https://firehub-site.vercel.app", "https://www.hakimriodasostras.com.br"]
      : ["http://localhost:3001", "http://localhost:3000", "https://firehub-site.vercel.app", "https://www.hakimriodasostras.com.br"];

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
      console.log(`[FireHub Alarm] Em Produção=${data.ordersInProduction} | Mode=${mode} ➔ ETA: ${data.etaRangeFormatted}`);

      await chrome.storage.local.set({
        lastEtaFormatted: data.etaRangeFormatted,
        recommendedMinutes: data.recommendedMinutes || 38,
        lastSyncTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        ordersInProduction: data.ordersInProduction,
        shouldPauseStore: !!data.shouldPauseStore,
      });

      const payload = {
        action: "SET_DELIVERY_TIME",
        minMinutes: data.recommendedMinutes || 38,
        maxMinutes: data.recommendedMinutes || 38,
        formatted: data.etaRangeFormatted,
        mode,
        shouldPause: !!data.shouldPauseStore,
      };

      // Verificar se o sync está ativado
      const syncStore2 = await chrome.storage.local.get(["autoSyncEnabled", "manualSyncEnabled"]);
      const syncEnabled2 = syncStore2.autoSyncEnabled || syncStore2.manualSyncEnabled;
      if (!syncEnabled2) {
        console.log("[FireHub Alarm] Sync desativado, apenas atualizando valores.");
        return;
      }

      // 1. Verificar se a aba do Portal do iFood já está aberta
      const tabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });

      if (tabs && tabs.length > 0) {
        // Envia comando para a aba existente
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
          }
        }
      } else {
        // 2. Se a aba NÃO estiver aberta, o bot abre automaticamente!
        console.log("[FireHub Bot] 🚀 Aba do Portal iFood não encontrada. Abrindo automaticamente...");
        chrome.tabs.create({ url: "https://portal.ifood.com.br/", active: false }, (newTab) => {
          if (newTab && newTab.id) {
            setTimeout(() => {
              chrome.tabs.sendMessage(newTab.id, payload).catch(() => {});
            }, 6000);
          }
        });
      }
    }
  } catch (err) {
    console.error("[FireHub Alarm Error]", err);
  }
}
