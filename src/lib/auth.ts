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
        loginType: { label: "LoginType", type: "text" }
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

        // Se veio do portal do embaixador, prioriza a busca na tabela Ambassador
        if (wantsAmbassador) {
          const ambassador = await prisma.ambassador.findFirst({
            where: { email: { equals: emailInput, mode: "insensitive" } }
          });
          if (ambassador && ambassador.password) {
            const ambPasswordMatch = await bcrypt.compare(credentials.password.trim(), ambassador.password);
            if (ambPasswordMatch) {
              limparFreioDeLogin(emailInput);
              return {
                id: ambassador.id,
                name: ambassador.name,
                email: ambassador.email,
                role: "AMBASSADOR",
                city: null,
                storeName: ambassador.name,
                permissions: "[]"
              };
            }
          }
          registrarFalhaDeLogin(emailInput, origem);
          return null;
        }

        // Fluxo padrão: busca primeiro na tabela User
        const user = await prisma.user.findFirst({
          where: {
            email: { equals: emailInput, mode: "insensitive" }
          }
        });

        if (user) {
          const passwordMatch = await bcrypt.compare(credentials.password.trim(), user.password);
          if (passwordMatch) {
            limparFreioDeLogin(emailInput);
            return {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role as string,
              city: user.city as string | null,
              storeName: user.storeName || user.name,
              permissions: user.permissions as string
            };
          }
        }

        // Se não encontrou em User ou senha não bateu em User, tenta Ambassador
        const fallbackAmbassador = await prisma.ambassador.findFirst({
          where: { email: { equals: emailInput, mode: "insensitive" } }
        });
        if (fallbackAmbassador && fallbackAmbassador.password) {
          const ambPasswordMatch = await bcrypt.compare(credentials.password.trim(), fallbackAmbassador.password);
          if (ambPasswordMatch) {
            limparFreioDeLogin(emailInput);
            return {
              id: fallbackAmbassador.id,
              name: fallbackAmbassador.name,
              email: fallbackAmbassador.email,
              role: "AMBASSADOR",
              city: null,
              storeName: fallbackAmbassador.name,
              permissions: "[]"
            };
          }
        }

        // Chegou aqui: e-mail inexistente ou senha errada. As duas contam igual,
        // porque distinguir uma da outra já entrega quais e-mails têm conta.
        registrarFalhaDeLogin(emailInput, origem);
        return null;
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
