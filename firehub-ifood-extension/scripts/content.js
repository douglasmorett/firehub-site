/**
 * FireHub Chrome Extension — Content Script no Portal do Parceiro iFood
 * 
 * Funcionalidades:
 * 1. Exibe pílula flutuante no canto da tela com status do ETA
 * 2. AUTOMATICAMENTE navega para Configurações de Entrega e ajusta o prazo
 *    usando os botões "+ 5 min" / "- 5 min" e clicando em "Salvar"
 */

console.log("[FireHub Extension] 🍕 Script carregado no Portal do Parceiro iFood!");

// ── ESTADO ──
let lastAppliedETA = null;
let isApplying = false;

// ── INICIALIZAÇÃO ──
createFloatingCornerPill();

// Ao carregar a página, verificar se existe um ETA pendente para aplicar
chrome.storage.local.get(["pendingETA", "lastAppliedETA"], (store) => {
  lastAppliedETA = store.lastAppliedETA || null;

  if (store.pendingETA && isOnDeliverySettingsPage()) {
    console.log(`[FireHub] 🎯 ETA pendente encontrado: ${store.pendingETA} min. Aplicando em 4s...`);
    setTimeout(() => {
      applyETAOnSettingsPage(store.pendingETA);
      chrome.storage.local.remove(["pendingETA"]);
    }, 4000);
  }
});

// ── RECEPTOR DE MENSAGENS ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SET_DELIVERY_TIME") {
    const targetMin = request.minMinutes || 38;
    console.log(`[FireHub Auto-ETA] ⏱️ Recebido: ${request.formatted} (${targetMin} min) | Modo: ${request.mode}`);

    updateFloatingPill(request.formatted, request.mode, request.shouldPause);

    // Não aplica se deve pausar a loja
    if (request.shouldPause) {
      console.log("[FireHub] ⚠️ shouldPause=true → Não aplicando, só exibindo alerta.");
      sendResponse({ success: true, applied: false, reason: "shouldPause" });
      return;
    }

    // Só aplica se o ETA mudou em relação ao último aplicado
    if (lastAppliedETA === targetMin) {
      console.log(`[FireHub] ✅ ETA ${targetMin} min já foi aplicado. Nenhuma ação necessária.`);
      sendResponse({ success: true, applied: false, reason: "already_applied" });
      return;
    }

    handleETAUpdate(targetMin);
    sendResponse({ success: true, applied: true });
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

