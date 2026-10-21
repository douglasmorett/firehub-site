/**
 * FireHub Chrome Extension — Background Service Worker
 *
 * FONTE DE VERDADE para a contagem de pedidos:
 * 1. PRIMARIO: Bridge (le o DOM do FireHub em tempo real)
 * 2. FALLBACK: API do servidor (so quando o bridge nao esta ativo)
 *
 * ONDE O PRAZO E ESCRITO (1.1.0, motor trazido da FireHub Prazos):
 * - iFood: o prazo de entrega de CADA loja marcada no popup, pela API do proprio
 *   Portal do Parceiro (o que o botao Salvar manda), de dentro de qualquer aba
 *   logada do portal. Desloca todas as faixas de raio pela mesma diferenca.
 * - 99Food: o tempo de preparo de cada loja marcada (prazo do iFood menos os
 *   minutos de entrega que o lojista informa), pela API do 99Food Admin.
 * - Site e robo do FireHub: o servidor recebe o prazo (POST /api/store/eta-config)
 *   e soma a diferenca em todas as areas de entrega (lib/prazo-automatico.ts).
 * As chamadas rodam no mundo da pagina (world: MAIN), com o login dela, e o
 * laco vive aqui no service worker: funciona com a aba so ABERTA, sem foco.
 * Ate a 1.0.1 era uma loja so, clicando +5/-5 na tela de Entrega.
 */

const ALARM_NAME = "FIREHUB_DYNAMIC_ETA_SYNC";
const SETTINGS_URL = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";
const IFOOD_URL_MATCH = "https://portal.ifood.com.br/*";
const N99_URL = "https://merchant.99app.com/pt-BR/manager";
const N99_URL_MATCH = "https://merchant.99app.com/*";
// 99Food: o cliente ve preparo + a entrega da area (tabela fixa por raio do 99).
// Preparo = prazo do iFood menos estes minutos (o lojista muda no popup).
const DESCONTO_PADRAO_99 = 15;
// O site do FireHub segue o prazo enquanto o robo avisa o servidor (validade de 15 min la).
const REPORTE_AO_SERVIDOR_MS = 60 * 1000;

// Histerese: o alarme AVALIA a cada minuto, mas so ESCREVE no iFood quando a
// faixa muda de verdade ou quando passou o intervalo minimo. Evita um save por
// minuto num portal de terceiro (rate-limit / revisao).
const MIN_APPLY_INTERVAL_MS = 3 * 60 * 1000;
const BRIDGE_FRESH_MS = 30000;

// Lock em memoria contra corrida dentro do mesmo ciclo de vida do SW.
let applyInFlight = false;

// ── ESTADO DO BRIDGE (em storage.session: sobrevive a morte do SW) ──

async function setBridgeState(count) {
  try {
    await chrome.storage.session.set({ bridgeCount: count, bridgeLastUpdate: Date.now() });
  } catch (e) {}
}

async function getBridgeState() {
  try {
    const s = await chrome.storage.session.get(["bridgeCount", "bridgeLastUpdate"]);
    return { count: s.bridgeCount || 0, lastUpdate: s.bridgeLastUpdate || 0 };
  } catch (e) {
    return { count: 0, lastUpdate: 0 };
  }
}

// ── CICLO DE VIDA ──

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[FireHub Extension] Instalada com sucesso!");
  ensureAlarm();
});

// O alarme tambem precisa existir depois de reiniciar o Chrome.
chrome.runtime.onStartup.addListener(() => {
  console.log("[FireHub Extension] Chrome reiniciado, garantindo alarme...");
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runSyncProcess();
  }
});

// ── RECALCULAR QUANDO MOTOBOYS, MODO OU TOGGLE MUDAM ──
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  const triggerKeys = ["motoboysCount", "activeMode", "manualRules", "autoSyncEnabled", "manualSyncEnabled", "lojasIfood", "lojas99", "desconto99"];
  const changed = triggerKeys.some(key => key in changes);

  if (changed) {
    (async () => {
      const bridge = await getBridgeState();
      const store = await chrome.storage.local.get(["ordersInProduction"]);
      const count = bridge.count > 0 ? bridge.count : (store.ordersInProduction || 0);
      console.log("[FireHub] Config mudou, recalculando com " + count + " pedidos...");
      // Config mudou por acao do lojista: ignora a histerese.
      await calculateAndApply(count, { force: true });
    })();
  }
});

