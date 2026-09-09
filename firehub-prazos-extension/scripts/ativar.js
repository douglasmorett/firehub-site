/**
 * FireHub Prazos — ativação em um clique.
 *
 * Roda só em firehubfood.com.br/prazos/ativar. O lojista clica no link que
 * chegou no e-mail da compra e acaba: a extensão entra sozinha, sem ele
 * copiar senha nenhuma.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 *   1. QUEM CHAMA A API É AQUI, não a página. O código sai da URL e o token
 *      volta para dentro da extensão. Assim o token nunca encosta no DOM nem
 *      no JavaScript da página — se um dia essa página carregar um script de
 *      terceiro (pixel, chat), ele não tem como ler a sessão de ninguém.
 *
 *   2. A PÁGINA NÃO SABE SE A EXTENSÃO EXISTE até este script falar. Por isso
 *      ele avisa a página em dois momentos: "estou aqui" assim que carrega, e
 *      "entrou" quando termina. Sem o primeiro aviso, a página mostraria
 *      "instale a extensão" para quem já instalou.
 */
(function () {
  if (window.__fhPrazosAtivar) return;
  window.__fhPrazosAtivar = true;

  // Dois canais para a página, de propósito. O postMessage é imediato; o
  // atributo no <html> é PERSISTENTE. A página é React e monta o listener num
  // useEffect — se este script rodar antes disso (document_idle costuma
  // ganhar da hidratação), um postMessage solitário se perde e a página conclui
  // "não tem extensão". Visto no teste em Edge isolado de 09/09/2026. O
  // atributo fica lá para a página ler quando acordar, e o aviso é repetido
  // por alguns segundos para o caso do listener chegar no meio.
  function avisar(estado, texto) {
    document.documentElement.setAttribute("data-fh-prazos", estado);
    document.documentElement.setAttribute("data-fh-prazos-texto", texto || "");
    window.postMessage({ fonte: "firehub-prazos", estado: estado, texto: texto || "" }, window.location.origin);
  }

  avisar("extensao-presente");
  var repeticoes = 0;
  var repetidor = setInterval(function () {
    var atual = document.documentElement.getAttribute("data-fh-prazos");
    if (atual !== "extensao-presente" || ++repeticoes > 15) { clearInterval(repetidor); return; }
    window.postMessage({ fonte: "firehub-prazos", estado: "extensao-presente", texto: "" }, window.location.origin);
  }, 400);

  var codigo = new URLSearchParams(window.location.search).get("t");
  if (!codigo) {
    avisar("sem-codigo");
    return;
  }

  chrome.storage.local.get(["token"], function (guardado) {
    if (guardado && guardado.token) {
      // Já logado neste Chrome: reativar seria queimar o código à toa, e o
      // lojista que reabre o e-mail antigo não pode ser deslogado por isso.
      avisar("ja-ativa", "Esta extensão já está conectada nesta máquina.");
      return;
    }

    fetch(window.location.origin + "/api/prazos/ativar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: codigo }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.success) {
          avisar("erro", res.d.error || "Não consegui ativar.");
          return;
        }
        // O service worker é quem guarda a sessão e acorda os alarmes; mandar
        // por mensagem em vez de gravar direto no storage evita a extensão
        // ficar "logada" sem ninguém ter começado a trabalhar.
        chrome.runtime.sendMessage(
          { tipo: "PRAZOS_ATIVAR", token: res.d.token, conta: res.d.conta },
          function () {
            if (chrome.runtime.lastError) {
              avisar("erro", "A extensão não respondeu. Feche e abra o Chrome e clique no link de novo.");
              return;
            }
            avisar("ativada", res.d.conta && res.d.conta.nomeLoja ? res.d.conta.nomeLoja : "");
          },
        );
      })
      .catch(function () {
        avisar("erro", "Sem conexão com o servidor do FireHub.");
      });
  });
})();
