/**
 * FireHub Chrome Extension — Content Script no Portal do Parceiro iFood (portal.ifood.com.br)
 * Injeta uma pílula compacta e discreta no canto da tela com a opção de minimizar.
 */

console.log("[FireHub Extension] 🍕 Script carregado no Portal do Parceiro iFood!");

// Injetar pílula flutuante discreta no canto superior direito
createFloatingCornerPill();

// Ouvir mensagens da extensão
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SET_DELIVERY_TIME") {
    console.log(`[FireHub Auto-ETA] ⏱️ Recebido novo prazo: ${request.formatted} (${request.mode || "auto"})`);
    updateFloatingPill(request.formatted, request.mode);
    sendResponse({ success: true });
  }
});

function createFloatingCornerPill() {
  if (document.getElementById("firehub-corner-pill")) return;

  const pill = document.createElement("div");
  pill.id = "firehub-corner-pill";
  pill.style.position = "fixed";
  pill.style.bottom = "20px";
  pill.style.right = "20px";
  pill.style.zIndex = "999999";
  pill.style.background = "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)";
  pill.style.color = "#FFF";
  pill.style.border = "1.5px solid #FF5722";
  pill.style.borderRadius = "20px";
  pill.style.padding = "6px 14px";
  pill.style.boxShadow = "0 8px 20px rgba(0,0,0,0.3)";
  pill.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  pill.style.fontSize = "12px";
  pill.style.fontWeight = "800";
  pill.style.display = "flex";
  pill.style.alignItems = "center";
  pill.style.gap = "8px";
  pill.style.cursor = "pointer";
  pill.style.userSelect = "none";
  pill.style.transition = "all 0.3s";

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
