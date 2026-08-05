/**
 * FireHub Chrome Extension — Bridge Content Script
 * Injetado nas páginas do FireHub (firehubfood.com.br / firehub.com.br / localhost)
 * 
 * FONTE PRIMÁRIA DE VERDADE: Lê o contador exato da coluna 'Em Produção' 
 * a cada 2 segundos e envia pro background em tempo real.
 */

console.log("[FireHub Extension Bridge] ⚡ Conectado ao painel do FireHub em tempo real!");

let lastEmProducaoCount = -1;
let consecutiveFailures = 0;

function notifyCount(count, source) {
  // Sempre notificar se o count mudou (ou a cada 10 iterações para manter heartbeat)
  if (count === lastEmProducaoCount && consecutiveFailures === 0) return;
  lastEmProducaoCount = count;
  consecutiveFailures = 0;

  console.log(`[FireHub Bridge] 🚀 ${source}: ${count} pedidos em produção`);

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
    notifyCount(count, "postMessage");
  }
});

// 2. Leitura do DOM a cada 2 segundos
function readCountFromDOM() {
  // Prioridade 1: Badge com ID específico
  const badgeEl = document.getElementById("firehub-em-producao-count-badge");
  if (badgeEl && badgeEl.textContent) {
    const countNum = parseInt(badgeEl.textContent.trim(), 10);
    if (!isNaN(countNum)) {
      notifyCount(countNum, "badge_id");
      return;
    }
  }

  // Prioridade 2: Coluna col-preparo
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

  // Prioridade 3: Procurar pelo texto "Em Produção" e ler o badge ao lado
  const allHeaders = document.querySelectorAll("h2, h3, span, div");
  for (const el of allHeaders) {
    if ((el.textContent || "").trim() === "Em Produção") {
      // Procurar badge numérico próximo (irmão ou filho do pai)
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
  if (consecutiveFailures > 10) {
    // Se não acha o badge há 20 segundos, pode ser que não tem pedidos
    console.log("[FireHub Bridge] ⚠️ Badge não encontrado — pode não ter pedidos em produção");
    // Não notificar 0 automaticamente pois pode ser erro de DOM
  }
}

// Verificar a cada 2 segundos
setInterval(readCountFromDOM, 2000);
// Primeira leitura imediata
setTimeout(readCountFromDOM, 500);

// 3. MutationObserver para reagir instantaneamente a mudanças no badge
function observeBadge() {
  const badgeEl = document.getElementById("firehub-em-producao-count-badge");
  if (!badgeEl) {
    // Tentar de novo em 3s
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

// Iniciar observer quando a página carregar
setTimeout(observeBadge, 2000);
