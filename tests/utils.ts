import { LAMPORTS_PER_SOL, Transaction, PublicKey, Keypair } from '@solana/web3.js';
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
  publicKey: null | PublicKey;

  constructor(private _keypair: Keypair) {
    this.publicKey = _keypair.publicKey;
  }

  async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
    // TODO: sign all transactions sequencially
    return txs;
  }

}

export { airdrop, MockWalletAdapter };
