/**
 * SOM DO PAINEL LIGADO OU DESLIGADO — neste computador.
 *
 * O botão do alto-falante do quadro de pedidos liga e desliga. Fica no
 * navegador (localStorage), não na loja: a cozinha quer o apito e o caixa ao
 * lado, às vezes, não. Desligado, NENHUM aviso do painel toca — pedido novo,
 * cancelamento, transferência, acréscimo, pedido do robô e chamado de
 * atendente. Ligado é o padrão: quem nunca clicou não perde nada.
 */
const CHAVE = "firehub_som_desligado";

export function somDesligado(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

export function gravarSomDesligado(desligado: boolean): void {
  try {
    if (desligado) localStorage.setItem(CHAVE, "1");
    else localStorage.removeItem(CHAVE);
  } catch {}
}
