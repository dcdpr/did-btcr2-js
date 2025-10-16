import { MESSAGE_PREFIX } from './base.js';

export const REQUEST_SIGNATURE = `${MESSAGE_PREFIX}musig2/sign/request_signature`;
export const AUTHORIZATION_REQUEST = `${MESSAGE_PREFIX}musig2/sign/authorization_request`;
export const NONCE_CONTRIBUTION = `${MESSAGE_PREFIX}musig2/sign/nonce_contribution`;
export const AGGREGATED_NONCE = `${MESSAGE_PREFIX}musig2/sign/aggregated_nonce`;
export const SIGNATURE_AUTHORIZATION = `${MESSAGE_PREFIX}musig2/sign/signature_authorization`;