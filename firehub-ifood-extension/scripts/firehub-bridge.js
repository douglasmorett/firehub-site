/**
 * FireHub Chrome Extension — Bridge Content Script
 * Injetado nas páginas do FireHub (firehubfood.com.br / firehub.com.br / localhost)
 * 
 * Funcionalidades:
 * 1. Lê o contador exato da coluna 'Em Produção' a cada 2 segundos e envia pro background em tempo real.
 * 2. Exibe alerta elegante na tela do FireHub quando o portal do iFood for desconectado, com botão de reconexão direta (sem criar abas duplicadas).
 */

console.log("[FireHub Extension Bridge] ⚡ Conectado ao painel do FireHub em tempo real!");

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

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      action: "FIREHUB_LIVE_COUNT",
      count: count,
      source: source
    }).catch(() => {});
  }
}

// Escuta notificações do background (ex: iFood desconectado)
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === "IFOOD_DISCONNECTED_ALERT") {
      showIfoodDisconnectedBanner(msg.reason || "Sessão do portal iFood expirada");
    }
    if (msg && msg.action === "IFOOD_CONNECTED_ALERT") {
      removeIfoodDisconnectedBanner();
    }
  });
}

// ── BANNER DE ALERTA DE DESCONEXÃO NO FIREHUB ──
function showIfoodDisconnectedBanner(reasonText) {
  if (document.getElementById("firehub-ifood-disconnect-alert")) return;

  const alertContainer = document.createElement("div");
  alertContainer.id = "firehub-ifood-disconnect-alert";
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
    <div>
      <div style="font-size: 14px; font-weight: 900; color: #7F1D1D;">O Portal iFood foi desconectado!</div>
      <div style="font-size: 12px; font-weight: 600; color: #991B1B;">A sua extensão de mudança de prazo automático não está conseguindo ativar porque o portal iFood deslogou. Por favor, abra novamente seu portal iFood em Entregas para continuar ajustando o prazo automático.</div>
    </div>
    <button id="firehub-reconnect-ifood-btn" style="
      background: #EF4444; color: #FFFFFF; border: none; padding: 8px 16px;
      border-radius: 10px; font-weight: 900; font-size: 12px; cursor: pointer;
      box-shadow: 0 4px 12px rgba(239,68,68,0.3); transition: all 0.2s;
    ">🔑 Reconectar no iFood</button>
  `;

  document.body.appendChild(alertContainer);

  const btn = document.getElementById("firehub-reconnect-ifood-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "FOCUS_OR_OPEN_IFOOD" }).catch(() => {});
      }
      removeIfoodDisconnectedBanner();
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

// 2. Leitura do DOM a cada 2 segundos
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
    const badge = preparoCol.querySelector("span[data-column-count]");
    if (badge && /^\d+$/.test(badge.textContent?.trim() || "")) {
      const count = parseInt(badge.textContent.trim(), 10);
      if (!isNaN(count)) {
        notifyCount(count, "col-preparo");
        return;
      }
    }
  }

  const allHeaders = document.querySelectorAll("h2, h3, span, div");
  for (const el of allHeaders) {
    if ((el.textContent || "").trim() === "Em Produção") {
      const parent = el.parentElement;
      if (parent) {
        const badges = parent.querySelectorAll("span");
        for (const b of badges) {
          const txt = (b.textContent || "").trim();
          if (/^\d+$/.test(txt)) {
            const count = parseInt(txt, 10);
            notifyCount(count, "header_scan");
            return;
          }
        }
      }
    }
  }

  consecutiveFailures++;
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
