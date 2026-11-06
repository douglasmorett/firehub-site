// FireHub — Balcão no WhatsApp: o "motor" da extensão.
//
// ── Por que o painel lateral do PRÓPRIO Chrome, e não um <div> dentro do WhatsApp
//
// 1. O LOGIN. O balcão roda com a sessão do painel do FireHub (cookie
//    SameSite=Lax). Numa moldura dentro de web.whatsapp.com o FireHub é
//    "site de terceiro" e o Chrome não manda esse cookie: o balcão abriria
//    sempre na tela de login. No painel lateral, a página de cima é da
//    extensão, que tem permissão no domínio do FireHub — e aí o Chrome trata a
//    moldura como primeira parte e o login do painel vale.
// 2. O CSP DO WHATSAPP. O web.whatsapp.com só aceita molduras dele mesmo; uma
//    <iframe> do FireHub injetada na página seria bloqueada.
// 3. O LUGAR. O painel do Chrome fica à DIREITA e empurra o WhatsApp (não tapa
//    a conversa), tem o botão de fechar dele, e o Chrome lembra a largura.
//
// O painel só existe nas abas do WhatsApp Web: nas outras, o ícone não abre nada.

const WHATSAPP = "https://web.whatsapp.com/";

async function ajustarAba(tabId, url) {
  if (!url) return;
  const noWhatsApp = url.startsWith(WHATSAPP);
  try {
    await chrome.sidePanel.setOptions({ tabId, path: "painel.html", enabled: noWhatsApp });
  } catch {
    /* aba que fechou no meio do caminho */
  }
}

async function prepararTudo() {
  // Clicar no ícone da extensão abre/fecha o painel — o caminho que sempre funciona.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Abas do WhatsApp que já estavam abertas antes da instalação.
  const abas = await chrome.tabs.query({ url: `${WHATSAPP}*` }).catch(() => []);
  for (const aba of abas) await ajustarAba(aba.id, aba.url);
}

chrome.runtime.onInstalled.addListener(prepararTudo);
chrome.runtime.onStartup.addListener(prepararTudo);

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "complete") ajustarAba(tabId, tab.url);
});

// O botão "🔥 Balcão" que o whatsapp.js põe na tela pede para abrir o painel.
// O Chrome só abre o painel em resposta a um clique; se recusar, o botão
// mostra o caminho pelo ícone da extensão.
chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (msg?.tipo !== "abrir-painel" || sender.tab?.id == null) return;
  chrome.sidePanel
    .open({ tabId: sender.tab.id })
    .then(() => responder({ ok: true }))
    .catch(() => responder({ ok: false }));
  return true; // resposta assíncrona
});
