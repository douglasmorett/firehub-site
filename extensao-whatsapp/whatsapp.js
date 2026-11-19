// FireHub — Balcão no WhatsApp: o que roda DENTRO do web.whatsapp.com.
//
// Duas tarefas, e só elas:
//   1. Ler QUEM está na conversa aberta (nome e, quando dá, o número) e
//      avisar o painel lateral quando muda.
//   2. Pôr na borda direita o botão "🔥 Balcão", que abre o painel.
// Nada aqui escreve no WhatsApp, clica em nada dele ou lê mensagem.
//
// ── A leitura depende do HTML do WhatsApp Web ─────────────────────────────
// O WhatsApp não tem API para isto; o que existe é a página. Quando eles
// mudam a página, a leitura pode falhar — e aí o balcão só não vem
// preenchido: o atendente digita nome e telefone, como no balcão comum.
// Os caminhos, do mais confiável para o menos:
//   - o número: o `data-id` das mensagens da conversa aberta traz o contato
//     ("false_5511999998888@c.us_..."). Contato que o WhatsApp esconde atrás
//     de um código (`@lid`) não tem número ali.
//   - o título do cabeçalho: o nome salvo, ou o próprio número quando o
//     contato não está salvo no celular da loja.

(() => {
  if (window.__firehubBalcao) return;
  window.__firehubBalcao = true;

  const SO_NUMERO = /^\+?[\d\s().-]{8,}$/;

  function lerContato() {
    const main = document.querySelector("#main");
    if (!main) return null;
    const titulo = (main.querySelector("header span[dir='auto']")?.textContent || "").replace(/\s+/g, " ").trim();
    let telefone = "";
    for (const el of main.querySelectorAll("[data-id]")) {
      const m = /^(?:true|false)_(\d{10,15})@c\.us/.exec(el.getAttribute("data-id") || "");
      if (m) { telefone = m[1]; break; }
    }
    // Grupo não é cliente: nada a preencher.
    if (!telefone && main.querySelector("[data-id*='@g.us']")) return null;
    if (!telefone && SO_NUMERO.test(titulo)) telefone = titulo.replace(/\D/g, "");
    const nome = SO_NUMERO.test(titulo) ? "" : titulo.slice(0, 80);
    return nome || telefone ? { nome, telefone } : null;
  }

  let ultimo = "";
  function avisarSeMudou() {
    const contato = lerContato();
    const chave = JSON.stringify(contato);
    if (chave === ultimo) return;
    ultimo = chave;
    // Painel fechado = ninguém para ouvir; o erro é esperado e não importa.
    // (O try pega a extensão recarregada com a aba do WhatsApp ainda aberta.)
    try { chrome.runtime.sendMessage({ tipo: "contato", contato }).catch(() => {}); } catch {}
  }

  // O WhatsApp redesenha a tela o tempo todo: olha no máximo duas vezes por segundo.
  let agendado = null;
  new MutationObserver(() => {
    if (agendado) return;
    agendado = setTimeout(() => { agendado = null; avisarSeMudou(); }, 500);
  }).observe(document.body, { childList: true, subtree: true });

  // O painel acabou de abrir e pergunta quem está na conversa.
  chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
    if (msg?.tipo === "qual-contato") responder(lerContato());
  });

  // ── O botão na borda direita ──────────────────────────────────────────
  const botao = document.createElement("button");
  botao.type = "button";
  botao.textContent = "🔥 Balcão";
  botao.title = "Abrir o balcão do FireHub ao lado da conversa";
  Object.assign(botao.style, {
    position: "fixed", right: "0", top: "42%", zIndex: "2147483000",
    writingMode: "vertical-rl", padding: "12px 7px", border: "none",
    borderRadius: "10px 0 0 10px", background: "#C92E09", color: "#fff",
    font: "800 13px/1 'Segoe UI', Arial, sans-serif", letterSpacing: "0.5px",
    cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
  });
  botao.addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ tipo: "abrir-painel" }).catch(() => null);
    if (!r?.ok) {
      botao.textContent = "Clique no ícone 🔥 da barra do Chrome";
      setTimeout(() => { botao.textContent = "🔥 Balcão"; }, 4000);
    }
  });
  document.body.appendChild(botao);
})();
