import { Socean } from '../src/main';
import { strict as assert } from 'assert';

describe('test basic functionalities', () => {
  it('it initializes', async () => {
    let socean = new Socean();
    console.log(socean);
  });

  it('it gets stake pool account', async () => {
    let socean = new Socean();
    let res = await socean.getStakePoolAccount();
    console.log(res);
  });
});
