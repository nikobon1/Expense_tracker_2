import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

const providers: NextAuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push(
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })
    );
}

if (process.env.DEV_LOGIN_ENABLED === "true") {
    providers.push(
        CredentialsProvider({
            name: "Dev Login",
            credentials: {
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (process.env.DEV_LOGIN_ENABLED !== "true") {
                    return null;
                }

                const requiredPassword = process.env.DEV_LOGIN_PASSWORD?.trim();
                const providedPassword = credentials?.password?.trim();

                if (requiredPassword && providedPassword !== requiredPassword) {
                    return null;
                }

                const email = process.env.DEV_LOGIN_EMAIL?.trim() || "dev@local.test";
                const name = process.env.DEV_LOGIN_NAME?.trim() || "Dev User";

                return {
                    id: `dev:${email}`,
                    email,
                    name,
                };
            },
        })
    );
}

if (!providers.length) {
    throw new Error("No auth providers configured. Set Google OAuth vars or enable DEV_LOGIN_ENABLED.");
}

export const authOptions: NextAuthOptions = {
    providers,
    pages: {
        signIn: "/login",
    },
    session: {
        strategy: "jwt",
    },
    secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
