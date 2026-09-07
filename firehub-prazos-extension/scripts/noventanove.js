/**
 * FireHub Prazos — script do 99Food Admin (merchant.99app.com).
 *
 * Igual ao do iFood: a pílula flutuante com o tempo de preparo em vigor e o
 * motivo de qualquer parada, e o aviso ao service worker quando a sessão cai.
 * Quem escreve o tempo de preparo é o service worker, pela API interna do
 * 99 (executada no contexto desta página) — este script não dirige o DOM.
 */
(function () {
  if (window.__fhPrazos99) return;
  window.__fhPrazos99 = true;

  var ID = "fhprazos-pill-99";

  function css(el, obj) { for (var k in obj) el.style[k] = obj[k]; }

  function criarPilula() {
    if (document.getElementById(ID) || !document.body) return;
    var p = document.createElement("div");
    p.id = ID;
    css(p, {
      position: "fixed", bottom: "20px", right: "20px", zIndex: "2147483000",
      background: "linear-gradient(135deg,#0F172A,#1E293B)", color: "#fff",
      border: "1.5px solid #FF5722", borderRadius: "20px", padding: "6px 14px",
      boxShadow: "0 8px 25px rgba(0,0,0,.35)", font: "800 12px -apple-system,Segoe UI,Roboto,sans-serif",
      display: "flex", alignItems: "center", gap: "8px", cursor: "default", userSelect: "none", maxWidth: "60vw",
    });
    p.innerHTML = "<span>🔥</span><span id=\"" + ID + "-texto\">FireHub Prazos</span>";
    document.body.appendChild(p);
  }

  function mostrar(prazo, erro, ultimo) {
    criarPilula();
    var p = document.getElementById(ID);
    var t = document.getElementById(ID + "-texto");
    if (!p || !t) return;
    if (erro) {
      t.textContent = "FireHub Prazos: " + erro;
      p.style.border = "1.5px solid #EF4444";
      p.style.background = "linear-gradient(135deg,#7F1D1D,#450A0A)";
      return;
    }
    if (prazo && typeof prazo.preparo99 === "number") {
      var n = (prazo.lojas99 || []).length;
      var okN = ultimo && Array.isArray(ultimo.n99) ? ultimo.n99.filter(function (x) { return x.ok; }).length : null;
      t.textContent = "FireHub Prazos · 99Food: preparo " + prazo.preparo99 + " min · " + prazo.pedidos + " ped." +
        (n ? " · " + (okN !== null ? okN + "/" + n : n) + " loja(s)" : " · nenhuma loja marcada") +
        (prazo.pausar ? " · ESTOURO" : "");
      p.style.border = prazo.pausar ? "1.5px solid #EF4444" : "1.5px solid #22C55E";
      p.style.background = prazo.pausar ? "linear-gradient(135deg,#7F1D1D,#450A0A)" : "linear-gradient(135deg,#0F172A,#1E293B)";
      return;
    }
    t.textContent = "FireHub Prazos: aguardando leitura do painel";
    p.style.border = "1.5px solid #FF5722";
  }

  function atualizarDoStorage() {
    try {
      chrome.storage.local.get(["prazo", "erro", "ultimoAplicado"], function (r) {
        mostrar(r && r.prazo, r && r.erro ? r.erro.texto : null, r && r.ultimoAplicado);
      });
    } catch (e) {}
  }

  function conferirSessao() {
    var href = location.href.toLowerCase();
    var deslogado = /\/login|passport|signin/.test(href) && !!document.querySelector('input[type="password"]');
    try { chrome.runtime.sendMessage({ tipo: "N99_SESSAO", conectado: !deslogado }).catch(function () {}); } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, responder) {
    if (msg && msg.tipo === "PRAZOS_STATUS") { mostrar(msg.prazo, msg.erro, msg.ultimoAplicado); responder({ ok: true }); }
  });
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && (ch.prazo || ch.erro || ch.ultimoAplicado)) atualizarDoStorage(); }); } catch (e) {}

  criarPilula();
  atualizarDoStorage();
  conferirSessao();
  setInterval(conferirSessao, 15000);
})();
