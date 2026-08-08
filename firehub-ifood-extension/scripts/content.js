/**
 * FireHub Chrome Extension — Content Script no Portal do Parceiro iFood
 * 
 * Funcionalidades:
 * 1. Exibe pílula flutuante no canto da tela com status do ETA
 * 2. AUTOMATICAMENTE ajusta o prazo em segundo plano usando os botões "+ 5 min" / "- 5 min" e "Salvar"
 * 3. Detecta quando a sessão do iFood é encerrada/desconectada e notifica o FireHub para exibir o aviso sem abrir abas duplicadas.
 */

console.log("[FireHub Extension] 🍕 Script carregado no Portal do Parceiro iFood!");

// ── ESTADO ──
let lastAppliedETA = null;
let isApplying = false;

// ── INICIALIZAÇÃO ──
createFloatingCornerPill();
checkDisconnectionStatus();

// Verificar se a sessão expirou
function checkDisconnectionStatus() {
  const href = window.location.href.toLowerCase();
  const isLoginPage = href.includes("login") || href.includes("auth") || href.includes("signin");
  const hasPasswordInput = !!document.querySelector('input[type="password"], input[name="email"]');
  const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
  const hasDisconnectText = bodyText.includes("fazer login") || bodyText.includes("sessão expirou") || bodyText.includes("entre com sua conta");

  if ((isLoginPage || (hasPasswordInput && hasDisconnectText)) && !isOnDeliverySettingsPage()) {
    console.warn("[FireHub] ⚠️ iFood Desconectado / Tela de Login detectada!");
    chrome.storage.local.set({ ifoodDisconnected: true });
    chrome.runtime.sendMessage({ action: "IFOOD_SESSION_DISCONNECTED", reason: "Sessão expirada no Portal iFood" }).catch(() => {});
    updatePillStatus("🔴 iFood Desconectado - Faça Login!", true);
    return true;
  } else if (isOnDeliverySettingsPage()) {
    chrome.storage.local.set({ ifoodDisconnected: false });
    chrome.runtime.sendMessage({ action: "IFOOD_SESSION_CONNECTED" }).catch(() => {});
  }
  return false;
}

// Ao carregar a página, verificar se existe um ETA pendente para aplicar
chrome.storage.local.get(["pendingETA", "lastAppliedETA"], (store) => {
  lastAppliedETA = store.lastAppliedETA || null;

  if (store.pendingETA && isOnDeliverySettingsPage()) {
    console.log(`[FireHub] 🎯 ETA pendente encontrado: ${store.pendingETA} min. Aplicando em 3s...`);
    setTimeout(() => {
      applyETAOnSettingsPage(store.pendingETA);
      chrome.storage.local.remove(["pendingETA"]);
    }, 3000);
  }
});

// Monitorar navegação na página para pegar logout
setInterval(checkDisconnectionStatus, 8000);

// ── RECEPTOR DE MENSAGENS ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SET_DELIVERY_TIME") {
    if (checkDisconnectionStatus()) {
      sendResponse({ success: false, reason: "disconnected" });
      return;
    }

    const targetMin = request.minMinutes || 38;
    console.log(`[FireHub Auto-ETA] ⏱️ Recebido: ${request.formatted} (${targetMin} min) | Modo: ${request.mode}`);

    updateFloatingPill(request.formatted, request.mode, request.shouldPause);

    if (request.shouldPause) {
      console.log("[FireHub] ⚠️ shouldPause=true → Não aplicando, só exibindo alerta.");
      sendResponse({ success: true, applied: false, reason: "shouldPause" });
      return;
    }

    handleETAUpdate(targetMin);
    sendResponse({ success: true, applied: true });
  }

  if (request.action === "RESET_APPLIED_ETA") {
    lastAppliedETA = null;
    console.log("[FireHub] 🔄 lastAppliedETA resetado!");
    sendResponse({ success: true });
  }
});

// ── HELPERS ──

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isOnDeliverySettingsPage() {
  return window.location.href.includes("merchant-delivery-core-portal-experience");
}

