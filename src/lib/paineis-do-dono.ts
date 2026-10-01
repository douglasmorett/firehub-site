/**
 * QUEM É LOJISTA E PARCEIRO AO MESMO TEMPO.
 *
 * O Victor é embaixador, vendedor e tem uma loja no FireHub — a loja existe
 * para ele apresentar o sistema. Eram dois logins que não se conheciam: no
 * /login entrava a loja, no /vendedor o portal, e trocar de um para o outro
 * era sair e digitar senha de novo (pedido do Douglas, 30/09/2026: "ele tem
 * que conseguir ter o acesso de vendedor e de lojista separado").
 *
 * As duas contas continuam separadas — a sessão do NextAuth carrega UMA
 * identidade por vez, e todas as rotas da loja leem a loja pelo `session.user`.
 * O que muda é que a sessão passa a lembrar quais contas a pessoa PROVOU ter
 * (`papeis`), e trocar para uma provada não pede senha.
 *
 * ── Quando duas contas são do mesmo dono ───────────────────────────────────
 *
 *   • mesmo e-mail na loja (User) e no portal (Ambassador); ou
 *   • `Ambassador.linkedUserId` — a loja que o admin promoveu a embaixadora
 *     (api/admin/ambassadors/promote), que pode ter e-mail diferente.
 *
 * Isso diz que as contas ANDAM JUNTAS, não que a pessoa entra nas duas: cada
 * uma só entra pela própria senha. Quem usa a mesma senha nas duas prova as
 * duas num login só. Sem essa regra, cadastrar uma loja com o e-mail de um
 * vendedor daria a qualquer um a carteira e as conversas dele.
 *
 * Senhas diferentes: no par VINCULADO pelo admin, a tela oferece a outra conta
 * e pede a senha dela na troca. No par só por e-mail, a outra conta só aparece
 * depois de provada — entrando nela pelo login dela no mesmo navegador, que a
 * soma à sessão. O cadastro de loja é público e aceita qualquer e-mail: sem
 * isso, quem cadastrasse a loja com o e-mail de um vendedor veria o nome dele
 * e um "painel de vendedor" para testar senha.
 */
import { decode } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { verificarFreioDeLogin, registrarFalhaDeLogin, limparFreioDeLogin, origemDaRequisicao } from "./login-throttle";

export type Painel = "loja" | "parceiro";

/** Contas que a sessão provou ter: id da loja (User) e/ou do parceiro (Ambassador). */
export type PapeisProvados = Partial<Record<Painel, string>>;

const COLUNAS_DA_LOJA = {
  id: true, name: true, email: true, password: true, role: true, city: true,
  storeName: true, permissions: true,
} as const;

const COLUNAS_DO_PARCEIRO = { id: true, name: true, email: true, password: true, isVendedor: true, linkedUserId: true } as const;

type Loja = { id: string; name: string; email: string; password: string; role: string; city: string | null; storeName: string | null; permissions: string | null };
type Parceiro = { id: string; name: string; email: string; password: string | null; isVendedor: boolean; linkedUserId: string | null };

export type ContasDoDono = {
  loja: Loja | null;
  parceiro: Parceiro | null;
  /** A conta achada é a do e-mail informado (e não a vinculada, de outro e-mail). */
  lojaPeloEmail: boolean;
  parceiroPeloEmail: boolean;
  /** O admin ligou as duas (`Ambassador.linkedUserId`) — não é só coincidência de e-mail. */
  vinculadas: boolean;
};

