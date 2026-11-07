import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import ListaDeIntegracoes from "./ListaDeIntegracoes";

export const dynamic = "force-dynamic";

/**
 * "Itens das integrações": o único lugar que mostra os espelhos de integração
 * (lib/espelho-de-integracao.ts) — para o lojista dizer qual produto real é
 * cada um. A lista vem da rota api/store/cardapio/integracoes, que já resolve
 * a loja da sessão; aqui só se garante que há sessão.
 */
export default async function ItensDasIntegracoesPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  return (
    <div className="container" style={{ marginTop: "1.5rem", maxWidth: 900 }}>
      <Link href="/store/cardapio" className="text-muted" style={{ fontSize: "0.85rem", textDecoration: "none" }}>
        ← Voltar ao cardápio
      </Link>
      <h1 className="font-bold" style={{ fontSize: "1.8rem", margin: "0.5rem 0 0" }}>🔗 Itens das integrações</h1>
      <p className="text-muted" style={{ margin: "6px 0 1.5rem", maxWidth: 680, lineHeight: 1.5 }}>
        Itens que chegaram pelo iFood, 99Food, Keeta e outros com nome diferente do seu cardápio. Diga qual produto seu é
        cada um: os próximos pedidos entram direto nele. Esses itens não aparecem no cardápio.
      </p>
      <ListaDeIntegracoes />
    </div>
  );
}
