import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { INTERMEDIADORES_CONHECIDOS, pendenciasParaEmitir, PROVEDORES_SUPORTADOS } from "@/lib/fiscal-emissao";
import { ambienteDoTokenColado, cifrar, decifrar, ErroDaChaveFiscal, MENSAGEM_SEM_CHAVE_FISCAL, nomeDoAmbiente, tokenDoAmbiente } from "@/lib/fiscal-credenciais";
import {
  aplicarFormularioFiscal,
  configParaConferencia,
  cscDoAmbiente,
  retratoDoCadastro,
  situacaoDoCertificado,
  type ConfigFiscalGravada,
} from "@/lib/fiscal-config";
import type { Problema } from "@/lib/fiscal-validacao";
import { tokenDeRevenda } from "@/lib/focus-empresas";
import { configDoEmissorProprio, usaEmissorProprio } from "@/lib/nfce/config-da-loja";
import {
  aplicarFormularioDoEmissor,
  conferirComEmissorProprio,
  emissorParaTela,
  lerProvedor,
  prontidaoDoEmissor,
  provedorEfetivo,
} from "@/lib/nfce/cadastro-do-emissor";
import { alterarFiscalConfig, ConflitoNaGravacao, LojaNaoEncontrada } from "@/lib/nfce/gravar-config-fiscal";
import { ufsDoEmissorProprio } from "@/lib/nfce/pendencias";
import { notasEmAndamentoDaLoja, respostaDeNotasEmAndamento } from "@/lib/fiscal-notas-em-andamento";
import { chaveDoCanal } from "@/lib/canal-do-pedido";
import { ehIntegracaoDaNota, INTEGRACOES_DA_NOTA, type IntegracaoDaNota } from "@/lib/fiscal-modo";

export const dynamic = "force-dynamic";

// Os campos que a tela pode gravar, os que só o titular altera e as regras de
// ligar/trocar de ambiente moram em lib/fiscal-config (aplicarFormularioFiscal):
// lá dá para testar sem sessão nem banco (scripts/teste-fiscal-cadastro.ts).
// O bloco do EMISSOR PRÓPRIO (`sefaz`: série, número, QR, contingência, CSC)
// mora em lib/nfce/cadastro-do-emissor (aplicarFormularioDoEmissor), pelo
// mesmo motivo (scripts/teste-nfce-certificado.ts).

/** As UF que o emissor próprio sabe transmitir (webservice e endereço do QR — lib/nfce/pendencias). */
const UFS_DO_EMISSOR = ufsDoEmissorProprio();

/**
 * As integrações que a loja usa, pelos pedidos dos últimos 60 dias e pelo
 * cadastro do iFood/99Food: a tabela "Em quais vendas a nota sai sozinha?"
 * mostra uma coluna para cada — a loja que só tem iFood não precisa ver cinco.
 * Falhou a leitura? A tela mostra só as vendas da loja e o botão "Mostrar as
 * outras integrações".
 */
async function integracoesDaLoja(lojaId: string, loja: { ifoodMerchantId?: string | null; food99MerchantId?: string | null } | null): Promise<IntegracaoDaNota[]> {
  const usadas = new Set<string>();
  if (loja?.ifoodMerchantId) usadas.add("IFOOD");
  if (loja?.food99MerchantId) usadas.add("99FOOD");
  try {
    const grupos = await prisma.customerOrder.groupBy({
      by: ["source", "openDeliveryChannel"],
      where: { franchiseeId: lojaId, createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60_000) } },
    });
    for (const g of grupos) {
      const canal = chaveDoCanal({ source: g.source, openDeliveryChannel: g.openDeliveryChannel });
      if (ehIntegracaoDaNota(canal)) usadas.add(canal);
    }
  } catch (err: any) {
    console.error("[Fiscal Config GET] integrações da loja:", String(err?.message ?? "").slice(0, 200));
  }
  return INTEGRACOES_DA_NOTA.map((i) => i.canal).filter((c) => usadas.has(c));
}

