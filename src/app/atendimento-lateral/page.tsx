import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import PainelLateral from "./PainelLateral";

export const dynamic = "force-dynamic";
export const metadata = { title: "Balcão FireHub no WhatsApp" };

/**
 * /atendimento-lateral — O BALCÃO DENTRO DO WHATSAPP WEB.
 *
 * É a página que a extensão do Chrome (extensao-whatsapp/) abre na lateral do
 * WhatsApp Web: o balcão compacto (components/balcao, modo "atendimento"), com
 * o cliente da conversa aberta lá preenchido pela extensão.
 *
 * Fica FORA de /store de propósito: o layout do painel desenha menu, barra do
 * topo, avisos e a central de tutoriais — numa coluna de 400px dentro do
 * WhatsApp isso tudo só tiraria lugar do pedido. A sessão é a mesma do painel,
 * e por isso a porta também: só loja e funcionário com o Balcão liberado
 * (a mesma caixinha de /store/venda-presencial, lib/permissao-da-tela).
 *
 * Ela pode ser emoldurada SÓ pela extensão (frame-ancestors chrome-extension:,
 * no next.config e no proxy). Todo o resto do site segue com DENY.
 */
export default async function AtendimentoLateral() {
  const session = await getServerSession(authOptions).catch(() => null);
  const role = (session?.user as any)?.role;
  if (!session?.user?.email || (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF")) {
    return <PainelLateral estado="entrar" />;
  }
  if (role === "STAFF") {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { permissions: true } }).catch(() => null);
    if (!funcionarioAbre("/store/venda-presencial", user?.permissions)) return <PainelLateral estado="sem-permissao" />;
  }
  return <PainelLateral estado="pronto" />;
}
