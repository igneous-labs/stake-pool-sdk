/**
 * Solana Instructions layout specification
 * (copied from token-swap)
 *
 * @module
 */

import { blob } from "@solana/buffer-layout";

/**
 * Layout for a public key
 */
export const publicKey = (property = "publicKey") => blob(32, property);

/**
 * Layout for a 64bit unsigned value
 */
export const uint64 = (property = "uint64") => blob(8, property);
