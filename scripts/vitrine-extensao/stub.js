/**
 * `chrome` e `fetch` de mentira para o popup real da extensão rodar fora dela,
 * só para as capturas da Chrome Web Store. A cena vem de window.__CENA, que a
 * vitrine injeta antes deste arquivo. Nada disto entra no pacote.
 */
(function () {
  const CENAS = {
    automatico: {
      storage: { authToken: "demo", storeName: "Pizzaria Exemplo", activeMode: "auto", motoboysCount: 3, autoSyncEnabled: true, ordersInProduction: 7, recommendedMinutes: 58, lastEtaFormatted: "58 min" },
      eta: { success: true, ordersInProduction: 7, recommendedMinutes: 58, etaRangeFormatted: "58 min", shouldPauseStore: false },
    },
    login: { storage: {}, eta: null },
    manual: {
      storage: {
        authToken: "demo", storeName: "Pizzaria Exemplo", activeMode: "manual", motoboysCount: 3, manualSyncEnabled: true, ordersInProduction: 4, recommendedMinutes: 40, lastEtaFormatted: "40 min",
        manualRules: [{ maxOrders: 3, minutes: 30 }, { maxOrders: 6, minutes: 40 }, { maxOrders: 10, minutes: 55 }],
      },
      eta: { success: true, ordersInProduction: 4, recommendedMinutes: 40, etaRangeFormatted: "40 min", shouldPauseStore: false, matchedRuleLabel: "Até 6 ped. (40 min)" },
    },
  };
  const cena = CENAS[window.__CENA] || CENAS.automatico;
  const dados = Object.assign({}, cena.storage);

  // Relógio fixo: a captura não pode sair com a hora em que foi tirada.
  Date.prototype.toLocaleTimeString = function () { return "19:42"; };

  function pegar(chaves) {
    const lista = Array.isArray(chaves) ? chaves : typeof chaves === "string" ? [chaves] : Object.keys(dados);
    const r = {};
    lista.forEach(function (k) { if (k in dados) r[k] = dados[k]; });
    return r;
  }

  window.chrome = {
    storage: {
      local: {
        get: function (chaves, cb) { const r = pegar(chaves); if (cb) cb(r); return Promise.resolve(r); },
        set: function (obj, cb) { Object.assign(dados, obj); if (cb) cb(); return Promise.resolve(); },
        remove: function (_k, cb) { if (cb) cb(); return Promise.resolve(); },
      },
      onChanged: { addListener: function () {} },
    },
    runtime: {
      lastError: undefined,
      getManifest: function () { return { version: "1.0.0" }; },
      sendMessage: function (_msg, cb) {
        const resp = { result: { ok: true, dispatched: true } };
        if (cb) cb(resp);
        return Promise.resolve(resp);
      },
    },
  };

  window.fetch = function (url) {
    let corpo = { success: false };
    if (String(url).includes("/api/store/eta-config")) corpo = { success: true, motoboysCount: dados.motoboysCount || 3 };
    else if (String(url).includes("/api/store/dynamic-eta") && cena.eta) corpo = cena.eta;
    return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
})();
