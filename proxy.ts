import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET
    });

    const isLoginPage = pathname === "/login";
    const isAuthRoute = pathname.startsWith("/api/auth");
    const isPublicHealthRoute = pathname.startsWith("/api/health");
    const isTelegramWebhookRoute = pathname.startsWith("/api/telegram/webhook");

    // Allow auth and bot/health routes without session
    if (isAuthRoute || isPublicHealthRoute || isTelegramWebhookRoute) {
        return NextResponse.next();
    }

    // Redirect to login if not authenticated
    if (!token && !isLoginPage) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    // Redirect to home if already logged in and on login page
    if (token && isLoginPage) {
        return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
