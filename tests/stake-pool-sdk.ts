import { strict as assert } from 'assert';
import { clusterApiUrl, Connection, Keypair } from '@solana/web3.js';
import { Numberu64 } from '../src/stake-pool/types';

import { Socean } from '../src';

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
      assert.equal(4, txs.length);
    } else {
      console.log("Updated this epoch, transactions should not have updates");
      assert.equal(1, txs.length);
    }
  });

});
