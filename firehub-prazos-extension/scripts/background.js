/**
 * FireHub Prazos — service worker.
 *
 * O que ele faz, nesta ordem, o dia inteiro:
 *   1. recebe do leitor a soma das colunas marcadas no painel do lojista;
 *   2. pergunta ao servidor que prazo cabe (POST /api/prazos/calcular) — a
 *      tabela, a regra do 99Food e a lista de lojas marcadas moram lá, junto
 *      com a conta e o status de pagamento;
 *   3. escreve nas lojas que o servidor mandou: no iFood, o prazo de entrega
 *      de cada loja marcada (API do próprio portal, de dentro da aba do
 *      Portal do Parceiro); no 99Food, o tempo de preparo de cada loja
 *      marcada (API do próprio 99Food Admin, de dentro da aba dele). Depois
 *      lê de volta e confere.
 *
 * Regras que valem mais que qualquer código aqui:
 *   - coluna marcada que sumiu do painel NÃO vira zero: segura o último prazo
 *     e avisa (zero no pico = 28 min na hora errada);
 *   - servidor recusou (conta sem pagamento) = para de escrever, com o
 *     motivo na tela;
 *   - só mexe em loja MARCADA pelo lojista; loja do login que não foi
 *     marcada fica como está;
 *   - a extensão nunca abre aba do iFood/99Food sozinha: só o clique do
 *     lojista. Ela precisa das abas abertas e logadas na conta das lojas.
 *
 * As chamadas às APIs internas do iFood e do 99Food rodam no mundo da
 * página (world: MAIN), com os cookies e o token que a própria página usa —
 * é exatamente o que o botão Salvar de cada portal faz, sem clicar em nada.
 */

const VERSAO = chrome.runtime.getManifest().version;
const ALARME = "FHPRAZOS_CICLO";
const IFOOD_SETTINGS_URL = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";
const IFOOD_URL_MATCH = "https://portal.ifood.com.br/*";
const N99_URL = "https://merchant.99app.com/pt-BR/manager";
const N99_URL_MATCH = "https://merchant.99app.com/*";
const SERVIDOR_PADRAO = "https://firehubfood.com.br";
const HISTERESE_MS = 3 * 60 * 1000;
const LEITURA_VELHA_MS = 120 * 1000;

let aplicando = false;

// ── ARMAZENAMENTO ─────────────────────────────────────────────────────

function get(keys) { return chrome.storage.local.get(keys); }
function set(obj) { return chrome.storage.local.set(obj); }

async function servidor() {
  const s = await get(["serverUrl"]);
  return (s.serverUrl || SERVIDOR_PADRAO).replace(/\/$/, "");
}

async function definirErro(texto) {
  await set({ erro: texto ? { texto: String(texto), em: Date.now() } : null });
}

// ── SERVIDOR ──────────────────────────────────────────────────────────

/** POST /api/prazos/calcular. Devolve { ok, dados } ou { ok:false, bloqueado, erro }. */
async function calcularNoServidor(corpo) {
  const s = await get(["token"]);
  if (!s.token) return { ok: false, erro: "sem-login" };
  try {
    const res = await fetch((await servidor()) + "/api/prazos/calcular?token=" + encodeURIComponent(s.token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...corpo, versao: VERSAO }),
      signal: AbortSignal.timeout(8000),
    });
    const dados = await res.json().catch(() => ({}));
    if (res.status === 402) {
      // Conta sem pagamento: o servidor é quem manda parar.
      const conta = (await get(["conta"])).conta || {};
      await set({ conta: { ...conta, status: dados.status || "BLOQUEADO", podeUsar: false, motivoBloqueio: dados.error || "Conta bloqueada" } });
      return { ok: false, bloqueado: true, erro: dados.error || "Conta bloqueada" };
    }
    if (res.status === 401) return { ok: false, deslogado: true, erro: "Sessão inválida. Entre de novo na extensão." };
    if (!res.ok || !dados.success) return { ok: false, erro: dados.error || ("Servidor respondeu " + res.status) };
    return { ok: true, dados };
  } catch (e) {
    return { ok: false, erro: "Servidor indisponível: " + String(e && e.message ? e.message : e) };
  }
}

