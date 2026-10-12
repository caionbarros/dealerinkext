import { supabase } from "./supabase";

export type Rooftop = { id: string; name: string; address: string; phone: string };

/**
 * The dealership's stores as registered in DealerInk, to fill the cover.
 * Only what the signed-in member can already see; empty when anything fails.
 */
export async function loadRooftops(): Promise<Rooftop[]> {
  try {
    const { data, error } = await supabase
      .from("rooftops")
      .select("id, name, legal_name, dba, address_line1, address_line2, city, state, zip, phone")
      .is("archived_at", null)
      .order("name");
    if (error || !data) return [];
    return data.map((r) => {
      const cityLine = [r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      return {
        id: r.id as string,
        name: (r.dba || r.legal_name || r.name) as string,
        address: [r.address_line1, r.address_line2, cityLine].filter(Boolean).join("\n"),
        phone: (r.phone ?? "") as string,
      };
    });
  } catch {
    return [];
  }
}
