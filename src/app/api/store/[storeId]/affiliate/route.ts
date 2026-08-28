import { NextResponse } from "next/server";

/**
 * DESATIVADA — resquício do "Indique e Ganhe" entre lojistas.
 *
 * Ela gravava o `asaasWalletId` do próprio lojista, e o motor de faturamento
 * usava esse campo para repassar 20% da mensalidade de quem tivesse o
 * `referredById` dele. O programa foi encerrado para o cliente comum e a tela
 * saiu do painel, mas a rota continuou no ar sem nenhuma UI chamando: qualquer
 * lojista logado que a descobrisse passava a receber comissão de verdade.
 *
 * O split hoje sai só do programa de embaixadores (lib/billing.ts), que é
 * fechado e entra por promoção manual do admin. Se um dia o programa entre
 * lojistas voltar, ele volta por ali — não por aqui.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Programa de afiliados entre lojistas encerrado." },
    { status: 410 }
  );
}
