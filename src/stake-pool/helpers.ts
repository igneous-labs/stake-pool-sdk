import {
  AccountInfo,
  PublicKey,
  SOLANA_SCHEMA,
} from "@solana/web3.js";

import { StakePoolAccount } from './types';
import * as schema from "./schema";
import { addStakePoolSchema } from "./schema";
addStakePoolSchema(SOLANA_SCHEMA);

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

export function getStakePoolFromAccountInfo(
  stakePoolAccountPubkey: PublicKey,
  account: AccountInfo<Buffer>,
): StakePoolAccount {
  const stakePool = schema.StakePool.decodeUnchecked(account.data);
  // reverse the pubkey fields (work-around for borsh.js)
  reverse(stakePool);

  return {
    publicKey: stakePoolAccountPubkey,
    account: {
      data: stakePool,
      executable: account.executable,
      lamports: account.lamports,
      owner: account.owner,
    },
  };
}
