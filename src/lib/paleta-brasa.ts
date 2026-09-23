// ── Paleta "Brasa" do painel (aprovada pelo dono em 23/09/2026) ─────────────
// Olhando a prévia no localhost ele disse: "não é sobre deixar tudo cinza, é
// sobre construir uma paleta de cores que combine e não fique poluído, tudo
// colorido". Então são POUCAS cores, todas da família do fogo, e cada uma com
// UM papel:
//
//   vermelho FireHub  → a ação principal da tela/cartão (o próximo passo)
//   laranja brasa     → o que é da entrega (endereço, retirada, pino)
//   verde-azulado     → deu certo (pronto, entregue, pago, atribuído)
//   âmbar             → atenção (perto de estourar o prazo)
//   vermelho grave    → erro, atrasado, cancelado
//   carvão e areia    → texto, ícones, navegação e informação (quente, não cinza)
//
// Azul, roxo, índigo, ciano e o verde-bandeira saíram do painel — o mapa das
// trocas mora em scripts/aplicar-paleta-brasa.js. Cor de MARCA de terceiro
// (iFood, WhatsApp, Facebook) continua a dela.
//
// Regra de uso: cor CHEIA só na ação principal (vermelho) ou na navegação
// (carvão). Verde, âmbar e vermelho aparecem como etiqueta de estado em fundo
// claro — nunca como botão.
export const PALETA = {
  marca: "#C92E09", marcaHover: "#B22908",
  brasa: "#E8590C", brasaClaro: "#FFF4EF", brasaBorda: "#FFD3C2", brasaTinta: "#9A3412",
  ok: "#0F766E", okClaro: "#F0FDFA", okBorda: "#99F6E4",
  atencao: "#B45309", atencaoClaro: "#FFF7E6", atencaoBorda: "#FDE68A",
  grave: "#B71C1C", graveClaro: "#FEF2F2", graveBorda: "#FECACA",
  carvao: "#1C1917", carvao2: "#44403C",
  areia: "#FAF6F2", areiaBorda: "#E7DDD3", areiaTinta: "#57534E",
} as const;
