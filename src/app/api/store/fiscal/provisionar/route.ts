import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { cifrar } from "@/lib/fiscal-credenciais";
import { normalizarConfigFiscal, retratoDoCadastro, type ConfigFiscalGravada } from "@/lib/fiscal-config";
import { notasEmAndamentoDaLoja, respostaDeNotasEmAndamento } from "@/lib/fiscal-notas-em-andamento";
import { pendenciasDoEmitente } from "@/lib/fiscal-validacao";
import { provedorEfetivo } from "@/lib/nfce/cadastro-do-emissor";
import {
  base64Limpo,
  buscarEmpresaPorCnpj,
  conferirPedidoDeCadastro,
  consultarEmpresa,
  enviarEmpresa,
  finalDoCsc,
  lerEmpresa,
  montarCorpoDaEmpresa,
  SemContaDeRevenda,
  SEM_CONTA_DE_REVENDA,
  TAMANHO_MAXIMO_DO_CERTIFICADO,
  tokenDeRevenda,
  traduzirErroDaFocus,
  type CscDoAmbiente,
} from "@/lib/focus-empresas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Criar empresa com certificado leva alguns segundos na Focus, e são duas
// viagens (dry_run e a de verdade).
export const maxDuration = 60;

/**
 * ── A FOCUS NÃO ASSUME NO MEIO DO EMISSOR DO FIREHUB ────────────────────────
 *
 * Esta rota grava `provedor = "focusnfe"` no fim — é uma TROCA DE EMISSOR
 * quando a loja está no emissor do FireHub (lib/nfce). O PUT de
 * /api/store/fiscal tem as guardas dessa troca e esta rota não tinha nenhuma:
 * a loja emitindo pelo FireHub com a emissão ligada passava a emitir pela Focus
 * na mesma série, a Focus contaria o número do zero e a SEFAZ recusaria as
 * notas por número repetido (rejeição 539) — com o balcão esperando o cupom.
 * E, como no PUT, nota em andamento (lib/fiscal-notas-em-andamento) trava a
 * troca mesmo com a emissão desligada.
 *
 * Loja que já está na Focus (atualizando certificado ou CSC) não troca nada:
 * passa direto.
 */
async function travaDaTrocaParaFocus(lojaId: string, config: Record<string, unknown>): Promise<NextResponse | null> {
  if (provedorEfetivo(config).provedor !== "sefaz") return null;
  if (config.enabled === true) {
    return NextResponse.json(
      {
        error: "emissao_ligada_no_emissor_do_firehub",
        mensagem:
          "Esta loja emite pelo Emissor do FireHub e a emissão está ligada. Desligue a emissão antes de cadastrar a empresa na Focus NFe: " +
          "a Focus numeraria a mesma série do começo e a SEFAZ recusaria as notas por número repetido (rejeição 539).",
      },
      { status: 409 }
    );
  }
  const emAndamento = await notasEmAndamentoDaLoja(lojaId);
  if (emAndamento.length > 0) return NextResponse.json(respostaDeNotasEmAndamento(emAndamento, "emissor"), { status: 409 });
  return null;
}

