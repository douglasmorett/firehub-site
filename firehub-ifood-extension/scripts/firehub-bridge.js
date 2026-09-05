/**
 * FireHub Chrome Extension — Bridge Content Script
 * Injetado nas páginas do FireHub (firehubfood.com.br / firehub.com.br / localhost)
 * 
 * Funcionalidades:
 * 1. Lê o contador exato da coluna 'Em Produção' a cada 2 segundos e envia pro background em tempo real.
 * 2. Exibe alerta elegante na tela do FireHub quando o portal do iFood for desconectado, com botão de reconexão direta (sem criar abas duplicadas).
 * 3. Marca a presença da extensão no DOM para a página /store/extensao-ifood saber que já está instalada.
 */

console.log("[FireHub Extension Bridge] ⚡ Conectado ao painel do FireHub em tempo real!");

// ── PRESENÇA DA EXTENSÃO ──
// O painel usa este atributo para trocar o botão "Instalar" por "Instalada".
// Content script vive em mundo isolado, mas o DOM e os eventos são os mesmos.
function anunciarPresenca() {
  try {
    const versao = chrome.runtime.getManifest().version;
    document.documentElement.setAttribute("data-firehub-extension", versao);
    window.dispatchEvent(new CustomEvent("firehub-extension-ready", { detail: { versao } }));
  } catch (e) {}
}

anunciarPresenca();
document.addEventListener("DOMContentLoaded", anunciarPresenca);
// A página é SPA: se o React recriar o <html>, o atributo volta no próximo tick.
setInterval(anunciarPresenca, 3000);

let lastEmProducaoCount = -1;
let lastSentTime = 0;
let consecutiveFailures = 0;

function notifyCount(count, source) {
  consecutiveFailures = 0;
  const now = Date.now();
  const changed = count !== lastEmProducaoCount;
  const heartbeatDue = (now - lastSentTime) > 10000;

  if (!changed && !heartbeatDue) return;

  if (changed) {
    console.log(`[FireHub Bridge] 🚀 MUDOU: ${lastEmProducaoCount} → ${count} (${source})`);
  }

  lastEmProducaoCount = count;
  lastSentTime = now;

  // Atualiza a pílula local imediatamente com a contagem atual do DOM!
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["lastEtaFormatted", "activeMode", "shouldPauseStore"], (res) => {
      const etaStr = (res && res.lastEtaFormatted) ? res.lastEtaFormatted : "38 min";
      updateFloatingPill(etaStr, count, res?.activeMode || "auto", !!res?.shouldPauseStore);
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      action: "FIREHUB_LIVE_COUNT",
      count: count,
      source: source
    }).catch(() => {});
  }
}

// ── PÍLULA FLUTUANTE ARRASTÁVEL NO FIREHUB ──

function makePillDraggable(pill, storageKey = "firehubPillPos") {
  let isDragging = false;
  let hasMoved = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  const applyPos = (pos) => {
    if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
      const maxLeft = Math.max(10, window.innerWidth - (pill.offsetWidth || 180) - 10);
      const maxTop = Math.max(10, window.innerHeight - (pill.offsetHeight || 36) - 10);
      const left = Math.max(10, Math.min(maxLeft, pos.left));
      const top = Math.max(10, Math.min(maxTop, pos.top));
      pill.style.left = `${left}px`;
      pill.style.top = `${top}px`;
      pill.style.bottom = "auto";
      pill.style.right = "auto";
    }
  };

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([storageKey], (res) => {
      if (res && res[storageKey]) applyPos(res[storageKey]);
    });
  } else {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) applyPos(JSON.parse(saved));
    } catch (e) {}
  }

  const startDrag = (e) => {
    if (e.type === "mousedown" && e.button !== 0) return;
    isDragging = true;
    hasMoved = false;

    const clientX = e.type.startsWith("touch") ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith("touch") ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;

    const rect = pill.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    pill.style.cursor = "grabbing";
    pill.style.bottom = "auto";
    pill.style.right = "auto";
    pill.style.left = `${initialLeft}px`;
    pill.style.top = `${initialTop}px`;
    pill.style.transition = "none";
  };

  const doDrag = (e) => {
    if (!isDragging) return;
    const clientX = e.type.startsWith("touch") ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith("touch") ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      hasMoved = true;
    }

    const width = pill.offsetWidth || 180;
    const height = pill.offsetHeight || 36;
    const newLeft = Math.max(10, Math.min(window.innerWidth - width - 10, initialLeft + deltaX));
    const newTop = Math.max(10, Math.min(window.innerHeight - height - 10, initialTop + deltaY));

    pill.style.left = `${newLeft}px`;
    pill.style.top = `${newTop}px`;
  };

  const stopDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    pill.style.cursor = "grab";
    pill.style.transition = "background 0.3s, border 0.3s, box-shadow 0.3s";

    if (hasMoved) {
      const rect = pill.getBoundingClientRect();
      const pos = { left: rect.left, top: rect.top };
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [storageKey]: pos });
      }
      try { localStorage.setItem(storageKey, JSON.stringify(pos)); } catch (e) {}
    }
  };

  pill.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", doDrag);
  window.addEventListener("mouseup", stopDrag);

  pill.addEventListener("touchstart", startDrag, { passive: true });
  window.addEventListener("touchmove", doDrag, { passive: true });
  window.addEventListener("touchend", stopDrag);

  return () => hasMoved;
}

