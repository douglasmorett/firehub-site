/**
 * O que a página da loja fica sabendo do app, antes de carregar: o id desta
 * instalação (./instalacao.ts — sorteado, não é o telefone nem o aparelho).
 *
 * O cardápio manda esse id no pedido e o servidor confere que o app desta
 * marca já o registrou ao abrir (POST /api/app-da-loja/abertura): é a prova de
 * que o pedido veio de DENTRO do app, que o desconto do Clube no cartão exige
 * (src/lib/clube/regras.ts no site). Só nas páginas da loja: a página de
 * pagamento (Asaas, Mercado Pago), que também abre aqui dentro, não recebe nada.
 *
 * Sem import do React Native: o teste do site (scripts/teste-clube-asaas.ts)
 * roda este script num contexto falso.
 */
export function scriptDaInstalacao(instalacaoId: string, marcaId: string, dominios: string[]): string {
  const id = JSON.stringify(instalacaoId);
  const hosts = JSON.stringify(dominios.filter(Boolean).map((d) => d.toLowerCase()));
  return (
    "(function(){try{" +
    `if(${hosts}.indexOf(String(location.hostname).toLowerCase())>=0){` +
    `window.__FIREHUB_APP__={instalacaoId:${id},marca:${JSON.stringify(marcaId)}};}` +
    "}catch(e){}})();true;"
  );
}