async function handleETAUpdate(targetMinutes) {
  if (isApplying) {
    console.log("[FireHub] ⏳ Já está aplicando, ignorando esta requisição.");
    return;
  }

  if (isOnDeliverySettingsPage()) {
    // Já estamos na página de configurações → aplicar diretamente
    console.log("[FireHub] 📍 Já está na tela de Configurações de Entrega. Aplicando...");
    await sleep(1500);
    await applyETAOnSettingsPage(targetMinutes);
  } else {
    // Salvar ETA pendente e navegar para a página de configurações
    console.log("[FireHub] 🚀 Navegando para Configurações de Entrega...");
    updatePillStatus("🚀 Indo para Config...", false);
    chrome.storage.local.set({ pendingETA: targetMinutes });
    window.location.href = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";
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
    await sleep(2000);

    // 2. Encontrar os inputs de tempo
    let timeInputs = findTimeInputs();

    // Se não encontrou, esperar e tentar de novo
    if (timeInputs.length === 0) {
      console.log("[FireHub] ⏳ Inputs não encontrados, aguardando 3s...");
      await sleep(3000);
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
      console.warn("[FireHub] ❌ Valores atuais não legíveis");
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
        console.log(`[FireHub] 🖱️ Clique ${i + 1}/${clicksNeeded}`);
        await sleep(350);
      }

      await sleep(1200);

      // ── 6. VERIFICAÇÃO: Ler de novo e confirmar que bateu ──
      let verified = false;
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        const checkInputs = findTimeInputs();
        const checkValues = checkInputs.map(i => parseInt(i.value) || 0).filter(v => v > 0);
        const checkMax = checkValues.length > 0 ? Math.max(...checkValues) : 0;

        console.log(`[FireHub] 🔍 Verificação ${tentativa + 1}/3: Tempos agora = [${checkValues.join(", ")}] | Max = ${checkMax} | Alvo = ${targetMinutes}`);

        const diff = targetMinutes - checkMax;

        if (Math.abs(diff) < 3) {
          // ✅ Valor correto!
          console.log(`[FireHub] ✅ CONFIRMADO: Max ${checkMax} min ≈ Alvo ${targetMinutes} min`);
          updatePillStatus(`✅ Confirmado: ${checkMax} min`, false);
          verified = true;
          break;
        }

        // Não bateu — corrigir com cliques adicionais
        const correctionClicks = Math.max(1, Math.round(Math.abs(diff) / 5));
        const correctionBtn = findAdjustButton(diff > 0);

        if (correctionBtn && correctionClicks > 0) {
          console.log(`[FireHub] 🔄 Corrigindo: ${diff > 0 ? "+" : ""}${diff} min → ${correctionClicks} clique(s) extra`);
          for (let c = 0; c < correctionClicks; c++) {
            correctionBtn.click();
            await sleep(350);
          }
          await sleep(800);
        } else {
          console.warn("[FireHub] ⚠️ Botão de correção não encontrado");
          break;
        }
      }

      // Leitura final para log e confirmação no pill
      const finalInputs = findTimeInputs();
      const finalValues = finalInputs.map(i => parseInt(i.value) || 0).filter(v => v > 0);
      const finalMax = finalValues.length > 0 ? Math.max(...finalValues) : 0;
      const finalMin = finalValues.length > 0 ? Math.min(...finalValues) : 0;

      console.log(`[FireHub] 📊 VALORES FINAIS: [${finalValues.join(", ")}] | Min: ${finalMin} | Max: ${finalMax} | Alvo era: ${targetMinutes}`);

      if (!verified && Math.abs(targetMinutes - finalMax) >= 3) {
        console.warn(`[FireHub] ⚠️ Não conseguiu atingir o alvo exato. Final: ${finalMax}, Alvo: ${targetMinutes}`);
        updatePillStatus(`⚠️ Ficou em ${finalMax} min (alvo: ${targetMinutes})`, true);
      }

      // 7. Clicar em "Salvar" (mesmo que não tenha atingido exato, salva o mais próximo)
      await clickSalvar(targetMinutes, finalMax);

    } else {
      // FALLBACK: Editar inputs diretamente com React-compatible setter
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
    
    // Inputs de taxa têm vírgula (4,99) ou ponto (4.99) — excluir
    if (rawVal.includes(",") || rawVal.includes(".")) return false;

    const numVal = parseInt(rawVal);
    if (isNaN(numVal) || numVal < 10 || numVal > 500) return false;

    // Verificar se "min" aparece nas proximidades (irmão ou pai)
    // Mas NÃO se "R$" aparece (isso seria um input de taxa)
    const container = input.closest("tr, [class*='row'], [class*='Row']") || input.parentElement?.parentElement || input.parentElement;
    if (!container) return false;

    const containerText = container.textContent || "";
    
    // Se o container contém "min" e NÃO é predominantemente sobre preço
    if (containerText.includes("min")) {
      // Verificar se este input específico está na coluna de tempo (não taxa)
      // Checar se há "R$" ANTES deste input no mesmo nível
      const prevSibling = input.previousElementSibling;
      if (prevSibling && (prevSibling.textContent || "").includes("R$")) return false;
      
      return true;
    }

    // Fallback: checar irmão seguinte direto
    let next = input.nextElementSibling;
    if (next && (next.textContent || "").trim().toLowerCase().includes("min")) return true;

    // Checar pai e irmão do pai
    const parent = input.parentElement;
    if (parent) {
      const parentNext = parent.nextElementSibling;
      if (parentNext && (parentNext.textContent || "").trim().toLowerCase().includes("min")) return true;
    }

    return false;
  });
}