/** A loja e o portal que andam juntos com este e-mail. */
export async function contasDoMesmoDono(email: string): Promise<ContasDoDono> {
  const limpo = String(email || "").trim();
  if (!limpo) return { loja: null, parceiro: null, lojaPeloEmail: false, parceiroPeloEmail: false, vinculadas: false };
  const porEmail = { email: { equals: limpo, mode: "insensitive" as const } };

  const [lojaDoEmail, parceiroDoEmail] = await Promise.all([
    prisma.user.findFirst({ where: porEmail, select: COLUNAS_DA_LOJA }),
    prisma.ambassador.findFirst({ where: porEmail, select: COLUNAS_DO_PARCEIRO }),
  ]);

  let loja = lojaDoEmail as Loja | null;
  let parceiro = parceiroDoEmail as Parceiro | null;
  if (!loja && parceiro?.linkedUserId) {
    loja = (await prisma.user.findUnique({ where: { id: parceiro.linkedUserId }, select: COLUNAS_DA_LOJA })) as Loja | null;
  }
  if (!parceiro && loja) {
    parceiro = (await prisma.ambassador.findFirst({ where: { linkedUserId: loja.id }, select: COLUNAS_DO_PARCEIRO })) as Parceiro | null;
  }
  return {
    loja,
    parceiro,
    lojaPeloEmail: !!lojaDoEmail,
    parceiroPeloEmail: !!parceiroDoEmail,
    vinculadas: !!loja && !!parceiro && parceiro.linkedUserId === loja.id,
  };
}

/** O usuário que o `authorize` devolve para a sessão entrar na LOJA. */
export function identidadeDaLoja(loja: Loja, papeis: PapeisProvados) {
  return {
    id: loja.id,
    name: loja.name,
    email: loja.email,
    role: loja.role as string,
    city: loja.city as string | null,
    storeName: loja.storeName || loja.name,
    permissions: loja.permissions as string,
    papeis,
  };
}

/** O usuário que o `authorize` devolve para a sessão entrar no PORTAL DO PARCEIRO. */
export function identidadeDoParceiro(parceiro: Parceiro, papeis: PapeisProvados) {
  return {
    id: parceiro.id,
    name: parceiro.name,
    email: parceiro.email,
    role: "AMBASSADOR",
    city: null,
    storeName: parceiro.name,
    permissions: "[]",
    papeis,
  };
}

type TokenDaSessao = { id?: string; sub?: string; email?: string; role?: string; papeis?: PapeisProvados | null; impersonatedBy?: string | null };