async function salvarReceitasNoServidor() {
  const s = await get(["token", "receitas"]);
  if (!s.token) return;
  try {
    await fetch((await servidor()) + "/api/prazos/config?token=" + encodeURIComponent(s.token), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receitas: s.receitas || {} }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {}
}

// ── O CICLO ───────────────────────────────────────────────────────────

async function abaDe(padrao) {
  const abas = await chrome.tabs.query({ url: padrao }).catch(() => []);
  // Prefere aba que não está descartada; qualquer uma serve para a API.
  return abas.find((a) => a.id && !a.discarded) || abas.find((a) => a.id) || null;
}

/**
 * Avalia o que foi lido e, se couber, escreve no iFood e no 99Food.
 * `force` ignora a histerese (mudança feita pelo lojista no popup).
 */
async function avaliar(opts) {
  const options = opts || {};
  const s = await get(["token", "conta", "leitura", "receitas", "ultimoDespacho"]);
  if (!s.token) return { motivo: "sem-login" };

  const hosts = Object.keys(s.receitas || {}).filter((h) => (s.receitas[h].colunas || []).length > 0);
  if (hosts.length === 0) {
    await definirErro("Marque as colunas do seu painel de pedidos (botão Marcar coluna).");
    return { motivo: "sem-colunas" };
  }

  const leitura = s.leitura;
  if (!leitura || Date.now() - (leitura.em || 0) > LEITURA_VELHA_MS) {
    await definirErro("Sem leitura do painel há mais de 2 min: abra o painel de pedidos e deixe a aba aberta.");
    await calcularNoServidor({ erro: "painel sem leitura" });
    return { motivo: "leitura-velha" };
  }

  if (leitura.faltando && leitura.faltando.length > 0) {
    // Segura o prazo. Não manda `pedidos`: o servidor mantém o último número.
    const texto = "Coluna \"" + leitura.faltando[0] + "\" não encontrada no painel. Prazo mantido; abra a extensão e marque de novo.";
    await definirErro(texto);
    await calcularNoServidor({ erro: texto, host: leitura.host });
    return { motivo: "coluna-faltando" };
  }

  const resposta = await calcularNoServidor({
    pedidos: leitura.total,
    host: leitura.host,
    colunas: (leitura.colunas || []).map((c) => ({ rotulo: c.rotulo, n: c.n })),
    erro: null,
  });
  if (!resposta.ok) {
    await definirErro(resposta.erro);
    if (resposta.deslogado) await set({ token: null });
    return { motivo: resposta.bloqueado ? "bloqueado" : "servidor", erro: resposta.erro };
  }

  const d = resposta.dados;
  const prazo = {
    minutos: d.minutos, pausar: !!d.pausar, rotulo: d.rotulo, modo: d.modo, pedidos: d.pedidos, motoboys: d.motoboys, em: Date.now(),
    preparo99: d.preparo99 && typeof d.preparo99.minutos === "number" ? d.preparo99.minutos : null,
    rotulo99: d.preparo99 ? d.preparo99.rotulo : null,
    lojasIfood: Array.isArray(d.lojasIfood) ? d.lojasIfood : [],
    lojas99: Array.isArray(d.lojas99) ? d.lojas99 : [],
    lojasIncluidas: d.lojasIncluidas || 1,
  };
  // O robô liga/desliga na CONTA, não neste navegador: PC novo (ou reinstalação)
  // não pode voltar em silêncio para desligado. O storage aqui é só espelho.
  const roboLigado = d.roboLigado === true;
  await set({ prazo, roboLigado });
  await definirErro(null);
  avisarPilulas();

  if (!roboLigado) return { motivo: "robo-desligado", prazo };
  if (prazo.lojasIfood.length === 0 && prazo.lojas99.length === 0) {
    await definirErro("Marque na extensão as lojas do iFood e/ou do 99Food que devem ter o prazo ajustado.");
    return { motivo: "sem-lojas", prazo };
  }

  const ultimo = s.ultimoDespacho || {};
  const erros = [];
  const relato = { ifood: [], n99: [] };
  let tentou = false;

  // ── iFood: prazo de entrega em cada loja marcada ──
  if (prazo.lojasIfood.length > 0) {
    const u = ultimo.ifood || {};
    const pular = !options.force && u.minutos === prazo.minutos && Date.now() - (u.em || 0) < HISTERESE_MS;
    if (!pular) {
      tentou = true;
      const aba = await abaDe(IFOOD_URL_MATCH);
      if (!aba) {
        erros.push("iFood: abra o Portal do Parceiro (logado na conta das lojas) e deixe a aba aberta.");
      } else {
        const r = await aplicarNoIfood(aba.id, prazo.lojasIfood, prazo.minutos);
        relato.ifood = r.resultados || [];
        if (r.deslogado) { await set({ ifoodDesconectado: true }); erros.push("iFood: Portal do Parceiro deslogado — entre de novo."); }
        else if (r.erro) erros.push("iFood: " + r.erro);
        else {
          await set({ ifoodDesconectado: false });
          const falhas = relato.ifood.filter((x) => !x.ok);
          if (falhas.length) erros.push("iFood: " + falhas.map((f) => f.nome + " (" + (f.erro || "falhou") + ")").join(", "));
          if (relato.ifood.some((x) => x.ok)) ultimo.ifood = { minutos: prazo.minutos, em: Date.now() };
        }
      }
    }
  }

  // ── 99Food: tempo de preparo em cada loja marcada ──
  if (prazo.lojas99.length > 0 && typeof prazo.preparo99 === "number") {
    const u = ultimo.n99 || {};
    const pular = !options.force && u.minutos === prazo.preparo99 && Date.now() - (u.em || 0) < HISTERESE_MS;
    if (!pular) {
      tentou = true;
      const aba = await abaDe(N99_URL_MATCH);
      if (!aba) {
        erros.push("99Food: abra o 99Food Admin (logado na conta das lojas) e deixe a aba aberta.");
      } else {
        const r = await aplicarNo99(aba.id, prazo.lojas99, prazo.preparo99);
        relato.n99 = r.resultados || [];
        if (r.deslogado) { await set({ n99Desconectado: true }); erros.push("99Food: 99Food Admin deslogado — entre de novo."); }
        else if (r.erro) erros.push("99Food: " + r.erro);
        else {
          await set({ n99Desconectado: false });
          const falhas = relato.n99.filter((x) => !x.ok);
          if (falhas.length) erros.push("99Food: " + falhas.map((f) => f.nome + " (" + (f.erro || "falhou") + ")").join(", "));
          // Grampeado no limite da loja não é falha: aplicou o que dava, e o
          // lojista precisa saber por que o número ficou menor do que a conta.
          const avisos = relato.n99.filter((x) => x.ok && x.aviso);
          if (avisos.length) erros.push("99Food: " + avisos.map((f) => f.nome + " ficou em " + f.minutos + " min (" + f.aviso + ")").join(", "));
          if (relato.n99.some((x) => x.ok)) ultimo.n99 = { minutos: prazo.preparo99, em: Date.now() };
        }
      }
    }
  }

  if (!tentou) return { motivo: "histerese", prazo };

  const anterior = (await get(["ultimoAplicado"])).ultimoAplicado || {};
  await set({
    ultimoDespacho: ultimo,
    ultimoAplicado: {
      em: Date.now(),
      minutos: prazo.minutos,
      preparo99: prazo.preparo99,
      // Plataforma que não foi tentada neste ciclo mantém o último relato.
      ifood: relato.ifood.length ? relato.ifood : (anterior.ifood || []),
      n99: relato.n99.length ? relato.n99 : (anterior.n99 || []),
    },
  });
  await definirErro(erros.length ? erros.join(" · ") : null);
  avisarPilulas();
  await calcularNoServidor({
    aplicado: { minutos: prazo.minutos, ok: erros.length === 0, ifood: relato.ifood, n99: relato.n99 },
    erro: erros.length ? erros.join(" · ") : null,
  });
  return { motivo: erros.length ? "falhou" : "aplicado", prazo, erros, relato };
}

async function avisarPilulas() {
  try {
    const abas = await chrome.tabs.query({ url: ["https://*.ifood.com.br/*", N99_URL_MATCH] });
    const s = await get(["prazo", "erro", "ultimoAplicado"]);
    for (const aba of abas) {
      if (aba.id) chrome.tabs.sendMessage(aba.id, { tipo: "PRAZOS_STATUS", prazo: s.prazo, erro: s.erro ? s.erro.texto : null, ultimoAplicado: s.ultimoAplicado }).catch(() => {});
    }
  } catch (e) {}
}

// ── FUNÇÕES INJETADAS (autocontidas: rodam na página, não aqui) ───────

function fnOutraExtensaoPresente() {
  return !!document.getElementById("firehub-corner-pill");
}

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

// ── ORQUESTRADOR ──────────────────────────────────────────────────────

async function passo(tabId, func, args, mundo) {
  const r = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [], world: mundo || "ISOLATED" });
  return r && r[0] ? r[0].result : undefined;
}

