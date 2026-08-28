import { redirect } from "next/navigation";

/**
 * /store/trafego → /store/meta-ads
 *
 * O menu do lojista apontou para /store/trafego por um bom tempo enquanto a
 * página só existia em /store/meta-ads: quem clicava em "Tráfego Pago" batia
 * num 404 e concluía, com razão, que o módulo não funcionava.
 *
 * O link do menu já foi corrigido. Este redirecionamento fica para o endereço
 * errado nunca mais devolver 404 — alguém salvou nos favoritos, mandou por
 * WhatsApp para a equipe ou digitou de cabeça, e isso continua valendo.
 */
export default function TrafegoRedirect() {
  redirect("/store/meta-ads");
}
