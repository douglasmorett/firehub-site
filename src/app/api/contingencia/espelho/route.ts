/**
 * GET /api/contingencia/espelho?desde=<nº> — o que mudou na loja desde a
 * última pergunta (Modo Contingência). O computador da loja pergunta a cada
 * poucos segundos e grava na cópia dele.
 *
 *   { ate, linhas: { Tabela: [linha...] }, apagados: { Tabela: [registro...] }, mais }
 *
 * O diário só diz QUAL linha mudou; o que desce é a linha como ela está
 * agora. A que não existe mais foi apagada. `refazerFoto` = o computador
 * ficou tanto tempo sem perguntar que o diário já foi limpo: foto de novo.
 */
import { NextRequest, NextResponse } from "next/server";
import { idDoRegistro, tabelaDaCopia } from "@/lib/contingencia/catalogo";
import { linhasDosRegistros, lojaDaChave, mudancasDesde, primeiraMudancaGuardada } from "@/lib/contingencia/servidor";

export const dynamic = "force-dynamic";

const LIMITE = 2000;

/** Chave composta: o diário grava o json_build_array do banco ("[a, b]"); a resposta usa o JSON compacto. */
function registroNormal(registro: string, composta: boolean): string {
  if (!composta) return registro;
  try {
    return JSON.stringify(JSON.parse(registro));
  } catch {
    return registro;
  }
}

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const desde = (req.nextUrl.searchParams.get("desde") || "0").replace(/\D/g, "") || "0";

  if (desde !== "0") {
    const primeira = await primeiraMudancaGuardada(loja.lojaId);
    if (primeira && BigInt(primeira) > BigInt(desde) + BigInt(1)) {
      return NextResponse.json({ refazerFoto: true });
    }
  }

  const mudancas = await mudancasDesde(loja.lojaId, desde, LIMITE);
  const porTabela = new Map<string, Set<string>>();
  for (const m of mudancas) {
    if (!porTabela.has(m.tabela)) porTabela.set(m.tabela, new Set());
    porTabela.get(m.tabela)!.add(m.registro);
  }

  const linhas: Record<string, Record<string, unknown>[]> = {};
  const apagados: Record<string, string[]> = {};
  for (const [nome, registros] of porTabela) {
    const t = tabelaDaCopia(nome);
    if (!t) continue;
    const composta = t.chave.length > 1;
    const atuais = await linhasDosRegistros(t, [...registros]);
    if (atuais.length) linhas[nome] = atuais;
    const presentes = new Set(atuais.map((l) => idDoRegistro(t, l)));
    const sumiram = [...registros].map((r) => registroNormal(r, composta)).filter((r) => !presentes.has(r));
    if (sumiram.length) apagados[nome] = sumiram;
  }

  return NextResponse.json({
    ate: mudancas.length ? mudancas[mudancas.length - 1].id : desde,
    linhas,
    apagados,
    mais: mudancas.length >= LIMITE,
  });
}
