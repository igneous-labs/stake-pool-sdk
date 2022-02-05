//import { Provider, Wallet, web3 } from '@project-serum/anchor';

import { AccountInfo, SOLANA_SCHEMA } from "@solana/web3.js";

import * as schema from "./schema";
import { addStakePoolSchema } from "./schema";
addStakePoolSchema(SOLANA_SCHEMA);

import { SoceanConfig, ClusterType } from "./config";
import { tryAwait } from "./err";
import { StakePoolAccount } from './types';
import { reverse } from './helpers';

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
