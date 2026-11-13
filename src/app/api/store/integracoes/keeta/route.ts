import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDaSessao } from "@/lib/ifood-token";
import { keetaConfigurada, linkDeAutorizacao } from "@/lib/keeta/api";
import { lojaKeetaDoFranqueado, desligarVinculo } from "@/lib/keeta/lojas";
import { statusNaKeeta, abrirOuPausarNaKeeta, enviarHorarioParaKeeta, enviarContatoParaKeeta } from "@/lib/keeta/loja-na-keeta";
import { enviarCardapioParaKeeta } from "@/lib/keeta/cardapio";
import {
  COOKIE_DA_CONEXAO,
  assinarConexao,
  lojaDaConexao,
  lojasDaAutorizacao,
  urlBaseDoFireHub,
  vincularLojaNaKeeta,
} from "@/lib/keeta/vinculo";

export const dynamic = "force-dynamic";

/**
 * /api/store/integracoes/keeta — o lojista conecta a loja dele na Keeta sozinho.
 *
 *   GET                      → como está (e se a Keeta já liberou o FireHub)
 *   GET    ?authId=          → as lojas que ele acabou de autorizar (para escolher)
 *   POST   { acao:"conectar" }                         → link oficial da Keeta
 *   POST   { acao:"escolher", authId, keetaMerchantId } → liga a loja escolhida
 *   POST   { acao:"abrir"|"pausar"|"enviar-horario"|"enviar-contato"|"enviar-cardapio" } → a loja na Keeta
 *   DELETE                   → desliga
 *
 * O fluxo é o "self-serve com redirect" da Keeta: o botão abre a Keeta, o
 * lojista entra com a conta dele, marca a loja e confirma; a Keeta devolve
 * para /api/store/integracoes/keeta/retorno, que liga sozinho quando há uma
 * loja só. Sem App ID, sem segredo, sem código para copiar — igual ao 99Food.
 *
 * A loja é SEMPRE a da sessão (funcionário → loja do dono; admin → a loja que
 * ele está operando), e a escolha só vale com o cookie da conexão desta loja.
 */

async function lojaDoPedido(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return { erro: NextResponse.json({ error: "Faça login no painel." }, { status: 401 }) };
  const lojaId = await lojaDaSessao(email, req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null);
  if (!lojaId) return { erro: NextResponse.json({ error: "Loja não encontrada." }, { status: 404 }) };
  return { lojaId, email };
}

export async function GET(req: NextRequest) {
  const s = await lojaDoPedido(req);
  if (s.erro) return s.erro;
  const disponivel = keetaConfigurada();
  const vinculo = disponivel ? await lojaKeetaDoFranqueado(s.lojaId!).catch(() => null) : null;

  const authId = req.nextUrl.searchParams.get("authId");
  let autorizadas: Awaited<ReturnType<typeof lojasDaAutorizacao>>["lojas"] | undefined;
  let erro: string | undefined;
  if (authId && disponivel) {
    if (lojaDaConexao(req.cookies.get(COOKIE_DA_CONEXAO)?.value) !== s.lojaId) {
      erro = "A conexão expirou ou foi aberta em outra loja. Clique em Conectar com a Keeta de novo.";
    } else {
      const r = await lojasDaAutorizacao(authId);
      if (r.ok) autorizadas = r.lojas;
      else erro = `A Keeta não devolveu as lojas autorizadas: ${r.erro}`;
    }
  }

  // Status e horário como a KEETA vê — é o que o lojista confere antes de abrir/pausar.
  let naKeeta: { status: string | null; horario: unknown } | null = null;
  if (vinculo?.ativa) {
    const r = await statusNaKeeta(s.lojaId!).catch(() => null);
    if (r?.ok) naKeeta = { status: r.dados?.status ?? null, horario: r.dados?.services?.[0]?.serviceHours?.weekHours ?? null };
  }

  return NextResponse.json({
    disponivel,
    conectada: !!vinculo?.ativa,
    loja: vinculo ? { nome: vinculo.nomeNaKeeta, keetaMerchantId: vinculo.keetaMerchantId, ativa: vinculo.ativa } : null,
    ...(naKeeta ? { naKeeta } : {}),
    ...(autorizadas ? { autorizadas } : {}),
    ...(erro ? { erro } : {}),
  });
}

