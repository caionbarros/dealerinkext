import { createClient, type SupportedStorage } from "@supabase/supabase-js";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/**
 * The session lives in chrome.storage.local, so the popup and every editor tab
 * share one sign-in, and it survives closing the browser.
 */
const storage: SupportedStorage = {
  async getItem(key) {
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    return typeof value === "string" ? value : null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage,
    storageKey: "dealerink.session",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
