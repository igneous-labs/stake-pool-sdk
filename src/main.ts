// DELETEME:
export const foo = async (): Promise<boolean> => {
  console.log('Hello, world');
  return true;
}

//import { Provider, Wallet, web3 } from '@project-serum/anchor';

import {
  AccountInfo,
  Connection,
  PublicKey,
  clusterApiUrl,
  SOLANA_SCHEMA,
} from "@solana/web3.js";

import { tryAwait } from "./err";


import * as schema from "./schema";
import { addStakePoolSchema } from "./schema";
addStakePoolSchema(SOLANA_SCHEMA);

// DELETEME:
const testnetStakePoolAccountString = "5oc4nDMhYqP8dB5DW8DHtoLJpcasB19Tacu3GWAMbQAC";
const mainnetStakePoolAccountString = "5oc4nmbNTda9fx8Tw57ShLD132aqDK65vuHH4RU1K4LZ";

// constants
const CONNECTION = new Connection(clusterApiUrl('testnet'));
const STAKEPOOL_ACCOUNT_PUBKEY: PublicKey = new PublicKey(testnetStakePoolAccountString);
//const CONNECTION = new Connection(clusterApiUrl('mainnet-beta'));
//const STAKEPOOL_ACCOUNT_PUBKEY: PublicKey = new PublicKey(mainnetStakePoolAccountString);

export interface StakePoolAccount {
  publicKey: PublicKey;
  account: AccountInfo<schema.StakePool>;
}

//export interface ValidatorListAccount {
//  publicKey: PublicKey;
//  account: AccountInfo<schema.ValidatorList>;
//}

export function reverse(object: any) {
  for (const val in object) {
    if (object[val] instanceof PublicKey) {
      object[val] = new PublicKey(object[val].toBytes().reverse());
      //console.log(val, object[val].toString());
    } else if (object[val] instanceof Object) {
      reverse(object[val]);
    } else if (object[val] instanceof Array) {
      for (const elem of object[val]) {
        reverse(elem);
      }
    }
    /*else {
      console.log(val, object[val]);
    }*/
  }
}

export class Socean {
  /**
   * Retrieves and deserializes a StakePool account
   * @param connection: An active web3js connection.
   * @param stakePoolPubKey: The public key (address) of the stake pool account.
   */
  async getStakePoolAccount(): Promise<StakePoolAccount | null> {
    const account = await tryAwait(CONNECTION.getAccountInfo(STAKEPOOL_ACCOUNT_PUBKEY));
    if (account instanceof Error) return null;
    if (account === null) return null;

    return this.getStakePoolFromAccountInfo(account);
  }

  private getStakePoolFromAccountInfo(
    account: AccountInfo<Buffer>,
  ): StakePoolAccount {
    const stakePool = schema.StakePool.decodeUnchecked(account.data);
    // reverse the pubkey fields (work-around for borsh.js)
    reverse(stakePool);

    return {
      publicKey: STAKEPOOL_ACCOUNT_PUBKEY,
      account: {
        data: stakePool,
        executable: account.executable,
        lamports: account.lamports,
        owner: account.owner,
      },
    };
  }
}
