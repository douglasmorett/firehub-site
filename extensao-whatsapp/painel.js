// O painel lateral: emoldura o balcão do FireHub (/atendimento-lateral) e
// repassa a ele o contato da conversa aberta no WhatsApp Web.
//
// A conversa entre as partes, e quem confere o quê:
//   whatsapp.js  --runtime.sendMessage-->  aqui   (só mensagens da própria extensão chegam)
//   aqui  --postMessage(…, origemDoFireHub)-->  balcão   (só a origem configurada recebe)
//   balcão  confere que veio da janela-mãe e de chrome-extension://
//   balcão  --"firehub:pronto"-->  aqui   (aceito só da moldura e da origem do FireHub)

(async () => {
  const moldura = document.getElementById("balcao");
  const endereco = await lerEndereco();
  const origem = new URL(endereco).origin;
  document.getElementById("endereco").textContent = endereco.replace(/^https?:\/\//, "");
  moldura.src = `${endereco}/atendimento-lateral`;

  let ultimo = null;
  const entregar = (contato) => {
    ultimo = contato || null;
    moldura.contentWindow?.postMessage({ tipo: "firehub:contato", ...(ultimo || { nome: "", telefone: "" }) }, origem);
  };

  // Pergunta à aba do WhatsApp quem está na conversa (o painel abriu agora,
  // ou o balcão acabou de carregar).
  const perguntarContato = async () => {
    const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!aba?.id || !String(aba.url || "").startsWith("https://web.whatsapp.com/")) return;
    const contato = await chrome.tabs.sendMessage(aba.id, { tipo: "qual-contato" }).catch(() => null);
    entregar(contato);
  };

  window.addEventListener("message", (e) => {
    if (e.source !== moldura.contentWindow || e.origin !== origem) return;
    if (e.data?.tipo === "firehub:pronto") perguntarContato();
  });

  chrome.runtime.onMessage.addListener((msg, sender) => {
    // Só a aba que está na frente: com dois WhatsApp abertos, o de trás não manda aqui.
    if (msg?.tipo === "contato" && sender.tab?.active) entregar(msg.contato);
  });

  document.getElementById("recarregar").addEventListener("click", () => { moldura.src = `${endereco}/atendimento-lateral`; });
  document.getElementById("opcoes").addEventListener("click", () => chrome.runtime.openOptionsPage());
})();
