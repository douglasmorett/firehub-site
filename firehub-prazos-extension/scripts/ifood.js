/**
 * FireHub Prazos — script do Portal do Parceiro (portal.ifood.com.br).
 *
 * Só duas funções, de propósito:
 *   1. a pílula flutuante com o prazo em vigor e o motivo de qualquer parada;
 *   2. avisar o service worker quando a sessão do portal cai (tela de login).
 *
 * Quem mexe no prazo é o service worker, de fora da página, via
 * chrome.scripting — este script não dirige o DOM. E se a extensão interna do
 * FireHub estiver na mesma aba (a pílula dela tem id `firehub-corner-pill`),
 * esta avisa e o service worker recusa escrever: uma mão só no campo.
 */
(function () {
  if (window.__fhPrazosIfood) return;
  window.__fhPrazosIfood = true;

  var ID = "fhprazos-pill";

  function css(el, obj) { for (var k in obj) el.style[k] = obj[k]; }

  function criarPilula() {
    if (document.getElementById(ID)) return;
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

  function mostrar(prazo, erro) {
    criarPilula();
    var p = document.getElementById(ID);
    var t = document.getElementById(ID + "-texto");
    if (!p || !t) return;
    if (document.getElementById("firehub-corner-pill")) {
      t.textContent = "FireHub Prazos: extensão FireHub interna ativa nesta aba — use só uma";
      p.style.border = "1.5px solid #EF4444";
      return;
    }
    if (erro) {
      t.textContent = "FireHub Prazos: " + erro;
      p.style.border = "1.5px solid #EF4444";
      p.style.background = "linear-gradient(135deg,#7F1D1D,#450A0A)";
      return;
    }
    if (prazo && typeof prazo.minutos === "number") {
      t.textContent = "FireHub Prazos: " + prazo.minutos + " min · " + prazo.pedidos + " ped." + (prazo.pausar ? " · PAUSAR A LOJA" : "");
      p.style.border = prazo.pausar ? "1.5px solid #EF4444" : "1.5px solid #22C55E";
      p.style.background = prazo.pausar ? "linear-gradient(135deg,#7F1D1D,#450A0A)" : "linear-gradient(135deg,#0F172A,#1E293B)";
      return;
    }
    t.textContent = "FireHub Prazos: aguardando leitura do painel";
    p.style.border = "1.5px solid #FF5722";
  }

  function atualizarDoStorage() {
    try {
      chrome.storage.local.get(["prazo", "erro"], function (r) {
        mostrar(r && r.prazo, r && r.erro ? r.erro.texto : null);
      });
    } catch (e) {}
  }

  function conferirSessao() {
    var href = location.href.toLowerCase();
    if (href.indexOf("openid-connect") !== -1 || href.indexOf("callback") !== -1 || href.indexOf("response_type=") !== -1) return;
    var senha = document.querySelector('input[type="password"]');
    var texto = (document.body ? document.body.innerText : "").toLowerCase();
    var deslogado = !!(senha && (texto.indexOf("fazer login") !== -1 || texto.indexOf("sessão expirou") !== -1 || texto.indexOf("entre com sua conta") !== -1 || href.indexOf("login.ifood.com.br") !== -1));
    try { chrome.runtime.sendMessage({ tipo: "IFOOD_SESSAO", conectado: !deslogado }).catch(function () {}); } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, responder) {
    if (msg && msg.tipo === "PRAZOS_STATUS") { mostrar(msg.prazo, msg.erro); responder({ ok: true }); }
  });
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && (ch.prazo || ch.erro)) atualizarDoStorage(); }); } catch (e) {}

  criarPilula();
  atualizarDoStorage();
  conferirSessao();
  setInterval(conferirSessao, 8000);
})();
