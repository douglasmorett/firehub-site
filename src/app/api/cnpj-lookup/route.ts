import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: getCorsHeaders(req) });
}

/**
 * POST /api/cnpj-lookup
 * 
 * Aceita: { cnpj: "00000000000000" }
 * Retorna dados completos do CNPJ via BrasilAPI (gratuito, sem key).
 * 
 * O fluxo de onboarding funciona assim:
 * 1. Usuário digita CPF (apenas para identificação)
 * 2. Usuário digita CNPJ da empresa
 * 3. Esta rota valida o CNPJ na Receita Federal e retorna os dados
 * 4. Frontend mostra os dados para confirmação
 */
export async function POST(req: NextRequest) {
  try {
    const { cnpj } = await req.json();

    if (!cnpj) {
      return NextResponse.json(
        { error: "CNPJ é obrigatório." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    const clean = cnpj.replace(/\D/g, "");
    if (clean.length !== 14) {
      return NextResponse.json(
        { error: "CNPJ inválido. Deve conter 14 dígitos." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    // Tentar BrasilAPI primeiro (mais rápida e confiável)
    let data = null;
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
        headers: { "User-Agent": "FireHub/1.0" },
      });
      if (res.ok) {
        data = await res.json();
      }
    } catch {
      // fallback abaixo
    }

    // Fallback: ReceitaWS (3 consultas/min grátis)
    if (!data) {
      try {
        const res = await fetch(`https://receitaws.com.br/v1/cnpj/${clean}`, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const rw = await res.json();
          if (rw.status !== "ERROR") {
            data = {
              cnpj: clean,
              razao_social: rw.nome || "",
              nome_fantasia: rw.fantasia || "",
              descricao_situacao_cadastral: rw.situacao || "",
              municipio: rw.municipio || "",
              uf: rw.uf || "",
              bairro: rw.bairro || "",
              logradouro: rw.logradouro || "",
              numero: rw.numero || "",
              cep: rw.cep || "",
              complemento: rw.complemento || "",
              porte: rw.porte || "",
              // A ReceitaWS traz o Simples e o MEI em objetos próprios; o código
              // IBGE do município ela não tem (só a BrasilAPI).
              opcao_pelo_simples: typeof rw.simples?.optante === "boolean" ? rw.simples.optante : null,
              opcao_pelo_mei: typeof rw.simei?.optante === "boolean" ? rw.simei.optante : null,
              qsa: (rw.qsa || []).map((s: { nome: string; qual: string }) => ({
                nome_socio: s.nome,
                qualificacao_socio: s.qual,
              })),
            };
          }
        }
      } catch {
        // sem fallback
      }
    }

    if (!data) {
      return NextResponse.json(
        { error: "CNPJ não encontrado na Receita Federal. Verifique e tente novamente." },
        { status: 404, headers: getCorsHeaders(req) }
      );
    }

    // Normalizar resposta
    return NextResponse.json({
      cnpj: clean,
      razao_social: data.razao_social || "",
      nome_fantasia: data.nome_fantasia || "",
      situacao: data.descricao_situacao_cadastral || data.situacao_cadastral || "",
      municipio: data.municipio || "",
      uf: data.uf || "",
      bairro: data.bairro || "",
      logradouro: data.logradouro || "",
      numero: data.numero || "",
      cep: (data.cep || "").replace(/\D/g, ""),
      socios: (data.qsa || []).map((s: { nome_socio?: string; qualificacao_socio?: string }) => ({
        nome: s.nome_socio || "",
        qualificacao: s.qualificacao_socio || "",
      })),
      // Para a tela fiscal pré-preencher o emitente (lib/nfce/dados-da-receita):
      // o tipo do logradouro ("QUADRA"), o complemento, o código IBGE do
      // município (vai no XML de toda nota) e o regime (Simples → CRT 1, MEI →
      // CRT 4). Campos novos, somados aos de sempre — o cadastro não muda.
      tipo_logradouro: data.descricao_tipo_de_logradouro || "",
      complemento: data.complemento || "",
      codigo_municipio_ibge: data.codigo_municipio_ibge ? String(data.codigo_municipio_ibge) : "",
      opcao_pelo_simples: typeof data.opcao_pelo_simples === "boolean" ? data.opcao_pelo_simples : null,
      opcao_pelo_mei: typeof data.opcao_pelo_mei === "boolean" ? data.opcao_pelo_mei : null,
      porte: data.porte || "",
      cnae_fiscal: data.cnae_fiscal ? String(data.cnae_fiscal) : "",
      cnae_fiscal_descricao: data.cnae_fiscal_descricao || "",
    }, { headers: getCorsHeaders(req) });
  } catch (error) {
    console.error("CNPJ lookup error:", error);
    return NextResponse.json(
      { error: "Erro ao consultar CNPJ. Tente novamente." },
      { status: 500, headers: getCorsHeaders(req) }
    );
  }
}
