import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/prazos/visita — o que a página de venda manda sobre a visita.
 *
 * Quem chama é `MedidorDaPagina.tsx`, por `navigator.sendBeacon`, algumas
 * vezes por visita: no começo (com a origem), de tempos em tempos enquanto a
 * pessoa está lá, e uma última vez quando a aba some. O beacon não espera
 * resposta — por isso esta rota responde curto e nunca devolve erro que o
 * navegador vá tentar de novo.
 *
 * ── Por que medição própria, se já existe pixel do Meta ───────────────────
 * O pixel responde "quantos cliques viraram checkout" e mais nada: ele não
 * diz quanto tempo a pessoa ficou, até onde rolou, se abriu a calculadora,
 * se parou no preço. E, do lado de lá, o relatório mistura o que acontece em
 * todo o domínio — foi assim que uma compra de COMIDA de uma loja sem pixel
 * próprio apareceu como venda da extensão (corrigido em FacebookPixel.tsx).
 * Aqui o dado é da página, nosso, e dá para conferir linha por linha.
 *
 * ── O que NÃO é guardado ──────────────────────────────────────────────────
 * IP, e-mail, telefone, cookie que atravesse domínio, nada que identifique
 * alguém. `sessao` é um id aleatório que vive no sessionStorage daquela aba.
 * Fechou a aba, acabou a sessão. É contagem de comportamento, não perfil de
 * pessoa.
 *
 * ── Por que UPSERT com GREATEST ───────────────────────────────────────────
 * Os beacons chegam fora de ordem e às vezes repetidos (o navegador reenvia
 * ao restaurar a aba). Gravar "o último que chegou" faria o tempo ANDAR PARA
 * TRÁS. Cada número só cresce; os marcos viram união de conjunto.
 */

/** Teto de sanidade: acima disso é aba esquecida aberta, não leitura. */
const MAX_SEGUNDOS = 3600;
const MARCOS_CONHECIDOS = new Set([
  "viu-demonstracao",
  "viu-preco",
  "viu-quem-indica",
  "abriu-calculadora",
  "abriu-faq",
  "escolheu-plano",
  "foi-ao-checkout",
  "chamou-no-zap",
  "foi-ver-a-demo",
  "chegou-ao-fim",
]);

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t ? t : null;
}

function inteiro(v: unknown, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const sessao = texto(body?.sessao, 40);
    // Sem sessão não há o que atualizar, e inventar uma aqui criaria uma
    // visita fantasma por beacon perdido.
    if (!sessao) return NextResponse.json({ ok: false }, { status: 204 });

    const marcos = Array.isArray(body?.marcos)
      ? [...new Set(body.marcos.filter((m: unknown) => typeof m === "string" && MARCOS_CONHECIDOS.has(m)))]
      : [];

    const dados = {
      pagina: texto(body?.pagina, 120) ?? "/prazos",
      origem: texto(body?.origem, 60),
      campanha: texto(body?.campanha, 120),
      conteudo: texto(body?.conteudo, 120),
      gatilho: texto(body?.gatilho, 30),
      referencia: texto(body?.referencia, 180),
      dispositivo: body?.dispositivo === "celular" ? "celular" : "computador",
      segundos: inteiro(body?.segundos, 0, MAX_SEGUNDOS),
      rolagem: inteiro(body?.rolagem, 0, 100),
      cliquesCta: inteiro(body?.cliquesCta, 0, 50),
      cliquesZap: inteiro(body?.cliquesZap, 0, 50),
      planoVisto: body?.planoVisto == null ? null : inteiro(body?.planoVisto, 1, 5),
    };

    // A origem só é gravada na PRIMEIRA vez (COALESCE do valor que já está
    // lá): um beacon tardio sem os parâmetros de UTM não pode apagar de onde
    // a pessoa veio.
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "PrazoVisita"
        ("sessao","pagina","origem","campanha","conteudo","gatilho","referencia","dispositivo",
         "segundos","rolagem","cliquesCta","cliquesZap","planoVisto","marcos","atualizadoEm")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT ("sessao") DO UPDATE SET
        "segundos"     = GREATEST("PrazoVisita"."segundos", EXCLUDED."segundos"),
        "rolagem"      = GREATEST("PrazoVisita"."rolagem", EXCLUDED."rolagem"),
        "cliquesCta"   = GREATEST("PrazoVisita"."cliquesCta", EXCLUDED."cliquesCta"),
        "cliquesZap"   = GREATEST("PrazoVisita"."cliquesZap", EXCLUDED."cliquesZap"),
        "planoVisto"   = COALESCE(EXCLUDED."planoVisto", "PrazoVisita"."planoVisto"),
        "origem"       = COALESCE("PrazoVisita"."origem", EXCLUDED."origem"),
        "campanha"     = COALESCE("PrazoVisita"."campanha", EXCLUDED."campanha"),
        "conteudo"     = COALESCE("PrazoVisita"."conteudo", EXCLUDED."conteudo"),
        "gatilho"      = COALESCE("PrazoVisita"."gatilho", EXCLUDED."gatilho"),
        "referencia"   = COALESCE("PrazoVisita"."referencia", EXCLUDED."referencia"),
        "marcos"       = (
          SELECT COALESCE(jsonb_agg(DISTINCT m), '[]'::jsonb)
          FROM jsonb_array_elements("PrazoVisita"."marcos" || EXCLUDED."marcos") AS m
        ),
        "atualizadoEm" = CURRENT_TIMESTAMP;
      `,
      sessao,
      dados.pagina,
      dados.origem,
      dados.campanha,
      dados.conteudo,
      dados.gatilho,
      dados.referencia,
      dados.dispositivo,
      dados.segundos,
      dados.rolagem,
      dados.cliquesCta,
      dados.cliquesZap,
      dados.planoVisto,
      JSON.stringify(marcos),
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // Falta a tabela? Medição não pode derrubar a página de venda nem encher
    // o log de produção. Registra uma linha e segue.
    console.warn("[prazos visita]", err?.message);
    return NextResponse.json({ ok: false });
  }
}