// ── FLUXO PRINCIPAL ──

let lastApplyTime = 0;

async function handleETAUpdate(targetMinutes) {
  if (isApplying) {
    console.log("[FireHub] ⏳ Já está aplicando, ignorando esta requisição.");
    return;
  }

  const now = Date.now();
  const targetChanged = lastAppliedETA !== targetMinutes;
  const cooldownPassed = (now - lastApplyTime) > 60000; // 60s cooldown

  if (!targetChanged && !cooldownPassed) {
    return;
  }

  lastApplyTime = now;

  if (isOnDeliverySettingsPage()) {
    console.log(`[FireHub] 📍 Aplicando ${targetMinutes} min no iFood em segundo plano...`);
    await sleep(1000);
    await applyETAOnSettingsPage(targetMinutes);
  } else {
    // NÃO redirecionar esta aba se for gestor de pedidos! Sollicita ao background
    console.log("[FireHub] 📌 Não estamos na tela de configurações. Solicitando ao background...");
    chrome.storage.local.set({ pendingETA: targetMinutes });
    chrome.runtime.sendMessage({
      action: "OPEN_DELIVERY_SETTINGS",
      targetMinutes: targetMinutes
    }).catch(() => {});
  }
}

// ── AUTOMAÇÃO NA PÁGINA DE CONFIGURAÇÕES ──

async function applyETAOnSettingsPage(targetMinutes) {
  if (isApplying) return;
  isApplying = true;

  try {
    console.log(`[FireHub] 🎯 Alvo: ${targetMinutes} min`);
    updatePillStatus(`⏳ Ajustando para ${targetMinutes} min...`, false);

    // 1. Garantir que estamos na aba "Operação atual"
    await clickOperacaoAtualTab();
    await sleep(1500);

    // 2. Encontrar os inputs de tempo
    let timeInputs = findTimeInputs();

    if (timeInputs.length === 0) {
      await sleep(2500);
      timeInputs = findTimeInputs();
    }

    if (timeInputs.length === 0) {
      console.warn("[FireHub] ❌ Nenhum input de tempo encontrado na página!");
      updatePillStatus("❌ Campos de tempo não encontrados", true);
      return;
    }

    // 3. Ler o valor máximo atual
    const currentValues = timeInputs.map(i => parseInt(i.value) || 0).filter(v => v > 0);
    const currentMax = Math.max(...currentValues);

    console.log(`[FireHub] 📊 Tempos atuais: [${currentValues.join(", ")}] | Máximo: ${currentMax} min`);

    if (currentMax === 0) {
      updatePillStatus("❌ Valores não legíveis", true);
      return;
    }

    // 4. Calcular diferença
    const delta = targetMinutes - currentMax;

    if (Math.abs(delta) < 3) {
      console.log(`[FireHub] ✅ Prazo já está em ${currentMax} min (alvo: ${targetMinutes}). OK!`);
      lastAppliedETA = targetMinutes;
      chrome.storage.local.set({ lastAppliedETA: targetMinutes });
      updatePillStatus(`✅ ${currentMax} min (OK)`, false);
      return;
    }

    // 5. Usar botões "+ 5 min" / "- 5 min"
    const isIncrease = delta > 0;
    const clicksNeeded = Math.max(1, Math.round(Math.abs(delta) / 5));

    console.log(`[FireHub] 🔧 Delta: ${delta > 0 ? "+" : ""}${delta} min → ${clicksNeeded} cliques em "${isIncrease ? "+ 5 min" : "- 5 min"}"`);

    const adjustBtn = findAdjustButton(isIncrease);

    if (adjustBtn) {
      for (let i = 0; i < clicksNeeded; i++) {
        adjustBtn.click();
        await sleep(300);
      }

      await sleep(1000);

      // 6. Clicar em "Salvar"
      await clickSalvar(targetMinutes, currentMax);

    } else {
      console.log("[FireHub] ⚠️ Botões +/- 5 min não encontrados. Editando inputs diretamente...");
      await directInputEdit(timeInputs, targetMinutes, currentMax);
    }

  } catch (err) {
    console.error("[FireHub] ❌ Erro ao aplicar ETA:", err);
    updatePillStatus("❌ Erro ao aplicar", true);
  } finally {
    isApplying = false;
  }
}

