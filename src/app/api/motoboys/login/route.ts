import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { SENHA_PADRAO, conferirSenha, hashDeSenha } from "@/lib/motoboy-senha";

// ─── Senha do motoboy ────────────────────────────────────────────────────────
//
// Este login não passa pelo NextAuth: o app do motoboy é uma página pública em
// /loja/[slug]/motoboy, e o que separa um entregador do resto da internet é só
// isto aqui. Até agora eram três buracos somados:
//
//  1. a senha era gravada em texto puro no banco;
//  2. quem nunca trocou entra com "123456" — e a mensagem de erro ENSINAVA a
//     senha padrão a quem errasse;
//  3. o motoboy era encontrado por nome PARCIAL (`includes`), então digitar uma
//     única letra casava com o primeiro entregador cujo nome a contivesse.
//
// Juntos, os três davam acesso ao app de entregas de qualquer loja com duas
// tentativas: uma letra e "123456". Com acesso, veem endereço, telefone e nome
// dos clientes da loja.
//
// O hash e a regra da senha padrão vivem em lib/motoboy-senha.ts, compartilhados
// com o cadastro; aqui ficam a identificação do entregador e o freio de tentativas.

/**
 * Acha o entregador dentro da loja pelo que foi digitado no campo de acesso.
 *
 * O casamento por nome continua existindo — há entregador que entra pelo nome —
 * mas deixou de ser por trecho solto. Um texto curto ou ambíguo não identifica
 * ninguém: se mais de um cadastro casa, o login é recusado em vez de entregar o
 * primeiro da lista.
 */
function acharMotoboy(motoboys: any[], digitado: string) {
  const texto = digitado.trim().toLowerCase();
  const digitos = digitado.replace(/\D/g, "");

  // 1. Telefone: os dígitos têm que bater por inteiro. Antes um `includes`
  //    aceitava pedaço de número, e "9" casava com quase todo mundo.
  if (digitos.length >= 8) {
    const porTelefone = motoboys.filter(m => (m.phone || "").replace(/\D/g, "") === digitos);
    if (porTelefone.length === 1) return porTelefone[0];
    if (porTelefone.length > 1) return null;
  }

  // 2. Nome exato.
  const exatos = motoboys.filter(m => (m.name || "").trim().toLowerCase() === texto);
  if (exatos.length === 1) return exatos[0];
  if (exatos.length > 1) return null;

  // 3. Nome parcial, só se for específico o bastante e identificar uma pessoa só.
  if (texto.length >= 4) {
    const parciais = motoboys.filter(m => (m.name || "").toLowerCase().includes(texto));
    if (parciais.length === 1) return parciais[0];
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { storeSlug, phone, password } = await req.json();

    if (!storeSlug) {
      return NextResponse.json({ error: "Slug da loja é obrigatório" }, { status: 400 });
    }

    if (!phone || !password) {
      return NextResponse.json({ error: "Telefone/Nome e senha são obrigatórios" }, { status: 400 });
    }

    // Sem limite, um laço testa a senha padrão contra a lista inteira de
    // entregadores da loja em segundos.
    const limite = checkRateLimit(`motoboy-login:${getClientIp(req)}:${storeSlug}`, {
      windowMs: 60_000,
      maxRequests: 10,
    });
    if (!limite.allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde um minuto e tente de novo." },
        { status: 429 }
      );
    }

    const cleanSlug = storeSlug.toLowerCase().trim();
    const slugName = cleanSlug.replace(/-/g, " ");

    // MULTI-TENANT: Busca a loja EXCLUSIVAMENTE pelo slug — sem fallbacks
    let storeUser = await prisma.user.findFirst({
      where: {
        OR: [
          { slug: cleanSlug },
          { name: { contains: cleanSlug, mode: "insensitive" } },
          { name: { contains: slugName, mode: "insensitive" } },
        ]
      },
      select: { id: true, name: true, storeName: true, slug: true, storeAddress: true, city: true }
    });

    if (!storeUser) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    // MULTI-TENANT: Busca motoboys APENAS desta loja — sem fallback global
    const motoboys = await prisma.motoboy.findMany({
      where: {
        franchiseeId: storeUser.id,
        active: true,
      }
    });

    const motoboy = acharMotoboy(motoboys, phone);

    // A mesma resposta para "não existe" e "senha errada". Distinguir os dois
    // transforma esta rota numa lista de quem entrega para a loja.
    const RECUSADO = NextResponse.json(
      { error: "Telefone/nome ou senha incorretos." },
      { status: 401 }
    );

    if (!motoboy) return RECUSADO;

    const conferencia = await conferirSenha(motoboy.password, password);
    if (!conferencia.ok) return RECUSADO;

    if (conferencia.hashParaGravar) {
      await prisma.motoboy.update({
        where: { id: motoboy.id },
        data: { password: conferencia.hashParaGravar },
      });
    }

    // Sessão ASSINADA, criada DEPOIS do re-hash oportunista acima — a
    // assinatura embute o hash da senha, e assinar com o hash antigo geraria
    // um token que nasce inválido. É esta credencial que autoriza o verbo de
    // PUXAR pedido (QR da comanda); o localStorage sozinho nunca autoriza nada.
    const { criarSessaoDeMotoboy } = await import("@/lib/motoboy-sessao");
    const token = criarSessaoDeMotoboy(
      motoboy.id,
      storeUser.id,
      conferencia.hashParaGravar ?? motoboy.password
    );

    return NextResponse.json({
      success: true,
      token,
      motoboyId: motoboy.id,
      motoboyName: motoboy.name,
      // A tela usa isto para cobrar a troca de quem ainda está na senha padrão.
      mustChangePassword: conferencia.ehPadrao,
      storeId: storeUser.id,
      // O nome DA LOJA, nao o nome civil do dono: o app do motoboy exibia
      // "Loja: Jorge Luis Mingordo Cesario Junior" em vez de "Brasa Burguer".
      storeName: storeUser.storeName || storeUser.name,
      storeAddress: storeUser.storeAddress || storeUser.city || "",
      motoboy: {
        id: motoboy.id,
        name: motoboy.name,
        phone: motoboy.phone
      },
      store: {
        id: storeUser.id,
        name: storeUser.storeName || storeUser.name,
        storeAddress: storeUser.storeAddress || storeUser.city || "",
        city: storeUser.city || ""
      }
    });
  } catch (err: any) {
    console.error("[Motoboy Login Error]:", err);
    return NextResponse.json({ error: err?.message || "Erro interno ao realizar login" }, { status: 500 });
  }
}

