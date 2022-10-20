import {
  ConfirmOptions,
  Connection,
  PublicKey,
  sendAndConfirmRawTransaction,
  Signer,
  Transaction,
} from "@solana/web3.js";

import { WalletPublicKeyUnavailableError } from "@/socean/err";
import { tryRpc } from "@/stake-pool/utils";

export interface TransactionWithSigners {
  tx: Transaction;
  signers: Signer[];
}

/**
 * Copied from @solana/wallet-adapter-base\
 * `WalletAdapterProps` &
 * `SignerWalletAdapterProps` excluding signTransaction prop
 */
export interface WalletAdapter {
  publicKey: null | PublicKey;
  signAllTransactions(transaction: Transaction[]): Promise<Transaction[]>;
}

/**
 * Array of transaction arrays where
 * all transactions in the inner array must be confirmed
 * before proceeding to the next inner array
 */
export type TransactionSequence = Array<TransactionWithSigners[]>;

/**
 * Array of string arrays where
 * each element corresponds to a transaction in a TransactionSequence
 */
export type TransactionSequenceSignatures = Array<string[]>;

/**
 * Default confirm options for the transactions in a transaction sequence:
 * - preflightCommitment: `processed` to avoid blockhash not found error when simulating
 * - commitment: `confirmed`. web3.js tends to timeout when `finalized` is used instead.
 *             TODO: check if sequence may fail if previous
 *             transaction array is not yet finalized by the time the next one is sent
 */
export const TRANSACTION_SEQUENCE_DEFAULT_CONFIRM_OPTIONS: ConfirmOptions = {
  preflightCommitment: "processed",
  commitment: "confirmed",
};

/**
 * Signs and sends `TransactionSequence`,
 * awaiting confirmations for each inner array of transactions
 * before proceeding to the next one
 * @param walletAdapter wallet signing the transaction
 * @param transactionSequence `TransactionSequence` to sign and send
 * @param connection solana connection
 * @param confirmOptions transaction confirm options for each transaction
 * @returns `TransactionSequenceSignatures` for all transactions in the `TransactionSequence`
 * @throws RpcError
 * @throws WalletPublicKeyUnavailableError
 */
export async function signAndSendTransactionSequence(
  walletAdapter: WalletAdapter,
  transactionSequence: TransactionSequence,
  connection: Connection,
  confirmOptions: ConfirmOptions = TRANSACTION_SEQUENCE_DEFAULT_CONFIRM_OPTIONS,
): Promise<TransactionSequenceSignatures> {
  const res: TransactionSequenceSignatures = [];
  const feePayer = walletAdapter.publicKey;
  if (!feePayer) throw new WalletPublicKeyUnavailableError();

  // Can't use async/await with forEach/map (or can with Promise.all which will run them in parallel)
  // eslint-disable-next-line no-restricted-syntax
  for (const transactionArray of transactionSequence) {
    // eslint-disable-next-line no-await-in-loop
    const signatures = await signSendConfirmTransactions(
      walletAdapter,
      transactionArray,
      connection,
      feePayer,
      confirmOptions,
    );
    res.push(signatures);
  }
  return res;
}

/**
 * Helper for `signAndSendTransactionSequence`:
 * signs, sends and confirm an inner array of `TransactionWithSigners`
 * @param walletAdapter wallet signing the transaction
 * @param transactionArray array of `TransactionWithSigners` to send and confirm
 * @param connection solana connection
 * @param feePayer public key paying for tx fees
 * @param confirmOptions transaction confirm options for each transaction
 * @returns array of all signatures for the transactions
 * @throws RpcError
 */
async function signSendConfirmTransactions(
  walletAdapter: WalletAdapter,
  transactionArray: TransactionWithSigners[],
  connection: Connection,
  feePayer: PublicKey,
  confirmOptions: ConfirmOptions,
): Promise<string[]> {
  const { blockhash } = await tryRpc(connection.getLatestBlockhash("recent"));

  // Modify here, bec once you sign/partial sign a transaction, you cannot modify it
  const preppedTransactions = transactionArray.map(({ tx }) => {
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer;
    return tx;
  });

  // Must sign with wallet first before signers bec strike-wallet mutates the tx
  const walletSignedTransactions = await walletAdapter.signAllTransactions(
    preppedTransactions,
  );

  const signedTransactions = walletSignedTransactions.map(
    (walletSignedTransaction, i) => {
      const { signers } = transactionArray[i];
      walletSignedTransaction.partialSign(...signers);
      return walletSignedTransaction;
    },
  );

  const sigPromises = signedTransactions.map((tx) =>
    tryRpc(
      sendAndConfirmRawTransaction(connection, tx.serialize(), confirmOptions),
    ),
  );

  return Promise.all(sigPromises);
}
