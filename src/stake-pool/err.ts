/**
 * Custom error definitions and helpers
 *
 * @module
 */
import { Keypair, TransactionSignature } from "@solana/web3.js";

/**
 * Returns a Result-like struct representing
 * the success or error of a fallible promise
 */
export async function tryAwait<T>(
  fallible_promise: Promise<T>,
): Promise<T | Error> {
  try {
    return await fallible_promise;
  } catch (err: unknown) {
    console.log(err);
    if (err instanceof Error) {
      return err;
    }
    return new Error('Hmmm');
  }
}

/**
 * Error class reprensenting a partially-filled withdraw-stake operation
 */
export class PartialWithdrawalError extends Error {
  completedTransactions: TransactionSignature[];
  newStakeAccounts: Keypair[];

  constructor(
    msg: string,
    completedTransactions: TransactionSignature[],
    newStakeAccounts: Keypair[],
  ) {
    super(msg);
    this.completedTransactions = completedTransactions;
    this.newStakeAccounts = newStakeAccounts;
  }
}
