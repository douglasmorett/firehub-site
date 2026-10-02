// Envia os tutoriais para o servidor a partir do navegador logado como ADMIN no
// FireHub. Colar no console (ou rodar por automação) numa aba do site:
//
//   1. instalarEnvioDeTutoriais() — cria o campo de arquivo no canto da tela;
//   2. escolher TODOS os arquivos de tutoriais/saida/_envio (preparar-envio.mjs);
//   3. o envio começa sozinho; window.__envioDosTutoriais mostra o andamento.
//
// Pula o que já está no servidor (GET /api/admin/tutoriais) e retoma do byte
// certo quando o servidor responde 409 — dá para rodar de novo sem medo.
function instalarEnvioDeTutoriais() {
  const PEDACO = 4 * 1024 * 1024;
  const estado = (window.__envioDosTutoriais = { feitos: 0, total: 0, pulados: 0, bytes: 0, erros: [], atual: "", fim: false });
  const campo = document.createElement("input");
  campo.type = "file";
  campo.multiple = true;
  campo.id = "envio-dos-tutoriais";
  campo.setAttribute("aria-label", "Arquivos dos tutoriais");
  campo.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#fff;padding:8px;border:2px solid #C92E09;border-radius:8px";
  document.body.appendChild(campo);

  campo.addEventListener("change", async () => {
    const noServidor = await fetch("/api/admin/tutoriais").then((r) => r.json());
    const tamanhos = {};
    for (const t of noServidor.tutoriais) for (const [a, n] of Object.entries(t.arquivos)) tamanhos[`${t.id}__${t.versao}__${a}`] = n;
    const arquivos = Array.from(campo.files);
    estado.total = arquivos.length;
    for (const arquivo of arquivos) {
      const [id, versao, nome] = arquivo.name.split("__");
      estado.atual = arquivo.name;
      if (tamanhos[arquivo.name] === arquivo.size) { estado.pulados++; estado.feitos++; continue; }
      let inicio = 0;
      try {
        while (inicio < arquivo.size) {
          const pedaco = arquivo.slice(inicio, Math.min(inicio + PEDACO, arquivo.size));
          const q = new URLSearchParams({ id, versao, arquivo: nome, inicio: String(inicio), tamanho: String(arquivo.size) });
          const r = await fetch(`/api/admin/tutoriais?${q}`, { method: "POST", body: pedaco, headers: { "Content-Type": "application/octet-stream" } });
          const j = await r.json().catch(() => ({}));
          if (r.status === 409) { inicio = j.recomecarDe || 0; continue; }
          if (!r.ok) throw new Error(`${r.status} ${j.error || ""}`);
          estado.bytes += pedaco.size;
          inicio = j.recebido;
        }
      } catch (e) {
        estado.erros.push(`${arquivo.name}: ${e.message}`);
      }
      estado.feitos++;
    }
    estado.atual = "";
    estado.fim = true;
    campo.remove();
  });
  return "campo pronto";
}
