import { t } from "../i18n";
import { parseFilaments, type Filament } from "./filaments";

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

/** A holder design kept in an account: settings and decorations, never a picture. */
export type DesignRecord = { name: string; data: unknown; updatedAt: string };

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

async function call(
  path: string,
  body?: unknown,
): Promise<{ user?: Account | null; designs?: DesignRecord[]; filaments?: unknown[]; entries?: { id: string; data: unknown }[] }> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new Error(t("Could not reach the server"));
  }

  let data: {
    ok?: boolean;
    error?: string;
    user?: Account | null;
    designs?: DesignRecord[];
    filaments?: unknown[];
    entries?: { id: string; data: unknown }[];
  } = {};
  try {
    data = await res.json();
  } catch {
    throw new Error(t("The server did not answer properly"));
  }

  if (!data.ok) throw new Error(t(data.error || "Something went wrong"));
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
  if (!user) throw new Error(t("Signed in, but the server sent no account"));
  return user;
}

export async function signUp(email: string, password: string): Promise<Account> {
  const { user } = await call("register.php", { email, password });
  if (!user) throw new Error(t("Created, but the server sent no account"));
  return user;
}

export async function signOut(): Promise<void> {
  await call("logout.php", {});
}

/** Closes the account for good. The address is typed back to confirm. */
export async function closeAccount(email: string): Promise<void> {
  await call("close.php", { email });
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
export async function spendForExport(ref?: string): Promise<Account> {
  return (await spend(ref)).account;
}

/**
 * Pays for a holder, once per design.
 *
 * `ref` is a fingerprint of the design. The server remembers the ones an
 * account has paid for, so downloading the same holder again costs nothing, and
 * says so with `again`.
 */
export async function spendForHolder(ref: string): Promise<{ account: Account; again: boolean }> {
  return spend(ref);
}

async function spend(ref?: string): Promise<{ account: Account; again: boolean }> {
  let res: Response;
  try {
    res = await fetch("/api/spend.php", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(ref ? { ref } : {}),
      credentials: "same-origin",
    });
  } catch {
    throw new Error(t("Could not reach the server"));
  }

  const data: { ok?: boolean; error?: string; again?: boolean; user?: Account | null } =
    await res.json().catch(() => ({}));

  if (res.status === 402) throw new OutOfTokens(data.error || "No credits left");
  if (!data.ok || !data.user) throw new Error(t(data.error || "Could not export"));

  return { account: data.user, again: data.again === true };
}

/** The designs this account has kept. */
export async function listDesigns(): Promise<DesignRecord[]> {
  const { designs } = await call("designs.php");
  return designs ?? [];
}

export async function saveDesignRemote(name: string, data: unknown): Promise<void> {
  await call("designs.php", { action: "save", name, data });
}

export async function deleteDesignRemote(name: string): Promise<void> {
  await call("designs.php", { action: "delete", name });
}

/** Past work kept in the account: settings and the frame, never the picture. */
export async function listHistoryRemote(): Promise<{ id: string; data: unknown }[]> {
  const { entries } = await call("history.php");
  return entries ?? [];
}

export async function saveHistoryRemote(id: string, data: unknown): Promise<void> {
  await call("history.php", { action: "save", id, data });
}

export async function deleteHistoryRemote(id: string): Promise<void> {
  await call("history.php", { action: "delete", id });
}

/** The filament colours this account has kept. */
export async function loadFilaments(): Promise<Filament[]> {
  const { filaments } = await call("filaments.php");
  return parseFilaments(filaments);
}

export async function storeFilaments(list: Filament[]): Promise<void> {
  await call("filaments.php", { filaments: list });
}
