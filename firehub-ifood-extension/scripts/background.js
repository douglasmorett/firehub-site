/**
 * FireHub Chrome Extension — Background Service Worker
 * Mantém um alarme de 5 minutos ativo para buscar o tempo de entrega no FireHub e atualizar no iFood.
 */

const ALARM_NAME = "FIREHUB_DYNAMIC_ETA_SYNC";

// Configurar o alarme de 5 minutos ao instalar/iniciar
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
    const store = await chrome.storage.local.get(["serverUrl", "motoboysCount"]);
    const baseUrl = (store.serverUrl || "https://firehub-site.vercel.app").replace(/\/$/, "");
    const motoboys = store.motoboysCount || 2;

    const apiUrl = `${baseUrl}/api/store/dynamic-eta?motoboys=${motoboys}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data && data.success) {
      console.log(`[FireHub Alarm] KDS=${data.ordersInProduction} | Motoboys=${motoboys} ➔ ETA: ${data.etaRangeFormatted}`);

      await chrome.storage.local.set({
        lastEtaFormatted: data.etaRangeFormatted,
        lastSyncTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        ordersInProduction: data.ordersInProduction,
        minMinutes: data.recommendedEtaMin,
        maxMinutes: data.recommendedEtaMax,
      });

      // Enviar comando de atualização para as abas do iFood abertas
      const tabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: "SET_DELIVERY_TIME",
            minMinutes: data.recommendedEtaMin,
            maxMinutes: data.recommendedEtaMax,
            formatted: data.etaRangeFormatted,
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("[FireHub Alarm Error]", err);
  }
}