async function prepararAba(tabId) {
  try {
    const aba = await chrome.tabs.get(tabId);
    if (!aba) return false;
    if (aba.discarded) {
      await chrome.tabs.reload(tabId);
      await new Promise((resolve) => {
        const ouvinte = (id, info) => { if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(ouvinte); resolve(); } };
        chrome.tabs.onUpdated.addListener(ouvinte);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(ouvinte); resolve(); }, 20000);
      });
    }
    try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

async function aplicarNoIfood(tabId, lojas, alvo) {
  if (aplicando) return { erro: "ainda aplicando o ciclo anterior" };
  aplicando = true;
  try {
    if (!(await prepararAba(tabId))) return { erro: "aba do portal indisponível" };
    // A extensão interna do FireHub na mesma aba escreveria o prazo também:
    // duas mãos no mesmo campo. Uma só por conta do iFood.
    if (await passo(tabId, fnOutraExtensaoPresente)) return { erro: "a extensão FireHub interna está ativa nesta aba; use só uma" };
    const r = await passo(tabId, fnIfoodAplicarLojas, [lojas, alvo], "MAIN");
    if (!r) return { erro: "a página do portal não respondeu" };
    return r;
  } catch (e) {
    return { erro: String(e && e.message ? e.message : e) };
  } finally {
    aplicando = false;
  }
}

