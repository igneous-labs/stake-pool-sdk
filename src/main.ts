//import { Provider, Wallet, web3 } from '@project-serum/anchor';

import {
  AccountInfo,
  PublicKey,
  SOLANA_SCHEMA,
} from "@solana/web3.js";

import { tryAwait } from "./err";

import { SoceanConfig, ClusterType } from "./config";
import * as schema from "./schema";
import { addStakePoolSchema } from "./schema";
addStakePoolSchema(SOLANA_SCHEMA);

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
  private readonly config: SoceanConfig;

  constructor(clusterType: ClusterType = 'testnet') {
      this.config = new SoceanConfig(clusterType);
  }

  /**
   * Retrieves and deserializes a StakePool account
   * @param connection: An active web3js connection.
   * @param stakePoolPubKey: The public key (address) of the stake pool account.
   */
  async getStakePoolAccount(): Promise<StakePoolAccount | null> {
    const account = await tryAwait(this.config.connection.getAccountInfo(this.config.stakePoolAccountPubkey));
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
      publicKey: this.config.stakePoolAccountPubkey,
      account: {
        data: stakePool,
        executable: account.executable,
        lamports: account.lamports,
        owner: account.owner,
      },
    };
  }

}
