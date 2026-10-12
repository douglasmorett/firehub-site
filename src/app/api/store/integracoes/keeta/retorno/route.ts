import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojaDaSessao } from "@/lib/ifood-token";
import { keetaConfigurada } from "@/lib/keeta/api";
import { COOKIE_DA_CONEXAO, lojaDaConexao, lojasDaAutorizacao, urlBaseDoFireHub, vincularLojaNaKeeta } from "@/lib/keeta/vinculo";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/integracoes/keeta/retorno?authId=… — a Keeta devolve o
 * lojista aqui depois que ele autoriza o FireHub.
 *
 * - Uma loja autorizada → liga na hora e volta para Integrações (verde).
 * - Várias → volta para Integrações com a lista, e ele escolhe qual é esta loja.
 * - Nada / erro → volta com o motivo escrito.
 *
 * Só liga a loja do cookie da conexão, e só se ela for a mesma da sessão: a
 * autorização feita a partir do painel de outra loja não pode cair aqui.
 */
function voltar(base: string, params: Record<string, string>) {
  const url = new URL(`${base}/store/integracoes`);
  url.searchParams.set("integracao", "keeta");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url.toString(), 303);
}

export async function GET(req: NextRequest) {
  const base = urlBaseDoFireHub(req.headers.get("host"));
  if (!keetaConfigurada()) return voltar(base, { keeta: "erro", motivo: "A integração com a Keeta ainda não foi liberada no servidor." });

  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return NextResponse.redirect(`${base}/login?callbackUrl=${encodeURIComponent(`${base}/store/integracoes`)}`, 303);
  const lojaId = await lojaDaSessao(email, req.cookies.get("firehub_active_store")?.value || null);

  const daConexao = lojaDaConexao(req.cookies.get(COOKIE_DA_CONEXAO)?.value);
  if (!lojaId || daConexao !== lojaId) {
    return voltar(base, { keeta: "erro", motivo: "A conexão expirou ou foi aberta no painel de outra loja. Clique em Conectar com a Keeta de novo, nesta loja." });
  }

  const authId = req.nextUrl.searchParams.get("authId") || "";
  if (!authId) return voltar(base, { keeta: "erro", motivo: "A Keeta não devolveu a autorização. Tente de novo." });

  const r = await lojasDaAutorizacao(authId);
  if (!r.ok) return voltar(base, { keeta: "erro", motivo: `A Keeta não confirmou a autorização: ${r.erro}` });
  if (r.lojas.length === 0) return voltar(base, { keeta: "erro", motivo: "Nenhuma loja foi marcada na Keeta. Conecte de novo e marque a sua loja." });
  if (r.lojas.length > 1) return voltar(base, { keeta: "escolher", authId });

  const loja = r.lojas[0];
  const v = await vincularLojaNaKeeta({ lojaId, keetaMerchantId: loja.id, nome: loja.nome || null, quem: email, urlBase: base });
  if (!v.ok) return voltar(base, { keeta: "erro", motivo: v.motivo || "Não consegui ligar a loja." });
  console.log(`[Keeta] 🔗 loja ${lojaId} conectou a loja ${loja.id} (${loja.nome}) da Keeta (${email})`);
  const res = voltar(base, { keeta: "ok" });
  res.cookies.delete(COOKIE_DA_CONEXAO);
  return res;
}
