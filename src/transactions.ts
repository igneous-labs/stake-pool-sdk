import { Connection, PublicKey, sendAndConfirmRawTransaction, Signer, Transaction } from "@solana/web3.js";
import { tryRpc } from "./stake-pool/utils";

export interface TransactionWithSigners {
  tx: Transaction;
  signers: Signer[];
};

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
 * Copied from @solana/wallet-adapter-base
 * excluding signTransaction prop
 */
export interface SignerWalletAdapterProps {
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
 * Signs and sends `TransactionSequence`,
 * awaiting confirmations for each inner array of transactions
 * before proceeding to the next one
 * @param walletAdapter wallet signing the transaction
 * @param transactionSequence `TransactionSequence` to sign and send
 * @param connection solana connection
 * @param feePayer public key paying for tx fees
 * @returns `TransactionSequenceSignatures` for all transactions in the `TransactionSequence`
 * @throws RpcError
 */
export async function signAndSendTransactionSequence(
  walletAdapter: SignerWalletAdapterProps,
  transactionSequence: TransactionSequence,
  connection: Connection,
  feePayer: PublicKey,
): Promise<TransactionSequenceSignatures> {
  const res: TransactionSequenceSignatures = [];
  for (const transactions of transactionSequence) {
    const signatures = await signSendConfirmTransactions(
      walletAdapter,
      transactions,
      connection,
      feePayer
    );
    res.push(signatures);
  }
  return res;
}

/**
 * Helper for `signAndSendTransactionSequence`:
 * signs, sends and confirm an inner array of `TransactionWithSigners`
 * @param walletAdapter wallet signing the transaction
 * @param transactions `TransactionWithSigners` to send and confirm 
 * @param connection solana connection
 * @param feePayer public key paying for tx fees 
 * @returns array of all signatures for the transactions
 * @throws RpcError
 */
async function signSendConfirmTransactions(
  walletAdapter: SignerWalletAdapterProps,
  transactions: TransactionWithSigners[],
  connection: Connection,
  feePayer: PublicKey,
): Promise<string[]> {
  const { blockhash } = await tryRpc(connection.getRecentBlockhash("recent"));
  
  const partialSignedTransactions = transactions.map((transaction) => {
    transaction.tx.feePayer = feePayer;
    transaction.tx.recentBlockhash = blockhash;
    // Once you sign/partial sign a transaction, you cannot modify it
    return partialSign(transaction);
  });

  const signedTransactions = await walletAdapter.signAllTransactions(partialSignedTransactions);

  const sigPromises = signedTransactions.map((tx) => tryRpc(
      sendAndConfirmRawTransaction(connection, tx.serialize(), {
        preflightCommitment: "recent",
        commitment: "recent",
      })
    )
  );

  return Promise.all(sigPromises);
}
