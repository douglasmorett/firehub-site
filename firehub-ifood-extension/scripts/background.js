/**
 * FireHub Chrome Extension — Background Service Worker
 * 
 * FONTE DE VERDADE para a contagem de pedidos:
 * 1. PRIMÁRIO: Bridge (lê o DOM do FireHub em tempo real, a cada 1s)
 * 2. FALLBACK: API do servidor (só quando o bridge não está ativo)
 * 
 * Fluxo:
 * Bridge → handleLiveCountUpdate() → calculateAndApply() → Salva no storage + Envia pro iFood
 * Alarme (1min) → Se bridge inativo, chama API → calculateAndApply()
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
    // Pegar a contagem mais recente (bridge ou storage)
    chrome.storage.local.get(["ordersInProduction"], (store) => {
      const count = bridgeCount > 0 ? bridgeCount : (store.ordersInProduction || 0);
      console.log(`[FireHub] 🔄 Config mudou → Recalculando com ${count} pedidos...`);
      calculateAndApply(count);
    });
  }
});

// ── RECEPTOR EM TEMPO REAL (FIREHUB WEB BRIDGE) ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "FIREHUB_LIVE_COUNT") {
    bridgeLastUpdate = Date.now();
    bridgeCount = msg.count;
    console.log(`[FireHub Bridge] ⚡ Contagem ao vivo: ${msg.count} pedidos em produção`);
    calculateAndApply(msg.count);
    sendResponse({ success: true });
  }

  if (msg && msg.action === "OPEN_DELIVERY_SETTINGS") {
    // Encontrar aba de configurações de entrega já aberta, ou abrir uma nova
    const settingsUrl = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";
    chrome.tabs.query({ url: "https://portal.ifood.com.br/merchant-delivery-core-portal-experience*" }, (tabs) => {
      if (tabs && tabs.length > 0) {
        // Já tem aba aberta → focar nela
        console.log(`[FireHub] 📌 Aba de configurações já existe (tab ${tabs[0].id}), focando...`);
        chrome.tabs.update(tabs[0].id, { active: false }); // Não focar, só recarregar
        chrome.tabs.reload(tabs[0].id);
      } else {
        // Abrir nova aba em background (sem tirar o foco do user)
        console.log("[FireHub] 🚀 Abrindo aba de configurações de entrega em background...");
        chrome.tabs.create({ url: settingsUrl, active: false });
      }
    });
    sendResponse({ success: true });
  }
});

// ── FUNÇÃO CENTRAL: Calcula ETA e aplica ──
async function calculateAndApply(count) {
  try {
    const store = await chrome.storage.local.get([
      "motoboysCount", "activeMode", "manualRules",
      "autoSyncEnabled", "manualSyncEnabled"
    ]);

    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";
    const syncEnabled = store.autoSyncEnabled || store.manualSyncEnabled;

    let recommendedMinutes = 38;
    let etaRangeFormatted = "38 min";
    let shouldPauseStore = false;

    if (mode === "manual" && Array.isArray(store.manualRules) && store.manualRules.length > 0) {
      // ── MODO MANUAL: Usar regras personalizadas ──
      const sorted = [...store.manualRules].sort((a, b) => (a.maxOrders || 0) - (b.maxOrders || 0));
      const matched = sorted.find(r => count <= r.maxOrders) || sorted[sorted.length - 1];
      if (matched) {
        recommendedMinutes = matched.minutes || 58;
        shouldPauseStore = !!matched.pause;
        etaRangeFormatted = shouldPauseStore ? "⚠️ PAUSAR LOJA" : `${recommendedMinutes} min`;
      }
    } else {
      // ── MODO AUTOMÁTICO: Tabela Hakim ──
      // 28m = ≤ 1*M | 38m = ≤ 2*M | 58m = ≤ 3*M | 78m = ≤ 4*M | > 4*M → PAUSAR
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

    // Salvar no storage (popup lê daqui)
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

      const tabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
      console.log(`[FireHub] 📤 Despachando pro iFood: ${recommendedMinutes} min | Tabs encontradas: ${tabs.length}`);

      if (tabs && tabs.length > 0) {
        for (const tab of tabs) {
          if (tab.id) {
            try {
              await chrome.tabs.sendMessage(tab.id, payload);
              console.log(`[FireHub] ✅ Mensagem enviada pra tab ${tab.id} (${tab.url?.substring(0, 50)})`);
            } catch (err) {
              console.warn(`[FireHub] ⚠️ Falha ao enviar pra tab ${tab.id}: ${err.message}. Reinjetando content script...`);
              // Reinjetar o content script e tentar de novo
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["scripts/content.js"]
                });
                // Esperar o script carregar
                await new Promise(r => setTimeout(r, 2000));
                await chrome.tabs.sendMessage(tab.id, payload);
                console.log(`[FireHub] ✅ Mensagem enviada após reinjeção na tab ${tab.id}`);
              } catch (e2) {
                console.error(`[FireHub] ❌ Falha total na tab ${tab.id}: ${e2.message}`);
              }
            }
          }
        }
      } else {
        // Se a aba do iFood não está aberta, abrir automaticamente
        console.log("[FireHub] 🚀 Nenhuma aba iFood aberta. Abrindo Portal iFood...");
        chrome.tabs.create({ url: "https://portal.ifood.com.br/merchant-delivery-core-portal-experience", active: false }, (newTab) => {
          if (newTab && newTab.id) {
            // Esperar página carregar + content script injetar
            setTimeout(() => {
              chrome.tabs.sendMessage(newTab.id, payload).catch((e) => {
                console.warn(`[FireHub] ⚠️ Falha ao enviar pra nova tab: ${e.message}`);
              });
            }, 8000);
          }
        });
      }
    } else {
      console.log(`[FireHub] ⏸️ Sync desativado, apenas salvando valores.`);
    }

  } catch (err) {
    console.warn("[FireHub calculateAndApply Error]", err);
  }
}

// ── ALARME: FALLBACK QUANDO O BRIDGE NÃO ESTÁ ATIVO ──
async function runSyncProcess() {
  try {
    // Se o bridge atualizou nos últimos 30 segundos, usa a contagem dele
    const bridgeIsActive = (Date.now() - bridgeLastUpdate) < 30000;

    if (bridgeIsActive) {
      console.log(`[FireHub Alarm] Bridge ativo (${bridgeCount} ped.), usando contagem do bridge.`);
      await calculateAndApply(bridgeCount);
      return;
    }

    // Bridge inativo → chamar API do servidor como fallback
    console.log("[FireHub Alarm] Bridge inativo, buscando contagem da API...");

    const store = await chrome.storage.local.get(["serverUrl", "motoboysCount", "activeMode", "manualRules", "authToken"]);
    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";

    const candidates = store.serverUrl
      ? [store.serverUrl, "http://localhost:3001", "http://localhost:3000", "https://firehub-site.vercel.app", "https://www.hakimriodasostras.com.br"]
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
      console.log(`[FireHub Alarm API] Em Produção=${data.ordersInProduction} | ${mode} → ${data.etaRangeFormatted}`);
      await calculateAndApply(data.ordersInProduction);
    }

  } catch (err) {
    console.error("[FireHub Alarm Error]", err);
  }
}