async function aplicarNo99(tabId, lojas, minutos) {
  try {
    if (!(await prepararAba(tabId))) return { erro: "aba do 99Food Admin indisponível" };
    const r = await passo(tabId, fn99AplicarLojas, [lojas, minutos], "MAIN");
    if (!r) return { erro: "a página do 99Food não respondeu" };
    return r;
  } catch (e) {
    return { erro: String(e && e.message ? e.message : e) };
  }
}

/** Lista as lojas de cada plataforma pelas abas abertas (para o popup marcar). */
async function listarLojas() {
  const saida = { ifood: { ok: false, lojas: [], erro: null }, n99: { ok: false, lojas: [], erro: null } };
  const abaIfood = await abaDe(IFOOD_URL_MATCH);
  if (!abaIfood) saida.ifood.erro = "Abra o Portal do Parceiro (logado) e clique em Atualizar.";
  else {
    try {
      await prepararAba(abaIfood.id);
      const r = await passo(abaIfood.id, fnIfoodListarLojas, [], "MAIN");
      if (r && r.ok) { saida.ifood = { ok: true, lojas: r.lojas, erro: null }; await set({ ifoodDesconectado: false }); }
      else { saida.ifood.erro = (r && r.erro) || "não consegui ler as lojas"; if (r && r.deslogado) await set({ ifoodDesconectado: true }); }
    } catch (e) { saida.ifood.erro = String(e && e.message ? e.message : e); }
  }
  const aba99 = await abaDe(N99_URL_MATCH);
  if (!aba99) saida.n99.erro = "Abra o 99Food Admin (logado) e clique em Atualizar.";
  else {
    try {
      await prepararAba(aba99.id);
      const r = await passo(aba99.id, fn99ListarLojas, [], "MAIN");
      if (r && r.ok) { saida.n99 = { ok: true, lojas: r.lojas, erro: null }; await set({ n99Desconectado: false }); }
      else { saida.n99.erro = (r && r.erro) || "não consegui ler as lojas"; if (r && r.deslogado) await set({ n99Desconectado: true }); }
    } catch (e) { saida.n99.erro = String(e && e.message ? e.message : e); }
  }
  return saida;
}

