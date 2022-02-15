import { strict as assert } from 'assert';
import { expect } from "chai";
import { clusterApiUrl, Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

import { Numberu64 } from '../src/stake-pool/types';
import { Socean, WalletAdapter } from '../src';
import { airdrop, MockWalletAdapter } from './utils';

describe('test basic functionalities', () => {
  it('it initializes and gets stake pool account', async () => {
    const socean = new Socean();
    const res = await socean.getStakePoolAccount();
    console.log(res);
  });

  it('it initializes mainnet and gets stake pool account', async () => {
    const socean = new Socean('mainnet-beta');
    const res = await socean.getStakePoolAccount();
    console.log(res);
  });

  it('it generates deposit sol tx', async () => {
    const socean = new Socean();
    const staker = Keypair.generate();
    const referrer = Keypair.generate();

    const tx = await socean.depositSolTransactions(staker.publicKey, new Numberu64(1), referrer.publicKey);
    console.log(JSON.stringify(tx, null, 4));
  });

  it('it generates withdraw txs', async () => {
    const socean = new Socean();
    const staker = Keypair.generate();

    const txs = await socean.withdrawStakeTransactions(staker.publicKey, new Numberu64(1));
    console.log(JSON.stringify(txs, null, 4));
  });

  it('it appends update txs', async () => {
    const socean = new Socean();
    const staker = Keypair.generate();

    const txs = await socean.depositSolTransactions(staker.publicKey, new Numberu64(1));
    const { account: { data: { lastUpdateEpoch } }} = await socean.getStakePoolAccount();
    const { epoch } = await new Connection(clusterApiUrl("testnet")).getEpochInfo();
    if (lastUpdateEpoch.toNumber() < epoch) {
      console.log("Not updated this epoch, transactions should contain updates");
      // 1. updateValidatorListBalance
      // 2. updateStakePool
      // 3. cleanupRemovedValidators
      // 4. deposit
      expect(txs.length).to.eq(4);
    } else {
      console.log("Updated this epoch, transactions should not have updates");
      expect(txs.length).to.eq(1);
    }
  });

  it('it deposits and withdraws on testnet', async () => {
    const socean = new Socean();
    const connection = new Connection(clusterApiUrl("testnet"));

    // prep wallet and airdrop 1 SOL
    const staker: WalletAdapter = new MockWalletAdapter(Keypair.generate());
    await airdrop(connection, staker.publicKey, 1);
    const originalBalance = await connection.getBalance(staker.publicKey, "confirmed");
    console.log("staker:", staker.publicKey.toBase58());
    console.log("original balance:", originalBalance);

    // deposit 0.5 sol
    const depositAmount = 0.5 * LAMPORTS_PER_SOL;
    console.log("deposit amout:", depositAmount);
    const lastTxId = (await socean.depositSol(staker, new Numberu64(depositAmount))).pop().pop();
    // wait until the last tx (deposit) is confirmed
    await connection.confirmTransaction(lastTxId, "confirmed");

    // assert the balance decreased by 0.5
    const afterDepositBalance = await connection.getBalance(staker.publicKey, "confirmed");
    console.log("balance after deposit:", afterDepositBalance);
    expect(afterDepositBalance).to.be.below(depositAmount * LAMPORTS_PER_SOL);

    // TODO: assert scnSOL balance != 0

    // TODO: withdraw

    // TODO: assert SOL balance increased after withdrawal
  });
});
