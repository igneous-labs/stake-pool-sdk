import { LAMPORTS_PER_SOL, Connection, Transaction, PublicKey, Keypair } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { WalletAdapter } from '../src';
import path from 'path';

export const airdrop = async (connection: Connection, pubkey: PublicKey, amount: number = 1): Promise<void> => {
  //airdrop tokens
  await connection.confirmTransaction(
    await connection.requestAirdrop(
      pubkey,
      amount * LAMPORTS_PER_SOL
    ),
    "finalized"
  );
};

export const keypairFromLocalFile = (filepath: string): Keypair => {
  return Keypair.fromSecretKey(
    Buffer.from(
      JSON.parse(
        readFileSync(path.resolve(__dirname, filepath), {
          encoding: "utf-8",
        })
      )
    )
  );
}

export class MockWalletAdapter implements WalletAdapter {
  publicKey: PublicKey;

  constructor(private _keypair: Keypair) {
    this.publicKey = _keypair.publicKey;
  }

  async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
    // Note: must use partialSign(). sign() overwrites all signatures
    txs.forEach((tx) => tx.partialSign(this._keypair));
    return txs;
  }
}
