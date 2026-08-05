/**
 * FireHub Chrome Extension — Bridge Content Script
 * Injetado nas páginas do FireHub (firehubfood.com.br / firehub.com.br / localhost)
 * Lê em tempo real o contador exato da coluna 'Em Produção' exibido no site e espelha na extensão sem divergências!
 */

console.log("[FireHub Extension Bridge] ⚡ Conectado ao painel do FireHub em tempo real!");

let lastEmProducaoCount = -1;

function notifyCount(count, source) {
  if (count === lastEmProducaoCount) return;
  lastEmProducaoCount = count;

  console.log(`[FireHub Bridge] 🚀 Notificando extensão ao vivo (${source}): ${count} pedidos em produção`);

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      action: "FIREHUB_LIVE_COUNT",
      count: count,
      source: source
    }).catch(() => {});
  }
}

// 1. Escuta eventos postMessage emitidos pelo Dashboard de Pedidos
window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FIREHUB_EM_PRODUCAO_COUNT") {
    const count = typeof event.data.count === "number" ? event.data.count : 0;
    notifyCount(count, "web_postmessage");
  }
});

// 2. Leitura ultra rápida do DOM diretamente do badge id #firehub-em-producao-count-badge
function observeEmProducaoBadge() {
  const checkBadge = () => {
    const badgeEl = document.getElementById("firehub-em-producao-count-badge");
    if (badgeEl && badgeEl.textContent) {
      const countNum = parseInt(badgeEl.textContent.trim(), 10);
      if (!isNaN(countNum)) {
        notifyCount(countNum, "dom_badge_id");
        return;
      }
    }

    // Fallback: Procura por coluna com data-droppable="col-preparo"
    const preparoCol = document.querySelector('[data-droppable="col-preparo"]');
    if (preparoCol) {
      const badge = preparoCol.querySelector("span[data-column-count], span");
      if (badge && /^\d+$/.test(badge.textContent?.trim() || "")) {
        const count = parseInt(badge.textContent.trim(), 10);
        if (!isNaN(count)) {
          notifyCount(count, "dom_column_selector");
        }
      }
    }
  };

  setInterval(checkBadge, 1000);
  checkBadge();
}

observeEmProducaoBadge();
