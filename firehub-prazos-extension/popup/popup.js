/**
 * FireHub Prazos — popup.
 *
 * Tela de controle. Não calcula nada e não escreve no iFood: pede ao servidor
 * (conta, motoboys, faixas, colunas marcadas) e ao service worker (marcar,
 * recalcular, abrir o portal). O que aparece aqui vem do chrome.storage,
 * que o service worker mantém atualizado — por isso a tela reage ao vivo.
 */
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const SERVIDOR_PADRAO = "https://firehubfood.com.br";
  const VERSAO = chrome.runtime.getManifest().version;

  let estado = { token: null, conta: null, receitas: {}, leitura: null, prazo: null, erro: null, roboLigado: false, ifoodAplicadoEm: null, serverUrl: SERVIDOR_PADRAO };
  let modoAtivo = "auto";
  let regras = [];

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
    const receitas = (conta && conta.config && conta.config.receitas) || {};
    estado.receitas = receitas;
    modoAtivo = (conta && conta.config && conta.config.modo) || "auto";
    regras = (conta && conta.config && Array.isArray(conta.config.regrasManuais)) ? conta.config.regrasManuais.slice() : [];
    return chrome.storage.local.set({ conta, receitas });
  }

  async function salvarConfig(corpo) {
    try {
      const { res, dados } = await api("/api/prazos/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (res.status === 402) { await aplicarConta({ ...(estado.conta || {}), status: dados.status, podeUsar: false, motivoBloqueio: dados.error }); render(); return false; }
      if (!res.ok || !dados.success) { mostrarErroLocal(dados.error || "Não salvou"); return false; }
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
    estado.token = null; estado.conta = null; estado.receitas = {}; estado.prazo = null; estado.leitura = null;
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
      if (/ifood\.com\.br$/.test(new URL(aba.url).host)) { aviso.textContent = "Esta é a aba do iFood. Marque colunas no painel do SEU sistema (onde você vê os pedidos em produção)."; return; }
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

  // ── MOTOBOYS / MODO / FAIXAS ───────────────────────────────────────
  $("btnMenos").addEventListener("click", () => { const m = Math.max(1, (estado.conta?.motoboys || 2) - 1); salvarConfig({ motoboys: m }); });
  $("btnMais").addEventListener("click", () => { const m = Math.min(50, (estado.conta?.motoboys || 2) + 1); salvarConfig({ motoboys: m }); });

  $("tabAuto").addEventListener("click", () => salvarConfig({ modo: "auto" }));
  $("tabManual").addEventListener("click", () => salvarConfig({ modo: "manual" }));

  function renderRegras() {
    const lista = $("listaRegras");
    lista.innerHTML = "";
    if (regras.length === 0) regras = [{ maxPedidos: 3, minutos: 38 }, { maxPedidos: 6, minutos: 58 }, { maxPedidos: 9, minutos: 78 }];
    regras.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "regra";
      row.innerHTML = `Até <input type="number" class="rmax" value="${r.maxPedidos}"> ped ➔ <input type="number" class="rmin" value="${r.minutos}"> min <button class="x" style="margin-left:auto;background:none;border:none;color:#EF4444;font-weight:900;cursor:pointer">✕</button>`;
      row.querySelector(".rmax").addEventListener("change", (e) => { regras[i].maxPedidos = parseInt(e.target.value, 10) || 0; salvarConfig({ regrasManuais: regras }); });
      row.querySelector(".rmin").addEventListener("change", (e) => { regras[i].minutos = parseInt(e.target.value, 10) || 0; salvarConfig({ regrasManuais: regras }); });
      row.querySelector(".x").addEventListener("click", () => { if (regras.length > 1) { regras.splice(i, 1); salvarConfig({ regrasManuais: regras }); } });
      lista.appendChild(row);
    });
  }
  $("btnRegra").addEventListener("click", () => {
    const u = regras[regras.length - 1] || { maxPedidos: 5, minutos: 45 };
    regras.push({ maxPedidos: u.maxPedidos + 3, minutos: u.minutos + 20 });
    salvarConfig({ regrasManuais: regras });
  });

  $("toggleRobo").addEventListener("change", async (e) => {
    estado.roboLigado = e.target.checked;
    await chrome.storage.local.set({ roboLigado: estado.roboLigado });
    chrome.runtime.sendMessage({ tipo: "PRAZOS_RECALCULAR", force: true }).catch(() => {});
  });

  $("btnAbrirIfood").addEventListener("click", () => chrome.runtime.sendMessage({ tipo: "PRAZOS_ABRIR_IFOOD" }).catch(() => {}));

  // ── RENDER ─────────────────────────────────────────────────────────
  function haQuanto(ms) {
    if (!ms) return "nunca";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "há " + s + " s";
    if (s < 3600) return "há " + Math.round(s / 60) + " min";
    return "há " + Math.round(s / 3600) + " h";
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
    const ifood = $("statusIfood");
    if (estado.ultimoAplicado && estado.ultimoAplicado.em) { ifood.textContent = "🟢 " + estado.ultimoAplicado.minutos + " min " + haQuanto(estado.ultimoAplicado.em); ifood.style.color = "#34D399"; }
    else { ifood.textContent = "ainda não aplicou"; ifood.style.color = "#94A3B8"; }

    renderColunas();
    $("motoboys").textContent = String(c.motoboys || 2);

    const auto = modoAtivo !== "manual";
    $("tabAuto").classList.toggle("active", auto); $("tabManual").classList.toggle("active", !auto);
    $("tabAutoC").classList.toggle("active", auto); $("tabManualC").classList.toggle("active", !auto);
    renderRegras();

    const p = estado.prazo;
    const banner = $("banner");
    if (p && typeof p.minutos === "number") {
      banner.classList.toggle("pausar", !!p.pausar);
      $("bannerMinutos").textContent = p.minutos + " min";
      $("bannerRotulo").textContent = p.pausar ? "ESTOUROU — pausar a loja" : "Prazo calculado";
      $("bannerSub").textContent = p.rotulo + " · " + p.pedidos + " ped. · " + (p.motoboys || c.motoboys) + " motoboy(s)";
    } else {
      banner.classList.remove("pausar");
      $("bannerMinutos").textContent = "—"; $("bannerRotulo").textContent = "Aguardando leitura do painel"; $("bannerSub").textContent = "marque as colunas e deixe o painel aberto";
    }
    $("toggleRobo").checked = !!estado.roboLigado;
  }

  // ── CARGA E ATUALIZAÇÃO AO VIVO ────────────────────────────────────
  chrome.storage.local.get(["token", "conta", "receitas", "leitura", "prazo", "erro", "roboLigado", "ultimoAplicado", "serverUrl"], async (s) => {
    estado = { ...estado, ...s, receitas: s.receitas || {}, serverUrl: s.serverUrl || SERVIDOR_PADRAO };
    if (estado.conta) { modoAtivo = estado.conta.config?.modo || "auto"; regras = (estado.conta.config?.regrasManuais || []).slice(); }
    render();
    if (estado.token) atualizarDoServidor();
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
    for (const k of ["leitura", "prazo", "erro", "roboLigado", "ultimoAplicado", "receitas", "conta"]) {
      if (ch[k]) estado[k] = ch[k].newValue;
    }
    if (ch.conta && ch.conta.newValue) { modoAtivo = ch.conta.newValue.config?.modo || modoAtivo; }
    render();
  });
});
