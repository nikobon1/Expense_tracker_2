import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getUserById, upsertUserFromSession, type AppUser } from "@/lib/server/users";

export class AuthenticationRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export function isAuthenticationRequiredError(error: unknown): error is AuthenticationRequiredError {
  return error instanceof AuthenticationRequiredError;
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;

  if (!sessionUser?.email) {
    return null;
  }

  if (typeof sessionUser.appUserId === "number" && Number.isInteger(sessionUser.appUserId)) {
    const existingUser = await getUserById(sessionUser.appUserId);
    if (existingUser) {
      return existingUser;
    }
  }

  return upsertUserFromSession({
    email: sessionUser.email,
    name: sessionUser.name,
    image: sessionUser.image,
  });
}

export async function requireCurrentUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationRequiredError();
  }

  return user;
}