function findAdjustButton(isIncrease) {
  const buttons = Array.from(document.querySelectorAll("button"));

  return buttons.find(btn => {
    const text = btn.textContent.trim();
    // Precisa conter "5" e "min"
    if (!text.includes("5") || !text.toLowerCase().includes("min")) return false;

    if (isIncrease) {
      return text.includes("+");
    } else {
      // O iFood usa — (em dash), – (en dash) ou - (hyphen)
      return text.includes("-") || text.includes("–") || text.includes("—");
    }
  });
}

function findButtonByText(searchText) {
  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.find(btn => {
    const text = btn.textContent.trim().toLowerCase();
    return text === searchText.toLowerCase() || text.includes(searchText.toLowerCase());
  });
}

async function clickOperacaoAtualTab() {
  // Tentar clicar na aba "Operação atual" se existir e não estiver ativa
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
      console.log("[FireHub] 📌 Clicando na aba 'Operação atual'...");
      opTab.click();
      await sleep(1500);
    }
  }
}

async function clickSalvar(targetMinutes, actualMax = null) {
  const salvarBtn = findButtonByText("Salvar");
  const displayVal = actualMax || targetMinutes;

  if (salvarBtn) {
    // Verificar se o botão está habilitado
    if (salvarBtn.disabled) {
      console.warn("[FireHub] ⚠️ Botão Salvar está desabilitado. Pode já estar salvo.");
      updatePillStatus(`⚠️ ${displayVal} min (Salvar desabilitado)`, false);
      return;
    }

    salvarBtn.click();

    // Após clicar em Salvar, esperar e re-ler para confirmação final
    await sleep(2500);

    // Re-ler inputs após o save para garantir
    const postSaveInputs = findTimeInputs();
    const postSaveValues = postSaveInputs.map(i => parseInt(i.value) || 0).filter(v => v > 0);
    const postSaveMax = postSaveValues.length > 0 ? Math.max(...postSaveValues) : actualMax || targetMinutes;

    const matchOk = Math.abs(targetMinutes - postSaveMax) < 3;

    if (matchOk) {
      console.log(`[FireHub] ✅✅ SALVO E CONFIRMADO! Valor final: ${postSaveMax} min (alvo: ${targetMinutes})`);
      updatePillStatus(`✅ ${postSaveMax} min SALVO!`, false);
    } else {
      console.log(`[FireHub] ⚠️ Salvo, mas valor final (${postSaveMax}) difere do alvo (${targetMinutes})`);
      updatePillStatus(`⚠️ Salvo ${postSaveMax} min (alvo era ${targetMinutes})`, true);
    }

    lastAppliedETA = targetMinutes;
    chrome.storage.local.set({ lastAppliedETA: targetMinutes });
  } else {
    console.warn("[FireHub] ⚠️ Botão 'Salvar' não encontrado na página");
    updatePillStatus(`⚠️ ${displayVal} min (Salvar não achado)`, true);
  }
}

// ── FALLBACK: EDIÇÃO DIRETA DOS INPUTS ──

async function directInputEdit(timeInputs, targetMinutes, currentMax) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, "value"
  ).set;

  const delta = targetMinutes - currentMax;

  for (const input of timeInputs) {
    const currentVal = parseInt(input.value) || 0;
    if (currentVal <= 0) continue;

    const newVal = Math.max(10, currentVal + delta);

    // React-compatible value update
    input.focus();
    await sleep(100);
    nativeInputValueSetter.call(input, String(newVal));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    input.dispatchEvent(new Event("blur", { bubbles: true }));

    console.log(`[FireHub] ✏️ Input: ${currentVal} → ${newVal}`);
    await sleep(300);
  }

  await sleep(1000);
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
    // Voltar ao normal após 8 segundos
    setTimeout(() => {
      if (pill) {
        pill.style.border = "1.5px solid #FF5722";
      }
    }, 8000);
  }
}
