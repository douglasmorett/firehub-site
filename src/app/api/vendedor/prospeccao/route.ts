import { NextRequest, NextResponse } from "next/server";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import {
  cidadesComLojas, guardarLugaresAvulsos, lojasDoMapa, lugaresDaCidade, marcacoesDaCidade, marcarLugar,
  passoDaVarredura, prepararCidade, reservar, resumoDaCidade, usoDoGoogle,
} from "@/lib/prospeccao/dados";
import { STATUS_DA_MARCACAO, type StatusDaMarcacao } from "@/lib/prospeccao/regras";
import { SKUS, type Sku } from "@/lib/prospeccao/varredura";

export const dynamic = "force-dynamic";

/**
 * Mapa de prospecção do vendedor (components/prospeccao/MapaDeProspeccao).
 *
 * GET ?cidade=X — a chave do mapa (de navegador, presa aos domínios do FireHub),
 * as cidades com loja, o uso do Google (hoje e no mês, por SKU), a cidade
 * (caixa + resumo da varredura), os lugares do cache (do Google, só id e
 * ponto: o nome a tela busca na hora), as lojas do FireHub nela e as marcações.
 * Sem cidade, só a chave, as cidades e o uso. A 1ª abertura de uma cidade busca
 * a caixa, a população e o OpenStreetMap (grátis) para estimar a varredura.
 *
 * Só admin e vendedor da equipe (lib/crm/acesso.ts).
 */
export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });

  const cidade = (req.nextUrl.searchParams.get("cidade") || "").trim().slice(0, 80);
  const chave = process.env.GOOGLE_MAPS_NAVEGADOR_KEY || null;
  const souAdmin = quem.tipo === "ADMIN";

  const [cidades, uso] = await Promise.all([cidadesComLojas(), usoDoGoogle()]);
  const base = { chave, cidades, uso, souAdmin };
  if (!cidade) return NextResponse.json({ ...base, cidade: null, lugares: [], lojas: [], marcacoes: [] });

  const linha = await prepararCidade(cidade);
  if (!linha) {
    return NextResponse.json({
      ...base, cidade: null, lugares: [], lojas: [], marcacoes: [],
      error: "Não achei essa cidade no mapa. Escreva como \"Cidade - UF\" (ex.: Rio das Ostras - RJ).",
    });
  }
  const [resumo, lugares, lojas, marcacoes] = await Promise.all([
    resumoDaCidade(linha, quem), lugaresDaCidade(cidade), lojasDoMapa(cidade, linha.caixa), marcacoesDaCidade(cidade),
  ]);
  return NextResponse.json({ ...base, cidade: { nome: cidade, caixa: linha.caixa, varredura: resumo }, lugares, lojas, marcacoes });
}

/**
 * POST { acao: "marcar", placeId, cidade, status, nota } — o vendedor anota o lugar.
 * POST { acao: "varrer", cidade, continuar?, refazer?, resultados?, erro?, pausar? } — um passo da varredura
 *   (lib/prospeccao/dados.ts, passoDaVarredura). refazer: só o admin. Ninguém passa do grátis.
 * POST { acao: "reservar", sku, qtd } — antes de chamar o Google; sem vaga no dia ou no mês, não reserva.
 * POST { acao: "lugares", cidade, lugares } — o que o "buscar também" e os nomes por perto trouxeram
 *   entra no cache da cidade (só id + ponto).
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

  if (corpo?.acao === "varrer") {
    const cidade = typeof corpo.cidade === "string" ? corpo.cidade.trim().slice(0, 80) : "";
    if (!cidade) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    if (corpo.refazer && quem.tipo !== "ADMIN") {
      return NextResponse.json({ error: "Só o administrador atualiza uma cidade já varrida." }, { status: 403 });
    }
    const resultados = Array.isArray(corpo.resultados) ? corpo.resultados.slice(0, 50) : undefined;
    try {
      return NextResponse.json(await passoDaVarredura(quem, {
        cidade, resultados,
        continuar: !!corpo.continuar, refazer: !!corpo.refazer, pausar: !!corpo.pausar,
        erro: typeof corpo.erro === "string" ? corpo.erro : undefined,
      }));
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Não deu para varrer agora." }, { status: 400 });
    }
  }

  if (corpo?.acao === "reservar") {
    const sku = corpo.sku as Sku;
    const qtd = Math.floor(Number(corpo.qtd));
    if (!(sku in SKUS) || !(qtd >= 1 && qtd <= 20)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    return NextResponse.json(await reservar(sku, qtd));
  }

  if (corpo?.acao === "lugares") {
    const cidade = typeof corpo.cidade === "string" ? corpo.cidade.trim() : "";
    if (!cidade || !Array.isArray(corpo.lugares)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    return NextResponse.json({ guardados: await guardarLugaresAvulsos(cidade, corpo.lugares) });
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
