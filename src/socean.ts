/**
 * Socean class
 *
 * @module
 */
import { Transaction, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js"

import { SoceanConfig, ClusterType } from "./config";
import { StakePoolAccount } from "./stake-pool/types";
import { getStakePoolFromAccountInfo } from  "./stake-pool/helpers";
import { tryAwait } from "./stake-pool/err";
import { depositSolInstruction } from "./stake-pool/instructions";

export class Socean {
  private readonly config: SoceanConfig;

  constructor(clusterType: ClusterType = 'testnet') {
      this.config = new SoceanConfig(clusterType);
  }

  /**
   * Returns Transaction that deposits sol into Socean stake pool
   */
  async depositSol(amountLamports: BN, referrerPoolTokensAccount: PublicKey | null): Promise<Transaction | null> {
    const tx = new Transaction();
    console.log(amountLamports);

    // TODO: check if the wallet public key as scnSOL associated token account
    // if not create one
    //tx.add();

    // prep deposit sol instruction
    const stakepool = await this.getStakePoolAccount();
    if (stakepool === null) return null;
    const ix = depositSolInstruction(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      // TODO: stakePoolWithdrawAuthority,
      stakepool.account.data.reserveStake,
      // TODO: lamportsFrom,
      // TODO: poolTokenTo,
      stakepool.account.data.managerFeeAccount,
      referrerPoolTokensAccount ?? stakepool.account.data.managerFeeAccount,
      stakepool.account.data.poolMint,
      TOKEN_PROGRAM_ID,
      amountLamports,
      // TODO: solDepositAuthority,
    );

    tx.add(ix);
    return tx;
  }

  /**
   * Retrieves and deserializes a StakePool account
   */
  async getStakePoolAccount(): Promise<StakePoolAccount | null> {
    const account = await tryAwait(this.config.connection.getAccountInfo(this.config.stakePoolAccountPubkey));
    if (account instanceof Error) return null;
    if (account === null) return null;

    return getStakePoolFromAccountInfo(this.config.stakePoolAccountPubkey, account);
  }
}
