import { strict as assert } from 'assert';
import { Keypair } from '@solana/web3.js';
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

    const tx = await socean.depositSol(staker.publicKey, new Numberu64(1), referrer.publicKey);
    console.log(JSON.stringify(tx, null, 4));
  });

  it('it generates withdraw txs', async () => {
    const socean = new Socean();
    const staker = Keypair.generate();

    const txs = await socean.withdraw(staker.publicKey, new Numberu64(1));
    console.log(JSON.stringify(txs, null, 4));
  });
});
