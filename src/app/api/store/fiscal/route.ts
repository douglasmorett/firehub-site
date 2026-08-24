import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pendenciasParaEmitir, PROVEDORES_SUPORTADOS, type ConfiguracaoFiscal } from "@/lib/fiscal-emissao";

export const dynamic = "force-dynamic";

/**
 * Campos que a tela pode gravar.
 *
 * Antes o PUT fazia `{ ...configAtual, ...body }` — o corpo inteiro da
 * requisição caía dentro do `fiscalConfig`. Qualquer chave inventada entrava, e
 * qualquer sessão autenticada (um STAFF de balcão inclusive) trocava CNPJ,
 * inscrição estadual e o ambiente de homologação para produção.
 */
const CAMPOS_PERMITIDOS = [
  "enabled",
  "provedor",
  "tokenDoProvedor",
  "cnpj",
  "inscricaoEstadual",
  "inscricaoMunicipal",
  "razaoSocial",
  "nomeFantasia",
  "regimeTributario",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "municipio",
  "codigoMunicipio",
  "uf",
  "cep",
  "serie",
  "ambiente",
  "cscId",
  "csc",
  "cfopPadrao",
  "csosnPadrao",
  "autoEmitPaymentMethods",
] as const;

/** Campos que só o responsável pela loja altera — são a identidade fiscal dela. */
const CAMPOS_DO_TITULAR = new Set([
  "cnpj",
  "inscricaoEstadual",
  "razaoSocial",
  "regimeTributario",
  "ambiente",
  "csc",
  "cscId",
  "provedor",
  "tokenDoProvedor",
]);

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const lojaId = user.ownerId || user.id;
    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { id: true, storeName: true, cpfCnpj: true, fiscalConfig: true },
    });

    // Nada de `ncmDefault: "2106.90.90"`. Aquele valor era aplicado em silêncio
    // ao produto sem NCM, e o produto passava a exibir situação "Regular" na
    // tela fiscal — o lojista via tudo verde com o cadastro vazio. Não existe
    // NCM genérico válido: cada produto tem o seu na tabela da Receita.
    const padrao: ConfiguracaoFiscal & { enabled: boolean } = {
      enabled: false,
      provedor: null,
      tokenDoProvedor: null,
      cnpj: loja?.cpfCnpj || "",
      inscricaoEstadual: "",
      razaoSocial: loja?.storeName || "",
      nomeFantasia: loja?.storeName || "",
      regimeTributario: 1, // Simples Nacional é o caso da esmagadora maioria
      logradouro: "",
      numero: "",
      bairro: "",
      municipio: "",
      codigoMunicipio: "",
      uf: "",
      cep: "",
      serie: 1,
      ambiente: 2, // homologação: quem liga produção faz isso de propósito
      cscId: "",
      csc: "",
      temCertificado: false,
    };

    const salvo = (loja?.fiscalConfig as any) || {};
    const config = { ...padrao, ...salvo };

    // O token do provedor é credencial: a tela precisa saber que existe, não
    // qual é. Devolver o valor deixaria o segredo no HTML de qualquer STAFF.
    const configParaTela = {
      ...config,
      tokenDoProvedor: undefined,
      temTokenDoProvedor: Boolean(config.tokenDoProvedor),
      csc: undefined,
      temCsc: Boolean(config.csc),
    };

    const pendencias = pendenciasParaEmitir(config);

    return NextResponse.json({
      success: true,
      storeName: loja?.storeName || "",
      cpfCnpj: loja?.cpfCnpj || "",
      fiscalConfig: configParaTela,
      // A tela mostra esta lista como checklist. É o que separa "acho que está
      // configurado" de "sei exatamente o que falta".
      pendencias,
      podeEmitir: pendencias.length === 0,
      provedoresSuportados: PROVEDORES_SUPORTADOS,
      papelDoUsuario: user.role,
    });
  } catch (err: any) {
    console.error("[Fiscal Config GET]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const lojaId = user.ownerId || user.id;
    const body = await req.json().catch(() => ({}));

    const atual = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true },
    });
    const config: any = { ...((atual?.fiscalConfig as any) || {}) };

    const recusados: string[] = [];
    for (const campo of CAMPOS_PERMITIDOS) {
      if (!(campo in body)) continue;

      if (CAMPOS_DO_TITULAR.has(campo) && user.role === "STAFF") {
        recusados.push(campo);
        continue;
      }

      let valor = body[campo];

      // Números chegam como string do formulário; guardar como número evita
      // comparação frouxa depois ("2" !== 2 quebrava a checagem de ambiente).
      if (campo === "regimeTributario" || campo === "serie" || campo === "ambiente") {
        valor = Number(valor);
        if (!Number.isFinite(valor)) continue;
      }
      if (campo === "uf" && typeof valor === "string") valor = valor.trim().toUpperCase();

      config[campo] = valor;
    }

    if (recusados.length > 0) {
      return NextResponse.json(
        {
          error: "sem_permissao",
          mensagem:
            "Só o responsável pela loja altera os dados de identidade fiscal: " +
            recusados.join(", ") +
            ".",
        },
        { status: 403 }
      );
    }

    await prisma.user.update({ where: { id: lojaId }, data: { fiscalConfig: config } });

    const pendencias = pendenciasParaEmitir(config);

    return NextResponse.json({
      success: true,
      // Devolve o retrato depois de gravar: o lojista salva e já vê o que
      // continua faltando, em vez de descobrir só na hora de emitir.
      pendencias,
      podeEmitir: pendencias.length === 0,
    });
  } catch (err: any) {
    console.error("[Fiscal Config PUT]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
