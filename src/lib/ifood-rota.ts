/**
 * /src/lib/ifood-rota.ts
 *
 * O contorno repetido de toda rota que fala com o iFood: exigir sessão,
 * descobrir a loja, executar, e traduzir qualquer tropeço numa resposta que a
 * tela consiga mostrar.
 *
 * Duas decisões que valem explicação:
 *
 * O status HTTP do iFood viaja de volta para o cliente em `ifood.status`. Não é
 * capricho de log: a homologação de Merchant é avaliada por código de resposta
 * — 201 ao criar a pausa, 204 ao remover, 201 no PUT dos horários — e o
 * analista precisa ver isso na tela durante o vídeo.
 *
 * "Loja não conectada" deixa de ser 502. Antes, `getMerchantIdForUser` lançava e
 * todo catch transformava a falta de integração em erro de gateway, como se o
 * iFood estivesse fora do ar. São coisas diferentes: uma o lojista resolve
 * sozinho em Integrações, a outra não depende dele.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth";
import { contextoIfood, ErroIfood, type ContextoIfood } from "./ifood-token";
import { ErroValidacao } from "./ifood-catalog";
import { ErroSequencia } from "./ifood-logistics";
import { mensagemDeErro, type RespostaIfood } from "./ifood-http";

export type DadosRota = {
  ctx: ContextoIfood;
  email: string;
  /** Query string da requisição, já pronta. */
  params: URLSearchParams;
  corpo: any;
};

/**
 * Envolve o handler. `merchantId` pode vir na query (?merchantId=) ou no corpo,
 * para as telas que deixam escolher entre várias lojas da conta.
 *
 * @param exigirDistribuido quando true, o token do app centralizado não entra
 *        na cascata. É o modo da homologação: as requisições precisam sair pelo
 *        mesmo aplicativo cujo client_id foi declarado no chamado.
 */
export async function comContextoIfood(
  req: Request | null,
  handler: (d: DadosRota) => Promise<NextResponse>,
  opts: { exigirDistribuido?: boolean } = {},
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }

  let corpo: any = null;
  let params = new URLSearchParams();
  if (req) {
    try { params = new URL(req.url).searchParams; } catch { /* url estranha: segue sem query */ }
    if (req.method !== "GET" && req.method !== "DELETE") {
      corpo = await req.json().catch(() => null);
    }
  }

  try {
    // A tela de homologação manda ?distribuido=1 para travar a cascata no app
    // distribuído — assim o vídeo não corre o risco de gravar uma chamada que
    // saiu, por fallback, pelo aplicativo centralizado.
    const soDistribuido =
      opts.exigirDistribuido === true ||
      params.get("distribuido") === "1" ||
      corpo?.distribuido === true;

    const ctx = await contextoIfood({
      email,
      merchantId: params.get("merchantId") || corpo?.merchantId || null,
      permitirCentral: soDistribuido ? false : undefined,
    });
    return await handler({ ctx, email, params, corpo });
  } catch (e: any) {
    if (e instanceof ErroIfood) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // Validação nossa e etapa fora de ordem são erros do pedido, não do servidor.
    if (e instanceof ErroValidacao || e instanceof ErroSequencia) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[iFood rota]", e?.message);
    return NextResponse.json(
      { error: "Não foi possível concluir a operação com o iFood." },
      { status: 500 },
    );
  }
}

/**
 * Devolve a resposta do iFood no formato que as telas esperam, preservando o
 * status original para exibição.
 */
export function responder(
  r: RespostaIfood & { origem?: string | null },
  extras: Record<string, any> = {},
) {
  const ifood = {
    status: r.status,
    ok: r.ok,
    origem: r.origem ?? null,
    tentativas: r.tentativas,
  };

  if (!r.ok) {
    return NextResponse.json(
      { error: mensagemDeErro(r), ifood, detalhe: r.data ?? r.texto?.slice(0, 500) ?? null, ...extras },
      // 0 é falha de rede daqui; para o cliente isso é 502, não "status 0".
      { status: r.status === 0 ? 502 : r.status },
    );
  }

  return NextResponse.json({ ok: true, ifood, data: r.data, ...extras });
}