// ── LEITOR NO PAINEL DO LOJISTA ───────────────────────────────────────

function idDoLeitor(host) { return "fhprazos-leitor-" + host.replace(/[^a-z0-9.-]/gi, "_"); }

/** Registra o leitor para um site (persiste entre reinícios do Chrome). */
async function registrarLeitor(origem) {
  const host = new URL(origem).host;
  const id = idDoLeitor(host);
  const existentes = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
  const def = { id, matches: [origem.replace(/\/$/, "") + "/*"], js: ["scripts/leitor.js"], runAt: "document_idle", persistAcrossSessions: true };
  if (existentes && existentes.length) await chrome.scripting.updateContentScripts([def]);
  else await chrome.scripting.registerContentScripts([def]);
}

/** Depois de instalar/reiniciar: religa o leitor em todo site marcado que ainda tem permissão. */
async function religarLeitores() {
  const s = await get(["receitas"]);
  for (const host of Object.keys(s.receitas || {})) {
    for (const esquema of ["https", "http"]) {
      const origem = esquema + "://" + host;
      try {
        if (await chrome.permissions.contains({ origins: [origem + "/*"] })) { await registrarLeitor(origem); break; }
      } catch (e) {}
    }
  }
}

async function garantirLeitorNaAba(tabId) {
  const ping = await chrome.tabs.sendMessage(tabId, { tipo: "PRAZOS_PING" }).catch(() => null);
  if (ping && ping.ok) return true;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["scripts/leitor.js"] });
  return true;
}

async function avisarLeitores(msg) {
  const s = await get(["receitas"]);
  for (const host of Object.keys(s.receitas || {})) {
    const abas = await chrome.tabs.query({ url: ["https://" + host + "/*", "http://" + host + "/*"] }).catch(() => []);
    for (const aba of abas) if (aba.id) chrome.tabs.sendMessage(aba.id, msg).catch(() => {});
  }
}

// ── ABAS DOS PORTAIS (só por clique do lojista) ───────────────────────

