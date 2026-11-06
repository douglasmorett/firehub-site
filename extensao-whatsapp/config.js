// O endereço do FireHub que o painel abre. Produção por padrão; o teste no
// computador (npm run dev / ambiente de tutoriais) troca em ⚙ Opções.
//
// Só entram os endereços que o manifest.json libera (host_permissions): fora
// deles o Chrome não trataria o FireHub como primeira parte no painel e o
// login do painel não valeria lá dentro.
const FIREHUB_PADRAO = "https://firehubfood.com.br";
const FIREHUB_PERMITIDO = /^(https:\/\/(www\.)?firehubfood\.com\.br|http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?)$/;

function normalizarEndereco(bruto) {
  const texto = String(bruto || "").trim().replace(/\/+$/, "");
  try {
    const origem = new URL(texto).origin;
    return FIREHUB_PERMITIDO.test(origem) ? origem : null;
  } catch {
    return null;
  }
}

async function lerEndereco() {
  const { urlDoFireHub } = await chrome.storage.sync.get("urlDoFireHub");
  return normalizarEndereco(urlDoFireHub) || FIREHUB_PADRAO;
}
