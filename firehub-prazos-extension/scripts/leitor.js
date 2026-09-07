/**
 * FireHub Prazos — leitor do painel do lojista (Saipos, Cardápio Web, o que for).
 *
 * Entra na página do sistema que o lojista já usa — só depois que ele deu
 * permissão para este site, no botão "Marcar coluna" da extensão — e faz duas
 * coisas:
 *
 *   1. MARCAR: modo em que o lojista clica na coluna do kanban que conta
 *      pedido na cozinha ("Em preparo", "Pronto"…). Quantas quiser. De cada
 *      clique sai uma RECEITA: como achar aquela coluna de novo e como contar
 *      nela (o número do cabeçalho, ou os cards dentro).
 *   2. LER: a cada 2 s, resolve cada coluna marcada, conta, soma e manda para
 *      o service worker. Coluna que não é encontrada vira `faltando` — e
 *      quem recebe SEGURA o prazo em vez de contar zero, porque zero no pico
 *      é 28 minutos na hora errada.
 *
 * Tudo aqui é heurística sobre um DOM que não é nosso. Por isso cada receita
 * guarda dois caminhos (seletor CSS e o texto do cabeçalho) e a leitura
 * prefere sempre o contador que o próprio painel já mostra.
 */
(function () {
  if (window.__fhPrazosLeitor) return;
  window.__fhPrazosLeitor = true;

  var HOST = location.host;
  var PREFIXO = "fhprazos";
  var receita = { colunas: [] };
  var marcando = false;
  var ultimoEnvio = 0;
  var ultimaAssinatura = "";

  // ── UTILIDADES DE DOM ──────────────────────────────────────────────────

  function textoProprio(el) {
    var t = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) t += n.nodeValue;
    }
    return (t || "").replace(/\s+/g, " ").trim();
  }

  function ehInteiro(txt) {
    return /^\d{1,3}$/.test(txt);
  }

  function classesUteis(el) {
    var lista = [];
    var cls = (el.className && typeof el.className === "string") ? el.className.split(/\s+/) : [];
    for (var i = 0; i < cls.length; i++) {
      var c = cls[i];
      // Fora: vazio, hash de build (css-modules), tokens longos e estados dinâmicos.
      if (!c || c.length > 32 || /[0-9a-f]{6,}/i.test(c) || /^(active|hover|selected|focus|open|dragging)$/i.test(c)) continue;
      if (!/^[a-zA-Z_-][\w-]*$/.test(c)) continue;
      lista.push(c);
      if (lista.length >= 3) break;
    }
    return lista;
  }

  function esc(v) {
    try { return CSS.escape(v); } catch (e) { return String(v).replace(/([^\w-])/g, "\\$1"); }
  }

  function passoDoSeletor(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id && !/\d{4,}/.test(el.id)) return "#" + esc(el.id);
    var attrs = ["data-droppable", "data-column", "data-column-id", "data-testid", "data-test", "data-id", "data-status", "aria-label"];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v && v.length <= 60) return tag + "[" + attrs[i] + "=\"" + v.replace(/"/g, "\\\"") + "\"]";
    }
    var cls = classesUteis(el);
    var base = tag + (cls.length ? "." + cls.map(esc).join(".") : "");
    // Desempata entre irmãos iguais.
    var pai = el.parentElement;
    if (pai) {
      var iguais = [];
      for (var j = 0; j < pai.children.length; j++) {
        var irm = pai.children[j];
        if (irm.tagName === el.tagName) iguais.push(irm);
      }
      if (iguais.length > 1) base += ":nth-of-type(" + (iguais.indexOf(el) + 1) + ")";
    }
    return base;
  }

  /** Caminho CSS de `el` até `raiz` (exclusiva) ou até um ancestral com id. */
  function caminho(el, raiz) {
    var partes = [];
    var atual = el;
    var passos = 0;
    while (atual && atual !== raiz && atual !== document.body && atual !== document.documentElement && passos < 8) {
      var p = passoDoSeletor(atual);
      partes.unshift(p);
      if (p.charAt(0) === "#") break;
      atual = atual.parentElement;
      passos++;
    }
    return partes.join(" > ");
  }

  function acha(seletor, raiz) {
    if (!seletor) return null;
    try { return (raiz || document).querySelector(seletor); } catch (e) { return null; }
  }

  /** Assinatura de um card: tag + primeira classe útil. */
  function assinaturaDe(el) {
    var cls = classesUteis(el);
    return el.tagName.toLowerCase() + (cls.length ? "." + cls[0] : "");
  }

  /** O elemento dentro de `cont` que mais parece a lista de cards. */
  function acharLista(cont) {
    var melhor = null, melhorN = 1;
    var todos = [cont].concat(Array.prototype.slice.call(cont.querySelectorAll("*")));
    for (var i = 0; i < todos.length && i < 400; i++) {
      var el = todos[i];
      if (el.children.length < 2) continue;
      var grupos = {};
      for (var j = 0; j < el.children.length; j++) {
        var a = assinaturaDe(el.children[j]);
        grupos[a] = (grupos[a] || 0) + 1;
      }
      for (var k in grupos) {
        // Card de pedido tem altura; linha de texto não.
        if (grupos[k] > melhorN && el.children[0].offsetHeight >= 24) { melhorN = grupos[k]; melhor = { el: el, assinatura: k, n: grupos[k] }; }
      }
    }
    return melhor;
  }

  /** O número que o painel já mostra no cabeçalho da coluna. */
  function acharBadge(cont) {
    var todos = cont.querySelectorAll("*");
    for (var i = 0; i < todos.length && i < 80; i++) {
      var el = todos[i];
      var t = textoProprio(el);
      if (ehInteiro(t) && el.offsetWidth < 90 && el.offsetHeight < 60) return el;
    }
    return null;
  }

  /** O título da coluna: o primeiro texto curto que não é número. */
  function acharRotulo(cont) {
    var todos = [cont].concat(Array.prototype.slice.call(cont.querySelectorAll("*")));
    for (var i = 0; i < todos.length && i < 60; i++) {
      var t = textoProprio(todos[i]);
      if (t && t.length >= 2 && t.length <= 40 && !ehInteiro(t)) return t;
    }
    return "Coluna";
  }

  /** Do elemento clicado, sobe até o contêiner que é "a coluna". */
  function escolherContainer(el) {
    var atual = el, candidato = null, passos = 0;
    while (atual && atual !== document.body && passos < 10) {
      var lista = acharListaRasa(atual);
      var alto = atual.offsetHeight >= 150 && atual.offsetWidth >= 120 && atual.offsetWidth <= window.innerWidth * 0.7;
      if (lista && alto) { candidato = atual; break; }
      if (!candidato && alto && acharRotulo(atual) !== "Coluna") candidato = atual;
      atual = atual.parentElement;
      passos++;
    }
    return candidato || el.parentElement || el;
  }

  function acharListaRasa(cont) {
    // Como acharLista, mas só até 3 níveis: evita subir até o kanban inteiro.
    var fila = [{ el: cont, d: 0 }];
    while (fila.length) {
      var it = fila.shift();
      var el = it.el;
      if (el.children.length >= 2) {
        var grupos = {};
        for (var j = 0; j < el.children.length; j++) {
          var a = assinaturaDe(el.children[j]);
          grupos[a] = (grupos[a] || 0) + 1;
          if (grupos[a] >= 2 && el.children[j].offsetHeight >= 24) return el;
        }
      }
      if (it.d < 3) for (var k = 0; k < el.children.length; k++) fila.push({ el: el.children[k], d: it.d + 1 });
    }
    return null;
  }

  // ── RECEITA: como achar e contar uma coluna ───────────────────────────

  function montarReceita(cont) {
    var badge = acharBadge(cont);
    var lista = acharLista(cont);
    var col = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      rotulo: acharRotulo(cont),
      seletor: caminho(cont, null),
      badge: badge ? caminho(badge, cont) : null,
      metodo: badge ? "badge" : "cards",
      lista: lista ? caminho(lista.el, cont) : null,
      assinatura: lista ? lista.assinatura : null,
    };
    return col;
  }

  function resolverColuna(col) {
    var cont = acha(col.seletor);
    if (cont) return cont;
    // Fallback pelo texto do cabeçalho: o painel mudou de classe, o título não.
    var alvo = String(col.rotulo || "").toLowerCase();
    if (!alvo || alvo === "coluna") return null;
    var todos = document.querySelectorAll("*");
    for (var i = 0; i < todos.length; i++) {
      var el = todos[i];
      if (textoProprio(el).toLowerCase() !== alvo) continue;
      var c = escolherContainer(el);
      if (c && c !== document.body) return c;
    }
    return null;
  }

  function contarColuna(col, cont) {
    if (col.metodo === "badge") {
      var b = acha(col.badge, cont) || acharBadge(cont);
      if (b) {
        var t = textoProprio(b);
        if (ehInteiro(t)) return parseInt(t, 10);
      }
    }
    var lista = acha(col.lista, cont);
    if (lista && col.assinatura) {
      var n = 0;
      for (var i = 0; i < lista.children.length; i++) if (assinaturaDe(lista.children[i]) === col.assinatura) n++;
      return n;
    }
    var achada = acharLista(cont);
    if (achada) return achada.n;
    // Contêiner existe e não tem lista: coluna vazia.
    return 0;
  }

  // ── LEITURA PERIÓDICA ──────────────────────────────────────────────────

  function carregarReceita(cb) {
    try {
      chrome.storage.local.get(["receitas"], function (r) {
        var todas = (r && r.receitas) || {};
        receita = todas[HOST] || { colunas: [] };
        if (cb) cb();
      });
    } catch (e) { if (cb) cb(); }
  }

  function ler() {
    if (marcando) return;
    var colunas = [], faltando = [], total = 0;
    for (var i = 0; i < receita.colunas.length; i++) {
      var col = receita.colunas[i];
      var cont = resolverColuna(col);
      if (!cont) { faltando.push(col.rotulo); colunas.push({ id: col.id, rotulo: col.rotulo, n: null, ok: false }); continue; }
      var n = contarColuna(col, cont);
      total += n;
      colunas.push({ id: col.id, rotulo: col.rotulo, n: n, ok: true });
    }
    var msg = { tipo: "PRAZOS_LEITURA", host: HOST, total: total, colunas: colunas, faltando: faltando, marcadas: receita.colunas.length };
    var assinatura = JSON.stringify([total, faltando, colunas.map(function (c) { return c.n; })]);
    var agora = Date.now();
    if (assinatura === ultimaAssinatura && agora - ultimoEnvio < 10000) return;
    ultimaAssinatura = assinatura;
    ultimoEnvio = agora;
    try { chrome.runtime.sendMessage(msg).catch(function () {}); } catch (e) {}
  }

  // ── MODO MARCAR ────────────────────────────────────────────────────────

  var realce = null, faixa = null, alvoAtual = null;

  function css(el, obj) { for (var k in obj) el.style[k] = obj[k]; }

  function entrarEmMarcacao() {
    if (marcando) return;
    marcando = true;
    realce = document.createElement("div");
    realce.id = PREFIXO + "-realce";
    css(realce, { position: "fixed", pointerEvents: "none", zIndex: "2147483646", border: "3px solid #FF5722", background: "rgba(255,87,34,0.10)", borderRadius: "10px", transition: "all .08s", display: "none" });
    faixa = document.createElement("div");
    faixa.id = PREFIXO + "-faixa";
    css(faixa, { position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", background: "#0F172A", color: "#fff", padding: "10px 16px", borderRadius: "14px", font: "700 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif", boxShadow: "0 10px 30px rgba(0,0,0,.35)", display: "flex", gap: "12px", alignItems: "center", maxWidth: "92vw" });
    faixa.innerHTML = "🔥 <span>Clique na coluna que conta pedido na cozinha. Pode marcar mais de uma.</span>" +
      "<button id=\"" + PREFIXO + "-concluir\" style=\"background:#FF5722;color:#fff;border:0;border-radius:9px;padding:6px 12px;font-weight:900;cursor:pointer\">Concluir</button>";
    document.body.appendChild(realce);
    document.body.appendChild(faixa);
    document.getElementById(PREFIXO + "-concluir").addEventListener("click", sairDeMarcacao);
    document.addEventListener("mousemove", aoMover, true);
    document.addEventListener("click", aoClicar, true);
    document.addEventListener("keydown", aoTecla, true);
  }

  function sairDeMarcacao() {
    marcando = false;
    document.removeEventListener("mousemove", aoMover, true);
    document.removeEventListener("click", aoClicar, true);
    document.removeEventListener("keydown", aoTecla, true);
    if (realce) realce.remove();
    if (faixa) faixa.remove();
    realce = faixa = alvoAtual = null;
    ler();
  }

  function aoTecla(e) { if (e.key === "Escape") { e.preventDefault(); sairDeMarcacao(); } }

  function aoMover(e) {
    if (!marcando) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || (faixa && faixa.contains(el))) return;
    var cont = escolherContainer(el);
    if (cont === alvoAtual) return;
    alvoAtual = cont;
    var r = cont.getBoundingClientRect();
    css(realce, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }

  function aoClicar(e) {
    if (!marcando) return;
    if (faixa && faixa.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    var cont = alvoAtual || escolherContainer(e.target);
    if (!cont) return;
    var col = montarReceita(cont);
    var n = contarColuna(col, cont);
    // Grava localmente e avisa o service worker (que leva ao servidor).
    receita.colunas = receita.colunas.filter(function (c) { return c.seletor !== col.seletor; });
    receita.colunas.push(col);
    chrome.storage.local.get(["receitas"], function (r) {
      var todas = (r && r.receitas) || {};
      todas[HOST] = { colunas: receita.colunas, atualizadoEm: new Date().toISOString() };
      chrome.storage.local.set({ receitas: todas }, function () {
        try { chrome.runtime.sendMessage({ tipo: "PRAZOS_COLUNA_MARCADA", host: HOST, coluna: col, n: n }).catch(function () {}); } catch (err) {}
      });
    });
    aviso("✅ \"" + col.rotulo + "\" marcada — " + n + " pedido(s) agora. Marque outra ou clique em Concluir.");
  }

  function aviso(texto) {
    var t = document.getElementById(PREFIXO + "-aviso");
    if (!t) {
      t = document.createElement("div");
      t.id = PREFIXO + "-aviso";
      css(t, { position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", background: "#064E3B", color: "#D1FAE5", padding: "10px 16px", borderRadius: "12px", font: "700 13px -apple-system,Segoe UI,Roboto,sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,.3)", maxWidth: "90vw" });
      document.body.appendChild(t);
    }
    t.textContent = texto;
    clearTimeout(t.__timer);
    t.__timer = setTimeout(function () { t.remove(); }, 4000);
  }

  // ── MENSAGENS ──────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (msg, sender, responder) {
    if (!msg || !msg.tipo) return;
    if (msg.tipo === "PRAZOS_MODO_MARCAR") { entrarEmMarcacao(); responder({ ok: true }); }
    if (msg.tipo === "PRAZOS_RECEITA_ATUALIZADA") { carregarReceita(function () { ultimaAssinatura = ""; ler(); }); responder({ ok: true }); }
    if (msg.tipo === "PRAZOS_LER_AGORA") { ultimaAssinatura = ""; ler(); responder({ ok: true }); }
    if (msg.tipo === "PRAZOS_PING") responder({ ok: true, host: HOST, marcadas: receita.colunas.length });
  });

  // Gancho para suporte e teste: no console da página do painel,
  // `__fhPrazosDebug.montarReceita(__fhPrazosDebug.escolherContainer(el))` mostra
  // o que a extensão veria ao marcar `el`. Não faz nada sozinho.
  window.__fhPrazosDebug = { escolherContainer: escolherContainer, montarReceita: montarReceita, resolverColuna: resolverColuna, contarColuna: contarColuna, acharRotulo: acharRotulo };

  carregarReceita(function () { ler(); });
  setInterval(ler, 2000);
})();
