import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugDoNome } from "@/lib/slug-da-loja";
import { fusoPorEndereco } from "@/lib/fuso-por-endereco";
import bcrypt from "bcryptjs";
import { getCorsHeaders } from "@/lib/cors";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { diasDeTesteDoLink } from "@/lib/trial-do-cadastro";
import { cpfValido } from "@/lib/fiscal-validacao";

// CORS headers for cross-origin requests from firehubfood.com.br
export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: getCorsHeaders(req) });
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting: 5 registros por minuto por IP
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`register:${ip}`, { windowMs: 60_000, maxRequests: 5 });
    if (!allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Tente novamente em 1 minuto." },
        { status: 429, headers: getCorsHeaders(req) }
      );
    }

    const { name, email, password, phone, storeName, cnpj, cpf, semCnpj, city, repasseConfig, refCode, comoConheceu, faturamento } = await req.json();

    // Validações básicas
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nome, e-mail e senha são obrigatórios." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "A senha deve ter no mínimo 6 caracteres." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }

    // ── CNPJ OU CPF ───────────────────────────────────────────────────────
    //
    // O CNPJ era obrigatório e barrava quem está começando a vender sem
    // empresa aberta. Agora quem marca "ainda não tenho CNPJ" entra pelo CPF,
    // e o CPF vira o documento da conta (`cpfCnpj`) até a pessoa trocar em
    // Minha Loja. Nada depois do cadastro exige 14 dígitos: Asaas cobra CPF,
    // e a NFC-e usa o CNPJ da configuração fiscal, que só existe com empresa.
    //
    // O CPF é sempre conferido pelo dígito — a tela já confere, mas a trava de
    // "uma conta por pessoa" não pode depender de a requisição vir da tela.
    const cpfClean = String(cpf || "").replace(/\D/g, "");
    const cnpjClean = String(cnpj || "").replace(/\D/g, "");
    const pelaPessoa = !cnpjClean && !!semCnpj;

    if (!cnpjClean && !pelaPessoa) {
      return NextResponse.json(
        { error: "Informe o CNPJ da empresa ou escolha continuar com o CPF." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }
    if (cnpjClean && cnpjClean.length !== 14) {
      return NextResponse.json(
        { error: "CNPJ inválido." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }
    if (!cpfValido(cpfClean)) {
      return NextResponse.json(
        { error: "CPF inválido." },
        { status: 400, headers: getCorsHeaders(req) }
      );
    }
    const documento = pelaPessoa ? cpfClean : cnpjClean;

    // 1. Uma conta por documento — não importa o e-mail.
    //
    // O CPF é conferido nos DOIS caminhos: quem entrou pelo CPF e depois volta
    // com um CNPJ recém-aberto está pedindo um segundo teste grátis, não uma
    // conta nova — o caminho é atualizar o documento em Minha Loja. Contas
    // antigas guardam CNPJ em `cpfCnpj`, então isso não pega ninguém de antes.
    const existingByDoc = await prisma.user.findFirst({
      where: { cpfCnpj: { in: pelaPessoa ? [cpfClean] : [cnpjClean, cpfClean] } },
      select: { cpfCnpj: true },
    });
    if (existingByDoc) {
      const porCpf = existingByDoc.cpfCnpj === cpfClean;
      return NextResponse.json(
        {
          error: porCpf
            ? "Este CPF já possui uma conta no FireHub. Faça login — se abriu o CNPJ, dá para atualizar em Minha Loja."
            : "Este CNPJ já possui uma conta cadastrada no FireHub. Faça login ou entre em contato com o suporte.",
        },
        { status: 409, headers: getCorsHeaders(req) }
      );
    }

    // 2. Verificar se o email já existe
    const existingByEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existingByEmail) {
      return NextResponse.json(
        { error: "Este e-mail já está cadastrado. Tente fazer login." },
        { status: 409, headers: getCorsHeaders(req) }
      );
    }

    // Gerar slug único a partir do nome do restaurante.
    // A regra mora em lib/slug-da-loja.ts porque agora ela roda em DOIS
    // momentos: aqui, no cadastro, e na tela de configurações quando a loja
    // corrige o nome. Duas cópias divergiriam e o link mudaria de formato no
    // meio da vida da loja.
    const storeNameFinal = storeName || name;
    const baseSlug = slugDoNome(storeNameFinal);

    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.user.findUnique({ where: { slug } })) {
      attempt++;
      slug = `${baseSlug}-${attempt}`;
    }

    // Hash da senha com alto nível de segurança (rounds: 12)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Buscar embaixador ou parceiro por refCode (se existir)
    let ambassadorId = null;
    let referredById = null;
    if (refCode) {
      const code = String(refCode).toLowerCase().trim();
      const amb = await prisma.ambassador.findUnique({ where: { code } });
      if (amb && amb.active) {
        ambassadorId = amb.id;
      } else {
        const partner = await prisma.user.findFirst({
          where: {
            OR: [
              { slug: code },
              { id: code }
            ]
          }
        });
        if (partner) {
          referredById = partner.id;
        }
      }
    }

    // ── Teste grátis: 15 dias, e 30 para os links de campanha ─────────────
    //
    // Era `ambassadorId ? 30 : 15` — quem entrava por link de embaixador ganhava
    // o dobro. Voltou a ser 15 para todos, por decisão comercial (26/08/2026).
    //
    // Quem JÁ se cadastrou pelo link de 30 continua com 30: o prazo de cada
    // loja fica gravado em `trialEndsAt` na hora do cadastro e nada o recalcula
    // depois (só `/api/admin/grant-days`, que é manual e ESTENDE). Mudar a conta
    // aqui só alcança cadastro novo.
    //
    // ── O QR DA PALESTRA ──────────────────────────────────────────────────
    //
    // O QR do slide do FireHub Conect (21/09/2026) leva para
    // /cadastro?ref=conect e o slide promete "30 dias Grátis". O `refCode` só
    // servia para achar embaixador ou parceiro; "conect" não é nenhum dos dois,
    // caía fora e a loja recebia os 15 de sempre — a plateia inteira scaneando
    // um QR que entrega metade do que está escrito na tela atrás do palestrante.
    //
    // A regra mora em lib/trial-do-cadastro.ts, e a TELA de cadastro lê a
    // mesma função: é o que impede a página prometer 30 e a conta nascer com
    // 15, que já aconteceu uma vez com o link de embaixador.
    const TRIAL_DIAS = diasDeTesteDoLink(refCode);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DIAS);

    // Criar usuário com role FRANCHISEE (dono de restaurante)
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: "FRANCHISEE",
        storeName: storeNameFinal,
        storePhone: phone || null,
        city: city || null,
        // O fuso vem da cidade (ver fuso-por-endereco.ts); sem estado reconhecível, Brasília.
        storeTimezone: fusoPorEndereco({ city })?.fuso ?? "America/Sao_Paulo",
        cpfCnpj: documento,
        slug,
        ambassadorId,
        referredById,
        trialEndsAt,
        ...(repasseConfig && Object.keys(repasseConfig).length > 0 ? { repasseConfig } : {}),
        onboardingData: {
          comoConheceu: comoConheceu || null,
          faturamento: faturamento || null,
          // O CPF de quem cadastrou, mesmo quando a conta é pelo CNPJ: antes
          // ele era pedido na tela e jogado fora.
          cpfDoResponsavel: cpfClean,
          semCnpj: pelaPessoa,
        },
        permissions: "",
        isFranqueadoHakim: false,
        storeOpen: true,
        cashOpen: false,
        autoAcceptOrders: false,
        storeAlertSound: "bell",
        storeOrderCount: 0,
        planPercent: 1,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Conta criada com sucesso!",
      userId: user.id,
      slug: user.slug,
      email: user.email,
      storeName: user.storeName,
    }, { headers: getCorsHeaders(req) });
  } catch (error: unknown) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Erro interno ao criar conta. Tente novamente." },
      { status: 500, headers: getCorsHeaders(req) }
    );
  }
}
