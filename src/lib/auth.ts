import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import { decode } from "next-auth/jwt";

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
        impersonateId: { label: "Impersonate", type: "text" }
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
                    permissions: targetUser.permissions as string
                  };
                }
              }
            } catch (e) {
              console.error("Impersonation error:", e);
            }
          }
          return null;
        }

        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        });

        if (!user) return null;

        const passwordMatch = await bcrypt.compare(credentials.password, user.password);
        if (!passwordMatch) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as string,
          city: user.city as string | null,
          permissions: user.permissions as string
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.city = (user as any).city;
        token.permissions = (user as any).permissions;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).city = token.city;
        (session.user as any).permissions = token.permissions;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',   // FireHub usa /login (não /firehub/login)
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET!,
};
