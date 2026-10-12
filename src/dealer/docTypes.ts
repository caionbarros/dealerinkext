/** The 23 document types DealerInk recognizes (same list as its database). */
export const DOC_TYPES = [
  "retail_installment_contract",
  "credit_application",
  "buyers_order",
  "itemization_of_sale",
  "risk_based_pricing_notice",
  "odometer_disclosure",
  "title_application",
  "state_title_application",
  "reassignment_of_title",
  "power_of_attorney",
  "gap_disclosure",
  "gap_addendum",
  "vehicle_service_contract",
  "theft_recovery_agreement",
  "arbitration_agreement",
  "buyers_guide",
  "privacy_notice",
  "e_sign_consent",
  "we_owe",
  "temporary_permit",
  "satellite_radio_trial",
  "scanned_document",
  "other",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

/**
 * First guess for what goes to the lender, before the dealer chose anything.
 * The order of DOC_TYPES is the usual funding stack (contract first). Every
 * choice the dealer makes is remembered per type and replaces this guess.
 */
export const NOT_SENT_BY_DEFAULT: ReadonlySet<DocType> = new Set([
  "temporary_permit",
  "satellite_radio_trial",
  "we_owe",
]);

/** Message key for a type's name. */
export function docTypeKey(type: DocType): string {
  return `docType_${type}`;
}