function createFloatingCornerPill() {
  if (document.getElementById("firehub-corner-pill")) return;

  const pill = document.createElement("div");
  pill.id = "firehub-corner-pill";
  pill.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
    color: #FFF; border: 1.5px solid #FF5722; border-radius: 20px;
    padding: 6px 14px; box-shadow: 0 8px 25px rgba(0,0,0,0.35);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px; font-weight: 800;
    display: flex; align-items: center; gap: 8px;
    cursor: grab; user-select: none; touch-action: none; transition: background 0.3s, border 0.3s;
  `;

  pill.innerHTML = `
    <span style="font-size: 14px;">🔥</span>
    <span id="firehub-pill-text">FireHub: Auto-ETA Ativo</span>
    <span id="firehub-pill-toggle" style="background: #334155; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; margin-left: 4px;">—</span>
  `;

  const getMoved = makePillDraggable(pill);

  let isCollapsed = false;
  pill.addEventListener("click", () => {
    if (getMoved()) return;
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
  refreshPillData();
}

function updateFloatingPill(formattedStr, count = null, mode = "auto", shouldPause = false) {
  const pill = document.getElementById("firehub-corner-pill");
  const textEl = document.getElementById("firehub-pill-text");

  if (textEl) {
    const badgeStr = mode === "manual" ? "✍️ Manual" : "🤖 Auto";
    const countStr = typeof count === "number" ? ` · ${count} ped.` : "";
    textEl.textContent = `FireHub: ${formattedStr}${countStr} (${badgeStr})`;
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

function refreshPillData() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["lastEtaFormatted", "ordersInProduction", "activeMode", "shouldPauseStore"], (res) => {
      if (res && res.lastEtaFormatted) {
        const count = typeof res.ordersInProduction === "number" ? res.ordersInProduction : null;
        updateFloatingPill(res.lastEtaFormatted, count, res.activeMode || "auto", !!res.shouldPauseStore);
      }
    });
  }
}

// Escuta notificações do background
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === "IFOOD_DISCONNECTED_ALERT") {
      showIfoodDisconnectedBanner(msg.reason || "Sessão do portal iFood expirada");
    }
    if (msg && msg.action === "IFOOD_CONNECTED_ALERT") {
      removeIfoodDisconnectedBanner();
    }
    if (msg && msg.action === "IFOOD_TAB_MISSING_ALERT") {
      showIfoodDisconnectedBanner(
        msg.reason || "A aba de Configurações de entrega do portal iFood não está aberta.",
        { id: "firehub-ifood-tab-alert", titulo: "Abra o portal iFood para o prazo mudar", botao: "🗔 Abrir a tela de entrega" }
      );
    }
    if (msg && msg.action === "IFOOD_TAB_PRESENT") {
      const el = document.getElementById("firehub-ifood-tab-alert");
      if (el) el.remove();
    }
    if (msg && msg.action === "ETA_UPDATED") {
      updateFloatingPill(msg.formatted, msg.ordersInProduction, msg.mode, msg.shouldPause);
    }
  });
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") refreshPillData();
  });
}

setTimeout(createFloatingCornerPill, 500);

// ── BANNER DE ALERTA DE DESCONEXÃO NO FIREHUB ──
function showIfoodDisconnectedBanner(reasonText, opcoes) {
  const o = opcoes || {};
  const id = o.id || "firehub-ifood-disconnect-alert";
  if (document.getElementById(id)) return;

  const alertContainer = document.createElement("div");
  alertContainer.id = id;
  alertContainer.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 999999;
    background: #FEF2F2; border: 2px solid #EF4444; color: #991B1B;
    padding: 12px 20px; border-radius: 16px; box-shadow: 0 10px 30px rgba(239,68,68,0.25);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; font-weight: 800; display: flex; align-items: center; gap: 14px;
    max-width: 90vw; animation: firehubSlideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  alertContainer.innerHTML = `
    <span style="font-size: 18px;">⚠️</span>
    <div style="flex: 1;">
      <div style="font-size: 14px; font-weight: 900; color: #7F1D1D;">${o.titulo || "O Portal iFood foi desconectado!"}</div>
      <div style="font-size: 12px; font-weight: 600; color: #991B1B;">${o.titulo ? reasonText : "Sua extensão do iFood foi desconectada ou a sessão deslogou. Clique no botão ao lado para relogar no iFood."}</div>
    </div>
    <button class="firehub-reconnect-ifood-btn" style="
      background: #EF4444; color: #FFFFFF; border: none; padding: 8px 16px;
      border-radius: 10px; font-weight: 900; font-size: 12px; cursor: pointer;
      box-shadow: 0 4px 12px rgba(239,68,68,0.3); transition: all 0.2s; flex-shrink: 0;
    ">${o.botao || "🔑 Reconectar no iFood"}</button>
    <button class="firehub-close-ifood-alert-btn" style="
      background: none; border: none; color: #991B1B; font-weight: 900; font-size: 16px;
      cursor: pointer; padding: 0 4px; line-height: 1; flex-shrink: 0;
    " title="Fechar aviso">✕</button>
  `;

  document.body.appendChild(alertContainer);

  // Clique do lojista: o UNICO caminho que abre ou foca a aba do iFood.
  const btn = alertContainer.querySelector(".firehub-reconnect-ifood-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "FOCUS_OR_OPEN_IFOOD" }).catch(() => {});
      }
      alertContainer.remove();
    });
  }

  const closeBtn = alertContainer.querySelector(".firehub-close-ifood-alert-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      alertContainer.remove();
    });
  }
}

function removeIfoodDisconnectedBanner() {
  const el = document.getElementById("firehub-ifood-disconnect-alert");
  if (el) el.remove();
}

// 1. Escuta eventos postMessage emitidos pelo Dashboard de Pedidos
window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FIREHUB_EM_PRODUCAO_COUNT") {
    const count = typeof event.data.count === "number" ? event.data.count : 0;
    notifyCount(count, "postMessage");
  }
});

// 2. Leitura do DOM a cada 2 segundos (estrita e precisa)
function readCountFromDOM() {
  const badgeEl = document.getElementById("firehub-em-producao-count-badge");
  if (badgeEl && badgeEl.textContent) {
    const countNum = parseInt(badgeEl.textContent.trim(), 10);
    if (!isNaN(countNum)) {
      notifyCount(countNum, "badge_id");
      return;
    }
  }

  const preparoCol = document.querySelector('[data-droppable="col-preparo"]');
  if (preparoCol) {
    const badge = preparoCol.querySelector("[data-column-count]");
    if (badge) {
      const attrVal = badge.getAttribute("data-column-count");
      const countNum = parseInt(attrVal || badge.textContent.trim(), 10);
      if (!isNaN(countNum)) {
        notifyCount(countNum, "col-preparo");
        return;
      }
    }
  }
}

setInterval(readCountFromDOM, 2000);
setTimeout(readCountFromDOM, 500);

function observeBadge() {
  const badgeEl = document.getElementById("firehub-em-producao-count-badge");
  if (!badgeEl) {
    setTimeout(observeBadge, 3000);
    return;
  }

  const observer = new MutationObserver(() => {
    const countNum = parseInt(badgeEl.textContent.trim(), 10);
    if (!isNaN(countNum)) {
      notifyCount(countNum, "mutation_observer");
    }
  });

  observer.observe(badgeEl, { childList: true, characterData: true, subtree: true });
  console.log("[FireHub Bridge] 👁️ MutationObserver ativo no badge Em Produção!");
}

setTimeout(observeBadge, 2000);