// ── LOCALIZAR ELEMENTOS NO DOM DO IFOOD ──

function findTimeInputs() {
  const allInputs = Array.from(document.querySelectorAll("input"));

  return allInputs.filter(input => {
    const rawVal = (input.value || "").trim();
    if (rawVal.includes(",") || rawVal.includes(".")) return false;

    const numVal = parseInt(rawVal);
    if (isNaN(numVal) || numVal < 5 || numVal > 500) return false;

    let next = input.nextElementSibling;
    while (next) {
      const txt = (next.textContent || "").trim().toLowerCase();
      if (txt === "min" || txt.includes("min")) return true;
      if (txt.includes("r$") || txt.includes("taxa")) return false;
      next = next.nextElementSibling;
    }

    const parent = input.parentElement;
    if (parent) {
      const parentText = parent.textContent || "";
      if (parentText.includes("min") && !parentText.includes("R$")) return true;
      
      const parentNext = parent.nextElementSibling;
      if (parentNext && (parentNext.textContent || "").trim().toLowerCase().includes("min")) return true;
    }

    const container = input.closest("tr, [class*='row'], [class*='Row']") || input.parentElement?.parentElement;
    if (container) {
      const containerText = container.textContent || "";
      if (containerText.includes("min") && !containerText.includes("R$")) {
        const prevSibling = input.previousElementSibling;
        if (prevSibling && (prevSibling.textContent || "").includes("R$")) return false;
        return true;
      }
    }

    return false;
  });
}

function findAdjustButton(isIncrease) {
  if (isIncrease) {
    const ariaBtn = document.querySelector('button[aria-label="add 5 min"]');
    if (ariaBtn) return ariaBtn;
  } else {
    const ariaBtn = document.querySelector('button[aria-label="subtract 5 min"]');
    if (ariaBtn) return ariaBtn;
  }

  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.find(btn => {
    const text = btn.textContent.trim();
    if (!text.includes("5") || !text.toLowerCase().includes("min")) return false;
    if (isIncrease) {
      return text.includes("+");
    } else {
      return text.includes("-") || text.includes("–") || text.includes("—");
    }
  });
}

async function clickOperacaoAtualTab() {
  const tabs = Array.from(document.querySelectorAll("button, a, [role='tab'], span"));
  const opTab = tabs.find(el => {
    const txt = (el.textContent || "").trim().toLowerCase();
    return txt.includes("operação atual") || txt.includes("operacao atual");
  });

  if (opTab) {
    const isActive = opTab.classList.contains("active") ||
      opTab.getAttribute("aria-selected") === "true" ||
      (opTab.style && opTab.style.borderBottom);

    if (!isActive) {
      opTab.click();
      await sleep(1000);
    }
  }
}

async function clickSalvar(targetMinutes, actualMax = null) {
  const displayVal = actualMax || targetMinutes;

  let salvarBtn = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const allButtons = Array.from(document.querySelectorAll("button"));
    const candidates = allButtons.filter(btn => {
      const text = (btn.textContent || "").trim();
      return text === "Salvar" || text.toLowerCase() === "salvar";
    });

    const enabledBtn = candidates.find(btn => !btn.disabled);
    if (enabledBtn) {
      salvarBtn = enabledBtn;
      break;
    }
    if (candidates.length > 0) {
      salvarBtn = candidates[0];
    }
    await sleep(800);
  }

  if (salvarBtn) {
    if (!document.hidden) {
      salvarBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(300);
    }

    if (salvarBtn.disabled) {
      salvarBtn.disabled = false;
      salvarBtn.removeAttribute("disabled");
    }

    salvarBtn.click();
    await sleep(2000);

    const postSaveInputs = findTimeInputs();
    const postSaveValues = postSaveInputs.map(i => parseInt(i.value) || 0).filter(v => v > 0);
    const postSaveMax = postSaveValues.length > 0 ? Math.max(...postSaveValues) : actualMax || targetMinutes;

    console.log(`[FireHub] ✅ SALVO! Final: ${postSaveMax} min (alvo: ${targetMinutes})`);
    updatePillStatus(`✅ ${postSaveMax} min SALVO!`, false);

    lastAppliedETA = targetMinutes;
    const nowStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    chrome.storage.local.set({ lastAppliedETA: targetMinutes, ifoodLastApply: nowStr });
  } else {
    updatePillStatus(`⚠️ ${displayVal} min (Salvar não achado)`, true);
  }
}

