/**
 * Message type URLs for the did:btcr2 Aggregate Beacon protocol.
 *
 * Naming follows the spec (https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html):
 * - Step 1 (Cohort Formation): COHORT_ADVERT, COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, COHORT_READY
 * - Step 2 (Update Submission): SUBMIT_UPDATE
 * - Step 3 (Aggregate & Validate): DISTRIBUTE_AGGREGATED_DATA, VALIDATION_ACK
 * - Step 4 (Sign & Broadcast): AUTHORIZATION_REQUEST, NONCE_CONTRIBUTION,
 *   AGGREGATED_NONCE, SIGNATURE_AUTHORIZATION
 * - Step 4 fallback (k-of-n script path, ADR 042): FALLBACK_AUTHORIZATION_REQUEST,
 *   FALLBACK_SIGNATURE
 */
export const AGGREGATION_MESSAGE_PREFIX = 'https://btcr2.dev/aggregation';

// Step 1: Cohort Formation
export const COHORT_ADVERT = `${AGGREGATION_MESSAGE_PREFIX}/keygen/cohort_advert`;
export const COHORT_OPT_IN = `${AGGREGATION_MESSAGE_PREFIX}/keygen/cohort_opt_in`;
export const COHORT_OPT_IN_ACCEPT = `${AGGREGATION_MESSAGE_PREFIX}/keygen/cohort_opt_in_accept`;
export const COHORT_READY = `${AGGREGATION_MESSAGE_PREFIX}/keygen/cohort_ready`;

// Step 2 + 3: Update Submission, Aggregation, Validation
export const SUBMIT_UPDATE = `${AGGREGATION_MESSAGE_PREFIX}/update/submit_update`;
/** A member with no update this round declines explicitly (cooperative non-inclusion). */
export const SUBMIT_NONINCLUDED = `${AGGREGATION_MESSAGE_PREFIX}/update/submit_nonincluded`;
export const DISTRIBUTE_AGGREGATED_DATA = `${AGGREGATION_MESSAGE_PREFIX}/update/distribute_aggregated_data`;
export const VALIDATION_ACK = `${AGGREGATION_MESSAGE_PREFIX}/update/validation_ack`;

// Step 4: Signing
export const AUTHORIZATION_REQUEST = `${AGGREGATION_MESSAGE_PREFIX}/sign/authorization_request`;
export const NONCE_CONTRIBUTION = `${AGGREGATION_MESSAGE_PREFIX}/sign/nonce_contribution`;
export const AGGREGATED_NONCE = `${AGGREGATION_MESSAGE_PREFIX}/sign/aggregated_nonce`;
export const SIGNATURE_AUTHORIZATION = `${AGGREGATION_MESSAGE_PREFIX}/sign/signature_authorization`;

// Step 4 fallback: k-of-n script-path signing when the optimistic n-of-n key
// path stalls (graceful liveness, ADR 042). A single standalone BIP-340
// signature per member, no nonce round.
/** Service asks members to sign the fallback (k-of-n) script path of the beacon tx. */
export const FALLBACK_AUTHORIZATION_REQUEST = `${AGGREGATION_MESSAGE_PREFIX}/sign/fallback_authorization_request`;
/** A member returns a standalone BIP-340 signature over the fallback script-path sighash. */
export const FALLBACK_SIGNATURE = `${AGGREGATION_MESSAGE_PREFIX}/sign/fallback_signature`;
