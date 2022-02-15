import { LAMPORTS_PER_SOL, Connection, Transaction, PublicKey, Keypair } from '@solana/web3.js';
import { WalletAdapter } from '../src';

const airdrop = async (connection, pubkey, amount = 1) => {
  //airdrop tokens
  await connection.confirmTransaction(
    await connection.requestAirdrop(
      pubkey,
      amount * LAMPORTS_PER_SOL
    ),
    "confirmed"
  );
};

class MockWalletAdapter implements WalletAdapter {
  publicKey: PublicKey;

  constructor(private _keypair: Keypair) {
    this.publicKey = _keypair.publicKey;
  }

  async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
    txs.forEach((tx) => tx.sign(this._keypair));
    return txs;
  }
}

export { airdrop, MockWalletAdapter };
