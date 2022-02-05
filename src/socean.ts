/**
 * Socean class
 *
 * @module
 */
import {
  AccountInfo,
  Transaction,
  SOLANA_SCHEMA,
} from "@solana/web3.js";

import BN from "bn.js"

import * as schema from "./stake-pool/schema";
import { addStakePoolSchema } from "./stake-pool/schema";
addStakePoolSchema(SOLANA_SCHEMA);

import { SoceanConfig, ClusterType } from "./config";
import { tryAwait } from "./stake-pool/err";
import { StakePoolAccount } from './stake-pool/types';
import { reverse } from './helpers';

export class Socean {
  private readonly config: SoceanConfig;

  constructor(clusterType: ClusterType = 'testnet') {
      this.config = new SoceanConfig(clusterType);
  }

  /**
   * Deposits sol into Socean stake pool
   */
  async depositSol(amountLamports: BN, ): Promise<Transaction | null> {
    const tx = new Transaction();
    console.log(amountLamports);

    // check if the wallet public key as scnSOL associated token account
    // if not create one
    //tx.add();

    // prep deposit sol instruction
    //const ix = depositSolInstruction(amountLamports);
    //tx.add();
    return tx;
  }


  /**
   * Retrieves and deserializes a StakePool account
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
