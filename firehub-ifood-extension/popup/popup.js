document.addEventListener("DOMContentLoaded", () => {
  const loginScreen = document.getElementById("loginScreen");
  const mainScreen = document.getElementById("mainScreen");
  const loginEmailInput = document.getElementById("loginEmail");
  const loginPasswordInput = document.getElementById("loginPassword");
  const btnLogin = document.getElementById("btnLogin");
  const loginError = document.getElementById("loginError");
  const btnLogout = document.getElementById("btnLogout");

  const headerTitle = document.getElementById("headerTitle");
  const headerSub = document.getElementById("headerSub");
  const firehubSyncStatus = document.getElementById("firehubSyncStatus");
  const ifoodSyncStatus = document.getElementById("ifoodSyncStatus");

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
  let authToken = null;
  let storeName = "FireHub";

  const serverUrl = "https://firehub-site.vercel.app";

  // ── AUTENTICAÇÃO FIREHUB ──
  btnLogin.addEventListener("click", async () => {
    loginError.style.display = "none";
    btnLogin.textContent = "⏳ Verificando...";
    btnLogin.disabled = true;

    try {
      const email = loginEmailInput.value.trim();
      const password = loginPasswordInput.value.trim();

      const res = await fetch(`${serverUrl}/api/store/extensao-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        authToken = data.token;
        storeName = data.storeName;

        if (typeof chrome !== "undefined" && chrome.storage) {
          chrome.storage.local.set({ authToken, storeName, userEmail: email });
        }

        showMainScreen();
      } else {
        loginError.textContent = "❌ " + (data.error || "Login inválido");
        loginError.style.display = "block";
      }
    } catch (err) {
      loginError.textContent = "❌ Erro ao conectar ao FireHub";
      loginError.style.display = "block";
    } finally {
      btnLogin.textContent = "🔑 Entrar e Conectar Loja";
      btnLogin.disabled = false;
    }
  });

  btnLogout.addEventListener("click", () => {
    authToken = null;
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.remove(["authToken", "storeName"]);
    }
    showLoginScreen();
  });

  // ── ATUALIZAÇÃO DE TELAS ──
  function showLoginScreen() {
    loginScreen.style.display = "block";
    mainScreen.style.display = "none";
    headerTitle.textContent = "FireHub iFood";
    headerSub.textContent = "AUTENTICAÇÃO";
    statusBadgeEl.textContent = "DESCONECTADO";
    statusBadgeEl.style.background = "#7F1D1D";
    statusBadgeEl.style.color = "#FCA5A5";
  }

  function showMainScreen() {
    loginScreen.style.display = "none";
    mainScreen.style.display = "block";
    headerTitle.textContent = storeName;
    headerSub.textContent = "CONECTADO AO FIREHUB";
    fetchData();
  }

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
    const minutes = manualMinutesInput.value || 58;

    await sendManualSync(orders, minutes);

    setTimeout(() => {
      btnSyncManual.textContent = "⚡ Aplicar Tempo Manual";
      btnSyncManual.disabled = false;
    }, 1000);
  });

  // Carregar Estado Salvo
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.get(["authToken", "storeName", "activeMode", "motoboysCount", "manualOrders", "manualMinutes", "lastEtaFormatted", "lastSyncTime"], (res) => {
      if (res.authToken) {
        authToken = res.authToken;
        storeName = res.storeName || "Minha Loja";
        showMainScreen();
      } else {
        showLoginScreen();
      }

      if (res.activeMode) activeMode = res.activeMode;
      if (res.motoboysCount) {
        count = res.motoboysCount;
        motoboysCountEl.textContent = count;
      }
      if (res.manualOrders) manualOrdersInput.value = res.manualOrders;
      if (res.manualMinutes) manualMinutesInput.value = res.manualMinutes;
      if (res.lastEtaFormatted) recommendedEtaEl.textContent = res.lastEtaFormatted;
      if (res.lastSyncTime) lastSyncTextEl.textContent = `✅ Última sync: ${res.lastSyncTime}`;
    });
  } else {
    showLoginScreen();
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
    if (!authToken) return;

    try {
      const apiUrl = `${serverUrl}/api/store/dynamic-eta?mode=${activeMode}&motoboys=${count}&token=${authToken}`;
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
        firehubSyncStatus.textContent = `🟢 ${nowStr}`;
        firehubSyncStatus.style.color = "#34D399";

        lastSyncTextEl.textContent = `✅ Atualizado às ${nowStr} (${data.ordersInProduction} ped. / ${count} motoboys)`;

        if (triggerSync) {
          dispatchToIfood(data.recommendedMinutes || 38, data.recommendedMinutes || 38, data.etaRangeFormatted, data.shouldPauseStore);
        }
      }
    } catch (err) {
      console.warn("[FireHub Extension Popup]", err);
      firehubSyncStatus.textContent = `🔴 Erro`;
      firehubSyncStatus.style.color = "#FCA5A5";
    }
  }

  async function sendManualSync(orders, minutes) {
    const minutesNum = parseInt(minutes, 10);
    const minMin = Math.max(15, minutesNum - 5);
    const maxMin = minutesNum + 10;
    const formatted = `${minutesNum} min`;

    const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    firehubSyncStatus.textContent = `🟢 ${nowStr}`;
    lastSyncTextEl.textContent = `✅ Modo Manual Aplicado às ${nowStr} (${minutesNum} min)`;

    dispatchToIfood(minMin, maxMin, formatted);
  }

  function dispatchToIfood(minMin, maxMin, formatted, shouldPause = false) {
    const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ url: "https://*.ifood.com.br/*" }, (tabs) => {
        if (tabs && tabs.length > 0) {
          ifoodSyncStatus.textContent = `🟢 ${nowStr}`;
          ifoodSyncStatus.style.color = "#34D399";

          chrome.tabs.sendMessage(tabs[0].id, {
            action: "SET_DELIVERY_TIME",
            minMinutes: minMin,
            maxMinutes: maxMin,
            formatted,
            mode: activeMode,
            shouldPause,
          });
        } else {
          ifoodSyncStatus.textContent = `🔴 Abrindo...`;
          ifoodSyncStatus.style.color = "#FCA5A5";

          chrome.tabs.create({ url: "https://portal.ifood.com.br/", active: false }, (newTab) => {
            if (newTab && newTab.id) {
              setTimeout(() => {
                ifoodSyncStatus.textContent = `🟢 ${nowStr}`;
                ifoodSyncStatus.style.color = "#34D399";
                chrome.tabs.sendMessage(newTab.id, {
                  action: "SET_DELIVERY_TIME",
                  minMinutes: minMin,
                  maxMinutes: maxMin,
                  formatted,
                  mode: activeMode,
                  shouldPause,
                }).catch(() => {});
              }, 6000);
            }
          });
        }
      });
    }
  }
});
