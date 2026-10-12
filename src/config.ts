/**
 * The extension signs in against the DealerInk backend: same accounts, same
 * two-factor, same plans. The publishable key is public by design (it ships in
 * the DealerInk web app too); every rule is enforced by the database.
 */
export const SUPABASE_URL = "https://jpbidhibblqphtzeuffm.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JaB3ZUaSaeNd9Y9_wSeXLQ_Kt19bprW";

/** Where people create an account, set up two-factor and manage the plan. */
export const DEALERINK_URL = "https://dealerink.lovable.app";
