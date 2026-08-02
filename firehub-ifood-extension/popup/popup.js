document.addEventListener("DOMContentLoaded", () => {
  const tabAutoBtn = document.getElementById("tabAutoBtn");
  const tabManualBtn = document.getElementById("tabManualBtn");
  const tabAutoContent = document.getElementById("tabAutoContent");
  const tabManualContent = document.getElementById("tabManualContent");

  const btnMinus = document.getElementById("btnMinus");
  const btnPlus = document.getElementById("btnPlus");
  const motoboysCountEl = document.getElementById("motoboysCount");
  const kdsOrdersEl = document.getElementById("kdsOrders");
  const currentRuleEl = document.getElementById("currentRule");
  const recommendedEtaEl = document.getElementById("recommendedEta");
  const btnSyncAuto = document.getElementById("btnSyncAuto");
  const btnSyncManual = document.getElementById("btnSyncManual");

  const manualOrdersInput = document.getElementById("manualOrdersInput");
  const manualMinutesInput = document.getElementById("manualMinutesInput");

  const lastSyncTextEl = document.getElementById("lastSyncText");
  const statusBadgeEl = document.getElementById("statusBadge");

  let activeMode = "auto";
  let count = 2;
  const serverUrl = "https://firehub-site.vercel.app";

  // Alternância de Abas
  tabAutoBtn.addEventListener("click", () => {
    activeMode = "auto";
    tabAutoBtn.classList.add("active");
    tabManualBtn.classList.remove("active");
    tabAutoContent.classList.add("active");
    tabManualContent.classList.remove("active");
    saveState();
    fetchData();
  });

  tabManualBtn.addEventListener("click", () => {
    activeMode = "manual";
    tabManualBtn.classList.add("active");
    tabAutoBtn.classList.remove("active");
    tabManualContent.classList.add("active");
    tabAutoContent.classList.remove("active");
    saveState();
  });

  // Controle de Motoboys
  btnMinus.addEventListener("click", () => {
    if (count > 1) {
      count--;
      motoboysCountEl.textContent = count;
      saveState();
      fetchData();
    }
  });

  btnPlus.addEventListener("click", () => {
    count++;
    motoboysCountEl.textContent = count;
    saveState();
    fetchData();
  });

  // Ações de Sincronização
  btnSyncAuto.addEventListener("click", async () => {
    btnSyncAuto.textContent = "⏳ Sincronizando...";
    btnSyncAuto.disabled = true;
    await fetchData(true);
    setTimeout(() => {
      btnSyncAuto.textContent = "⚡ Sincronizar Automático";
      btnSyncAuto.disabled = false;
    }, 1000);
  });

  btnSyncManual.addEventListener("click", async () => {
    btnSyncManual.textContent = "⏳ Aplicando...";
    btnSyncManual.disabled = true;

    const orders = manualOrdersInput.value || 15;
    const minutes = manualMinutesInput.value || 60;

    await sendManualSync(orders, minutes);

    setTimeout(() => {
      btnSyncManual.textContent = "⚡ Aplicar Tempo Manual";
      btnSyncManual.disabled = false;
    }, 1000);
  });

  // Carregar Estado Salvo
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.get(["activeMode", "motoboysCount", "manualOrders", "manualMinutes", "lastEtaFormatted", "lastSyncTime"], (res) => {
      if (res.activeMode) {
        activeMode = res.activeMode;
        if (activeMode === "manual") {
          tabManualBtn.click();
        }
      }
      if (res.motoboysCount) {
        count = res.motoboysCount;
        motoboysCountEl.textContent = count;
      }
      if (res.manualOrders) manualOrdersInput.value = res.manualOrders;
      if (res.manualMinutes) manualMinutesInput.value = res.manualMinutes;
      if (res.lastEtaFormatted) recommendedEtaEl.textContent = res.lastEtaFormatted;
      if (res.lastSyncTime) lastSyncTextEl.textContent = `✅ Última sync: ${res.lastSyncTime}`;

      fetchData();
    });
  } else {
    fetchData();
  }

  function saveState() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({
        activeMode,
        motoboysCount: count,
        manualOrders: manualOrdersInput.value,
        manualMinutes: manualMinutesInput.value,
      });
    }
  }

  async function fetchData(triggerSync = false) {
    try {
      const apiUrl = `${serverUrl}/api/store/dynamic-eta?mode=${activeMode}&motoboys=${count}`;
      const res = await fetch(apiUrl);
      const data = await res.json();

      if (data && data.success) {
        kdsOrdersEl.textContent = data.ordersInProduction;
        recommendedEtaEl.textContent = data.etaRangeFormatted;

        const resultBanner = document.getElementById("resultBanner");
        if (data.shouldPauseStore) {
          if (resultBanner) {
            resultBanner.style.background = "linear-gradient(135deg, #7F1D1D 0%, #450A0A 100%)";
            resultBanner.style.borderColor = "#EF4444";
          }
          recommendedEtaEl.style.color = "#FCA5A5";
          currentRuleEl.textContent = "ESTOURO";
          currentRuleEl.style.color = "#EF4444";
        } else {
          if (resultBanner) {
            resultBanner.style.background = "linear-gradient(135deg, #064E3B 0%, #022C22 100%)";
            resultBanner.style.borderColor = "#10B981";
          }
          recommendedEtaEl.style.color = "#34D399";
          currentRuleEl.textContent = `${data.recommendedMinutes} min`;
          currentRuleEl.style.color = "#38BDF8";
        }

        statusBadgeEl.textContent = "ONLINE";
        statusBadgeEl.style.background = "#064E3B";
        statusBadgeEl.style.color = "#34D399";

        const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        lastSyncTextEl.textContent = `✅ Atualizado às ${nowStr} (${data.ordersInProduction} ped. / ${count} motoboys)`;

        if (triggerSync) {
          dispatchToIfood(data.recommendedMinutes || 38, data.recommendedMinutes || 38, data.etaRangeFormatted, data.shouldPauseStore);
        }
      }
    } catch (err) {
      console.warn("[FireHub Extension Popup]", err);
      statusBadgeEl.textContent = "OFFLINE";
      statusBadgeEl.style.background = "#7F1D1D";
      statusBadgeEl.style.color = "#FCA5A5";
    }
  }

  async function sendManualSync(orders, minutes) {
    const minutesNum = parseInt(minutes, 10);
    const minMin = Math.max(15, minutesNum - 5);
    const maxMin = minutesNum + 10;
    const formatted = `${minutesNum} min`;

    const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    lastSyncTextEl.textContent = `✅ Modo Manual Aplicado às ${nowStr} (${minutesNum} min)`;

    dispatchToIfood(minMin, maxMin, formatted);
  }

  function dispatchToIfood(minMin, maxMin, formatted) {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ url: "https://*.ifood.com.br/*" }, (tabs) => {
        if (tabs && tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "SET_DELIVERY_TIME",
            minMinutes: minMin,
            maxMinutes: maxMin,
            formatted,
            mode: activeMode,
          });
        }
      });
    }
  }
});