/** O token da sessão que JÁ está aberta neste navegador (o cookie vem na requisição do login). */
export async function tokenDaSessaoAtual(req: any): Promise<TokenDaSessao | null> {
  const cookies: string = req?.headers?.cookie || "";
  const m = cookies.match(/(?:next-auth\.session-token|__Secure-next-auth\.session-token)=([^;]+)/);
  if (!m) return null;
  try {
    return ((await decode({ token: m[1], secret: process.env.NEXTAUTH_SECRET! })) as TokenDaSessao | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * O que a sessão prova, conferido contra as contas de agora: só vale id que
 * ainda é a loja ou o portal deste dono. A identidade ATIVA conta como provada
 * — ela entrou com senha —, o que também cobre a sessão aberta antes de os
 * `papeis` existirem. Sessão de "Acessar" do admin não prova nada: quem está
 * ali é o suporte, não o dono.
 */
export function papeisDaSessao(token: TokenDaSessao | null, contas: ContasDoDono): PapeisProvados {
  if (!token || token.impersonatedBy) return {};
  const papeis: PapeisProvados = {};
  const provados = token.papeis || {};
  const idAtivo = String(token.id || token.sub || "");
  if (contas.loja && (provados.loja === contas.loja.id || (token.role !== "AMBASSADOR" && idAtivo === contas.loja.id))) {
    papeis.loja = contas.loja.id;
  }
  if (contas.parceiro && (provados.parceiro === contas.parceiro.id || (token.role === "AMBASSADOR" && idAtivo === contas.parceiro.id))) {
    papeis.parceiro = contas.parceiro.id;
  }
  return papeis;
}

/**
 * TROCAR DE PAINEL sem sair: a sessão aberta vira a outra conta do mesmo dono.
 *
 * Conta já provada troca direto; a outra pede a senha DELA (com o mesmo freio
 * de força bruta do login). Devolve o usuário para o `authorize`, ou null.
 */
export async function trocarDePainel(para: Painel, senha: string | undefined, req: any) {
  const atual = await tokenDaSessaoAtual(req);
  if (!atual?.email || atual.impersonatedBy) return null;

  const contas = await contasDoMesmoDono(atual.email);
  const papeis = papeisDaSessao(atual, contas);
  // A sessão tem que ser de uma das duas contas: senão o e-mail do token não
  // liga ninguém a nada.
  if (!papeis.loja && !papeis.parceiro) return null;

  const alvo = para === "loja" ? contas.loja : contas.parceiro;
  if (!alvo) return null;

  if (papeis[para] !== alvo.id) {
    // Senha na troca só no par vinculado pelo admin (ver o topo do arquivo).
    if (!contas.vinculadas) return null;
    const digitada = String(senha || "").trim();
    if (!digitada || !alvo.password) return null;
    // Freio com chave PRÓPRIA da conta-alvo, não o do e-mail: o do e-mail zera
    // quando qualquer conta com aquele e-mail entra, e quem divide o e-mail
    // poderia zerá-lo entre uma tentativa e outra.
    const chave = `troca:${para}:${alvo.id}`;
    const origem = origemDaRequisicao(req?.headers);
    const freio = verificarFreioDeLogin(chave, origem);
    if (freio.bloqueado) {
      const minutos = Math.ceil(freio.esperarSegundos / 60);
      throw new Error(`Muitas tentativas. Tente novamente em ${minutos > 1 ? `${minutos} minutos` : "1 minuto"}.`);
    }
    if (!(await bcrypt.compare(digitada, alvo.password))) {
      registrarFalhaDeLogin(chave, origem);
      return null;
    }
    limparFreioDeLogin(chave);
    papeis[para] = alvo.id;
  }

  return para === "loja" ? identidadeDaLoja(alvo as Loja, papeis) : identidadeDoParceiro(alvo as Parceiro, papeis);
}

/**
 * Logado na loja e com o portal provado: a loja e o portal, para o /vendedor e
 * o /embaixador oferecerem "abrir sem senha". Null em qualquer outro caso —
 * aí a tela é o login de sempre.
 */
export async function lojaQueAbreOPortal(
  sessionUser: any
): Promise<{ loja: string; vendedor: boolean; destino: string } | null> {
  if (!sessionUser?.email || sessionUser.role === "AMBASSADOR") return null;
  try {
    const paineis = await paineisDaSessao(sessionUser);
    if (!paineis?.parceiro?.provado || !paineis.loja) return null;
    return { loja: paineis.loja.nome, vendedor: paineis.parceiro.vendedor, destino: paineis.parceiro.destino };
  } catch {
    return null;
  }
}

/** Os dois painéis de quem está logado, para a escolha no /login e os atalhos. */
export type PaineisDaSessao = {
  ativo: Painel;
  loja: { nome: string; provado: boolean; destino: string; admin: boolean } | null;
  parceiro: { nome: string; vendedor: boolean; provado: boolean; destino: string } | null;
};

export async function paineisDaSessao(sessionUser: any): Promise<PaineisDaSessao | null> {
  if (!sessionUser?.email || sessionUser.impersonatedBy) return null;
  const contas = await contasDoMesmoDono(sessionUser.email);
  const papeis = papeisDaSessao(
    { id: sessionUser.id, role: sessionUser.role, papeis: sessionUser.papeis, impersonatedBy: sessionUser.impersonatedBy },
    contas
  );
  // Par só por e-mail: a outra conta só aparece depois de provada.
  const loja = contas.vinculadas || papeis.loja ? contas.loja : null;
  const parceiro = contas.vinculadas || papeis.parceiro ? contas.parceiro : null;
  return {
    ativo: sessionUser.role === "AMBASSADOR" ? "parceiro" : "loja",
    loja: loja
      ? {
          nome: loja.storeName || loja.name,
          provado: !!papeis.loja,
          destino: loja.role === "ADMIN" ? "/admin" : "/store",
          admin: loja.role === "ADMIN",
        }
      : null,
    parceiro: parceiro
      ? {
          nome: parceiro.name,
          vendedor: parceiro.isVendedor,
          provado: !!papeis.parceiro,
          destino: parceiro.isVendedor ? "/vendedor" : "/embaixador",
        }
      : null,
  };
}
