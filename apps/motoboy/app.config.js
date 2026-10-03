// O app.json é a configuração. Este arquivo só acrescenta o que não pode ir
// para o git: o google-services.json do Firebase (aviso de pedido no Android).
// No EAS ele chega como variável de arquivo GOOGLE_SERVICES_JSON; no computador,
// basta o arquivo na pasta do app (baixado do console do Firebase, projeto
// firehub-entregador).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
