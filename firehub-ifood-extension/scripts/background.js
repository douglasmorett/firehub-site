/**
 * FireHub Chrome Extension — Background Service Worker
 * Mantém um alarme de 5 minutos ativo para buscar o tempo de entrega no FireHub e atualizar no iFood.
 * Se a aba do Portal do iFood não estiver aberta, o bot a abre automaticamente no navegador!
 */

const ALARM_NAME = "FIREHUB_DYNAMIC_ETA_SYNC";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[FireHub Extension] 🚀 Instalada com sucesso!");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runSyncProcess();
  }
});

async function runSyncProcess() {
  try {
    const store = await chrome.storage.local.get(["serverUrl", "motoboysCount", "activeMode", "manualOrders", "manualMinutes"]);
    const baseUrl = (store.serverUrl || "https://firehub-site.vercel.app").replace(/\/$/, "");
    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";

    let apiUrl = `${baseUrl}/api/store/dynamic-eta?mode=${mode}&motoboys=${motoboys}`;
    if (mode === "manual") {
      apiUrl += `&orders=${store.manualOrders || 10}&minutes=${store.manualMinutes || 58}`;
    }

    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data && data.success) {
      console.log(`[FireHub Alarm] KDS=${data.ordersInProduction} | Mode=${mode} ➔ ETA: ${data.etaRangeFormatted}`);

      await chrome.storage.local.set({
        lastEtaFormatted: data.etaRangeFormatted,
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