// ── RECEPTOR DE MENSAGENS DO BRIDGE, DO CONTENT SCRIPT E DO POPUP ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "FIREHUB_LIVE_COUNT") {
    (async () => {
      await setBridgeState(msg.count);
      console.log("[FireHub Bridge] Contagem ao vivo: " + msg.count + " pedidos em producao");
      await calculateAndApply(msg.count);
      sendResponse({ success: true });
    })();
    return true;
  }

  // O popup NAO despacha mais direto pro iFood. Ele pede ao SW, que e o unico
  // despachante. Dois despachantes concorrentes eram parte do BUG 2.
  if (msg && msg.action === "FORCE_SYNC") {
    (async () => {
      const bridge = await getBridgeState();
      const store = await chrome.storage.local.get(["ordersInProduction"]);
      const count = typeof msg.count === "number"
        ? msg.count
        : (bridge.count > 0 ? bridge.count : (store.ordersInProduction || 0));
      const result = await calculateAndApply(count, { force: true });
      sendResponse({ success: true, result: result });
    })();
    return true;
  }

  if (msg && msg.action === "IFOOD_SESSION_DISCONNECTED") {
    console.warn("[FireHub] Notificacao de iFood Desconectado recebida!");
    chrome.storage.local.set({ ifoodDisconnected: true, ifoodDisconnectedTime: new Date().toLocaleTimeString("pt-BR") });
    notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: msg.reason || "Sessao expirada" });
    sendResponse({ success: true });
    return true;
  }

  if (msg && msg.action === "IFOOD_SESSION_CONNECTED") {
    console.log("[FireHub] iFood Conectado!");
    chrome.storage.local.set({ ifoodDisconnected: false });
    notifyBridgeTabs({ action: "IFOOD_CONNECTED_ALERT" });
    sendResponse({ success: true });
    return true;
  }

  if (msg && msg.action === "FOCUS_OR_OPEN_IFOOD") {
    handleFocusOrOpenIfood(sendResponse, true); // true = rouba foco (clique manual do lojista)
    return true;
  }

  if (msg && msg.action === "FOCUS_OR_OPEN_99") {
    focarOuAbrir(N99_URL_MATCH, N99_URL).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
    return true;
  }

  // Popup: le as lojas dos logins abertos para o lojista marcar.
  if (msg && msg.action === "LISTAR_LOJAS") {
    listarLojas().then((r) => sendResponse({ success: true, ...r })).catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }
});

