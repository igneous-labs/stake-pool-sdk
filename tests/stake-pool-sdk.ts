import { Socean } from '../src/main';
import { strict as assert } from 'assert';

describe('test basic functionalities', () => {
  it('it initializes', async () => {
    const socean = new Socean();
    console.log(socean);
  });

  it('it initializes mainnet', async () => {
    const socean = new Socean('mainnet-beta');
    console.log(socean);
  });

  it('it gets stake pool account', async () => {
    const socean = new Socean();
    const res = await socean.getStakePoolAccount();
    console.log(res);
  });
});
