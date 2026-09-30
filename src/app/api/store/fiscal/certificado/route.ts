import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { cifrar, ErroDaChaveFiscal, MENSAGEM_SEM_CHAVE_FISCAL } from "@/lib/fiscal-credenciais";
import { guardarArquivoFiscal } from "@/lib/nfce/armazenamento";
import { configDoEmissorProprio, usaEmissorProprio } from "@/lib/nfce/config-da-loja";
import { cnpjParaConferir, emissorParaTela } from "@/lib/nfce/cadastro-do-emissor";
import {
  apagarDoCofre,
  conferirCertificadoEnviado,
  identificacaoDoA1,
  registroDoCertificado,
  TAMANHO_MAXIMO_DO_PFX,
} from "@/lib/nfce/envio-do-certificado";
import { alterarFiscalConfig, ConflitoNaGravacao, LojaNaoEncontrada } from "@/lib/nfce/gravar-config-fiscal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /api/store/fiscal/certificado — o certificado A1 do EMISSOR PRÓPRIO.
 *
 * POST (multipart: `certificado` = o .pfx/.p12, `senha`): abre o arquivo com
 * a senha e confere senha, validade, CNPJ e se é da empresa da loja
 * (lib/nfce/envio-do-certificado). Passando, o .pfx vai CIFRADO para o cofre
 * (lib/nfce/armazenamento), a senha vai cifrada, e o que a tela mostra
 * (titular, CNPJ, validade) fica em `fiscalConfig.sefaz.certificado`.
 *
 * DELETE: tira o certificado do cadastro e apaga o arquivo do cofre.
 *
 * Só o titular (FRANCHISEE ou ADMIN): quem tem o .pfx e a senha assina nota
 * em nome da empresa. O .pfx e a senha não vão para log nem para a resposta,
 * e nunca ficam em claro no disco.
 */