/**
 * POST /api/store/fiscal/provisionar — cadastra (ou atualiza) a empresa da
 * loja na Focus NFe pela conta de revenda do FireHub e liga a loja nos dois
 * tokens que a Focus devolve.
 *
 * Recebe multipart (campo `certificado` com o arquivo) ou JSON
 * (`certificadoBase64`), mais `senha`, `cscHomologacao`, `idCscHomologacao`,
 * `cscProducao`, `idCscProducao`. Os dados do emitente (CNPJ, IE, razão
 * social, regime, endereço) vêm do que a loja já salvou na tela — não do
 * corpo — para que o cadastro na Focus e o XML da nota digam a mesma coisa.
 *
 * Primeiro um `dry_run` (a Focus valida certificado, senha e CNPJ sem gravar);
 * só se passar, a chamada de verdade. O .pfx, a senha e o CSC atravessam esta
 * rota e não ficam em lugar nenhum: nem banco, nem log, nem resposta.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    // Mandar o certificado da empresa é ato do titular: quem tem o .pfx e a
    // senha assina nota em nome dela. STAFF de balcão não chega aqui.
    if (user.role !== "FRANCHISEE" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "sem_permissao", mensagem: "Só o responsável pela loja pode cadastrar o certificado e o CSC." },
        { status: 403 }
      );
    }

    if (!tokenDeRevenda()) {
      return NextResponse.json({ error: "sem_conta_de_revenda", mensagem: SEM_CONTA_DE_REVENDA }, { status: 503 });
    }

    const entrada = await lerEntrada(req);
    if ("erro" in entrada) {
      return NextResponse.json({ error: "entrada_invalida", mensagem: entrada.erro }, { status: 400 });
    }

    const lojaId = user.ownerId || user.id;
    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true, storePhone: true, email: true },
    });
    // O MESMO retrato que a tela confere (GET /api/store/fiscal) e que o PUT
    // de ligar grava: o que está salvo, sem preencher a identidade fiscal com
    // o nome da loja. A tela mostra esse nome só como sugestão a confirmar.
    const { config } = retratoDoCadastro(loja?.fiscalConfig, null);
    const empresaSalva = typeof config.focusEmpresaId === "string" && config.focusEmpresaId ? config.focusEmpresaId : null;

    // Antes de mandar o .pfx para a Focus (ver `travaDaTrocaParaFocus`).
    const travaAntes = await travaDaTrocaParaFocus(lojaId, config);
    if (travaAntes) return travaAntes;

    // O cadastro na Focus usa os dados da empresa JÁ salvos. Faltando algum,
    // a Focus recusaria com mensagem técnica — melhor dizer aqui o que falta.
    // São as mesmas pendências de emitente que a tela lista (lá sobre o mesmo
    // retrato); CSC e certificado vêm deste envio, e ambiente e série não
    // entram no cadastro da empresa.
    const faltasDoEmitente = pendenciasDoEmitente({ ...config, cscId: "x", csc: "x", temCertificado: true, ambiente: 2, serie: 1 });
    if (faltasDoEmitente.length > 0) {
      return NextResponse.json(
        {
          error: "dados_da_empresa_incompletos",
          mensagem: "Antes de cadastrar na Focus, complete e SALVE os dados da empresa e o endereço fiscal nesta tela.",
          pendencias: faltasDoEmitente,
        },
        { status: 409 }
      );
    }

    const pedido = {
      certificado: entrada.certificadoBase64 ? { base64: entrada.certificadoBase64, senha: entrada.senha } : null,
      csc: { homologacao: entrada.cscHomologacao, producao: entrada.cscProducao },
    };
    const problemas = conferirPedidoDeCadastro(pedido, { exigirCertificado: !empresaSalva });
    if (problemas.length > 0) {
      return NextResponse.json(
        { error: "entrada_invalida", mensagem: problemas.map((p) => p.mensagem).join(" "), pendencias: problemas },
        { status: 400 }
      );
    }

    const corpo = montarCorpoDaEmpresa({
      emitente: {
        cnpj: String(config.cnpj ?? ""),
        inscricaoEstadual: String(config.inscricaoEstadual ?? ""),
        razaoSocial: String(config.razaoSocial ?? ""),
        // Só o nome fantasia SALVO. Cair no nome da loja aqui mandava para a
        // Focus um dado que o lojista nunca confirmou (a tela o mostra como
        // sugestão); vazio, a Focus recebe a razão social (montarCorpoDaEmpresa).
        nomeFantasia: (typeof config.nomeFantasia === "string" && config.nomeFantasia.trim()) || null,
        regimeTributario: Number(config.regimeTributario),
        logradouro: String(config.logradouro ?? ""),
        numero: String(config.numero ?? ""),
        complemento: (config.complemento as string) || null,
        bairro: String(config.bairro ?? ""),
        municipio: String(config.municipio ?? ""),
        uf: String(config.uf ?? ""),
        cep: String(config.cep ?? ""),
        email: loja?.email || null,
        telefone: loja?.storePhone || null,
      },
      certificado: pedido.certificado,
      csc: pedido.csc,
    });
    const segredos = [entrada.senha, entrada.cscHomologacao?.codigo, entrada.cscProducao?.codigo];

    // Uma tentativa anterior pode ter criado a empresa na Focus e falhado
    // antes de gravar aqui. Sem esta busca, o POST seguinte acusaria CNPJ
    // duplicado e a loja ficaria sem caminho.
    const empresaId = empresaSalva ?? (await buscarEmpresaPorCnpj(String(config.cnpj ?? "")));

    const ensaio = await enviarEmpresa(corpo, empresaId, true);
    if (ensaio.status < 200 || ensaio.status >= 300) {
      return NextResponse.json(
        { error: "focus_recusou", etapa: "validacao", mensagem: traduzirErroDaFocus(ensaio.status, ensaio.dados, segredos) },
        { status: ensaio.status >= 500 ? 502 : 422 }
      );
    }

    const envio = await enviarEmpresa(corpo, empresaId, false);
    if (envio.status < 200 || envio.status >= 300) {
      return NextResponse.json(
        { error: "focus_recusou", etapa: "cadastro", mensagem: traduzirErroDaFocus(envio.status, envio.dados, segredos) },
        { status: envio.status >= 500 ? 502 : 422 }
      );
    }

    let empresa = lerEmpresa(envio.dados);
    const idFinal = empresa.id ?? empresaId;
    // A resposta do PUT pode vir sem os tokens; a consulta traz a empresa inteira.
    if (idFinal && (!empresa.tokenHomologacao || !empresa.tokenProducao || !empresa.certificadoValidoAte)) {
      const consulta = await consultarEmpresa(idFinal);
      if (consulta.status === 200) {
        const lida = lerEmpresa(consulta.dados);
        empresa = {
          id: idFinal,
          tokenProducao: empresa.tokenProducao ?? lida.tokenProducao,
          tokenHomologacao: empresa.tokenHomologacao ?? lida.tokenHomologacao,
          certificadoValidoAte: empresa.certificadoValidoAte ?? lida.certificadoValidoAte,
          certificadoCnpj: empresa.certificadoCnpj ?? lida.certificadoCnpj,
          habilitaNfce: empresa.habilitaNfce || lida.habilitaNfce,
        };
      }
    }

    // Relê a config: o lojista pode ter salvo outra coisa (contador, formas de
    // emissão) nos segundos em que a Focus estava respondendo.
    const atual = await prisma.user.findUnique({ where: { id: lojaId }, select: { fiscalConfig: true } });
    const novo: ConfigFiscalGravada = normalizarConfigFiscal(atual?.fiscalConfig);
    // A mesma trava, sobre o que está gravado AGORA: a loja pode ter ligado o
    // emissor do FireHub enquanto a Focus respondia. A empresa já está na
    // Focus (a próxima tentativa acha pelo CNPJ); aqui só não se troca.
    const travaDepois = await travaDaTrocaParaFocus(lojaId, novo);
    if (travaDepois) return travaDepois;
    const tokensAntigos = (novo.tokens && typeof novo.tokens === "object" ? novo.tokens : {}) as NonNullable<ConfigFiscalGravada["tokens"]>;

    novo.provedor = "focusnfe";
    novo.focusEmpresaId = idFinal;
    novo.cadastradoNaFocusEm = new Date().toISOString();
    novo.tokens = {
      homologacao: empresa.tokenHomologacao ? cifrar(empresa.tokenHomologacao) : tokensAntigos.homologacao ?? null,
      producao: empresa.tokenProducao ? cifrar(empresa.tokenProducao) : tokensAntigos.producao ?? null,
    };
    if (pedido.certificado) {
      novo.temCertificado = true;
      novo.certificadoValidoAte = empresa.certificadoValidoAte;
      novo.certificadoCnpj = empresa.certificadoCnpj;
    } else if (empresa.certificadoValidoAte) {
      novo.certificadoValidoAte = empresa.certificadoValidoAte;
    }

    // CSC: fica só o ID (não é segredo) e os 4 últimos caracteres, por ambiente.
    const cscNaFocus = { ...((novo.cscNaFocus as any) || {}) };
    for (const amb of ["homologacao", "producao"] as const) {
      const c = amb === "producao" ? entrada.cscProducao : entrada.cscHomologacao;
      if (c) cscNaFocus[amb] = { id: String(c.id).trim(), final: finalDoCsc(c.codigo) };
    }
    novo.cscNaFocus = cscNaFocus;
    // Os campos de um CSC só (`csc`, `cscId`, `cscFinal`, do modo manual e da
    // tela antiga) saem: o que vale agora é o que está na Focus, POR AMBIENTE.
    // Espelhar aqui o de homologação — era o que esta rota fazia — fazia ele
    // valer também em produção: a loja que cadastrou só o de homologação (o
    // formulário aceita) passava para produção com zero pendências e toda
    // NFC-e era recusada por falta do csc_nfce_producao.
    delete novo.csc;
    delete novo.cscId;
    delete novo.cscFinal;

    await prisma.user.update({ where: { id: lojaId }, data: { fiscalConfig: novo as any } });

    const semToken = !empresa.tokenHomologacao && !tokensAntigos.homologacao;
    return NextResponse.json({
      success: true,
      focusEmpresaId: idFinal,
      certificadoValidoAte: novo.certificadoValidoAte ?? null,
      temToken: {
        homologacao: Boolean(novo.tokens.homologacao),
        producao: Boolean(novo.tokens.producao),
      },
      mensagem:
        (empresaId ? "Cadastro da empresa ATUALIZADO na Focus NFe." : "Empresa CADASTRADA na Focus NFe.") +
        (novo.certificadoValidoAte
          ? ` Certificado válido até ${new Date(String(novo.certificadoValidoAte)).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`
          : "") +
        (semToken
          ? " A Focus não devolveu o token de homologação — avise o suporte do FireHub antes de ligar a emissão."
          : " Agora escolha o ambiente e ligue a emissão no topo desta tela.") +
        (cscNaFocus.producao
          ? ""
          : " Para passar para PRODUÇÃO, cadastre também o CSC de produção (e o ID dele) aqui."),
    });
  } catch (err: any) {
    if (err instanceof SemContaDeRevenda) {
      return NextResponse.json({ error: "sem_conta_de_revenda", mensagem: SEM_CONTA_DE_REVENDA }, { status: 503 });
    }
    // Só o nome e a mensagem do erro, nunca a entrada: uma falha de parse
    // costuma citar trechos do texto recebido — que aqui é o .pfx e a senha.
    console.error("[Fiscal Provisionar]", err?.name, String(err?.message ?? "").replace(/[A-Za-z0-9+/=]{40,}/g, "[…]").slice(0, 200));
    const tempoEsgotado = err?.name === "TimeoutError" || err?.name === "AbortError";
    return NextResponse.json(
      {
        error: tempoEsgotado ? "focus_sem_resposta" : "Erro interno",
        mensagem: tempoEsgotado
          ? "A Focus NFe demorou demais para responder. Confira em instantes se o cadastro aparece aqui antes de enviar de novo."
          : "Não consegui concluir o cadastro. Nada foi gravado no FireHub — tente de novo.",
      },
      { status: tempoEsgotado ? 504 : 500 }
    );
  }
}

type Entrada = {
  certificadoBase64: string | null;
  senha: string;
  cscHomologacao: CscDoAmbiente | null;
  cscProducao: CscDoAmbiente | null;
};

/**
 * Lê multipart (a tela) ou JSON (integração/teste). Recusa arquivo grande
 * ANTES de ler o conteúdo, e nunca devolve o texto recebido numa mensagem.
 */