// Envia mensagem para abas do FireHub ativas
async function notifyBridgeTabs(payload) {
  try {
    const bridgeTabs = await chrome.tabs.query({
      url: [
        "https://firehubfood.com.br/*",
        "https://*.firehubfood.com.br/*",
        "https://firehub.com.br/*",
        "https://*.firehub.com.br/*",
        "http://localhost:3001/*",
        "http://localhost:3000/*"
      ]
    });
    for (const tab of bridgeTabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch (e) {}
}

// ── REAPROVEITAMENTO E FOCO DE ABA DO IFOOD (Evita abas duplicadas) ──
async function handleFocusOrOpenIfood(sendResponse, forceFocus) {
  const settingsTabs = await chrome.tabs.query({ url: SETTINGS_URL + "*" });

  if (settingsTabs.length > 0 && settingsTabs[0].id) {
    if (forceFocus) {
      console.log("[FireHub] Focando na aba de configuracoes existente...");
      await chrome.tabs.update(settingsTabs[0].id, { active: true });
      if (settingsTabs[0].windowId) {
        await chrome.windows.update(settingsTabs[0].windowId, { focused: true });
      }
    }
    if (sendResponse) sendResponse({ success: true, tabId: settingsTabs[0].id });
    return;
  }

  if (!forceFocus) {
    // Sem gesto do lojista a extensao NAO abre aba. Antes abria em segundo plano com
    // cooldown e, quando o portal caia no login (URL diferente da de configuracoes),
    // a busca nao achava a aba e outra era criada a cada 2 minutos — dezenas de abas.
    avisarAbaFaltando();
    if (sendResponse) sendResponse({ success: false, reason: "sem-aba" });
    return;
  }

  const anyIfoodTabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
  if (anyIfoodTabs.length > 0 && anyIfoodTabs[0].id) {
    console.log("[FireHub] Direcionando aba iFood existente para configuracoes...");
    await chrome.tabs.update(anyIfoodTabs[0].id, { url: SETTINGS_URL, active: true });
    if (anyIfoodTabs[0].windowId) {
      await chrome.windows.update(anyIfoodTabs[0].windowId, { focused: true });
    }
    if (sendResponse) sendResponse({ success: true, tabId: anyIfoodTabs[0].id });
    return;
  }

  console.log("[FireHub] Abrindo aba do portal iFood ativa...");
  const newTab = await chrome.tabs.create({ url: SETTINGS_URL, active: true });
  if (sendResponse) sendResponse({ success: true, tabId: newTab.id });
}

/**
 * A aba de configuracoes do iFood NUNCA e criada automaticamente (decisao de
 * 04/09/2026). A extensao so trabalha com a aba que o lojista deixou aberta;
 * sem ela, avisa no painel do FireHub e no popup, e nada mais.
 */
function avisarAbaFaltando() {
  chrome.storage.local.set({
    ifoodApplyError: "Abra o Portal do Parceiro iFood (logado) e deixe a aba aberta"
  });
  notifyBridgeTabs({
    action: "IFOOD_TAB_MISSING_ALERT",
    reason: "O Portal do Parceiro iFood não está aberto. O prazo do iFood não muda até você abrir e deixar a aba aberta (qualquer tela do portal serve)."
  });
}

async function focarOuAbrir(padrao, url) {
  const abas = await chrome.tabs.query({ url: padrao });
  if (abas.length && abas[0].id) {
    await chrome.tabs.update(abas[0].id, { active: true });
    if (abas[0].windowId) await chrome.windows.update(abas[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

// ── FUNCOES INJETADAS NOS PORTAIS (autocontidas: rodam na pagina, nao aqui) ──
// Copiadas da FireHub Prazos (firehub-prazos-extension/scripts/background.js),
// que as testou na escrita real: iFood em 3 lojas e 99Food na Brasa e na Chapa
// Quente (07/09/2026). Mudou la, muda aqui.

/** iFood — lista as lojas do login (GET user/restaurants, com o token da página). */
function fnIfoodListarLojas() {
  var tok = (document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/) || [])[1];
  if (!tok) return { ok: false, deslogado: true, erro: "Portal do Parceiro deslogado" };
  return fetch("https://portal-api.ifood.com.br/next-web-bff/user/restaurants?offset=0&size=100", {
    headers: { Authorization: "Bearer " + tok, Accept: "application/json" },
  }).then(function (r) {
    if (r.status === 401 || r.status === 403) return { ok: false, deslogado: true, erro: "sessão do portal expirou" };
    if (!r.ok) return { ok: false, erro: "portal respondeu " + r.status };
    return r.json().then(function (j) {
      var lista = Array.isArray(j) ? j : (j && (j.items || j.content || j.restaurants)) || [];
      var lojas = lista.filter(function (x) { return x && x.uuid; }).map(function (x) {
        var ops = (x.business && x.business.operations) || [];
        return { uuid: String(x.uuid).toLowerCase(), nome: x.simpleName || x.name || "Loja", id: x.id || null, entrega: ops.indexOf("DELIVERY") !== -1, entregaPropria: null };
      });
      // Entrega pelo iFood (DELIVERY_FULL_SERVICE) não tem prazo para mexer: marca para o popup avisar.
      return Promise.all(lojas.map(function (l) {
        return fetch("https://portal-api.ifood.com.br/next-web-bff/delivery/merchants/" + l.uuid + "/all-delivery-flow-routes", { headers: { Authorization: "Bearer " + tok, Accept: "application/json" } })
          .then(function (rr) { return rr.ok ? rr.json() : null; })
          .then(function (rotas) {
            if (Array.isArray(rotas) && rotas.length) l.entregaPropria = rotas.some(function (x) { return x && x.deliveryFlow && x.deliveryFlow !== "DELIVERY_FULL_SERVICE"; });
          })
          .catch(function () {});
      })).then(function () { return { ok: true, lojas: lojas }; });
    });
  }).catch(function (e) { return { ok: false, erro: String(e && e.message ? e.message : e) }; });
}

/**
 * iFood — escreve o prazo `alvo` nas lojas dadas, pela API do portal:
 * GET all-delivery-flow-routes (setups) → GET faixas de entrega própria →
 * PATCH com o mesmo corpo que o botão Salvar manda → GET para conferir.
 *
 * O prazo da loja é o da faixa mais perto (500 m). Muita loja escalona as
 * faixas seguintes (34, 44, 53… até 110 min no raio maior): a extensão
 * DESLOCA todas pela mesma diferença, preservando a escada que o lojista
 * montou — nunca achata tudo num valor só.
 */
function fnIfoodAplicarLojas(lojas, alvo) {
  var tok = (document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/) || [])[1];
  if (!tok) return Promise.resolve({ deslogado: true, resultados: [] });
  var H = { Authorization: "Bearer " + tok, Accept: "application/json", "Content-Type": "application/json" };
  var base = "https://portal-api.ifood.com.br/next-web-bff/delivery/merchants/";
  function json(url, init) {
    return fetch(url, Object.assign({ headers: H }, init || {})).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("DESLOGADO");
      if (!r.ok) throw new Error("portal respondeu " + r.status);
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    });
  }
  function faixasProprias(cfg) {
    var dm = (cfg && cfg.deliveryMethods) || [];
    return dm.filter(function (m) { return m && m.id && typeof m.time === "number" && (!m.geometry || !m.geometry.deliveredBy || m.geometry.deliveredBy === "MERCHANT"); });
  }
  function umaLoja(l) {
    var saida = { uuid: l.uuid, nome: l.nome, ok: false, minutos: alvo, antes: null, depois: null, erro: null };
    return json(base + l.uuid + "/all-delivery-flow-routes").then(function (rotas) {
      var setups = [];
      (Array.isArray(rotas) ? rotas : []).forEach(function (r) { var id = r && r.setup && r.setup.setupId; if (id && setups.indexOf(id) === -1) setups.push(id); });
      if (!setups.length) { saida.erro = "sem configuração de entrega própria"; return saida; }
      var mexeu = 0;
      var cadeia = Promise.resolve();
      setups.forEach(function (setupId) {
        cadeia = cadeia.then(function () {
          if (saida.erro) return;
          var url = base + l.uuid + "?setupV2=" + encodeURIComponent(setupId) + "&deliveredBy=MERCHANT";
          return json(url).then(function (cfg) {
            var faixas = faixasProprias(cfg);
            if (!faixas.length) return;
            faixas.sort(function (a, b) { return Number(a.label) - Number(b.label); });
            var base0 = faixas[0].time;
            if (saida.antes === null) saida.antes = base0;
            var delta = alvo - base0;
            if (delta === 0) { saida.depois = alvo; mexeu++; return; }
            var limitar = function (t) { return Math.max(5, Math.min(180, t)); };
            var esperado = faixas.map(function (m) { return limitar(m.time + delta); });
            var corpo = faixas.map(function (m, i) { return { deliveryMethodId: m.id, newFee: m.fee, newTime: esperado[i], label: m.label, newOffset: 10 }; });
            return json(url, { method: "PATCH", body: JSON.stringify(corpo) }).then(function () { return json(url); }).then(function (conf) {
              var depois = faixasProprias(conf);
              depois.sort(function (a, b) { return Number(a.label) - Number(b.label); });
              var confere = depois.length === esperado.length && depois.every(function (m, i) { return m.time === esperado[i]; });
              if (!confere) {
                saida.depois = depois.length ? depois[0].time : null;
                saida.erro = "portal não confirmou o novo prazo";
                return;
              }
              saida.depois = alvo; mexeu++;
            });
          });
        });
      });
      return cadeia.then(function () {
        if (saida.erro) return saida;
        if (!mexeu) { saida.erro = "sem faixas de entrega própria (entrega pelo iFood?)"; return saida; }
        saida.ok = true; return saida;
      });
    }).catch(function (e) {
      var msg = String(e && e.message ? e.message : e);
      if (msg === "DESLOGADO") { saida.erro = "portal deslogado"; saida.deslogado = true; } else saida.erro = msg;
      return saida;
    });
  }
  return Promise.all(lojas.map(umaLoja)).then(function (res) { return { resultados: res, deslogado: res.some(function (r) { return r.deslogado; }) }; });
}

/** 99Food — parâmetros que a API interna exige em toda chamada (cookie faz o login). */
function fn99ListarLojas() {
  var app = { appCode: "1.0.0", versionCode: "rc.2508241000", originType: "6", osType: "12", passportAppId: "200108", lang: "pt-BR", locale: "pt-BR", country: "BR", location_country: "BR", countryCode: "BR" };
  function post(caminho, params) {
    return fetch("https://b.99app.com" + caminho, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", tripcountry: "BR" },
      body: new URLSearchParams(Object.assign({}, app, params)).toString(),
    }).then(function (r) { return r.json(); });
  }
  return post("/auth/contractor/getAuthContractorList", {}).then(function (c) {
    if (!c || c.errno !== 0) return { ok: false, deslogado: !!c && c.errno === 990003, erro: (c && c.errmsg) || "99Food não respondeu" };
    var signatarios = (c.data && c.data.list) || [];
    var lojas = [];
    var cadeia = Promise.resolve();
    signatarios.forEach(function (sg) {
      cadeia = cadeia.then(function () {
        var params = { contractorId: sg.contractorId, roleType: "1", brandId: "0", businessType: "1", menuKey: "serviceManagement", shopId: "" };
        return post("/merchant/storefront/getShopList", params).then(function (r) {
          if (!r || r.errno !== 0) { delete params.businessType; return post("/merchant/storefront/getShopList", params); }
          return r;
        }).then(function (r) {
          if (!r || r.errno !== 0) return;
          ((r.data && r.data.list) || []).forEach(function (l) {
            lojas.push({ shopId: String(l.shopId), cityId: String(l.cityId), contractorId: String(l.contractorId || sg.contractorId), nome: l.shopName || "Loja", signatario: sg.contractorName || "" });
          });
        }).catch(function () {});
      });
    });
    return cadeia.then(function () { return { ok: true, lojas: lojas }; });
  }).catch(function (e) { return { ok: false, erro: String(e && e.message ? e.message : e) }; });
}

/**
 * 99Food — escreve `minutos` de preparo nas lojas dadas: lê settingInfo,
 * manda avgProduceTime (o que o botão Salvar da aba Configurações de
 * operações manda) e relê para conferir.
 *
 * Duas coisas que o 99 cobra, medidas na Brasa e na Chapa Quente em
 * 07/09/2026:
 *   - cada loja tem seu limite (`produceTimeConf`: min 3, max 30 min lá).
 *     Pedir 43 volta "O tempo de preparo excede o tempo máximo" — então a
 *     extensão GRAMPEIA no limite da loja e avisa, em vez de falhar;
 *   - `multiPeriodsProduceTime: "[]"` volta "Erro no tipo do parâmetro".
 *     Loja sem tempo especial simplesmente não manda o campo.
 */
function fn99AplicarLojas(lojas, minutos) {
  var app = { appCode: "1.0.0", versionCode: "rc.2508241000", originType: "6", osType: "12", passportAppId: "200108", lang: "pt-BR", locale: "pt-BR", country: "BR", location_country: "BR", countryCode: "BR" };
  function post(caminho, params) {
    return fetch("https://b.99app.com" + caminho, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", tripcountry: "BR" },
      body: new URLSearchParams(Object.assign({}, app, params)).toString(),
    }).then(function (r) { return r.json(); });
  }
  function uma(l) {
    var saida = { shopId: l.shopId, nome: l.nome, ok: false, minutos: minutos, antes: null, depois: null, erro: null, aviso: null, entregaPropria: null };
    var base = { shopId: l.shopId, cityId: l.cityId, contractorId: l.contractorId, roleType: "1" };
    return post("/shop/query/settingInfo", base).then(function (a) {
      if (!a || a.errno !== 0) {
        if (a && a.errno === 990003) { saida.deslogado = true; saida.erro = "99Food deslogado"; }
        else saida.erro = (a && a.errmsg) || "99Food não respondeu";
        return saida;
      }
      var d = a.data || {};
      saida.antes = Math.round((d.avgProduceTime || 0) / 60);
      saida.entregaPropria = d.deliverType === 2;

      var conf = d.produceTimeConf || {};
      var minLoja = typeof conf.min === "number" && conf.min > 0 ? conf.min : 1;
      var maxLoja = typeof conf.max === "number" && conf.max > 0 ? conf.max : 240;
      var alvo = Math.max(minLoja, Math.min(maxLoja, minutos));
      if (alvo !== minutos) saida.aviso = "o 99 limita esta loja a " + maxLoja + " min de preparo";
      saida.minutos = alvo;
      var seg = Math.round(alvo * 60);

      var periodos = Array.isArray(d.multiPeriodsProduceTime) ? d.multiPeriodsProduceTime : [];
      var jaEsta = d.avgProduceTime === seg && periodos.every(function (p) { return (p.periods || []).every(function (q) { return q.preparationTime === seg; }); });
      var corpo = Object.assign({}, base, { appVersion: "1.3.58", avgProduceTime: String(seg), source: "0" });
      // Lista vazia quebra o 99: só manda o campo quando há tempo especial.
      if (periodos.length) {
        corpo.multiPeriodsProduceTime = JSON.stringify(periodos.map(function (p) {
          return { days: p.days, periods: (p.periods || []).map(function (q) { return { begin: q.begin, end: q.end, preparationTime: seg }; }) };
        }));
      }
      var escrever = jaEsta ? Promise.resolve({ errno: 0 }) : post("/shop/setting/avgProduceTime", corpo);
      return escrever.then(function (w) {
        if (!w || w.errno !== 0) { saida.erro = (w && w.errmsg) || "99Food recusou"; return saida; }
        return post("/shop/query/settingInfo", base).then(function (b) {
          saida.depois = b && b.data ? Math.round((b.data.avgProduceTime || 0) / 60) : null;
          saida.ok = saida.depois === alvo;
          if (!saida.ok) saida.erro = "99Food não confirmou (" + saida.depois + " min)";
          return saida;
        });
      });
    }).catch(function (e) { saida.erro = String(e && e.message ? e.message : e); return saida; });
  }
  return Promise.all(lojas.map(uma)).then(function (res) { return { resultados: res, deslogado: res.some(function (r) { return r.deslogado; }) }; });
}