// PATCH - Alterar senha do motoboy pelo próprio app
export async function PATCH(req: NextRequest) {
  try {
    const { motoboyId, currentPassword, newPassword } = await req.json();

    if (!motoboyId || !newPassword) {
      return NextResponse.json({ error: "ID do motoboy e nova senha são obrigatórios" }, { status: 400 });
    }

    // Trocar senha é justamente o que um invasor faz depois de entrar com a
    // padrão — e era ilimitado.
    const limite = checkRateLimit(`motoboy-senha:${getClientIp(req)}`, {
      windowMs: 60_000,
      maxRequests: 5,
    });
    if (!limite.allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde um minuto e tente de novo." },
        { status: 429 }
      );
    }

    // Senha curta demais devolve o entregador para o mesmo lugar de onde ele
    // está saindo: um número de seis dígitos que todo mundo adivinha.
    const nova = String(newPassword).trim();
    if (nova.length < 6) {
      return NextResponse.json({ error: "A nova senha precisa ter pelo menos 6 caracteres." }, { status: 400 });
    }
    if (nova === SENHA_PADRAO) {
      return NextResponse.json({ error: "Escolha uma senha diferente da padrão." }, { status: 400 });
    }

    const motoboy = await prisma.motoboy.findUnique({ where: { id: motoboyId } });
    if (!motoboy || motoboy.active === false) {
      return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });
    }

    const conferencia = await conferirSenha(motoboy.password, String(currentPassword ?? ""));
    if (!conferencia.ok) {
      return NextResponse.json({ error: "Senha atual incorreta!" }, { status: 401 });
    }

    const hashNovo = await hashDeSenha(nova);
    await prisma.motoboy.update({
      where: { id: motoboyId },
      data: { password: hashNovo }
    });

    // A troca de senha INVALIDA todas as sessões antigas por construção (o
    // hash entra na assinatura) — então devolve um token novo, senão o próprio
    // aparelho que trocou a senha seria deslogado no tique seguinte.
    const { criarSessaoDeMotoboy } = await import("@/lib/motoboy-sessao");
    const token = criarSessaoDeMotoboy(motoboy.id, motoboy.franchiseeId, hashNovo);

    // A resposta devolvia o registro inteiro do motoboy — senha inclusive.
    return NextResponse.json({ success: true, token, message: "Senha alterada com sucesso!" });
  } catch (err: any) {
    console.error("[Motoboy Change Password Error]:", err);
    return NextResponse.json({ error: err?.message || "Erro ao alterar senha" }, { status: 500 });
  }
}