/** Existe token que ABRE para este ambiente? (cifrado com chave trocada não conta) */
function temTokenPara(config: ConfigFiscalGravada, ambiente: 1 | 2): boolean {
  try {
    return Boolean(tokenDoAmbiente({ ...config, ambiente }));
  } catch {
    return false;
  }
}

/** Retrato da config para a tela: diz QUE os segredos existem, nunca quais são. */
function configParaTela(config: ConfigFiscalGravada) {
  // O bloco `sefaz` traz o caminho do .pfx no cofre, o hash, a senha e o CSC
  // cifrados: a tela recebe o retrato de lib/nfce/cadastro-do-emissor
  // (`emissorProprio`). As marcas do NCM assistido vão pela rota de produtos.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenDoProvedor, tokens, csc, contador, sefaz, ncmAssistido, ...resto } = config;
  const temToken = { homologacao: temTokenPara(config, 2), producao: temTokenPara(config, 1) };
  let temTokenManual = false;
  try {
    temTokenManual = Boolean(decifrar(tokenDoProvedor));
  } catch {
    temTokenManual = false;
  }
  const emissorProprio = emissorParaTela(config);
  const efetivo = provedorEfetivo(config);
  const proprio = efetivo.provedor === "sefaz";
  // No emissor próprio o CSC é o do bloco `sefaz` (o QR Code v3 dispensa).
  const cscProprio = {
    homologacao: emissorProprio.qrVersao === 3 || Boolean(emissorProprio.csc.homologacao),
    producao: emissorProprio.qrVersao === 3 || Boolean(emissorProprio.csc.producao),
  };
  return {
    ...resto,
    temToken,
    temTokenDoProvedor: nomeDoAmbiente(config.ambiente) === "producao" ? temToken.producao : temToken.homologacao,
    temTokenManual,
    // O token colado à mão vale só no ambiente dele: a tela diz qual, para o
    // "token ✓" do outro ambiente não parecer coberto por ele.
    ambienteDoTokenManual: temTokenManual ? ambienteDoTokenColado(config) : null,
    // CSC do ambiente escolhido, e de cada um: na loja cadastrada pelo FireHub
    // ele é por ambiente, e passar para produção sem o de produção deixaria
    // toda venda falhando. O botão de cada ambiente mostra o que falta.
    temCsc: proprio
      ? Number(config.ambiente) === 1 ? cscProprio.producao : cscProprio.homologacao
      : cscDoAmbiente(config, Number(config.ambiente) === 1 ? 1 : 2).temCsc,
    temCscNoAmbiente: proprio ? cscProprio : { homologacao: cscDoAmbiente(config, 2).temCsc, producao: cscDoAmbiente(config, 1).temCsc },
    cadastradoNaFocus: Boolean(config.focusEmpresaId),
    // A validade que o alerta de 30 dias do topo usa: a do certificado do
    // emissor que está valendo.
    certificado: situacaoDoCertificado(proprio ? emissorProprio.certificado?.validoAte : config.certificadoValidoAte),
    provedorEfetivo: efetivo.provedor,
    provedorGravado: efetivo.gravado,
    provedorPadrao: efetivo.padrao,
    emissorProprio,
  };
}

/**
 * Pendências para emitir, com o CSC DO AMBIENTE escolhido (lib/fiscal-config →
 * configParaConferencia): o FireHub guarda só o final, e na loja cadastrada
 * pela Focus o CSC de homologação não vale para produção.
 *
 * No emissor próprio, a conferência é a MESMA da emissão (pendenciasParaEmitir
 * → lib/nfce/pendencias: certificado, CSC do ambiente, UF), mais a série
 * escolhida, que só o ligar exige (lib/nfce/cadastro-do-emissor →
 * conferirComEmissorProprio).
 */
function conferir(config: ConfigFiscalGravada): Problema[] {
  return conferirComEmissorProprio(pendenciasParaEmitir(configParaConferencia(config)), config);
}

async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  return { user, lojaId: user.ownerId || user.id };
}

/**
 * O que o checklist de prontidão precisa do banco: quantos produtos ativos
 * estão sem NCM e se já saiu nota de homologação. Só leitura.
 */
