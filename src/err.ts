/* eslint-disable max-classes-per-file */
/**
 * Custom error definitions and helpers
 *
 * @module
 */
import { PublicKey } from "@solana/web3.js";

/**
 * Wrapper around solana rpc errors
 */
export class RpcError extends Error {
  constructor(err: Error) {
    super(err.message);
  }
}

/**
 * Given account does not exist
 */
export class AccountDoesNotExistError extends Error {
  readonly account: PublicKey;

  constructor(account: PublicKey) {
    super(`Account ${account.toString()} does not exist`);
    this.account = account;
  }
}

/**
 * The withdraw request is not serviceable (should never be thrown)
 */
export class WithdrawalUnserviceableError extends Error {
  constructor() {
    super("Could not determine withdrawal procedure");
  }
}

/**
 * Wallet adapter does not have a readable publicKey property
 */
export class WalletPublicKeyUnavailableError extends Error {
  constructor() {
    super("Wallet adapter public key not available");
  }
}

/// **
// * Error class reprensenting a partially-filled withdraw-stake operation
// */
// export class PartialWithdrawalError extends Error {
//  completedTransactions: TransactionSignature[];
//  newStakeAccounts: Keypair[];
//
//  constructor(
//    msg: string,
//    completedTransactions: TransactionSignature[],
//    newStakeAccounts: Keypair[],
//  ) {
//    super(msg);
//    this.completedTransactions = completedTransactions;
//    this.newStakeAccounts = newStakeAccounts;
//  }
// }
