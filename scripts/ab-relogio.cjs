// SÓ PARA O LABORATÓRIO DE A/B: adianta o relógio do processo para testar o fechamento
// de pedido com a loja ABERTA a qualquer hora (fechada, o robô recusa o pedido, e com razão).
//   NODE_OPTIONS="--require ./scripts/ab-relogio.cjs" FIREHUB_AB_AGORA="2026-10-29T19:30:00-03:00"
const alvo = process.env.FIREHUB_AB_AGORA ? Date.parse(process.env.FIREHUB_AB_AGORA) : NaN;
if (Number.isFinite(alvo)) {
  const Real = Date;
  const desvio = alvo - Real.now();
  class Relogio extends Real {
    constructor(...a) {
      if (a.length) super(...a);
      else super(Real.now() + desvio);
    }
    static now() {
      return Real.now() + desvio;
    }
  }
  globalThis.Date = Relogio;
}
