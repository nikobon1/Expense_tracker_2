import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: NonNullable<DefaultSession["user"]> & {
      id: string;
      appUserId: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    appUserId?: number;
  }
}
