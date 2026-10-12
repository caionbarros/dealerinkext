import { supabase } from "./supabase";

export type Dealership = {
  id: string;
  name: string;
  status: "trial" | "active" | "past_due" | "canceled" | null;
  current_period_end: string | null;
  in_force: boolean;
};

/** Every state the sign-in can be in, from the extension's point of view. */
export type Access =
  | { state: "signed_out" }
  | { state: "code"; factorId: string; email: string }
  | { state: "enroll"; email: string }
  | {
      state: "denied";
      email: string;
      reason: "disabled" | "no_dealership" | "no_plan" | "unavailable";
    }
  | { state: "offline"; email: string | null }
  | { state: "ok"; email: string; dealerships: Dealership[] };

type AccessAnswer = {
  allowed: boolean;
  reason: "ok" | "mfa_required" | "disabled" | "no_dealership" | "no_plan";
  dealerships: Dealership[];
};

function isNetworkError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return !navigator.onLine || /fetch|network|Failed to fetch/i.test(text);
}

/**
 * Where the signed-in person stands. Order matters: the second factor comes
 * before the plan, because the database only answers about plans for a
 * session that passed two-factor.
 */
export async function getAccess(): Promise<Access> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { state: "signed_out" };
  const email = session.user.email ?? "";

  const { data: aal, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) {
    return isNetworkError(aalError) ? { state: "offline", email } : { state: "signed_out" };
  }
  if (aal.currentLevel !== "aal2") {
    const { data: factors, error } = await supabase.auth.mfa.listFactors();
    if (error) return isNetworkError(error) ? { state: "offline", email } : { state: "signed_out" };
    const totp = factors.totp.find((factor) => factor.status === "verified");
    if (!totp) return { state: "enroll", email };
    return { state: "code", factorId: totp.id, email };
  }

  const { data, error } = await supabase.rpc("my_extension_access");
  if (error) {
    if (isNetworkError(error)) return { state: "offline", email };
    // The function is missing until the DealerInk database is updated.
    return { state: "denied", email, reason: "unavailable" };
  }
  const answer = data as unknown as AccessAnswer;
  if (answer.allowed) return { state: "ok", email, dealerships: answer.dealerships };
  if (answer.reason === "mfa_required") {
    // The token predates two-factor; ask for the code again.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp.find((factor) => factor.status === "verified");
    return totp ? { state: "code", factorId: totp.id, email } : { state: "enroll", email };
  }
  return {
    state: "denied",
    email,
    reason: answer.reason === "ok" ? "no_plan" : answer.reason,
  };
}

export type SignInError = "invalid" | "offline" | "unknown";

export async function signIn(email: string, password: string): Promise<SignInError | null> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return null;
  if (isNetworkError(error)) return "offline";
  return error.status === 400 ? "invalid" : "unknown";
}

export async function verifyCode(factorId: string, code: string): Promise<SignInError | null> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (!error) return null;
  if (isNetworkError(error)) return "offline";
  return error.status === 422 || error.status === 400 ? "invalid" : "unknown";
}

/** Signs out of the extension only; the DealerInk web app stays signed in. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
}
