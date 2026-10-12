/**
 * The extension signs in against the DealerInk backend: same accounts, same
 * two-factor, same plans. The publishable key is public by design (it ships in
 * the DealerInk web app too); every rule is enforced by the database.
 */
/** Through the DealerInk site, which forwards to the backend (dealerink: src/routes/api/sb). */
export const SUPABASE_URL = "https://dealerink.shiftcore.io/api/sb";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JaB3ZUaSaeNd9Y9_wSeXLQ_Kt19bprW";

/** Where people create an account, set up two-factor and manage the plan. */
export const DEALERINK_URL = "https://dealerink.shiftcore.io";

/**
 * Sites allowed to hand the extension a sign-in. The Lovable address is the
 * platform's fallback for the same app; keep both lists (this one and
 * externally_connectable in manifest.json) in step.
 */
export const DEALERINK_ORIGINS = ["https://dealerink.shiftcore.io", "https://dealerink.lovable.app"];