export async function POST(req: NextRequest) {
  const s = await lojaDoPedido(req);
  if (s.erro) return s.erro;
  if (!keetaConfigurada()) {
    return NextResponse.json({ error: "A integração com a Keeta ainda está sendo liberada para o FireHub. Avisaremos assim que estiver pronta." }, { status: 503 });
  }
  const corpo = await req.json().catch(() => ({}));
  const urlBase = urlBaseDoFireHub(req.headers.get("host"));
  // Recusa da Keeta volta como 422, não 502: no 502 o Cloudflare troca o JSON
  // pela página dele e a tela só dizia "A Keeta não respondeu".

  if (corpo?.acao === "conectar") {
    const r = await linkDeAutorizacao(`${urlBase}/api/store/integracoes/keeta/retorno`);
    if (!r.ok) return NextResponse.json({ error: `A Keeta não gerou o link de autorização: ${r.erro}` }, { status: 422 });
    const res = NextResponse.json({ url: r.dados });
    res.cookies.set(COOKIE_DA_CONEXAO, assinarConexao(s.lojaId!), { httpOnly: true, sameSite: "lax", secure: urlBase.startsWith("https"), path: "/", maxAge: 30 * 60 });
    return res;
  }

  if (corpo?.acao === "escolher") {
    if (lojaDaConexao(req.cookies.get(COOKIE_DA_CONEXAO)?.value) !== s.lojaId) {
      return NextResponse.json({ error: "A conexão expirou ou foi aberta em outra loja. Clique em Conectar com a Keeta de novo." }, { status: 409 });
    }
    const authId = String(corpo?.authId || "");
    const escolhida = Number(corpo?.keetaMerchantId);
    const r = await lojasDaAutorizacao(authId);
    if (!r.ok) return NextResponse.json({ error: `A Keeta não confirmou a autorização: ${r.erro}` }, { status: 422 });
    // Só loja que ESTA autorização trouxe — nunca um número digitado.
    const loja = r.lojas.find((l) => l.id === escolhida);
    if (!loja) return NextResponse.json({ error: "Essa loja não está entre as que você autorizou na Keeta." }, { status: 400 });
    const v = await vincularLojaNaKeeta({ lojaId: s.lojaId!, keetaMerchantId: loja.id, nome: loja.nome || null, quem: s.email!, urlBase });
    if (!v.ok) return NextResponse.json({ error: v.motivo }, { status: 409 });
    const dono = await prisma.user.findUnique({ where: { id: s.lojaId! }, select: { storeName: true } });
    console.log(`[Keeta] 🔗 ${dono?.storeName || s.lojaId} conectou a loja ${loja.id} (${loja.nome}) da Keeta pela tela (${s.email})`);
    const res = NextResponse.json({ ok: true, loja: { nome: loja.nome, keetaMerchantId: String(loja.id) } });
    res.cookies.delete(COOKIE_DA_CONEXAO);
    return res;
  }

  // Ações na loja do lado da Keeta — só quando o lojista pede (lib/keeta/loja-na-keeta.ts).
  const acoesDaLoja: Record<string, () => Promise<{ ok: boolean; erro?: string }>> = {
    abrir: () => abrirOuPausarNaKeeta(s.lojaId!, true),
    pausar: () => abrirOuPausarNaKeeta(s.lojaId!, false),
    "enviar-horario": () => enviarHorarioParaKeeta(s.lojaId!),
    "enviar-contato": () => enviarContatoParaKeeta(s.lojaId!),
    "enviar-cardapio": () => enviarCardapioParaKeeta(s.lojaId!),
  };
  const acao = acoesDaLoja[String(corpo?.acao || "")];
  if (acao) {
    const r = await acao();
    console.log(`[Keeta] 🏪 ${corpo.acao} da loja ${s.lojaId} por ${s.email}: ${r.ok ? "ok" : r.erro}`);
    if (!r.ok) return NextResponse.json({ error: `A Keeta recusou: ${r.erro}` }, { status: 422 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const s = await lojaDoPedido(req);
  if (s.erro) return s.erro;
  const n = await desligarVinculo({ franchiseeId: s.lojaId! }).catch(() => 0);
  console.log(`[Keeta] 🔌 loja ${s.lojaId} desconectada pela tela (${s.email})`);
  return NextResponse.json({ ok: true, desligados: n });
}