async function directInputEdit(timeInputs, targetMinutes, currentMax) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, "value"
  ).set;

  const delta = targetMinutes - currentMax;

  for (const input of timeInputs) {
    const currentVal = parseInt(input.value) || 0;
    if (currentVal <= 0) continue;

    const newVal = Math.max(10, currentVal + delta);

    input.focus();
    await sleep(50);
    nativeInputValueSetter.call(input, String(newVal));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();

    await sleep(200);
  }

  await sleep(800);
  await clickSalvar(targetMinutes);
}

// ── PÍLULA FLUTUANTE ──

function createFloatingCornerPill() {
  if (document.getElementById("firehub-corner-pill")) return;

  const pill = document.createElement("div");
  pill.id = "firehub-corner-pill";
  pill.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
    color: #FFF; border: 1.5px solid #FF5722; border-radius: 20px;
    padding: 6px 14px; box-shadow: 0 8px 20px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px; font-weight: 800;
    display: flex; align-items: center; gap: 8px;
    cursor: pointer; user-select: none; transition: all 0.3s;
  `;

  pill.innerHTML = `
    <span style="font-size: 14px;">🔥</span>
    <span id="firehub-pill-text">FireHub: Auto-ETA Ativo</span>
    <span id="firehub-pill-toggle" style="background: #334155; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; margin-left: 4px;">—</span>
  `;

  let isCollapsed = false;
  pill.addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    const textEl = document.getElementById("firehub-pill-text");
    const toggleEl = document.getElementById("firehub-pill-toggle");
    if (isCollapsed) {
      if (textEl) textEl.style.display = "none";
      if (toggleEl) toggleEl.textContent = "+";
      pill.style.padding = "6px 10px";
    } else {
      if (textEl) textEl.style.display = "inline";
      if (toggleEl) toggleEl.textContent = "—";
      pill.style.padding = "6px 14px";
    }
  });

  document.body.appendChild(pill);
}

function updateFloatingPill(formattedStr, mode = "auto", shouldPause = false) {
  const pill = document.getElementById("firehub-corner-pill");
  const textEl = document.getElementById("firehub-pill-text");

  if (textEl) {
    const badgeStr = mode === "manual" ? "✍️ Manual" : "🤖 Auto";
    textEl.textContent = `FireHub: ${formattedStr} (${badgeStr})`;
  }

  if (pill) {
    if (shouldPause) {
      pill.style.background = "linear-gradient(135deg, #7F1D1D 0%, #450A0A 100%)";
      pill.style.border = "1.5px solid #EF4444";
      pill.style.color = "#FCA5A5";
    } else {
      pill.style.background = "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)";
      pill.style.border = "1.5px solid #FF5722";
      pill.style.color = "#FFF";
    }
  }
}

function updatePillStatus(statusText, isError = false) {
  const textEl = document.getElementById("firehub-pill-text");
  if (textEl) {
    textEl.textContent = `FireHub: ${statusText}`;
  }
  const pill = document.getElementById("firehub-corner-pill");
  if (pill) {
    if (isError) {
      pill.style.border = "1.5px solid #EF4444";
    } else {
      pill.style.border = "1.5px solid #22C55E";
    }
    setTimeout(() => {
      if (pill) {
        pill.style.border = "1.5px solid #FF5722";
      }
    }, 8000);
  }
}
