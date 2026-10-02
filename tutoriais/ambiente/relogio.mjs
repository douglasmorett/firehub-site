// O relógio do tutorial: na gravação é sempre noite de movimento.
//
// A tela de pedidos mostra "o dia de hoje" do navegador. Gravando de madrugada,
// os pedidos de "duas horas atrás" seriam de ontem e sumiriam da tela; gravando
// às 10h, o vídeo mostraria uma loja de delivery lotada no meio da manhã.
//
// Em vez de falsificar o relógio (o que mexe com temporizadores da página),
// escolhe-se o FUSO em que agora são 20h e alguma coisa. O relógio continua
// de verdade — só o fuso é escolhido —, e a mesma escolha vale para o
// navegador da gravação e para a loja fictícia.
export function fusoDaNoite(agora = new Date()) {
  const atras = (agora.getUTCHours() - 20 + 24) % 24; // horas atrás do UTC para dar 20h
  // "Etc/GMT+N" é UTC−N (o sinal é invertido nesse padrão); vai de +12 a −14.
  return atras <= 12 ? `Etc/GMT+${atras}` : `Etc/GMT-${24 - atras}`;
}