async function focarOuAbrir(padrao, url) {
  const abas = await chrome.tabs.query({ url: padrao });
  if (abas.length && abas[0].id) {
    await chrome.tabs.update(abas[0].id, { active: true });
    if (abas[0].windowId) await chrome.windows.update(abas[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

// ── CICLO DE VIDA E MENSAGENS ─────────────────────────────────────────

async function garantirAlarme() {
  const existe = await chrome.alarms.get(ALARME);
  if (!existe) chrome.alarms.create(ALARME, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { garantirAlarme(); religarLeitores(); });
chrome.runtime.onStartup.addListener(() => { garantirAlarme(); religarLeitores(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARME) avaliar().catch(() => {}); });

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (!msg || !msg.tipo) return;

  if (msg.tipo === "PRAZOS_LEITURA") {
    (async () => {
      // A aba do painel é a fonte de tudo: o Chrome não pode descartá-la.
      if (sender.tab && sender.tab.id) { try { await chrome.tabs.update(sender.tab.id, { autoDiscardable: false }); } catch (e) {} }
      await set({ leitura: { host: msg.host, total: msg.total, colunas: msg.colunas, faltando: msg.faltando || [], marcadas: msg.marcadas, em: Date.now() } });
      const r = await avaliar();
      responder({ ok: true, r });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_COLUNA_MARCADA") {
    (async () => {
      await salvarReceitasNoServidor();
      if (sender.tab && sender.tab.id) chrome.tabs.sendMessage(sender.tab.id, { tipo: "PRAZOS_LER_AGORA" }).catch(() => {});
      responder({ ok: true });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_INICIAR_MARCACAO") {
    (async () => {
      try {
        await registrarLeitor(msg.origem);
        await garantirLeitorNaAba(msg.tabId);
        await chrome.tabs.sendMessage(msg.tabId, { tipo: "PRAZOS_MODO_MARCAR" });
        responder({ ok: true });
      } catch (e) {
        responder({ ok: false, erro: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_REMOVER_COLUNA") {
    (async () => {
      const s = await get(["receitas"]);
      const todas = s.receitas || {};
      if (todas[msg.host]) {
        todas[msg.host].colunas = (todas[msg.host].colunas || []).filter((c) => c.id !== msg.id);
        if (todas[msg.host].colunas.length === 0) delete todas[msg.host];
      }
      await set({ receitas: todas });
      await salvarReceitasNoServidor();
      await avisarLeitores({ tipo: "PRAZOS_RECEITA_ATUALIZADA" });
      responder({ ok: true });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_RECALCULAR") {
    avaliar({ force: !!msg.force }).then((r) => responder({ ok: true, r })).catch((e) => responder({ ok: false, erro: String(e) }));
    return true;
  }

  if (msg.tipo === "PRAZOS_LISTAR_LOJAS") {
    listarLojas().then((r) => responder({ ok: true, ...r })).catch((e) => responder({ ok: false, erro: String(e) }));
    return true;
  }

  if (msg.tipo === "PRAZOS_ABRIR_IFOOD") {
    focarOuAbrir(IFOOD_URL_MATCH, IFOOD_SETTINGS_URL).then(() => responder({ ok: true })).catch(() => responder({ ok: false }));
    return true;
  }

  if (msg.tipo === "PRAZOS_ABRIR_99") {
    focarOuAbrir(N99_URL_MATCH, N99_URL).then(() => responder({ ok: true })).catch(() => responder({ ok: false }));
    return true;
  }

  if (msg.tipo === "IFOOD_SESSAO") {
    (async () => { await set({ ifoodDesconectado: !msg.conectado }); responder({ ok: true }); })();
    return true;
  }

  if (msg.tipo === "N99_SESSAO") {
    (async () => { await set({ n99Desconectado: !msg.conectado }); responder({ ok: true }); })();
    return true;
  }

  if (msg.tipo === "PRAZOS_ENTROU") {
    // Login feito no popup: religa leitores (as receitas vieram do servidor) e avalia.
    (async () => { await religarLeitores(); await avisarLeitores({ tipo: "PRAZOS_RECEITA_ATUALIZADA" }); responder({ ok: true }); })();
    return true;
  }

  if (msg.tipo === "PRAZOS_ATIVAR") {
    // Ativação pelo link do e-mail de compra (scripts/ativar.js). Guarda a
    // sessão e segue o mesmo caminho do login pelo popup — se divergisse, a
    // extensão ativada por link ficaria sem leitor até o lojista recarregar a
    // aba do painel, e ele não teria como adivinhar isso.
    (async () => {
      if (!msg.token) { responder({ ok: false }); return; }
      await set({ token: msg.token, conta: msg.conta || null, erro: null });
      await religarLeitores();
      await avisarLeitores({ tipo: "PRAZOS_RECEITA_ATUALIZADA" });
      responder({ ok: true });
    })();
    return true;
  }

  if (msg.tipo === "PRAZOS_SAIU") {
    (async () => {
      await set({ token: null, conta: null, prazo: null, leitura: null, erro: null, ultimoDespacho: null, ultimoAplicado: null });
      responder({ ok: true });
    })();
    return true;
  }
});
