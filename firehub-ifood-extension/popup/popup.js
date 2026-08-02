document.addEventListener("DOMContentLoaded", () => {
  const btnMinus = document.getElementById("btnMinus");
  const btnPlus = document.getElementById("btnPlus");
  const motoboysCountEl = document.getElementById("motoboysCount");
  const kdsOrdersEl = document.getElementById("kdsOrders");
  const currentRuleEl = document.getElementById("currentRule");
  const recommendedEtaEl = document.getElementById("recommendedEta");
  const btnSync = document.getElementById("btnSync");
  const serverUrlEl = document.getElementById("serverUrl");
  const lastSyncTextEl = document.getElementById("lastSyncText");
  const statusBadgeEl = document.getElementById("statusBadge");

  let count = 2;

  // Carregar dados salvos no chrome.storage
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.get(["motoboysCount", "serverUrl", "lastEtaFormatted", "lastSyncTime"], (res) => {
      if (res.motoboysCount) {
        count = res.motoboysCount;
        motoboysCountEl.textContent = count;
      }
      if (res.serverUrl) {
        serverUrlEl.value = res.serverUrl;
      }
      if (res.lastEtaFormatted) {
        recommendedEtaEl.textContent = res.lastEtaFormatted;
      }
      if (res.lastSyncTime) {
        lastSyncTextEl.textContent = `✅ Última sync: ${res.lastSyncTime}`;
      }
      fetchData();
    });
  } else {
    fetchData();
  }

  btnMinus.addEventListener("click", () => {
    if (count > 1) {
      count--;
      motoboysCountEl.textContent = count;
      saveMotoboys();
      fetchData();
    }
  });

  btnPlus.addEventListener("click", () => {
    count++;
    motoboysCountEl.textContent = count;
    saveMotoboys();
    fetchData();
  });

  serverUrlEl.addEventListener("change", () => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ serverUrl: serverUrlEl.value.trim() });
    }
    fetchData();
  });

  btnSync.addEventListener("click", async () => {
    btnSync.textContent = "⏳ Sincronizando...";
    btnSync.disabled = true;

    await fetchData(true);

    setTimeout(() => {
      btnSync.textContent = "⚡ Sincronizar Agora no iFood";
      btnSync.disabled = false;
    }, 1200);
  });

  function saveMotoboys() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ motoboysCount: count });
    }
  }

  async function fetchData(triggerIFoodSync = false) {
    try {
      const baseUrl = (serverUrlEl.value || "https://firehub-site.vercel.app").replace(/\/$/, "");
      const apiUrl = `${baseUrl}/api/store/dynamic-eta?motoboys=${count}`;

      const res = await fetch(apiUrl);
      const data = await res.json();

      if (data && data.success) {
        kdsOrdersEl.textContent = data.ordersInProduction;
        recommendedEtaEl.textContent = data.etaRangeFormatted;

        const ruleShort = data.ordersInProduction <= 6 ? "Leve"
          : data.ordersInProduction <= 12 ? "Moderada"
          : data.ordersInProduction <= 20 ? "Movimentada"
          : "Pico";
        currentRuleEl.textContent = ruleShort;
        statusBadgeEl.textContent = "ONLINE";
        statusBadgeEl.style.background = "#064E3B";
        statusBadgeEl.style.color = "#34D399";

        const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        lastSyncTextEl.textContent = `✅ Atualizado às ${nowStr} (${data.ordersInProduction} ped. / ${count} motoboys)`;

        if (typeof chrome !== "undefined" && chrome.storage) {
          chrome.storage.local.set({
            lastEtaFormatted: data.etaRangeFormatted,
            lastSyncTime: nowStr,
            ordersInProduction: data.ordersInProduction,
            minMinutes: data.recommendedEtaMin,
            maxMinutes: data.recommendedEtaMax,
          });
        }

        if (triggerIFoodSync) {
          // Enviar mensagem para a aba ativa do portal.ifood.com.br
          if (typeof chrome !== "undefined" && chrome.tabs) {
            chrome.tabs.query({ url: "https://*.ifood.com.br/*" }, (tabs) => {
              if (tabs && tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, {
                  action: "SET_DELIVERY_TIME",
                  minMinutes: data.recommendedEtaMin,
                  maxMinutes: data.recommendedEtaMax,
                  formatted: data.etaRangeFormatted,
                });
              }
            });
          }
        }
      }
    } catch (err) {
      console.warn("[FireHub Extension Popup]", err);
      statusBadgeEl.textContent = "OFFLINE";
      statusBadgeEl.style.background = "#7F1D1D";
      statusBadgeEl.style.color = "#FCA5A5";
    }
  }
});
