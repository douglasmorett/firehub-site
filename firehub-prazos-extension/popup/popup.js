/**
 * FireHub Prazos — popup.
 *
 * Tela de controle. Não calcula nada e não escreve no iFood nem no 99Food:
 * pede ao servidor (conta, motoboys, faixas, lojas marcadas, regra do 99) e
 * ao service worker (marcar coluna, listar lojas das abas abertas,
 * recalcular, abrir os portais). O que aparece aqui vem do chrome.storage,
 * que o service worker mantém atualizado — por isso a tela reage ao vivo.
 */
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const SERVIDOR_PADRAO = "https://firehubfood.com.br";
  const VERSAO = chrome.runtime.getManifest().version;

  let estado = { token: null, conta: null, receitas: {}, leitura: null, prazo: null, erro: null, roboLigado: false, ultimoAplicado: null, serverUrl: SERVIDOR_PADRAO, lojasEncontradas: null, ifoodDesconectado: false, n99Desconectado: false };
  let modoAtivo = "auto";
  let regras = [];
  let preparo99 = { modo: "desconto", desconto: 15, regras: [] };
  let listandoLojas = false;

  $("versao").textContent = "v" + VERSAO;

  // ── SERVIDOR ───────────────────────────────────────────────────────
  async function api(caminho, opcoes) {
    const base = (estado.serverUrl || SERVIDOR_PADRAO).replace(/\/$/, "");
    const sep = caminho.includes("?") ? "&" : "?";
    const url = base + caminho + (estado.token ? sep + "token=" + encodeURIComponent(estado.token) : "");
    const res = await fetch(url, { ...(opcoes || {}), signal: AbortSignal.timeout(8000) });
    const dados = await res.json().catch(() => ({}));
    return { res, dados };
  }

  function aplicarConta(conta) {
    estado.conta = conta;
    // As colunas marcadas nascem no navegador (o leitor grava no storage) e o
    // servidor guarda uma CÓPIA para restaurar noutro PC. A cópia só vale
    // quando não há nada aqui: sobrescrever o local com o que veio do servidor
    // apagava as colunas recém-marcadas sempre que a cópia ainda não tinha
    // subido (visto no teste de 07/09/2026).
    const cfg = (conta && conta.config) || {};
    const doServidor = cfg.receitas || {};
    const temLocal = Object.keys(estado.receitas || {}).length > 0;
    if (!temLocal && Object.keys(doServidor).length > 0) estado.receitas = doServidor;
    modoAtivo = cfg.modo || "auto";
    estado.roboLigado = cfg.roboLigado === true;
    regras = Array.isArray(cfg.regrasManuais) ? cfg.regrasManuais.slice() : [];
    preparo99 = {
      modo: (cfg.preparo99 && cfg.preparo99.modo) || "desconto",
      desconto: cfg.preparo99 && typeof cfg.preparo99.desconto === "number" ? cfg.preparo99.desconto : 15,
      regras: cfg.preparo99 && Array.isArray(cfg.preparo99.regras) ? cfg.preparo99.regras.slice() : [],
    };
    return chrome.storage.local.set(temLocal ? { conta } : { conta, receitas: estado.receitas });
  }

  async function salvarConfig(corpo) {
    try {
      const { res, dados } = await api("/api/prazos/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (res.status === 402) { await aplicarConta({ ...(estado.conta || {}), status: dados.status, podeUsar: false, motivoBloqueio: dados.error }); render(); return false; }
      if (!res.ok || !dados.success) {
        if (dados.cota) { mostrarAvisoLojas(dados.error); render(); return false; }
        mostrarErroLocal(dados.error || "Não salvou");
        return false;
      }
      await aplicarConta(dados.conta);
      chrome.runtime.sendMessage({ tipo: "PRAZOS_RECALCULAR", force: true }).catch(() => {});
      render();
      return true;
    } catch (e) {
      mostrarErroLocal("Servidor indisponível: não salvou.");
      return false;
    }
  }

  function mostrarErroLocal(texto) {
    const el = $("erroAtual");
    el.textContent = "⚠️ " + texto;
    el.style.display = "block";
  }
  function mostrarAvisoLojas(texto) {
    const el = $("lojasAviso");
    el.textContent = texto ? "⛔ " + texto : "";
    el.style.display = texto ? "block" : "none";
  }

  // ── LOGIN ──────────────────────────────────────────────────────────
  $("btnLogin").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    const senha = $("loginSenha").value;
    $("loginErro").style.display = "none";
    $("btnLogin").disabled = true;
    $("btnLogin").textContent = "Verificando…";
    try {
      estado.token = null;
      const { res, dados } = await api("/api/prazos/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, senha }) });
      if (res.ok && dados.success) {
        estado.token = dados.token;
        await chrome.storage.local.set({ token: dados.token, serverUrl: estado.serverUrl });
        await aplicarConta(dados.conta);
        chrome.runtime.sendMessage({ tipo: "PRAZOS_ENTROU" }).catch(() => {});
        render();
        listarLojas();
      } else {
        $("loginErro").textContent = "❌ " + (dados.error || "E-mail ou senha inválidos");
        $("loginErro").style.display = "block";
      }
    } catch (e) {
      $("loginErro").textContent = "❌ Não consegui falar com o servidor.";
      $("loginErro").style.display = "block";
    } finally {
      $("btnLogin").disabled = false;
      $("btnLogin").textContent = "Entrar";
    }
  });
  $("loginSenha").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnLogin").click(); });

  $("btnSair").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ tipo: "PRAZOS_SAIU" }).catch(() => {});
    estado.token = null; estado.conta = null; estado.receitas = {}; estado.prazo = null; estado.leitura = null; estado.ultimoAplicado = null;
    render();
  });

  // ── MARCAR COLUNA (precisa do gesto do usuário para pedir permissão) ──
  $("btnMarcar").addEventListener("click", async () => {
    const aviso = $("marcarAviso");
    aviso.style.display = "block";
    try {
      const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!aba || !aba.url || !/^https?:/.test(aba.url)) { aviso.textContent = "Abra o painel de pedidos do seu sistema numa aba e volte aqui."; return; }
      const origem = new URL(aba.url).origin;
      const host = new URL(aba.url).host;
      if (/ifood\.com\.br$/.test(host) || /99app\.com$/.test(host)) { aviso.textContent = "Esta é a aba do " + (/ifood/.test(host) ? "iFood" : "99Food") + ". Marque colunas no painel do SEU sistema (onde você vê os pedidos em produção)."; return; }
      const ok = await chrome.permissions.request({ origins: [origem + "/*"] });
      if (!ok) { aviso.textContent = "Sem permissão para ler este site. Clique de novo e aceite."; return; }
      const r = await chrome.runtime.sendMessage({ tipo: "PRAZOS_INICIAR_MARCACAO", tabId: aba.id, origem });
      if (r && r.ok) aviso.textContent = "Agora clique na coluna, na página. Pode marcar mais de uma; Esc ou Concluir para terminar.";
      else aviso.textContent = "Não consegui entrar na página: " + ((r && r.erro) || "recarregue a aba e tente de novo.");
    } catch (e) {
      aviso.textContent = "Falhou: " + String(e && e.message ? e.message : e);
    }
  });

  function renderColunas() {
    const lista = $("listaColunas");
    lista.innerHTML = "";
    const leituraCols = (estado.leitura && estado.leitura.colunas) || [];
    let total = 0, n = 0;
    for (const host of Object.keys(estado.receitas || {})) {
      for (const c of estado.receitas[host].colunas || []) {
        n++;
        const viva = leituraCols.find((x) => x.id === c.id);
        const row = document.createElement("div");
        row.className = "col";
        const ok = viva ? viva.ok : null;
        const num = viva && viva.ok ? viva.n : null;
        if (typeof num === "number") total += num;
        row.innerHTML = `<span title="${host}">${ok === false ? "⚠️ " : ""}${c.rotulo}</span><span class="n">${ok === false ? "não achei" : (typeof num === "number" ? num : "…")}</span><button class="x" title="Remover">✕</button>`;
        row.querySelector(".x").addEventListener("click", async () => {
          await chrome.runtime.sendMessage({ tipo: "PRAZOS_REMOVER_COLUNA", host, id: c.id }).catch(() => {});
          const s = await chrome.storage.local.get(["receitas"]);
          estado.receitas = s.receitas || {};
          render();
        });
        lista.appendChild(row);
      }
    }
    $("totalColunas").textContent = n ? String(total) + " ped." : "0";
    $("semColunas").style.display = n ? "none" : "block";
  }

  // ── LOJAS ──────────────────────────────────────────────────────────
  async function listarLojas() {
    if (listandoLojas || !estado.token) return;
    listandoLojas = true;
    $("btnLojas").textContent = "… lendo";
    try {
      const r = await chrome.runtime.sendMessage({ tipo: "PRAZOS_LISTAR_LOJAS" });
      if (r && r.ok) {
        const anterior = estado.lojasEncontradas || {};
        estado.lojasEncontradas = {
          ifood: r.ifood && r.ifood.ok ? { lojas: r.ifood.lojas, em: Date.now(), erro: null } : { ...(anterior.ifood || { lojas: [] }), erro: (r.ifood && r.ifood.erro) || "não li" },
          n99: r.n99 && r.n99.ok ? { lojas: r.n99.lojas, em: Date.now(), erro: null } : { ...(anterior.n99 || { lojas: [] }), erro: (r.n99 && r.n99.erro) || "não li" },
        };
        await chrome.storage.local.set({ lojasEncontradas: estado.lojasEncontradas });
      }
    } catch (e) {}
    listandoLojas = false;
    $("btnLojas").textContent = "↻ Atualizar lista";
    render();
  }
  $("btnLojas").addEventListener("click", listarLojas);

  function configLojas(plat) {
    const cfg = (estado.conta && estado.conta.config) || {};
    return plat === "ifood" ? (cfg.lojasIfood || []) : (cfg.lojas99 || []);
  }

  /** União: lojas vistas nas abas (com o `ativa` guardado) + marcadas que não estão neste login. */
  function lojasParaMostrar(plat) {
    const chave = plat === "ifood" ? "uuid" : "shopId";
    const cfg = configLojas(plat);
    const vistas = (estado.lojasEncontradas && estado.lojasEncontradas[plat] && estado.lojasEncontradas[plat].lojas) || [];
    const saida = vistas.map((l) => {
      const c = cfg.find((x) => x[chave] === l[chave]);
      return { ...l, ativa: !!(c && c.ativa), presente: true };
    });
    for (const c of cfg) if (c.ativa && !saida.find((x) => x[chave] === c[chave])) saida.push({ ...c, presente: false });
    return saida;
  }

  function resultadoDaLoja(plat, loja) {
    const u = estado.ultimoAplicado;
    if (!u) return null;
    const lista = plat === "ifood" ? u.ifood : u.n99;
    const chave = plat === "ifood" ? "uuid" : "shopId";
    return Array.isArray(lista) ? lista.find((x) => x[chave] === loja[chave]) || null : null;
  }

  async function alternarLoja(plat, loja, ativa) {
    const chave = plat === "ifood" ? "uuid" : "shopId";
    const todas = lojasParaMostrar(plat).map((l) => {
      const base = plat === "ifood"
        ? { uuid: l.uuid, nome: l.nome, id: l.id || null }
        : { shopId: l.shopId, cityId: l.cityId, contractorId: l.contractorId, nome: l.nome, entregaPropria: typeof l.entregaPropria === "boolean" ? l.entregaPropria : null };
      return { ...base, ativa: l[chave] === loja[chave] ? ativa : !!l.ativa };
    });
    mostrarAvisoLojas("");
    return salvarConfig(plat === "ifood" ? { lojasIfood: todas } : { lojas99: todas });
  }

  function renderPlataforma(plat) {
    const lista = $(plat === "ifood" ? "listaIfood" : "lista99");
    const cnt = $(plat === "ifood" ? "cntIfood" : "cnt99");
    const dica = $(plat === "ifood" ? "dicaIfood" : "dica99");
    lista.innerHTML = "";
    const lojas = lojasParaMostrar(plat);
    const cota = (estado.conta && estado.conta.lojasIncluidas) || 1;
    const marcadas = lojas.filter((l) => l.ativa).length;
    cnt.textContent = marcadas + " de " + cota + " marcada" + (marcadas === 1 ? "" : "s");
    cnt.style.color = marcadas > cota ? "#FCA5A5" : "#94A3B8";
    for (const l of lojas) {
      const row = document.createElement("label");
      row.className = "loja" + (l.presente ? "" : " fora");
      const r = resultadoDaLoja(plat, l);
      let tag = "";
      if (!l.presente) tag = `<span class="tag erro">não está neste login</span>`;
      else if (l.ativa && r) {
        if (r.ok && r.aviso) tag = `<span class="tag" style="color:#FDE68A" title="${String(r.aviso).replace(/"/g, "'")}">✓ ${r.minutos} min (limite)</span>`;
        else if (r.ok) tag = `<span class="tag ok">✓ ${r.minutos} min</span>`;
        else tag = `<span class="tag erro" title="${String(r.erro || "").replace(/"/g, "'")}">✗ ${r.erro || "falhou"}</span>`;
      }
      else if (plat === "ifood" && (l.entrega === false || l.entregaPropria === false)) tag = `<span class="tag">${l.entrega === false ? "sem delivery" : "entrega pelo iFood"}</span>`;
      else if (plat === "n99" && l.signatario && l.signatario !== l.nome) tag = `<span class="tag">${l.signatario}</span>`;
      row.innerHTML = `<input type="checkbox" ${l.ativa ? "checked" : ""}><span class="nome">${l.nome}</span>${tag}`;
      const cb = row.querySelector("input");
      cb.addEventListener("change", async () => {
        cb.disabled = true;
        const ok = await alternarLoja(plat, l, cb.checked);
        if (!ok) cb.checked = !cb.checked;
        cb.disabled = false;
      });
      lista.appendChild(row);
    }
    const enc = estado.lojasEncontradas && estado.lojasEncontradas[plat];
    if (lojas.length === 0) {
      dica.textContent = enc && enc.erro ? enc.erro : (plat === "ifood" ? "Abra o Portal do Parceiro (logado) e clique em Atualizar lista." : "Abra o 99Food Admin (logado) e clique em Atualizar lista.");
    } else if (enc && enc.erro) {
      dica.textContent = "Lista de " + haQuanto(enc.em) + " · " + enc.erro;
    } else {
      dica.textContent = plat === "ifood"
        ? "Só lojas com entrega própria têm prazo para ajustar."
        : "Lojas com entrega pela plataforma também recebem o tempo de preparo.";
    }
  }

  function renderLojas() {
    renderPlataforma("ifood");
    renderPlataforma("n99");
    const cota = (estado.conta && estado.conta.lojasIncluidas) || 1;
    $("cotaTexto").textContent =
      "Seu plano: " + cota + " loja" + (cota > 1 ? "s" : "") + " por plataforma — " + cota +
      " no iFood e " + cota + " no 99Food. Cada R$ 9,90 a mais libera uma loja nas duas.";
  }

  /** Leva ao checkout já na faixa de cima da que ele tem hoje. */
  function abrirUpgrade() {
    const cota = (estado.conta && estado.conta.lojasIncluidas) || 1;
    const base = (estado.serverUrl || SERVIDOR_PADRAO).replace(/\/+$/, "");
    chrome.tabs.create({ url: base + "/prazos?lojas=" + (cota + 1) + "#assinar" });
  }

  $("btnMaisLojas").addEventListener("click", abrirUpgrade);

  $("btnJaComprei").addEventListener("click", async () => {
    const b = $("btnJaComprei");
    const antes = (estado.conta && estado.conta.lojasIncluidas) || 1;
    b.disabled = true;
    b.textContent = "🔄 Conferindo…";
    await atualizarDoServidor();
    const depois = (estado.conta && estado.conta.lojasIncluidas) || 1;
    b.disabled = false;
    b.textContent = "🔄 Já comprei";
    if (depois > antes) {
      mostrarAvisoLojas("");
      $("cotaTexto").textContent =
        "✅ Plano atualizado: agora são " + depois + " lojas por plataforma. Marque as novas aí em cima.";
    } else {
      // O pagamento da Cakto pode levar alguns segundos para virar webhook.
      // Dizer isso é melhor que deixar o botão parecer quebrado.
      mostrarAvisoLojas("Ainda não chegou a confirmação do pagamento. Ela costuma levar alguns segundos — a extensão confere sozinha a cada 20 s.");
    }
  });

  // ── MOTOBOYS / MODO / FAIXAS (iFood) ───────────────────────────────
  $("btnMenos").addEventListener("click", () => { const m = Math.max(1, (estado.conta?.motoboys || 2) - 1); salvarConfig({ motoboys: m }); });
  $("btnMais").addEventListener("click", () => { const m = Math.min(50, (estado.conta?.motoboys || 2) + 1); salvarConfig({ motoboys: m }); });

  $("tabAuto").addEventListener("click", () => salvarConfig({ modo: "auto" }));
  $("tabManual").addEventListener("click", () => salvarConfig({ modo: "manual" }));

  function editorDeFaixas(elLista, lista, aoMudar, padrao) {
    elLista.innerHTML = "";
    if (lista.length === 0) lista.push(...padrao);
    lista.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "regra";
      row.innerHTML = `Até <input type="number" class="rmax" value="${r.maxPedidos}"> ped ➔ <input type="number" class="rmin" value="${r.minutos}"> min <button class="x" style="margin-left:auto;background:none;border:none;color:#EF4444;font-weight:900;cursor:pointer">✕</button>`;
      row.querySelector(".rmax").addEventListener("change", (e) => { lista[i].maxPedidos = parseInt(e.target.value, 10) || 0; aoMudar(); });
      row.querySelector(".rmin").addEventListener("change", (e) => { lista[i].minutos = parseInt(e.target.value, 10) || 0; aoMudar(); });
      row.querySelector(".x").addEventListener("click", () => { if (lista.length > 1) { lista.splice(i, 1); aoMudar(); } });
      elLista.appendChild(row);
    });
  }

  function renderRegras() {
    editorDeFaixas($("listaRegras"), regras, () => salvarConfig({ regrasManuais: regras }), [{ maxPedidos: 3, minutos: 38 }, { maxPedidos: 6, minutos: 58 }, { maxPedidos: 9, minutos: 78 }]);
  }
  $("btnRegra").addEventListener("click", () => {
    const u = regras[regras.length - 1] || { maxPedidos: 5, minutos: 45 };
    regras.push({ maxPedidos: u.maxPedidos + 3, minutos: u.minutos + 20 });
    salvarConfig({ regrasManuais: regras });
  });

  // ── REGRA DO 99 ────────────────────────────────────────────────────
  function salvarPreparo99() { return salvarConfig({ preparo99 }); }
  $("p99desconto").addEventListener("change", () => { preparo99.modo = "desconto"; salvarPreparo99(); });
  $("p99faixas").addEventListener("change", () => { preparo99.modo = "faixas"; salvarPreparo99(); });
  $("p99descontoMin").addEventListener("change", (e) => { preparo99.desconto = Math.max(0, Math.min(120, parseInt(e.target.value, 10) || 0)); preparo99.modo = "desconto"; salvarPreparo99(); });
  $("p99descontoMin").addEventListener("click", (e) => e.preventDefault());
  function renderRegras99() {
    $("p99desconto").checked = preparo99.modo !== "faixas";
    $("p99faixas").checked = preparo99.modo === "faixas";
    if (document.activeElement !== $("p99descontoMin")) $("p99descontoMin").value = preparo99.desconto;
    $("p99faixasC").style.display = preparo99.modo === "faixas" ? "block" : "none";
    editorDeFaixas($("listaRegras99"), preparo99.regras, salvarPreparo99, [{ maxPedidos: 3, minutos: 20 }, { maxPedidos: 6, minutos: 35 }, { maxPedidos: 9, minutos: 50 }]);
  }
  $("btnRegra99").addEventListener("click", () => {
    const u = preparo99.regras[preparo99.regras.length - 1] || { maxPedidos: 5, minutos: 30 };
    preparo99.regras.push({ maxPedidos: u.maxPedidos + 3, minutos: u.minutos + 15 });
    salvarPreparo99();
  });

  // O robô mora na conta (o servidor decide), não neste navegador.
  $("toggleRobo").addEventListener("change", async (e) => {
    const ligado = e.target.checked;
    estado.roboLigado = ligado;
    await chrome.storage.local.set({ roboLigado: ligado });
    const ok = await salvarConfig({ roboLigado: ligado });
    if (!ok) { estado.roboLigado = !ligado; await chrome.storage.local.set({ roboLigado: !ligado }); render(); }
  });

  $("btnAbrirIfood").addEventListener("click", () => chrome.runtime.sendMessage({ tipo: "PRAZOS_ABRIR_IFOOD" }).catch(() => {}));
  $("btnAbrir99").addEventListener("click", () => chrome.runtime.sendMessage({ tipo: "PRAZOS_ABRIR_99" }).catch(() => {}));
  $("btnRelatorio").addEventListener("click", () => {
    if (!estado.token) return;
    const base = (estado.serverUrl || SERVIDOR_PADRAO).replace(/\/$/, "");
    chrome.tabs.create({ url: base + "/prazos/relatorio#token=" + encodeURIComponent(estado.token) });
  });

  // ── TROCAR SENHA ───────────────────────────────────────────────────
  $("btnSenha").addEventListener("click", () => { $("senhaCard").style.display = "block"; $("senhaMsg").style.display = "none"; $("senhaAtual").focus(); });
  $("btnSenhaFechar").addEventListener("click", () => { $("senhaCard").style.display = "none"; });
  $("btnSenhaSalvar").addEventListener("click", async () => {
    const msg = $("senhaMsg");
    const atual = $("senhaAtual").value, nova = $("senhaNova").value, nova2 = $("senhaNova2").value;
    msg.style.display = "block"; msg.style.color = "#FCA5A5";
    if (nova.length < 6) { msg.textContent = "A nova senha precisa de pelo menos 6 caracteres."; return; }
    if (nova !== nova2) { msg.textContent = "As duas senhas novas não são iguais."; return; }
    $("btnSenhaSalvar").disabled = true;
    try {
      const { res, dados } = await api("/api/prazos/senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senhaAtual: atual, novaSenha: nova }) });
      if (res.ok && dados.success) { msg.style.color = "#34D399"; msg.textContent = "✓ Senha trocada. Use a nova no próximo login."; $("senhaAtual").value = ""; $("senhaNova").value = ""; $("senhaNova2").value = ""; }
      else msg.textContent = dados.error || "Não consegui trocar a senha.";
    } catch (e) { msg.textContent = "Servidor indisponível."; }
    $("btnSenhaSalvar").disabled = false;
  });

  // ── RENDER ─────────────────────────────────────────────────────────
  function haQuanto(ms) {
    if (!ms) return "nunca";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "há " + s + " s";
    if (s < 3600) return "há " + Math.round(s / 60) + " min";
    return "há " + Math.round(s / 3600) + " h";
  }

  function statusDaPlataforma(plat) {
    const el = $(plat === "ifood" ? "statusIfood" : "status99");
    const marcadas = configLojas(plat).filter((l) => l.ativa).length;
    const deslogado = plat === "ifood" ? estado.ifoodDesconectado : estado.n99Desconectado;
    if (marcadas === 0) { el.textContent = "sem loja marcada"; el.style.color = "#94A3B8"; return; }
    if (deslogado) { el.textContent = "🔴 deslogado"; el.style.color = "#FCA5A5"; return; }
    const u = estado.ultimoAplicado;
    const lista = u ? (plat === "ifood" ? u.ifood : u.n99) : null;
    if (!u || !Array.isArray(lista) || lista.length === 0) { el.textContent = marcadas + " loja(s) · ainda não aplicou"; el.style.color = "#94A3B8"; return; }
    const ok = lista.filter((x) => x.ok).length;
    const min = plat === "ifood" ? u.minutos : u.preparo99;
    el.textContent = (ok === lista.length ? "🟢 " : "🟠 ") + ok + "/" + lista.length + " · " + min + " min " + haQuanto(u.em);
    el.style.color = ok === lista.length ? "#34D399" : "#FDE68A";
  }

  function render() {
    const logado = !!estado.token && !!estado.conta;
    $("loginScreen").style.display = logado ? "none" : "block";
    $("mainScreen").style.display = logado ? "block" : "none";
    const badge = $("statusBadge");
    if (!logado) { badge.textContent = "DESCONECTADO"; badge.style.background = "#7F1D1D"; badge.style.color = "#FCA5A5"; badge.style.borderColor = "#EF4444"; $("headerTitle").textContent = "FireHub Prazos"; return; }

    const c = estado.conta;
    $("headerTitle").textContent = c.nomeLoja || "FireHub Prazos";
    const cores = { PILOTO: ["#1E3A8A", "#BFDBFE", "#3B82F6"], ATIVO: ["#064E3B", "#34D399", "#059669"], BLOQUEADO: ["#7F1D1D", "#FCA5A5", "#EF4444"], CANCELADO: ["#334155", "#CBD5E1", "#64748B"] };
    const cor = cores[c.status] || cores.CANCELADO;
    badge.textContent = c.status || "—"; badge.style.background = cor[0]; badge.style.color = cor[1]; badge.style.borderColor = cor[2];

    const bloq = $("bloqueio");
    if (c.podeUsar === false) { bloq.textContent = "⛔ " + (c.motivoBloqueio || "Conta sem permissão de uso."); bloq.style.display = "block"; }
    else bloq.style.display = "none";

    const erro = $("erroAtual");
    if (estado.erro && estado.erro.texto) { erro.textContent = "⚠️ " + estado.erro.texto; erro.style.display = "block"; }
    else erro.style.display = "none";

    const l = estado.leitura;
    const painel = $("statusPainel");
    if (l && Date.now() - (l.em || 0) < 120000) { painel.textContent = "🟢 " + l.total + " ped. " + haQuanto(l.em); painel.style.color = "#34D399"; }
    else { painel.textContent = l ? "🔴 sem leitura " + haQuanto(l.em) : "sem leitura"; painel.style.color = "#FCA5A5"; }
    statusDaPlataforma("ifood");
    statusDaPlataforma("n99");

    renderColunas();
    renderLojas();
    $("motoboys").textContent = String(c.motoboys || 2);

    const auto = modoAtivo !== "manual";
    $("tabAuto").classList.toggle("active", auto); $("tabManual").classList.toggle("active", !auto);
    $("tabAutoC").classList.toggle("active", auto); $("tabManualC").classList.toggle("active", !auto);
    renderRegras();
    renderRegras99();

    const p = estado.prazo;
    const banner = $("banner");
    if (p && typeof p.minutos === "number") {
      banner.classList.toggle("pausar", !!p.pausar);
      $("bannerMinutos").innerHTML = "iFood " + p.minutos + " min" + (typeof p.preparo99 === "number" ? "<br><span style=\"font-size:.8rem\">99 preparo " + p.preparo99 + " min</span>" : "");
      $("bannerRotulo").textContent = p.pausar ? "ESTOUROU — pausar a loja" : "Prazo calculado";
      $("bannerSub").textContent = p.rotulo + " · " + p.pedidos + " ped. · " + (p.motoboys || c.motoboys) + " motoboy(s)";
    } else {
      banner.classList.remove("pausar");
      $("bannerMinutos").textContent = "—"; $("bannerRotulo").textContent = "Aguardando leitura do painel"; $("bannerSub").textContent = "marque as colunas e deixe o painel aberto";
    }
    $("toggleRobo").checked = !!estado.roboLigado;
  }

  // ── CARGA E ATUALIZAÇÃO AO VIVO ────────────────────────────────────
  chrome.storage.local.get(["token", "conta", "receitas", "leitura", "prazo", "erro", "roboLigado", "ultimoAplicado", "serverUrl", "lojasEncontradas", "ifoodDesconectado", "n99Desconectado"], async (s) => {
    estado = { ...estado, ...s, receitas: s.receitas || {}, serverUrl: s.serverUrl || SERVIDOR_PADRAO };
    if (estado.conta) aplicarConta(estado.conta);
    render();
    if (estado.token) {
      atualizarDoServidor();
      // Sem lista ainda (ou lista velha): tenta ler das abas abertas ao abrir.
      const enc = estado.lojasEncontradas;
      const velha = !enc || Math.max((enc.ifood && enc.ifood.em) || 0, (enc.n99 && enc.n99.em) || 0) < Date.now() - 10 * 60 * 1000;
      if (velha) listarLojas();
    }
  });

  async function atualizarDoServidor() {
    try {
      const { res, dados } = await api("/api/prazos/estado");
      if (res.status === 401) { estado.token = null; await chrome.storage.local.set({ token: null }); render(); return; }
      if (res.ok && dados.success) { await aplicarConta(dados.conta); render(); }
    } catch (e) {}
  }
  setInterval(() => { if (estado.token) atualizarDoServidor(); }, 20000);

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    for (const k of ["leitura", "prazo", "erro", "roboLigado", "ultimoAplicado", "receitas", "conta", "lojasEncontradas", "ifoodDesconectado", "n99Desconectado"]) {
      if (ch[k]) estado[k] = ch[k].newValue;
    }
    if (ch.conta && ch.conta.newValue) { modoAtivo = ch.conta.newValue.config?.modo || modoAtivo; }
    render();
  });
});