async function lerEntrada(req: Request): Promise<Entrada | { erro: string }> {
  const tipo = req.headers.get("content-type") || "";
  const tamanho = Number(req.headers.get("content-length") || 0);
  // Base64 cresce ~4/3, e o multipart tem os outros campos: 4x o limite do
  // arquivo é teto folgado para o corpo inteiro.
  if (tamanho > TAMANHO_MAXIMO_DO_CERTIFICADO * 4) {
    return { erro: "Envio grande demais. Um certificado A1 tem poucos KB (limite 50 KB)." };
  }

  let campos: Record<string, unknown> = {};
  let certificadoBase64: string | null = null;

  if (tipo.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { erro: "Não consegui ler o formulário enviado." };
    }
    const arquivo = form.get("certificado");
    if (arquivo && typeof arquivo === "object" && "arrayBuffer" in arquivo) {
      const f = arquivo as File;
      if (f.size > TAMANHO_MAXIMO_DO_CERTIFICADO) {
        return { erro: `O arquivo tem ${Math.ceil(f.size / 1024)} KB — um certificado A1 tem poucos KB (limite 50 KB).` };
      }
      if (f.size > 0) certificadoBase64 = Buffer.from(await f.arrayBuffer()).toString("base64");
    }
    form.forEach((valor, chave) => {
      if (typeof valor === "string") campos[chave] = valor;
    });
  } else {
    try {
      campos = (await req.json()) ?? {};
    } catch {
      return { erro: "Corpo da requisição inválido." };
    }
    if (typeof campos.certificadoBase64 === "string" && campos.certificadoBase64.trim()) {
      certificadoBase64 = base64Limpo(campos.certificadoBase64);
    }
  }

  const texto = (k: string) => (typeof campos[k] === "string" ? String(campos[k]).trim() : "");
  const csc = (id: string, codigo: string): CscDoAmbiente | null => {
    const i = texto(id);
    const c = texto(codigo);
    return i || c ? { id: i, codigo: c } : null;
  };

  return {
    certificadoBase64,
    // A senha não leva trim: espaço pode ser parte dela.
    senha: typeof campos.senha === "string" ? campos.senha : "",
    cscHomologacao: csc("idCscHomologacao", "cscHomologacao"),
    cscProducao: csc("idCscProducao", "cscProducao"),
  };
}
