import { LAMPORTS_PER_SOL, Connection, Transaction, PublicKey, Keypair, StakeProgram } from '@solana/web3.js';
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

type PrepareStakerResult = {
  staker: MockWalletAdapter,
  stakerKeypair: Keypair,
  originalBalanceLamports: number,
}

// prep wallet and airdrop SOL if necessary
export const prepareStaker = async (connection: Connection, minStartingSol: number = 1): Promise<PrepareStakerResult> => {
  const stakerKeypair = keypairFromLocalFile("testnet-staker.json");
  const staker = new MockWalletAdapter(stakerKeypair);
  let originalBalanceLamports = await connection.getBalance(staker.publicKey, "finalized");
  if (originalBalanceLamports < minStartingSol * LAMPORTS_PER_SOL) {
      console.log("airdropping", minStartingSol, "SOL to", staker.publicKey.toString(), "...");
      await airdrop(connection, staker.publicKey, minStartingSol);
      originalBalanceLamports = await connection.getBalance(staker.publicKey, "finalized");
  }
  return {
    staker,
    stakerKeypair,
    originalBalanceLamports,
  };
}

export const transferStakeAcc = async (connection: Connection, stakeAccount: PublicKey, owner: Keypair, newOwner: PublicKey) => {
  const transferAuthTxs = [STAKE_AUTHORITY_ENUM, WITHDRAW_AUTHORITY_ENUM].map((authType) => StakeProgram.authorize({
    authorizedPubkey: owner.publicKey,
    newAuthorizedPubkey: newOwner,
    stakeAuthorizationType: { index: authType },
    stakePubkey: stakeAccount,
  }));
  const tx = transferAuthTxs[1];
  tx.add(transferAuthTxs[0].instructions[0]);
  await connection.sendTransaction(tx, [owner]);
}

// corresponding numeric values for stake program authority enum
export const STAKE_AUTHORITY_ENUM = 0;
export const WITHDRAW_AUTHORITY_ENUM = 1;