async function extrasDaProntidao(lojaId: string) {
  const produtos = await prisma.menuProduct.findMany({ where: { franchiseeId: lojaId, active: true }, select: { ncm: true } });
  const semNcm = produtos.filter((p) => String(p.ncm ?? "").replace(/\D/g, "").length !== 8).length;
  const notaDeTeste = await prisma.customerOrder.findFirst({
    where: { franchiseeId: lojaId, fiscalStatus: "EMITTED", fiscalInfo: { path: ["ambiente"], equals: 2 } },
    select: { id: true },
  });
  return { produtosSemNcm: semNcm, totalDeProdutos: produtos.length, temNotaDeHomologacao: Boolean(notaDeTeste) };
}

export async function GET() {
  try {
    const sessao = await lojaDaSessao();
    if ("erro" in sessao) return sessao.erro;
    const { user, lojaId } = sessao;

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { id: true, storeName: true, cpfCnpj: true, fiscalConfig: true, ifoodMerchantId: true, food99MerchantId: true },
    });

    // A conferência é a do que está GRAVADO — a mesma do PUT de ligar e do
    // /provisionar (lib/fiscal-config → retratoDoCadastro). Antes este GET
    // preenchia razão social, CNPJ e nome fantasia vazios com o nome e o
    // documento da loja e conferia esse retrato: a Hakim Centro, com
    // `razaoSocial: ""` gravado, via "sem pendência" ali e o ligar recusava.
    // O nome da loja e o documento do cadastro voltam como `sugestoes`, que a
    // tela mostra para o lojista confirmar e salvar — nunca como dado gravado.
    //
    // Nada de `ncmDefault: "2106.90.90"` também: aquele valor era aplicado em
    // silêncio ao produto sem NCM, e o produto passava a exibir "Regular".
    const { config, sugestoes } = retratoDoCadastro(loja?.fiscalConfig, loja);

    const pendencias = conferir(config);
    // O checklist do emissor próprio lê o banco (produtos sem NCM, nota de
    // teste): só para a loja que usa, ou vai usar, o emissor do FireHub.
    //
    // Se essa leitura falhar, o checklist some — a tela NÃO. Antes, qualquer
    // erro aqui virava "Erro interno" e a tela ficava com os valores de
    // fábrica: "0 pendência(s)", botão de ligar travado e a Focus marcada
    // como emissor. O lojista via um cadastro que não era o dele.
    let prontidao: ReturnType<typeof prontidaoDoEmissor> | null = null;
    let prontidaoIndisponivel = false;
    if (provedorEfetivo(config).provedor === "sefaz") {
      try {
        prontidao = prontidaoDoEmissor(config, await extrasDaProntidao(lojaId));
      } catch (err: any) {
        prontidaoIndisponivel = true;
        console.error("[Fiscal Config GET] checklist de prontidão:", String(err?.message ?? "").slice(0, 300));
      }
    }

    return NextResponse.json({
      success: true,
      storeName: loja?.storeName || "",
      cpfCnpj: loja?.cpfCnpj || "",
      fiscalConfig: configParaTela(config),
      // Só para os campos ainda não gravados. A tela mostra como sugestão, com
      // um botão para usar — o lojista confere antes de ir para a nota.
      sugestoes,
      // A tela mostra esta lista como checklist. É o que separa "acho que está
      // configurado" de "sei exatamente o que falta".
      pendencias,
      podeEmitir: pendencias.length === 0,
      prontidao,
      prontidaoIndisponivel,
      ufsDoEmissorProprio: UFS_DO_EMISSOR,
      provedoresSuportados: PROVEDORES_SUPORTADOS,
      papelDoUsuario: user.role,
      // Sem a conta de revenda do FireHub na Focus, o cadastro automático não
      // tem como funcionar — a tela avisa ANTES de o lojista escolher o arquivo.
      cadastroAutomaticoDisponivel: Boolean(tokenDeRevenda()),
      // As colunas da tabela de formas por canal (Como a nota é emitida).
      integracoesDaLoja: await integracoesDaLoja(lojaId, loja),
      // Os CNPJs dos marketplaces que o código já conhece (conferidos na
      // Receita — lib/fiscal-emissao): a tela pré-preenche com eles e só grava
      // o que a loja mudar, para uma correção no código chegar a todo mundo.
      intermediadoresOficiais: Object.fromEntries(
        Object.entries(INTERMEDIADORES_CONHECIDOS).map(([canal, i]) => [canal, { nome: i!.nome, razaoSocial: i!.razaoSocial, cnpj: i!.cnpj }])
      ),
    });
  } catch (err: any) {
    // O motivo vai para o log inteiro (com a pilha) e, resumido, para a tela:
    // "Erro interno" sem mais nada deixava o suporte sem ter por onde começar.
    // Só a primeira linha da mensagem — nela não há segredo, e o resto (a
    // consulta do Prisma, por exemplo) não ajuda quem lê a tela.
    console.error("[Fiscal Config GET]", String(err?.stack ?? err?.message ?? err).slice(0, 2000));
    const motivo = String(err?.message ?? "").split("\n")[0].trim().slice(0, 160);
    return NextResponse.json(
      {
        error: "Erro interno",
        mensagem: "O servidor não conseguiu montar o cadastro fiscal desta loja.",
        motivo: motivo || null,
      },
      { status: 500 }
    );
  }
}

