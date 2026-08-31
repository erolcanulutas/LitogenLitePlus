/**
 * Talking to the membership endpoints.
 *
 * Addresses are relative, so the app works wherever it is served from and
 * there is no host to keep in step with the build. The dev server has no PHP
 * behind it, so every one of these fails there — which is the honest answer,
 * and the caller shows it rather than pretending someone is signed in.
 */

export type Account = {
  email: string;
  /** "sub" while a subscription is running, otherwise "free". */
  plan: string;
  /** Exports left to spend. Ignored while subscribed. */
  tokens: number;
  /** When the subscription runs out, if there is one. */
  planUntil: string | null;
};

/** Whether this account may export without spending anything. */
export function unlimited(a: Account | null): boolean {
  return a?.plan === "sub";
}

/**
 * A header no cross-site form can set.
 *
 * A page elsewhere can make a browser POST here, and the session cookie is
 * SameSite=Lax so it would not be sent along — but requiring something only a
 * script of ours can add costs nothing and does not rely on getting the cookie
 * rules right.
 */
const HEADERS = {
  "Content-Type": "application/json",
  "X-Litogen": "1",
};

async function call(path: string, body?: unknown): Promise<{ user?: Account | null }> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Could not reach the server");
  }

  let data: { ok?: boolean; error?: string; user?: Account | null } = {};
  try {
    data = await res.json();
  } catch {
    throw new Error("The server did not answer properly");
  }

  if (!data.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

/** Who is signed in, or null. Never throws for "nobody". */
export async function whoAmI(): Promise<Account | null> {
  try {
    const { user } = await call("me.php");
    return user ?? null;
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<Account> {
  const { user } = await call("login.php", { email, password });
  if (!user) throw new Error("Signed in, but the server sent no account");
  return user;
}

export async function signUp(email: string, password: string): Promise<Account> {
  const { user } = await call("register.php", { email, password });
  if (!user) throw new Error("Created, but the server sent no account");
  return user;
}

export async function signOut(): Promise<void> {
  await call("logout.php", {});
}

/** Raised when the balance is empty, so the caller can say so properly. */
export class OutOfTokens extends Error {}

/**
 * Pays for one export.
 *
 * Called after the model is built and before the file is handed over: looking
 * costs nothing, keeping costs a token. The server decides — the balance shown
 * here is only what it last said.
 */
export async function spendForExport(): Promise<Account> {
  let res: Response;
  try {
    res = await fetch("/api/spend.php", {
      method: "POST",
      headers: HEADERS,
      body: "{}",
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Could not reach the server");
  }

  const data: { ok?: boolean; error?: string; user?: Account | null } =
    await res.json().catch(() => ({}));

  if (res.status === 402) throw new OutOfTokens(data.error || "No tokens left");
  if (!data.ok || !data.user) throw new Error(data.error || "Could not export");

  return data.user;
}
