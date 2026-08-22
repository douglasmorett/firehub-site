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
  const toggleAutoSync = document.getElementById("toggleAutoSync");
  const toggleManualSync = document.getElementById("toggleManualSync");
  const toggleSlider = document.getElementById("toggleSlider");
  const toggleDot = document.getElementById("toggleDot");
  const toggleManualSlider = document.getElementById("toggleManualSlider");
  const toggleManualDot = document.getElementById("toggleManualDot");

  const manualRulesListEl = document.getElementById("manualRulesList");
  const btnAddRule = document.getElementById("btnAddRule");
  const manualOrdersCountEl = document.getElementById("manualOrdersCount");
  const manualRecommendedEtaEl = document.getElementById("manualRecommendedEta");
  const manualRuleMatchedLabelEl = document.getElementById("manualRuleMatchedLabel");
  const manualResultBannerEl = document.getElementById("manualResultBanner");

  const lastSyncTextEl = document.getElementById("lastSyncText");
  const statusBadgeEl = document.getElementById("statusBadge");

  let activeMode = "auto";
  let count = 2;
  let authToken = null;
  let storeName = "FireHub";

  let manualRules = [
    { maxOrders: 3, minutes: 38 },
    { maxOrders: 6, minutes: 58 },
    { maxOrders: 9, minutes: 78 },
    { maxOrders: 15, minutes: 98 },
  ];

  let serverUrl = "https://firehubfood.com.br";

  async function apiFetchWithFallback(endpoint, options = {}) {
    let savedUrl = null;
    if (typeof chrome !== "undefined" && chrome.storage) {
      const store = await new Promise(r => chrome.storage.local.get(["serverUrl"], r));
      if (store && store.serverUrl) savedUrl = store.serverUrl;
    }

    // PRODUCAO E COOLIFY (firehubfood.com.br) e vem PRIMEIRO.
    // Antes esta lista comecava em localhost e caia no deploy zumbi da Vercel,
    // que continua no ar servindo contagem de outro ambiente — e o resultado
    // ainda era salvo em serverUrl, envenenando tambem o background.
    // hakimriodasostras.com.br saiu: hoje redireciona para app.jotaja.com.
    const candidates = savedUrl
      ? [savedUrl, "https://firehubfood.com.br", "http://localhost:3001", "http://localhost:3000"]
      : ["https://firehubfood.com.br", "http://localhost:3001", "http://localhost:3000"];

    const uniqueUrls = Array.from(new Set(candidates.map(u => u.replace(/\/$/, ""))));

    let lastError = null;

    for (const baseUrl of uniqueUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(`${baseUrl}${endpoint}`, {
          ...options,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json().catch(() => null);

        // 401 NAO e sucesso: tratar como servidor valido escondia sessao expirada
        // e o popup seguia exibindo numeros velhos sem avisar o lojista.
        if (res.ok || (data && data.success)) {
          if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.set({ serverUrl: baseUrl });
          }
          serverUrl = baseUrl;
          return { res, data, baseUrl };
        }
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Servidor indisponível");
  }

  // ── GERENCIADOR DE REGRAS MANUAIS ──
  function renderManualRules() {
    if (!manualRulesListEl) return;
    manualRulesListEl.innerHTML = "";

    manualRules.forEach((rule, idx) => {
      const row = document.createElement("div");
      row.className = "rule-row";
      row.style.cssText = "display: flex; gap: 4px; align-items: center; background: #0F172A; padding: 5px 8px; border-radius: 8px; border: 1px solid #334155;";

      row.innerHTML = `
        <span style="font-size: 0.65rem; color: #94A3B8; font-weight: 700;">Até</span>
        <input type="number" class="rule-max" data-idx="${idx}" value="${rule.maxOrders}" style="width: 46px; background: #1E293B; border: 1px solid #475569; color: #FFF; border-radius: 6px; font-size: 0.75rem; text-align: center; padding: 3px 4px; font-weight: 700;">
        <span style="font-size: 0.65rem; color: #94A3B8; font-weight: 700;">ped ➔</span>
        <input type="number" class="rule-min" data-idx="${idx}" value="${rule.minutes}" style="width: 50px; background: #1E293B; border: 1px solid #475569; color: #38BDF8; border-radius: 6px; font-size: 0.75rem; text-align: center; padding: 3px 4px; font-weight: 800;">
        <span style="font-size: 0.65rem; color: #94A3B8; font-weight: 700;">min</span>
        <button class="btn-del-rule" data-idx="${idx}" style="background: none; border: none; color: #EF4444; font-weight: 800; cursor: pointer; font-size: 0.8rem; margin-left: auto; padding: 2px 4px;">✕</button>
      `;

      manualRulesListEl.appendChild(row);
    });

    // Attach listeners
    manualRulesListEl.querySelectorAll(".rule-max").forEach(input => {
      input.addEventListener("change", (e) => {
        const idx = parseInt(e.target.getAttribute("data-idx"), 10);
        manualRules[idx].maxOrders = parseInt(e.target.value, 10) || 0;
        saveState();
        fetchData();
      });
    });

    manualRulesListEl.querySelectorAll(".rule-min").forEach(input => {
      input.addEventListener("change", (e) => {
        const idx = parseInt(e.target.getAttribute("data-idx"), 10);
        manualRules[idx].minutes = parseInt(e.target.value, 10) || 0;
        saveState();
        fetchData();
      });
    });

    manualRulesListEl.querySelectorAll(".btn-del-rule").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-idx"), 10);
        if (manualRules.length > 1) {
          manualRules.splice(idx, 1);
          renderManualRules();
          saveState();
          fetchData();
        }
      });
    });
  }

  if (btnAddRule) {
    btnAddRule.addEventListener("click", () => {
      const lastRule = manualRules[manualRules.length - 1] || { maxOrders: 5, minutes: 45 };
      manualRules.push({
        maxOrders: lastRule.maxOrders + 5,
        minutes: lastRule.minutes + 20,
      });
      renderManualRules();
      saveState();
      fetchData();
    });
  }

  // ── AUTENTICAÇÃO FIREHUB ──
  btnLogin.addEventListener("click", async () => {
    loginError.style.display = "none";
    btnLogin.textContent = "⏳ Verificando...";
    btnLogin.disabled = true;

    try {
      const email = loginEmailInput.value.trim();
      const password = loginPasswordInput.value.trim();

      const { res, data, baseUrl } = await apiFetchWithFallback("/api/store/extensao-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok && data && data.success) {
        authToken = data.token;
        storeName = data.storeName;

        if (typeof chrome !== "undefined" && chrome.storage) {
          chrome.storage.local.set({ authToken, storeName, userEmail: email, serverUrl: baseUrl });
        }

        showMainScreen();
      } else {
        loginError.textContent = "❌ " + (data?.error || "E-mail ou senha incorretos");
        loginError.style.display = "block";
      }
    } catch (err) {
      loginError.textContent = "❌ " + (err?.message || "Erro ao conectar ao FireHub");
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
    renderManualRules();
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
    fetchData();
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

  // Toggle Automático
  function updateToggleVisual(checkbox, slider, dot, isOn) {
    if (isOn) {
      slider.style.background = "#22C55E";
      dot.style.transform = "translateX(20px)";
    } else {
      slider.style.background = "#475569";
      dot.style.transform = "translateX(0)";
    }
  }

  toggleAutoSync.addEventListener("change", async () => {
    const isOn = toggleAutoSync.checked;
    updateToggleVisual(toggleAutoSync, toggleSlider, toggleDot, isOn);

    if (isOn) {
      // Desativar manual se ativar automático
      toggleManualSync.checked = false;
      updateToggleVisual(toggleManualSync, toggleManualSlider, toggleManualDot, false);
      chrome.storage.local.set({ autoSyncEnabled: true, manualSyncEnabled: false });
      // Trocar para aba automático
      activeMode = "auto";
      tabAutoBtn.classList.add("active");
      tabManualBtn.classList.remove("active");
      tabAutoContent.classList.add("active");
      tabManualContent.classList.remove("active");
      saveState();
      await fetchData(true);
    } else {
      chrome.storage.local.set({ autoSyncEnabled: false });
    }
  });

  toggleManualSync.addEventListener("change", async () => {
    const isOn = toggleManualSync.checked;
    updateToggleVisual(toggleManualSync, toggleManualSlider, toggleManualDot, isOn);

    if (isOn) {
      // Desativar automático se ativar manual
      toggleAutoSync.checked = false;
      updateToggleVisual(toggleAutoSync, toggleSlider, toggleDot, false);
      chrome.storage.local.set({ manualSyncEnabled: true, autoSyncEnabled: false });
      // Trocar para aba manual
      activeMode = "manual";
      tabManualBtn.classList.add("active");
      tabAutoBtn.classList.remove("active");
      tabManualContent.classList.add("active");
      tabAutoContent.classList.remove("active");
      saveState();
      await fetchData(true);
    } else {
      chrome.storage.local.set({ manualSyncEnabled: false });
    }
  });

  // Escutar alterações do armazenamento local (disparado pelo Bridge/Background em tempo real)
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (changes.ordersInProduction) {
          kdsOrdersEl.textContent = changes.ordersInProduction.newValue;
          if (manualOrdersCountEl) manualOrdersCountEl.textContent = changes.ordersInProduction.newValue;
        }
        if (changes.lastEtaFormatted) {
          recommendedEtaEl.textContent = changes.lastEtaFormatted.newValue;
          if (manualRecommendedEtaEl) manualRecommendedEtaEl.textContent = changes.lastEtaFormatted.newValue;
        }
        if (changes.recommendedMinutes) {
          const mins = changes.recommendedMinutes.newValue;
          currentRuleEl.textContent = `${mins} min`;
          currentRuleEl.style.color = "#38BDF8";
        }
        if (changes.shouldPauseStore) {
          if (changes.shouldPauseStore.newValue) {
            currentRuleEl.textContent = "ESTOURO";
            currentRuleEl.style.color = "#EF4444";
          }
        }
        if (changes.lastSyncTime) {
          const t = changes.lastSyncTime.newValue;
          lastSyncTextEl.textContent = `⚡ Ao vivo às ${t}`;
          // Atualizar badge do FireHub Site (bridge ativo)
          firehubSyncStatus.textContent = `🟢 ${t}`;
          firehubSyncStatus.style.color = "#34D399";
        }
        // Atualizar badge do Portal iFood
        if (changes.ifoodLastApply) {
          const t = changes.ifoodLastApply.newValue;
          ifoodSyncStatus.textContent = `🟢 ${t}`;
          ifoodSyncStatus.style.color = "#34D399";
        }
      }
    });
  }

  // Polling em tempo real (a cada 3 segundos enquanto o popup estiver aberto)
  setInterval(() => {
    if (authToken && mainScreen.style.display !== "none") {
      fetchData(false);
    }
  }, 3000);

  // Carregar Estado Salvo
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.get(["authToken", "storeName", "activeMode", "motoboysCount", "manualRules", "lastEtaFormatted", "lastSyncTime", "ordersInProduction", "recommendedMinutes", "shouldPauseStore"], (res) => {
      // IMPORTANTE: Carregar modo e motoboys ANTES de mostrar a tela (que chama fetchData)
      if (res.activeMode) activeMode = res.activeMode;
      if (res.motoboysCount) {
        count = res.motoboysCount;
        motoboysCountEl.textContent = count;
      }
      if (Array.isArray(res.manualRules) && res.manualRules.length > 0) {
        manualRules = res.manualRules;
      }

      // Atualizar aba ativa baseado no modo salvo
      if (activeMode === "manual") {
        tabManualBtn.classList.add("active");
        tabAutoBtn.classList.remove("active");
        tabManualContent.classList.add("active");
        tabAutoContent.classList.remove("active");
      } else {
        tabAutoBtn.classList.add("active");
        tabManualBtn.classList.remove("active");
        tabAutoContent.classList.add("active");
        tabManualContent.classList.remove("active");
      }

      if (res.authToken) {
        authToken = res.authToken;
        storeName = res.storeName || "Minha Loja";
        showMainScreen();
      } else {
        showLoginScreen();
      }

      if (typeof res.ordersInProduction === "number") {
        kdsOrdersEl.textContent = res.ordersInProduction;
        if (manualOrdersCountEl) manualOrdersCountEl.textContent = res.ordersInProduction;
      }

      // Atualizar Status Carga do storage
      if (typeof res.recommendedMinutes === "number" && res.recommendedMinutes > 0) {
        if (res.shouldPauseStore) {
          currentRuleEl.textContent = "ESTOURO";
          currentRuleEl.style.color = "#EF4444";
        } else {
          currentRuleEl.textContent = `${res.recommendedMinutes} min`;
          currentRuleEl.style.color = "#38BDF8";
        }
      }

      renderManualRules();

      // Restaurar estado dos toggles
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.get(["autoSyncEnabled", "manualSyncEnabled"], (toggleStore) => {
          if (toggleAutoSync && toggleStore.autoSyncEnabled) {
            toggleAutoSync.checked = true;
            updateToggleVisual(toggleAutoSync, toggleSlider, toggleDot, true);
          }
          if (toggleManualSync && toggleStore.manualSyncEnabled) {
            toggleManualSync.checked = true;
            updateToggleVisual(toggleManualSync, toggleManualSlider, toggleManualDot, true);
          }
        });
      }

      if (res.lastEtaFormatted) {
        recommendedEtaEl.textContent = res.lastEtaFormatted;
        if (manualRecommendedEtaEl) manualRecommendedEtaEl.textContent = res.lastEtaFormatted;
      }
      if (res.lastSyncTime) lastSyncTextEl.textContent = `⚡ Última sync: ${res.lastSyncTime}`;
    });
  } else {
    showLoginScreen();
  }

  function saveState() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({
        activeMode,
        motoboysCount: count,
        manualRules,
      });
    }
  }

  async function fetchData(triggerSync = false) {
    if (!authToken) return;

    try {
      let endpoint = `/api/store/dynamic-eta?mode=${activeMode}&motoboys=${count}&token=${authToken}`;

      if (activeMode === "manual") {
        const rulesJson = encodeURIComponent(JSON.stringify(manualRules));
        endpoint += `&rules=${rulesJson}`;
      }

      const { res, data } = await apiFetchWithFallback(endpoint);

      if (data && data.success) {
        kdsOrdersEl.textContent = data.ordersInProduction;
        recommendedEtaEl.textContent = data.etaRangeFormatted;

        if (manualOrdersCountEl) manualOrdersCountEl.textContent = data.ordersInProduction;
        if (manualRecommendedEtaEl) manualRecommendedEtaEl.textContent = data.etaRangeFormatted;
        if (manualRuleMatchedLabelEl) manualRuleMatchedLabelEl.textContent = data.matchedRuleLabel || `Aba Em Produção (${data.ordersInProduction} ped.)`;

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

        lastSyncTextEl.textContent = `✅ Atualizado às ${nowStr} (${data.ordersInProduction} ped. em produção)`;

        // Auto-dispatch se o toggle estiver ativo
        const autoOn = toggleAutoSync && toggleAutoSync.checked;
        const manualOn = toggleManualSync && toggleManualSync.checked;
        // Sem fallback fabricado: se o servidor nao mandou o valor, nao despacha
        // (o `|| 38` antigo empurrava 38 min pro iFood mesmo sem recomendacao).
        if ((triggerSync || autoOn || manualOn) && typeof data.recommendedMinutes === "number") {
          requestBackgroundSync(data.ordersInProduction);
        }
      }
    } catch (err) {
      console.warn("[FireHub Extension Popup]", err);
      firehubSyncStatus.textContent = `🔴 Erro`;
      firehubSyncStatus.style.color = "#FCA5A5";
    }
  }

  // O popup NAO despacha mais direto pro iFood.
  // Antes existiam DOIS despachantes concorrentes (popup e service worker) e o
  // do popup morria junto com o painel ao fechar — por isso o prazo so mudava
  // com a extensao aberta. Agora ha um unico despachante: o service worker,
  // que sobrevive ao popup fechado e nao sofre throttling de aba oculta.
  function requestBackgroundSync(count) {
    if (typeof chrome === "undefined" || !chrome.runtime) return;
    const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    chrome.runtime.sendMessage({ action: "FORCE_SYNC", count }, (resp) => {
      if (chrome.runtime.lastError) {
        ifoodSyncStatus.textContent = "🔴 SW indisponivel";
        ifoodSyncStatus.style.color = "#FCA5A5";
        return;
      }
      const r = resp && resp.result;
      if (r && r.ok) {
        ifoodSyncStatus.textContent = `🟢 ${nowStr}`;
        ifoodSyncStatus.style.color = "#34D399";
      } else if (r && r.reason === "histerese") {
        ifoodSyncStatus.textContent = `🟢 ${nowStr} (sem mudanca)`;
        ifoodSyncStatus.style.color = "#34D399";
      } else {
        ifoodSyncStatus.textContent = `🔴 ${(r && r.reason) || "falhou"}`;
        ifoodSyncStatus.style.color = "#FCA5A5";
      }
    });
  }
});