type RespostaDoPut =
  | { status: 200; config: ConfigFiscalGravada; recusados: string[]; avisos: string[] }
  | { status: 400 | 409; corpo: Record<string, unknown> };

export async function PUT(req: Request) {
  try {
    const sessao = await lojaDaSessao();
    if ("erro" in sessao) return sessao.erro;
    const { user, lojaId } = sessao;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
    }
    // O emissor é "sefaz" (o do FireHub); "focusnfe" só volta da loja antiga
    // que já está nela (a troca PARA a Focus é barrada mais abaixo).
    // aplicarFormularioFiscal gravaria qualquer texto — e texto desconhecido
    // é loja sem emissor.
    if ("provedor" in body && body.provedor !== null && body.provedor !== undefined && body.provedor !== "") {
      const lido = lerProvedor(body.provedor);
      if (!lido.ok) return NextResponse.json({ error: "provedor_invalido", mensagem: lido.mensagem }, { status: 400 });
      body.provedor = lido.provedor;
    } else if ("provedor" in body) {
      // Vazio não apaga a escolha: a tela antiga mandava `provedor: null` em
      // todo "Salvar Dados" quando não havia escolha — e escolher é um botão.
      delete body.provedor;
    }

    // Nota em andamento trava a troca de emissor e de ambiente
    // (lib/fiscal-notas-em-andamento). Lido ANTES do compare-and-swap, cujo
    // passo é síncrono; a troca pode vir de um campo que não é `provedor` (o
    // token da Focus numa loja sem emissor escolhido muda o emissor efetivo),
    // então lê sempre — é uma consulta pelo índice, de até 5 linhas.
    const emAndamento = await notasEmAndamentoDaLoja(lojaId);

    // Compare-and-swap (lib/nfce/gravar-config-fiscal): o certificado enviado
    // na outra aba no meio deste Salvar não some.
    const r = await alterarFiscalConfig<RespostaDoPut>(lojaId, (bruto) => {
      const f = aplicarFormularioFiscal(bruto, body, {
        papel: user.role,
        cifrar: (segredo) => cifrar(segredo),
        conferir,
      });
      if (!f.ok) return { gravar: null, resposta: { status: f.status, corpo: f.corpo } };
      let config = f.config;

      // A Focus NFe deixou de ser oferecida (09/10/2026): quem já estava nela
      // continua até trocar; ninguém entra. O "Salvar Dados" da loja antiga
      // manda o "focusnfe" gravado de volta — isso não é mudança e passa.
      if (String(config.provedor ?? "") === "focusnfe" && String(f.antes.provedor ?? "") !== "focusnfe") {
        return {
          gravar: null,
          resposta: {
            status: 400,
            corpo: { error: "provedor_invalido", mensagem: "A Focus NFe não é mais oferecida: as notas saem pelo Emissor do FireHub, direto na SEFAZ." },
          },
        };
      }

      // O bloco do emissor próprio.
      const ligadaNoProprio = f.antes.enabled === true && usaEmissorProprio(f.antes);
      const e = aplicarFormularioDoEmissor(configDoEmissorProprio(config), (body as Record<string, unknown>).sefaz, {
        papel: user.role,
        cifrar: (segredo) => cifrar(segredo),
        emissaoLigadaNoProprio: ligadaNoProprio,
        ambiente: Number(config.ambiente) === 1 ? 1 : 2,
      });
      if (!e.ok) return { gravar: null, resposta: { status: e.status, corpo: e.corpo } };
      if (e.mudou) config = { ...config, sefaz: e.sefaz };

      // Trocar de emissor com a emissão ligada é trocar de onde sai a próxima
      // nota: só passa se o outro lado já está pronto — senão toda venda
      // falharia até alguém perceber.
      const trocouDeEmissor = provedorEfetivo(f.antes).provedor !== provedorEfetivo(config).provedor;
      const ambienteDe = (c: { ambiente?: unknown }) => (Number(c.ambiente) === 1 ? 1 : 2);
      const trocouDeAmbiente = ambienteDe(f.antes) !== ambienteDe(config);
      // Com nota em andamento, nem uma troca nem a outra — ligada ou não: a
      // nota é acompanhada pelo emissor e no ambiente em que começou.
      if ((trocouDeEmissor || trocouDeAmbiente) && emAndamento.length > 0) {
        return {
          gravar: null,
          resposta: { status: 409, corpo: respostaDeNotasEmAndamento(emAndamento, trocouDeEmissor ? "emissor" : "ambiente") },
        };
      }
      if (trocouDeEmissor && config.enabled === true && f.antes.enabled === true) {
        const pendencias = conferir(config);
        if (pendencias.length > 0) {
          return {
            gravar: null,
            resposta: {
              status: 409,
              corpo: {
                error: "pendencias",
                mensagem:
                  `O emissor não foi trocado: com a emissão ligada, ele teria ${pendencias.length} pendência(s) e toda venda falharia. ` +
                  "Desligue a emissão ou complete o cadastro do outro emissor antes.",
                pendencias,
                podeEmitir: false,
              },
            },
          };
        }
      }
      return {
        gravar: config as Record<string, unknown>,
        resposta: { status: 200, config, recusados: [...f.recusados, ...e.recusados], avisos: [...f.avisos, ...e.avisos] },
      };
    });
    if (r.status !== 200) return NextResponse.json(r.corpo, { status: r.status });
    const { config, recusados, avisos } = r;

    const pendencias = conferir(config);

    return NextResponse.json({
      success: true,
      // Devolve o retrato depois de gravar: o lojista salva e já vê o que
      // continua faltando, em vez de descobrir só na hora de emitir.
      pendencias,
      podeEmitir: pendencias.length === 0,
      fiscalConfig: configParaTela(config),
      // STAFF pode salvar o operacional (ex.: formas de emissão automática),
      // mas os campos de identidade fiscal são ignorados — e a resposta DIZ
      // quais, em vez de rejeitar a gravação inteira com um 403 mudo.
      ...(recusados.length > 0 ? { camposIgnorados: recusados } : {}),
      ...(recusados.length > 0 || avisos.length > 0
        ? {
            aviso: [
              ...(recusados.length > 0
                ? ["Alguns campos só o responsável pela loja altera e foram mantidos como estavam: " + recusados.join(", ") + "."]
                : []),
              ...avisos,
            ].join(" "),
          }
        : {}),
    });
  } catch (err: any) {
    if (err instanceof LojaNaoEncontrada) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    if (err instanceof ConflitoNaGravacao) return NextResponse.json({ error: "conflito", mensagem: err.message }, { status: 409 });
    if (err instanceof ErroDaChaveFiscal) {
      console.error("[Fiscal Config PUT]", err.message);
      return NextResponse.json({ error: "chave_fiscal", mensagem: MENSAGEM_SEM_CHAVE_FISCAL }, { status: 503 });
    }
    // Só a mensagem: o objeto de erro do Prisma pode trazer o fiscalConfig inteiro.
    console.error("[Fiscal Config PUT]", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
