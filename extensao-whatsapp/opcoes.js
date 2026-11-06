(async () => {
  const atual = await lerEndereco();
  const producao = atual === FIREHUB_PADRAO;
  document.querySelector(`input[value="${producao ? FIREHUB_PADRAO : "outro"}"]`).checked = true;
  if (!producao) document.getElementById("outro").value = atual;
  const aviso = document.getElementById("aviso");

  document.getElementById("salvar").addEventListener("click", async () => {
    const escolha = document.querySelector("input[name=onde]:checked")?.value;
    const url = escolha === "outro" ? normalizarEndereco(document.getElementById("outro").value) : FIREHUB_PADRAO;
    if (!url) {
      aviso.style.color = "#B71C1C";
      aviso.textContent = "Endereço não aceito. Use firehubfood.com.br ou http://localhost:<porta>.";
      return;
    }
    await chrome.storage.sync.set({ urlDoFireHub: url });
    aviso.style.color = "#0F766E";
    aviso.textContent = `Salvo: ${url}. Feche e abra o painel do WhatsApp (ou clique em ↻).`;
  });
})();
