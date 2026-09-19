/**
 * /src/lib/codigo-de-entrega.ts
 *
 * O que fazer com a resposta do iFood quando o motoboy digita, na porta do
 * cliente, o código de entrega de 4 dígitos. Sem banco e sem rede de propósito:
 * é a regra que decide se o entregador fica preso no teclado ou segue, e ela é
 * provada por scripts/teste-codigo-de-entrega.mjs.
 *
 * Três desfechos, e só um prende o entregador:
 *
 *   conferido     o iFood aceitou — e é ELE que conclui o pedido (CONCLUDED).
 *                 Ninguém chama "entregue" em cima.
 *   errado        o iFood disse que o código não confere. Volta ao teclado.
 *   indisponivel  todo o resto (403, 5xx, timeout, sem credencial). A entrega
 *                 segue com aviso e o motivo fica no pedido, em
 *                 ifoodDropCodeInfo (ver a correção de 12/09/2026 em
 *                 api/motoboys/orders).
 */

export type ResultadoCodigo = "conferido" | "errado" | "indisponivel";

/**
 * iFood, `POST /order/v1.0/orders/{id}/verifyDeliveryCode` (módulo Order).
 *
 * ── O que a produção responde, medido nos pedidos reais ─────────────────────
 *
 * A referência da API promete `{success: true|false}` e o guia escreve
 * `{valid: true}`. O que chega de verdade, lido de `ifoodDropCodeInfo` em
 * 19/09/2026 (30 dias, 101 conferências):
 *
 *   200 corpo VAZIO    81x  código certo — o iFood conclui o pedido
 *   400                 9x  {"errorType":"NOT_FOUND",
 *                            "description":"Confirmation code is invalid"}
 *   403 HTML             7x  "Access Denied" — bloqueio da plataforma
 *   422                  1x  {"code":"ORDER_ALREADY_CONFIRMED"}
 *
 * ── O 400 ERA CÓDIGO ERRADO, E PASSAVA ─────────────────────────────────────
 *
 * O 400 caía no `indisponivel` — o desfecho que NÃO prende o entregador — e a
 * entrega era concluída. Ou seja: o motoboy digitava um código errado e o
 * pedido fechava assim mesmo, que é o contrário de para que o código existe.
 * Foram nove entregas em 30 dias, e o dono viu acontecer (19/09/2026).
 *
 * O iFood diz o motivo em texto claro ("Confirmation code is invalid"), então
 * é por ele que se decide, não pelo número do status: a mesma frase pode vir
 * com outro código HTTP amanhã, e um 400 de requisição malformada não deve
 * mandar o cliente ditar o código de novo.
 *
 * O 403 continua em `indisponivel` de propósito: é "Access Denied" em HTML, um
 * bloqueio da plataforma que não diz nada sobre o código. Prender o entregador
 * na porta do cliente por causa de uma permissão nossa foi o incidente de
 * 12/09 (ver api/motoboys/orders) — quem não tem como conferir usa o "não
 * tenho o código", que fica registrado com o nome de quem decidiu.
 *
 * ── "JÁ CONFIRMADO" É CÓDIGO CERTO ─────────────────────────────────────────
 *
 * O toque repetido do motoboy (ou o cliente que confirmou antes) volta 422
 * ORDER_ALREADY_CONFIRMED. Isso é conferido, não errado — mandar redigitar
 * prenderia o entregador num código que está certo. A leitura é pelo TEXTO,
 * insensível a maiúsculas e ao formato do corpo: houve caso gravado como
 * "errado" com esse mesmo corpo, e código certo recusado é tão ruim quanto
 * código errado aceito.
 */
export function lerRespostaCodigoIfood(r: {
  ok: boolean;
  status: number;
  data?: unknown;
  texto?: string;
}): ResultadoCodigo {
  const d = (r.data ?? {}) as { success?: unknown; valid?: unknown; code?: unknown };
  if (r.ok) return d.success === false || d.valid === false ? "errado" : "conferido";

  // Tudo que o iFood escreveu, venha em objeto ou em texto cru.
  let cru = typeof r.texto === "string" ? r.texto : "";
  try { cru += " " + JSON.stringify(r.data ?? {}); } catch {}
  cru = cru.toLowerCase();

  // Bloqueio de PERMISSÃO (401/403) não fala do pedido: é o WAF ou a
  // credencial, e nada no corpo dele prova que o código foi aceito.
  const bloqueioDePermissao = r.status === 401 || r.status === 403;

  if (!bloqueioDePermissao && /order_already_confirmed|already confirmed|já confirmad/.test(cru)) return "conferido";
  if (!bloqueioDePermissao && /confirmation code is invalid|invalid.{0,12}code|c[oó]digo.{0,12}inv[aá]lid|code.{0,12}not.{0,12}(found|match)/.test(cru)) return "errado";

  // 422 sem texto conhecido segue como errado (era assim antes e nada mudou).
  if (r.status === 422) return "errado";

  return "indisponivel";
}

/**
 * O FireHub já mandou "saiu para entrega" ao iFood?
 *
 * Só SAIU_ENTREGA prova isso: é a transição que dispara o dispatch (painel,
 * rota e WhatsApp do motoboy). O pedido PUXADO pelo QR da comanda chega às
 * mãos do motoboy em PRONTO ou ACEITO — para o iFood ele nunca saiu da loja, e
 * o guia do módulo Order põe o despacho antes da confirmação da entrega. Nesses
 * casos quem dá baixa despacha antes de conferir.
 */
export function jaSaiuNoParceiro(status?: string | null): boolean {
  return status === "SAIU_ENTREGA" || status === "SAIU_PARA_ENTREGA";
}