// ── ORQUESTRADOR ──

function hhmm() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

async function passo(tabId, func, args, mundo) {
  const r = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: func, args: args || [], world: mundo || "ISOLATED" });
  return r && r[0] ? r[0].result : undefined;
}

async function abaDe(padrao) {
  const abas = await chrome.tabs.query({ url: padrao }).catch(() => []);
  // Prefere aba que nao esta descartada; qualquer uma serve para a API.
  return abas.find((a) => a.id && !a.discarded) || abas.find((a) => a.id) || null;
}

async function ensureTabReady(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return false;

    // Memory Saver pode descartar a aba: recarrega e espera terminar.
    if (tab.discarded) {
      await chrome.tabs.reload(tabId);
      await new Promise(function (resolve) {
        const listener = function (id, info) {
          if (id === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(function () {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 20000);
      });
    }

    // Impede que o Chrome descarte a aba enquanto ela e nossa efetora.
    try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

/** Lista as lojas de cada plataforma pelas abas abertas (para o popup marcar). */
async function listarLojas() {
  const saida = { ifood: { ok: false, lojas: [], erro: null }, n99: { ok: false, lojas: [], erro: null } };
  const abaIfood = await abaDe(IFOOD_URL_MATCH);
  if (!abaIfood) saida.ifood.erro = "Abra o Portal do Parceiro iFood (logado) e clique em Atualizar.";
  else {
    try {
      await ensureTabReady(abaIfood.id);
      const r = await passo(abaIfood.id, fnIfoodListarLojas, [], "MAIN");
      if (r && r.ok) saida.ifood = { ok: true, lojas: r.lojas, erro: null };
      else saida.ifood.erro = (r && r.erro) || "nao consegui ler as lojas";
    } catch (e) { saida.ifood.erro = String(e && e.message ? e.message : e); }
  }
  const aba99 = await abaDe(N99_URL_MATCH);
  const com99 = await chrome.permissions.contains({ origins: [N99_URL_MATCH] }).catch(() => false);
  if (!com99) saida.n99.erro = "clique em Abrir 99 e permita o acesso ao 99Food.";
  else if (!aba99) saida.n99.erro = "Abra o 99Food Admin (logado) e clique em Atualizar.";
  else {
    try {
      await ensureTabReady(aba99.id);
      const r = await passo(aba99.id, fn99ListarLojas, [], "MAIN");
      if (r && r.ok) saida.n99 = { ok: true, lojas: r.lojas, erro: null };
      else saida.n99.erro = (r && r.erro) || "nao consegui ler as lojas";
    } catch (e) { saida.n99.erro = String(e && e.message ? e.message : e); }
  }
  // Grava aqui, não no popup: o pedido de permissão do 99 fecha o popup e a
  // lista lida se perdia (21/10/2026).
  const s = await chrome.storage.local.get(["lojasIfood", "lojas99"]);
  const novo = {};
  if (saida.ifood.ok) novo.lojasIfood = juntarLojas(saida.ifood.lojas, s.lojasIfood, (l) => l.uuid);
  if (saida.n99.ok) novo.lojas99 = juntarLojas(saida.n99.lojas, s.lojas99, (l) => l.shopId);
  if (Object.keys(novo).length) await chrome.storage.local.set(novo);
  return saida;
}

/** Junta a lista nova com as marcações salvas. Loja nova entra marcada só se for a única. */
function juntarLojas(novas, salvas, id) {
  const antes = new Map((salvas || []).map((l) => [id(l), l.ativa]));
  return novas.map((l) => ({
    ...l,
    ativa: antes.has(id(l)) ? antes.get(id(l)) : (!salvas && novas.length === 1),
  }));
}

// Permitiu o 99Food (o popup já fechou nessa hora): lê as lojas de novo.
chrome.permissions.onAdded.addListener(() => { listarLojas().catch(() => {}); });

/**
 * Lojas do iFood marcadas. Quem atualizou da 1.0.1 nunca marcou nada: se o
 * login tem UMA loja so, ela e marcada sozinha (era essa loja que a extensao ja
 * ajustava); com mais de uma, o lojista escolhe no popup.
 */
async function lojasIfoodMarcadas(tabId) {
  const s = await chrome.storage.local.get(["lojasIfood"]);
  if (Array.isArray(s.lojasIfood)) return s.lojasIfood.filter((l) => l.ativa);
  const r = await passo(tabId, fnIfoodListarLojas, [], "MAIN");
  if (!r || !r.ok) return [];
  const lojas = r.lojas.map((l) => ({ uuid: l.uuid, nome: l.nome, ativa: r.lojas.length === 1 }));
  await chrome.storage.local.set({ lojasIfood: lojas });
  return lojas.filter((l) => l.ativa);
}

/** Escreve `minutos` no iFood e o preparo no 99 das lojas marcadas. */
async function aplicarNasPlataformas(minutos) {
  if (applyInFlight) return { ok: false, reason: "ja-aplicando" };
  applyInFlight = true;
  try {
    const s = await chrome.storage.local.get(["lojasIfood", "lojas99", "desconto99"]);
    const relato = { ifood: null, n99: null };

    // ── iFood: prazo de entrega ──
    // Lista salva e nenhuma marcada = o lojista tirou o iFood (loja so de 99):
    // nada de cobrar a aba do portal dele.
    const semIfood = Array.isArray(s.lojasIfood) && !s.lojasIfood.some((l) => l.ativa);
    const abaIfood = semIfood ? null : await abaDe(IFOOD_URL_MATCH);
    if (semIfood) {
      await chrome.storage.local.set({ ifoodApplyError: null });
    } else if (!abaIfood) {
      avisarAbaFaltando();
      relato.ifood = { ok: false, reason: "sem-aba" };
    } else if (!(await ensureTabReady(abaIfood.id))) {
      relato.ifood = { ok: false, reason: "aba-indisponivel" };
    } else {
      notifyBridgeTabs({ action: "IFOOD_TAB_PRESENT" });
      const lojas = await lojasIfoodMarcadas(abaIfood.id);
      if (lojas.length === 0) {
        await chrome.storage.local.set({ ifoodApplyError: "Marque no popup da extensao as lojas do iFood que devem ter o prazo ajustado" });
        relato.ifood = { ok: false, reason: "sem-lojas" };
      } else {
        const r = await passo(abaIfood.id, fnIfoodAplicarLojas, [lojas, minutos], "MAIN");
        const resultados = (r && r.resultados) || [];
        if (!r || r.deslogado) {
          await chrome.storage.local.set({ ifoodDisconnected: true });
          notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: "Sessao do portal iFood encerrada" });
          relato.ifood = { ok: false, reason: "deslogado" };
        } else {
          const falhas = resultados.filter((x) => !x.ok);
          await chrome.storage.local.set({
            ifoodDisconnected: false,
            ifoodRelato: resultados,
            ifoodApplyError: falhas.length ? falhas.map((f) => f.nome + ": " + (f.erro || "falhou")).join(" · ") : null,
            ...(resultados.some((x) => x.ok) ? { lastAppliedETA: minutos, ifoodLastApply: hhmm() } : {}),
          });
          relato.ifood = { ok: falhas.length === 0, resultados };
        }
      }
    }

    // ── 99Food: tempo de preparo ──
    const lojas99 = Array.isArray(s.lojas99) ? s.lojas99.filter((l) => l.ativa) : [];
    if (lojas99.length > 0) {
      const desconto = typeof s.desconto99 === "number" ? s.desconto99 : DESCONTO_PADRAO_99;
      const preparo = Math.max(5, Math.min(240, minutos - desconto));
      const aba99 = await abaDe(N99_URL_MATCH);
      if (!aba99) {
        await chrome.storage.local.set({ n99ApplyError: "Abra o 99Food Admin (logado) e deixe a aba aberta" });
        relato.n99 = { ok: false, reason: "sem-aba" };
      } else if (!(await ensureTabReady(aba99.id))) {
        relato.n99 = { ok: false, reason: "aba-indisponivel" };
      } else {
        const r = await passo(aba99.id, fn99AplicarLojas, [lojas99, preparo], "MAIN");
        const resultados = (r && r.resultados) || [];
        const falhas = resultados.filter((x) => !x.ok);
        // Grampeado no limite da loja nao e falha: aplicou o que dava, e o
        // lojista precisa saber por que ficou menor do que a conta.
        const avisos = resultados.filter((x) => x.ok && x.aviso);
        await chrome.storage.local.set({
          n99Relato: resultados,
          n99ApplyError: !r ? "a pagina do 99Food nao respondeu"
            : r.deslogado ? "99Food Admin deslogado: entre de novo"
            : [...falhas.map((f) => f.nome + ": " + (f.erro || "falhou")), ...avisos.map((f) => f.nome + " ficou em " + f.minutos + " min (" + f.aviso + ")")].join(" · ") || null,
          ...(resultados.some((x) => x.ok) ? { n99LastApply: hhmm(), n99Preparo: preparo } : {}),
        });
        relato.n99 = { ok: !!r && !r.deslogado && falhas.length === 0, resultados };
      }
    }

    const ok = (!relato.ifood || relato.ifood.ok) && (!relato.n99 || relato.n99.ok);
    return { ok, relato, reason: ok ? null : ((relato.ifood && relato.ifood.reason) || (relato.n99 && relato.n99.reason) || "falhou") };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    await chrome.storage.local.set({ ifoodApplyError: message });
    console.warn("[FireHub aplicarNasPlataformas]", err);
    return { ok: false, reason: "excecao", error: message };
  } finally {
    applyInFlight = false;
  }
}

/**
 * Avisa o servidor do prazo calculado: e com ele que o site e o robo do FireHub
 * sobem o tempo das areas de entrega (vale 15 min la). Uma vez por minuto, ou
 * na hora quando o prazo muda. Tambem marca o uso do mes (so registro: e cortesia).
 */
async function reportarAoServidor(minutos) {
  const s = await chrome.storage.local.get(["authToken", "serverUrl", "ultimoReporte"]);
  if (!s.authToken) return;
  const u = s.ultimoReporte || {};
  if (u.minutos === minutos && Date.now() - (u.em || 0) < REPORTE_AO_SERVIDOR_MS) return;
  const base = (s.serverUrl || "https://firehubfood.com.br").replace(/\/$/, "");
  try {
    const res = await fetch(base + "/api/store/eta-config?token=" + encodeURIComponent(s.authToken), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutos: minutos }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      await chrome.storage.local.set({ ultimoReporte: { minutos: minutos, em: Date.now() }, firehubSiteError: null, firehubSiteLastApply: hhmm() });
    } else {
      await chrome.storage.local.set({
        firehubSiteError: res.status === 401 ? "Sessao antiga: saia e entre de novo na extensao" : "Servidor respondeu " + res.status,
      });
    }
  } catch (e) {
    await chrome.storage.local.set({ firehubSiteError: "Servidor do FireHub nao respondeu" });
  }
}

// ── FUNCAO CENTRAL: Calcula ETA e aplica ──
async function calculateAndApply(count, opts) {
  const options = opts || {};
  try {
    const store = await chrome.storage.local.get([
      "motoboysCount", "activeMode", "manualRules",
      "autoSyncEnabled", "manualSyncEnabled", "ifoodDisconnected",
      "lastDispatchedMinutes", "lastDispatchTime"
    ]);

    const syncEnabled = !!(store.autoSyncEnabled || store.manualSyncEnabled);

    // REGRESSAO CORRIGIDA: o commit 6febead removeu estas duas linhas e o resto
    // da funcao seguiu lendo as variaveis, gerando ReferenceError em toda
    // chamada e matando tudo daqui pra baixo (storage.set e despacho).
    const mode = store.activeMode || "auto";
    const motoboys = store.motoboysCount || 2;

    if (store.ifoodDisconnected && syncEnabled) {
      console.log("[FireHub] iFood desconectado e sync ativo. Avisando o lojista...");
      notifyBridgeTabs({ action: "IFOOD_DISCONNECTED_ALERT", reason: "Sessao do portal iFood encerrada" });
    } else if (!store.ifoodDisconnected) {
      notifyBridgeTabs({ action: "IFOOD_CONNECTED_ALERT" });
    }

    let recommendedMinutes = 38;
    let etaRangeFormatted = "38 min";
    let shouldPauseStore = false;

    if (mode === "manual" && Array.isArray(store.manualRules) && store.manualRules.length > 0) {
      const sorted = store.manualRules.slice().sort(function (a, b) {
        return (a.maxOrders || 0) - (b.maxOrders || 0);
      });
      const matched = sorted.find(function (r) { return count <= r.maxOrders; }) || sorted[sorted.length - 1];
      if (matched) {
        recommendedMinutes = matched.minutes || 58;
        shouldPauseStore = !!matched.pause;
        etaRangeFormatted = shouldPauseStore
          ? recommendedMinutes + " min + PAUSAR"
          : recommendedMinutes + " min";
      }
    } else {
      const max28 = 1 * motoboys;
      const max38 = 2 * motoboys;
      const max58 = 3 * motoboys;
      const max78 = 4 * motoboys;

      if (count <= max28) {
        recommendedMinutes = 28;
        etaRangeFormatted = "28 min";
      } else if (count <= max38) {
        recommendedMinutes = 38;
        etaRangeFormatted = "38 min";
      } else if (count <= max58) {
        recommendedMinutes = 58;
        etaRangeFormatted = "58 min";
      } else if (count <= max78) {
        recommendedMinutes = 78;
        etaRangeFormatted = "78 min";
      } else {
        // ANTES: shouldPause impedia QUALQUER aplicacao, entao no pico o prazo
        // ficava congelado no valor antigo (o pior comportamento possivel).
        // AGORA: aplica o teto E alerta o lojista para pausar.
        recommendedMinutes = 78;
        shouldPauseStore = true;
        etaRangeFormatted = "78 min + PAUSAR LOJA";
      }
    }

    await chrome.storage.local.set({
      ordersInProduction: count,
      lastEtaFormatted: etaRangeFormatted,
      recommendedMinutes: recommendedMinutes,
      lastSyncTime: hhmm(),
      shouldPauseStore: shouldPauseStore
    });

    console.log("[FireHub] " + count + " ped. | " + motoboys + " motoboys | " + mode + " -> " + etaRangeFormatted);

    notifyBridgeTabs({
      action: "ETA_UPDATED",
      formatted: etaRangeFormatted,
      ordersInProduction: count,
      mode: mode,
      shouldPause: shouldPauseStore
    });

    if (!syncEnabled) return { dispatched: false, reason: "sync-desligado", recommendedMinutes: recommendedMinutes };
    // iFood deslogado nao segura mais o resto: o 99 e o site seguem, e a
    // tentativa no iFood devolve "deslogado" sozinha (aplicarNasPlataformas).

    // Site e robo do FireHub: o servidor sobe as areas de entrega junto.
    await reportarAoServidor(recommendedMinutes);

    // ── HISTERESE: so escreve nos portais quando a faixa muda de fato ──
    const sameTier = store.lastDispatchedMinutes === recommendedMinutes;
    const sinceLast = Date.now() - (store.lastDispatchTime || 0);
    if (!options.force && sameTier && sinceLast < MIN_APPLY_INTERVAL_MS) {
      return { dispatched: false, reason: "histerese", recommendedMinutes: recommendedMinutes };
    }

    console.log("[FireHub] Despachando " + recommendedMinutes + " min");

    // Avisa a pilula das abas do iFood (so display, nao automacao).
    const abasIfood = await chrome.tabs.query({ url: IFOOD_URL_MATCH }).catch(() => []);
    for (const aba of abasIfood) {
      if (aba.id) chrome.tabs.sendMessage(aba.id, {
        action: "ETA_STATUS",
        formatted: etaRangeFormatted,
        ordersInProduction: count,
        mode: mode,
        shouldPause: shouldPauseStore
      }).catch(function () {});
    }

    const result = await aplicarNasPlataformas(recommendedMinutes);

    // Marca a tentativa mesmo com falha: o painel manda a contagem a cada
    // poucos segundos, e um portal fora do ar viraria uma chamada por leitura.
    // Com a mesma faixa, tenta de novo depois de MIN_APPLY_INTERVAL_MS.
    if (result.reason !== "ja-aplicando") {
      await chrome.storage.local.set({
        lastDispatchedMinutes: recommendedMinutes,
        lastDispatchTime: Date.now()
      });
    }

    return {
      dispatched: true,
      ok: result.ok,
      reason: result.reason,
      relato: result.relato,
      recommendedMinutes: recommendedMinutes
    };

  } catch (err) {
    // Antes era so console.warn, e por isso o ReferenceError passou meses
    // invisivel. Agora o erro fica no storage e aparece no popup.
    const message = String(err && err.message ? err.message : err);
    console.error("[FireHub calculateAndApply Error]", err);
    try {
      await chrome.storage.local.set({ lastBackgroundError: hhmm() + " - " + message });
    } catch (e) {}
    return { dispatched: false, reason: "erro", error: message };
  }
}

// ── ALARME: FALLBACK QUANDO O BRIDGE NAO ESTA ATIVO ──
async function runSyncProcess() {
  try {
    const bridge = await getBridgeState();
    const bridgeIsActive = (Date.now() - bridge.lastUpdate) < BRIDGE_FRESH_MS;

    if (bridgeIsActive) {
      console.log("[FireHub Alarm] Bridge ativo (" + bridge.count + " ped.), usando contagem do bridge.");
      await calculateAndApply(bridge.count);
      return;
    }

    console.log("[FireHub Alarm] Bridge inativo, buscando contagem da API...");

    const store = await chrome.storage.local.get(["serverUrl", "motoboysCount", "activeMode", "manualRules", "authToken"]);
    const motoboys = store.motoboysCount || 2;
    const mode = store.activeMode || "auto";

    // PRODUCAO E COOLIFY (firehubfood.com.br). O deploy da Vercel virou zumbi e
    // servia contagem de outro ambiente, entao nao entra mais na lista.
    const candidates = store.serverUrl
      ? [store.serverUrl, "https://firehubfood.com.br", "http://localhost:3001", "http://localhost:3000"]
      : ["https://firehubfood.com.br", "http://localhost:3001", "http://localhost:3000"];

    const uniqueUrls = Array.from(new Set(candidates.map(function (u) { return u.replace(/\/$/, ""); })));

    let data = null;
    let workingUrl = null;

    for (const baseUrl of uniqueUrls) {
      try {
        let apiUrl = baseUrl + "/api/store/dynamic-eta?mode=" + mode + "&motoboys=" + motoboys;
        if (store.authToken) {
          apiUrl += "&token=" + store.authToken;
        }
        if (mode === "manual" && Array.isArray(store.manualRules)) {
          apiUrl += "&rules=" + encodeURIComponent(JSON.stringify(store.manualRules));
        }
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(3500) });
        if (res.ok) {
          const json = await res.json();
          if (json && json.success) {
            data = json;
            workingUrl = baseUrl;
            break;
          }
        }
      } catch (e) {}
    }

    if (workingUrl) {
      await chrome.storage.local.set({ serverUrl: workingUrl });
    }

    if (data && data.success) {
      console.log("[FireHub Alarm API] Em Producao=" + data.ordersInProduction + " | " + mode + " -> " + data.etaRangeFormatted);
      await calculateAndApply(data.ordersInProduction);
    } else {
      await chrome.storage.local.set({ lastBackgroundError: hhmm() + " - API nao respondeu em nenhum servidor" });
    }

  } catch (err) {
    console.error("[FireHub Alarm Error]", err);
  }
}