async function titularDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, email: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  if (user.role !== "FRANCHISEE" && user.role !== "ADMIN") {
    return {
      erro: NextResponse.json(
        { error: "sem_permissao", mensagem: "Só o responsável pela loja envia ou remove o certificado digital." },
        { status: 403 }
      ),
    };
  }
  return { user, lojaId: user.ownerId || user.id };
}

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function POST(req: Request) {
  let guardadoAgora: string | null = null;
  let jaEraEste = false;
  try {
    const sessao = await titularDaSessao();
    if ("erro" in sessao) return sessao.erro;
    const { user, lojaId } = sessao;

    const entrada = await lerEnvio(req);
    if ("erro" in entrada) return NextResponse.json({ error: "entrada_invalida", mensagem: entrada.erro }, { status: entrada.status });

    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { fiscalConfig: true, cpfCnpj: true } });
    if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    const configAntes = objeto(loja.fiscalConfig);

    const conferido = conferirCertificadoEnviado({
      pfx: entrada.pfx,
      senha: entrada.senha,
      cnpjDaLoja: cnpjParaConferir(configAntes, loja.cpfCnpj),
    });
    if (!conferido.ok) return NextResponse.json({ error: conferido.erro, mensagem: conferido.mensagem }, { status: conferido.status });

    // A conferência já garantiu que a senha APARADA abre o arquivo — é ela
    // que `cifrar` guarda.
    const senhaCifrada = cifrar(entrada.senha);
    if (!senhaCifrada) return NextResponse.json({ error: "sem_senha", mensagem: "Informe a senha do certificado." }, { status: 400 });

    const arquivo = await guardarArquivoFiscal({
      lojaId,
      tipo: "certificado",
      identificacao: identificacaoDoA1(conferido.sha256),
      conteudo: entrada.pfx,
    });
    guardadoAgora = arquivo.caminho;
    jaEraEste = configDoEmissorProprio(configAntes).certificado?.arquivo === arquivo.caminho;

    const registro = registroDoCertificado({ conferido, arquivo, senhaCifrada, enviadoPor: user.email ?? user.id });
    const gravado = await alterarFiscalConfig(lojaId, (bruto) => {
      const atual = objeto(bruto);
      const sefaz = configDoEmissorProprio(atual);
      const arquivoAnterior = sefaz.certificado?.arquivo ?? null;
      const provedorAntes = typeof atual.provedor === "string" ? atual.provedor.trim() : "";
      // O teste de conexão era do certificado anterior: some, para a tela não
      // mostrar "conexão OK" de um certificado que não é mais o da loja.
      const novo: Record<string, unknown> = { ...atual, sefaz: { ...sefaz, certificado: registro, ultimoTeste: null } };
      // Loja nova, sem emissor escolhido: enviar o certificado AQUI é escolher
      // o emissor do FireHub (a Focus recebe o dela pelo /provisionar).
      if (!provedorAntes) novo.provedor = "sefaz";
      return { gravar: novo, resposta: { config: novo, provedorAntes, arquivoAnterior } };
    });
    guardadoAgora = null;
    // O anterior só sai do cofre depois que o banco aponta para o novo.
    if (gravado.arquivoAnterior && gravado.arquivoAnterior !== arquivo.caminho) {
      if (!(await apagarDoCofre(gravado.arquivoAnterior))) console.error("[Fiscal Certificado] não consegui apagar o arquivo anterior do cofre", lojaId);
    }

    const tela = emissorParaTela(gravado.config);
    const validoAte = conferido.cert.validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const naFocus = gravado.provedorAntes === "focusnfe";
    return NextResponse.json({
      success: true,
      mensagem:
        `Certificado de ${conferido.cert.titular || "sem nome"} guardado (válido até ${validoAte}).` +
        (naFocus
          ? " A loja continua emitindo pela Focus NFe: o certificado fica guardado para quando você passar para o Emissor do FireHub."
          : " Agora teste a conexão com a SEFAZ em homologação."),
      avisos: conferido.avisos,
      certificado: tela.certificado,
      emissorProprio: tela,
      provedor: usaEmissorProprio(gravado.config) ? "sefaz" : gravado.provedorAntes || null,
    });
  } catch (err: any) {
    // Gravou o arquivo e falhou no banco: o arquivo novo não fica órfão no cofre.
    if (guardadoAgora && !jaEraEste) await apagarDoCofre(guardadoAgora);
    if (err instanceof LojaNaoEncontrada) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    if (err instanceof ConflitoNaGravacao) return NextResponse.json({ error: "conflito", mensagem: err.message }, { status: 409 });
    if (err instanceof ErroDaChaveFiscal) {
      console.error("[Fiscal Certificado]", err.message);
      return NextResponse.json({ error: "chave_fiscal", mensagem: MENSAGEM_SEM_CHAVE_FISCAL }, { status: 503 });
    }
    // Só o nome e a mensagem, com qualquer sequência longa de base64 cortada:
    // erro de leitura costuma ecoar trechos do que chegou — aqui, o .pfx.
    console.error("[Fiscal Certificado]", err?.name, String(err?.message ?? "").replace(/[A-Za-z0-9+/=]{40,}/g, "[…]").slice(0, 200));
    return NextResponse.json(
      { error: "Erro interno", mensagem: "Não consegui guardar o certificado. Nada foi alterado — tente de novo." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const sessao = await titularDaSessao();
    if ("erro" in sessao) return sessao.erro;
    const { lojaId } = sessao;

    type Resposta = { status: number; corpo: Record<string, unknown>; arquivo: string | null };
    const r = await alterarFiscalConfig<Resposta>(lojaId, (bruto) => {
      const atual = objeto(bruto);
      const sefaz = configDoEmissorProprio(atual);
      if (!sefaz.certificado) {
        return { gravar: null, resposta: { status: 404, corpo: { error: "sem_certificado", mensagem: "Não há certificado guardado." }, arquivo: null } };
      }
      // Sem certificado nenhuma nota é assinada: com a emissão ligada no
      // emissor próprio, remover derrubaria toda venda. Desliga antes.
      if (usaEmissorProprio(atual) && atual.enabled === true) {
        return {
          gravar: null,
          resposta: {
            status: 409,
            corpo: {
              error: "emissao_ligada",
              mensagem: "Desligue a emissão antes de remover o certificado — sem ele nenhuma nota é assinada. Para trocar por um novo, basta enviar o novo.",
            },
            arquivo: null,
          },
        };
      }
      return {
        gravar: { ...atual, sefaz: { ...sefaz, certificado: null, ultimoTeste: null } },
        resposta: { status: 200, corpo: { success: true, mensagem: "Certificado removido do FireHub." }, arquivo: sefaz.certificado.arquivo },
      };
    });
    if (r.status === 200 && r.arquivo && !(await apagarDoCofre(r.arquivo))) {
      console.error("[Fiscal Certificado] removido do cadastro, mas o arquivo não saiu do cofre", lojaId);
    }
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err: any) {
    if (err instanceof LojaNaoEncontrada) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    if (err instanceof ConflitoNaGravacao) return NextResponse.json({ error: "conflito", mensagem: err.message }, { status: 409 });
    console.error("[Fiscal Certificado DELETE]", err?.name, String(err?.message ?? "").slice(0, 200));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * Lê multipart (a tela) ou JSON com `certificadoBase64` (integração). Recusa
 * envio grande pelo tamanho ANTES de ler, e nunca devolve o que recebeu.
 */
async function lerEnvio(req: Request): Promise<{ pfx: Buffer; senha: string } | { erro: string; status: 400 | 413 }> {
  const tipo = req.headers.get("content-type") || "";
  const tamanho = Number(req.headers.get("content-length") || 0);
  // Base64 cresce ~4/3 e o multipart tem os outros campos: 4x o limite do
  // arquivo é teto folgado para o corpo inteiro.
  if (tamanho > TAMANHO_MAXIMO_DO_PFX * 4) {
    return { erro: "Envio grande demais. Um certificado A1 tem poucos KB (limite 50 KB).", status: 413 };
  }
  if (tipo.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { erro: "Não consegui ler o formulário enviado.", status: 400 };
    }
    const arquivo = form.get("certificado");
    const senha = form.get("senha");
    if (!arquivo || typeof arquivo === "string" || !("arrayBuffer" in arquivo)) {
      return { erro: "Escolha o arquivo do certificado digital A1 (.pfx ou .p12).", status: 400 };
    }
    const f = arquivo as File;
    if (f.size > TAMANHO_MAXIMO_DO_PFX) {
      return { erro: `O arquivo tem ${Math.ceil(f.size / 1024)} KB — um certificado A1 tem poucos KB (limite 50 KB).`, status: 413 };
    }
    // A senha não leva trim aqui: a conferência decide (ver envio-do-certificado).
    return { pfx: Buffer.from(await f.arrayBuffer()), senha: typeof senha === "string" ? senha : "" };
  }
  let corpo: Record<string, unknown>;
  try {
    corpo = objeto(await req.json());
  } catch {
    return { erro: "Corpo da requisição inválido.", status: 400 };
  }
  const b64 = typeof corpo.certificadoBase64 === "string" ? corpo.certificadoBase64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { erro: "Envie o certificado (.pfx) em `certificadoBase64`.", status: 400 };
  const pfx = Buffer.from(b64, "base64");
  if (pfx.length > TAMANHO_MAXIMO_DO_PFX) return { erro: "Arquivo grande demais para um certificado A1 (limite 50 KB).", status: 413 };
  return { pfx, senha: typeof corpo.senha === "string" ? corpo.senha : "" };
}
