import { NextRequest, NextResponse } from "next/server";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import {
  caixaDaCidade, cidadesComLojas, lojasDoMapa, marcacoesDaCidade, marcarLugar, reservarUso, usoDoDia,
} from "@/lib/prospeccao/dados";
import { LIMITES_DO_DIA, STATUS_DA_MARCACAO, type StatusDaMarcacao, type TipoDeUso } from "@/lib/prospeccao/regras";

export const dynamic = "force-dynamic";

/**
 * Mapa de prospecção do vendedor (components/prospeccao/MapaDeProspeccao).
 *
 * GET ?cidade=X — a chave do mapa (de navegador, presa aos domínios do FireHub),
 * as cidades com loja, a caixa da cidade, as lojas do FireHub nela, as marcações
 * da equipe e o uso do dia. Sem cidade, só a chave, as cidades e o uso.
 *
 * Só admin e vendedor da equipe (lib/crm/acesso.ts).
 */
export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });

  const cidade = (req.nextUrl.searchParams.get("cidade") || "").trim().slice(0, 80);
  const chave = process.env.GOOGLE_MAPS_NAVEGADOR_KEY || null;

  const [cidades, uso] = await Promise.all([cidadesComLojas(), usoDoDia()]);
  if (!cidade) return NextResponse.json({ chave, cidades, uso, cidade: null, lojas: [], marcacoes: [] });

  const caixa = await caixaDaCidade(cidade);
  const [lojas, marcacoes] = await Promise.all([lojasDoMapa(cidade, caixa), marcacoesDaCidade(cidade)]);
  return NextResponse.json({ chave, cidades, uso, cidade: { nome: cidade, caixa }, lojas, marcacoes });
}

/**
 * POST { acao: "marcar", placeId, cidade, status, nota } — o vendedor anota o lugar.
 * POST { acao: "reservar", tipo: "busca" | "contato", qtd } — antes de chamar o Google.
 */
export async function POST(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const corpo = await req.json().catch(() => null);

  if (corpo?.acao === "marcar") {
    const placeId = typeof corpo.placeId === "string" ? corpo.placeId.trim() : "";
    const cidade = typeof corpo.cidade === "string" ? corpo.cidade.trim() : "";
    const status = corpo.status as StatusDaMarcacao;
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId) || !cidade || !STATUS_DA_MARCACAO.includes(status)) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }
    const marcacao = await marcarLugar(quem, { placeId, cidade, status, nota: typeof corpo.nota === "string" ? corpo.nota : "" });
    return NextResponse.json({ marcacao });
  }

  if (corpo?.acao === "reservar") {
    const tipo = corpo.tipo as TipoDeUso;
    const qtd = Math.floor(Number(corpo.qtd));
    if (!(tipo in LIMITES_DO_DIA) || !(qtd >= 1 && qtd <= 20)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    return NextResponse.json(await reservarUso(quem, tipo, qtd));
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
