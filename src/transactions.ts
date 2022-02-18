import { ConfirmOptions, Connection, PublicKey, sendAndConfirmRawTransaction, Signer, Transaction } from "@solana/web3.js";
import { WalletPublicKeyUnavailableError } from "./err";
import { tryRpc } from "./stake-pool/utils";

export interface TransactionWithSigners {
  tx: Transaction;
  signers: Signer[];
}

/**
 * Partially sign a transaction with its list of signers
 * @param transaction `TransactionWithSigners` to sign and convert to `Transaction`
 * @returns the partially signed `Transaction`
 */
function partialSign(transaction: TransactionWithSigners): Transaction {
  const { tx, signers } = transaction;
  for (const signer of signers) {
    tx.partialSign(signer);
  }
  return tx;
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
}

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

  for (const transactionArray of transactionSequence) {
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

  const partialSignedTransactions = transactionArray.map((transaction) => {
    transaction.tx.feePayer = feePayer;
    transaction.tx.recentBlockhash = blockhash;
    // Once you sign/partial sign a transaction, you cannot modify it
    return partialSign(transaction);
  });

  const signedTransactions = await walletAdapter.signAllTransactions(partialSignedTransactions);

  const sigPromises = signedTransactions.map((tx) => tryRpc(
      sendAndConfirmRawTransaction(connection, tx.serialize(), confirmOptions)
    )
  );

  return Promise.all(sigPromises);
}
