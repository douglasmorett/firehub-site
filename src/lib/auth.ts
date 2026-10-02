import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import { decode } from "next-auth/jwt";
import {
  verificarFreioDeLogin,
  registrarFalhaDeLogin,
  limparFreioDeLogin,
  origemDaRequisicao,
} from "./login-throttle";
import {
  contasDoMesmoDono,
  identidadeDaLoja,
  identidadeDoParceiro,
  papeisDaSessao,
  tokenDaSessaoAtual,
  trocarDePainel,
} from "./paineis-do-dono";
import { podeTrocarParaLoja } from "./loja-ativa";

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET environment variable is not defined. Please set it in your .env file.');
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
        impersonateId: { label: "Impersonate", type: "text" },
        returnToAdmin: { label: "ReturnToAdmin", type: "text" },
        isAmbassador: { label: "IsAmbassador", type: "text" },
        loginType: { label: "LoginType", type: "text" },
        trocarPara: { label: "TrocarPara", type: "text" },
        trocarLoja: { label: "TrocarLoja", type: "text" }
      },
      async authorize(credentials, req) {
        if (credentials?.impersonateId) {
          const cookies = req?.headers?.cookie || "";
          const sessionTokenMatch = cookies.match(/(?:next-auth\.session-token|__Secure-next-auth\.session-token)=([^;]+)/);
          if (sessionTokenMatch) {
            const tokenValue = sessionTokenMatch[1];
            try {
              const decoded = await decode({ token: tokenValue, secret: process.env.NEXTAUTH_SECRET! });
              if (decoded?.role === "ADMIN") {
                const targetUser = await prisma.user.findUnique({ where: { id: credentials.impersonateId } });
                if (targetUser) {
                  return {
                    id: targetUser.id,
                    name: targetUser.name,
                    email: targetUser.email,
                    role: targetUser.role as string,
                    city: targetUser.city as string | null,
                    storeName: targetUser.storeName || targetUser.name,
                    permissions: targetUser.permissions as string,
                    // Quem entrou. Sem isto a impersonação era porta de mão
                    // única: ela SUBSTITUI a sessão do admin pela da loja, e a
                    // própria checagem acima (`role === "ADMIN"`) passava a
                    // falhar — o admin perdia justamente a permissão que
                    // precisaria para desfazer. A única saída era sair e entrar
                    // de novo, a cada atendimento.
                    impersonatedBy: (decoded as any).id || decoded.sub || null,
                  } as any;
                }
              }
            } catch (e) {
              console.error("Impersonation error:", e);
            }
          }
          return null;
        }

        // ── Voltar ao admin, sem senha e sem sair ─────────────────────────
        //
        // Só funciona sobre uma sessão que NASCEU de impersonação: quem decide
        // o destino é o `impersonatedBy` gravado no token, nunca nada que venha
        // na requisição. Sem esse campo, não há para onde voltar e a resposta é
        // recusa — uma sessão comum de loja não vira admin por aqui.
        //
        // O papel do destino é conferido AGORA, no banco, e não pelo que o
        // token diz. Admin rebaixado depois da impersonação não recupera acesso
        // por causa de um token emitido quando ainda era.
        if (credentials?.returnToAdmin === "true") {
          const cookies = req?.headers?.cookie || "";
          const sessionTokenMatch = cookies.match(/(?:next-auth\.session-token|__Secure-next-auth\.session-token)=([^;]+)/);
          if (!sessionTokenMatch) return null;
          try {
            const decoded = await decode({ token: sessionTokenMatch[1], secret: process.env.NEXTAUTH_SECRET! });
            const adminId = (decoded as any)?.impersonatedBy;
            if (!adminId) return null;

            const admin = await prisma.user.findUnique({ where: { id: String(adminId) } });
            if (!admin || admin.role !== "ADMIN") return null;

            return {
              id: admin.id,
              name: admin.name,
              email: admin.email,
              role: admin.role as string,
              city: admin.city as string | null,
              storeName: admin.storeName || admin.name,
              permissions: admin.permissions as string,
              // Volta a ser sessão normal: sem isto o admin ficaria marcado
              // como "impersonando" para sempre, e a faixa nunca sumiria.
              impersonatedBy: null,
            } as any;
          } catch (e) {
            console.error("Erro ao voltar da impersonação:", e);
            return null;
          }
        }

        // ── Trocar entre a loja e o portal do parceiro, sem sair ────────────
        // Quem é lojista E embaixador/vendedor (o Victor). A regra mora em
        // lib/paineis-do-dono.ts: conta já provada nesta sessão troca direto,
        // a outra pede a senha dela.
        if (credentials?.trocarPara === "loja" || credentials?.trocarPara === "parceiro") {
          return (await trocarDePainel(credentials.trocarPara, credentials.password, req)) as any;
        }

        // ── Multiloja: trocar para outra loja DO MESMO GRUPO, sem senha ─────
        //
        // O seletor "Suas Lojas" só gravava um cookie que quase nenhuma tela
        // lia; a sessão continuava na loja do login (China Pow → Yakisoba do
        // San, 02/10/2026). Agora a sessão vira a da loja escolhida, como no
        // modo suporte (lib/loja-ativa.ts).
        //
        // Quem decide é o token ATUAL, nunca o corpo da requisição: a conta da
        // sessão tem que ser loja (não funcionário — viraria dono da outra) e o
        // destino tem que ser do grupo dela (a principal ou uma filial que
        // aponta para a principal). Quem entrou pelo modo suporte continua
        // marcado (`impersonatedBy`), para o "Voltar ao admin" seguir valendo.
        if (credentials?.trocarLoja) {
          const atual = await tokenDaSessaoAtual(req);
          const atualId = (atual as any)?.id || (atual as any)?.sub;
          if (!atualId) return null;
          const conta = await prisma.user.findUnique({ where: { id: String(atualId) } });
          const destino = await prisma.user.findUnique({ where: { id: String(credentials.trocarLoja) } });
          if (!destino || !podeTrocarParaLoja(conta as any, destino as any)) return null;
          const papeisAtuais = ((atual as any)?.papeis || {}) as Record<string, string>;
          return {
            ...identidadeDaLoja(destino as any, { ...papeisAtuais, loja: destino.id } as any),
            impersonatedBy: (atual as any)?.impersonatedBy ?? null,
          } as any;
        }

        if (!credentials?.email || !credentials?.password) return null;

        const emailInput = credentials.email.trim();
        const wantsAmbassador = credentials.isAmbassador === "true" || credentials.loginType === "ambassador";

        // ── Freio de força bruta ────────────────────────────────────────────
        //
        // Este login não tinha limite nenhum de tentativas: um robô testava
        // senhas contra a conta de um lojista o quanto quisesse. A trava conta
        // por e-mail — que é o que o atacante precisa manter fixo para invadir
        // uma conta específica — e não só por IP, que ele troca a cada envio.
        //
        // A verificação vem ANTES do bcrypt.compare de propósito: durante o
        // bloqueio, nem a senha certa entra. Um bloqueio que abre para quem
        // acertou é exatamente o que o robô está procurando.
        const origem = origemDaRequisicao(req?.headers as any);
        const freio = verificarFreioDeLogin(emailInput, origem);
        if (freio.bloqueado) {
          const minutos = Math.ceil(freio.esperarSegundos / 60);
          throw new Error(
            minutos > 1
              ? `Muitas tentativas de login. Tente novamente em ${minutos} minutos.`
              : "Muitas tentativas de login. Tente novamente em 1 minuto."
          );
        }

        // A senha é conferida nas DUAS contas do dono (loja e portal do
        // parceiro, lib/paineis-do-dono.ts): quem usa a mesma senha nas duas
        // sai daqui com as duas provadas e troca de painel sem digitar de novo.
        const senha = credentials.password.trim();
        const contas = await contasDoMesmoDono(emailInput);
        const lojaOk = !!contas.loja && (await bcrypt.compare(senha, contas.loja.password));
        const parceiroOk = !!contas.parceiro?.password && (await bcrypt.compare(senha, contas.parceiro.password));

        // Quem ENTRA é a conta do e-mail digitado, como sempre foi: no /login a
        // loja primeiro e o portal se a senha for a dele; no portal
        // (`wantsAmbassador`), só o portal. A conta vinculada de outro e-mail
        // nunca entra pelo login — só aparece provada para a troca.
        const entraLoja = !wantsAmbassador && lojaOk && contas.lojaPeloEmail;
        const entraParceiro = !entraLoja && parceiroOk && contas.parceiroPeloEmail;

        if (!entraLoja && !entraParceiro) {
          // E-mail inexistente ou senha errada. As duas contam igual, porque
          // distinguir uma da outra já entrega quais e-mails têm conta.
          registrarFalhaDeLogin(emailInput, origem);
          return null;
        }
        limparFreioDeLogin(emailInput);

        // Entrar no portal estando na loja (ou o contrário) não esquece a que
        // já estava provada neste navegador.
        const papeis = papeisDaSessao(await tokenDaSessaoAtual(req), contas);
        if (lojaOk) papeis.loja = contas.loja!.id;
        if (parceiroOk) papeis.parceiro = contas.parceiro!.id;

        return (entraLoja ? identidadeDaLoja(contas.loja!, papeis) : identidadeDoParceiro(contas.parceiro!, papeis)) as any;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.city = (user as any).city;
        token.storeName = (user as any).storeName;
        token.permissions = (user as any).permissions;
        // `?? null` em vez de `if (...)`: precisa APAGAR quando o login novo
        // não carrega o campo. Só gravar quando existe deixaria o admin com a
        // marca de impersonação grudada depois de voltar.
        (token as any).impersonatedBy = (user as any).impersonatedBy ?? null;
        // As contas que esta sessão provou (lib/paineis-do-dono.ts). Mesma
        // regra do campo acima: login sem o campo APAGA o anterior.
        (token as any).papeis = (user as any).papeis ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id || token.sub;
        (session.user as any).role = token.role;
        (session.user as any).city = token.city;
        (session.user as any).storeName = token.storeName;
        (session.user as any).permissions = token.permissions;
        (session.user as any).impersonatedBy = (token as any).impersonatedBy || null;
        (session.user as any).papeis = (token as any).papeis || null;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',   // FireHub usa /login (não /firehub/login)
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 dias
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? `__Secure-next-auth.session-token` : `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  secret: process.env.NEXTAUTH_SECRET!,
};
