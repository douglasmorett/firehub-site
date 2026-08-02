/**
 * FireHub Chrome Extension — Content Script no Portal do Parceiro iFood (portal.ifood.com.br)
 * Interage com a página do iFood ou simula alteração no módulo de tempo de entrega.
 */

console.log("[FireHub Extension] 🍕 Script carregado no Portal do Parceiro iFood!");

// Ouvir requisições vindas da extensão (Popup ou Background Alarm)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SET_DELIVERY_TIME") {
    console.log(`[FireHub Auto-ETA] ⏱️ Recebido novo prazo para aplicar no iFood: ${request.formatted}`);
    applyDeliveryTimeOnIfoodPortal(request.minMinutes, request.maxMinutes, request.formatted);
    sendResponse({ success: true });
  }
});

/**
 * Função responsável por aplicar o novo tempo de entrega no DOM ou chamar endpoints do Portal iFood
 */
function applyDeliveryTimeOnIfoodPortal(minMin, maxMin, formattedStr) {
  try {
    // 1. Notificação de confirmação visual no portal do iFood
    showToastNotification(`🔥 FireHub Auto-ETA: Prazo ajustado para ${formattedStr}`);

    // 2. Procurar seletores de tempo no Portal do iFood (Perfil / Entrega / Prazos)
    const timeSelects = document.querySelectorAll("select[name*='time'], select[id*='deliveryTime'], input[placeholder*='minuto']");
    if (timeSelects.length > 0) {
      timeSelects.forEach(select => {
        const option = Array.from((select as any).options || []).find((opt: any) => opt.text.includes(String(minMin)) || opt.text.includes(String(maxMin)));
        if (option) {
          (select as HTMLSelectElement).value = (option as HTMLOptionElement).value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }

    console.log(`[FireHub Auto-ETA] ✅ Prazo de ${formattedStr} aplicado com sucesso!`);
  } catch (err) {
    console.error("[FireHub Auto-ETA Error]", err);
  }
}

/**
 * Exibe um Toast minimalista no topo da página do iFood avisando o operador
 */
function showToastNotification(message) {
  let toast = document.getElementById("firehub-eta-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "firehub-eta-toast";
    toast.style.position = "fixed";
    toast.style.top = "20px";
    toast.style.right = "20px";
    toast.style.zIndex = "999999";
    toast.style.background = "#0F172A";
    toast.style.color = "#34D399";
    toast.style.border = "1.5px solid #10B981";
    toast.style.padding = "10px 16px";
    toast.style.borderRadius = "12px";
    toast.style.fontSize = "13px";
    toast.style.fontWeight = "800";
    toast.style.boxShadow = "0 10px 25px rgba(0,0,0,0.3)";
    toast.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";
    toast.style.transition = "opacity 0.4s";
    document.body.appendChild(toast);
  }

  toast.innerHTML = message;
  toast.style.opacity = "1";

  setTimeout(() => {
    if (toast) toast.style.opacity = "0";
  }, 4000);
}
