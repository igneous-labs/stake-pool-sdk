/**
 * Socean class
 *
 * @module
 */
import { Transaction, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { SoceanConfig, ClusterType } from "./config";
import { StakePoolAccount, Numberu64 } from "./stake-pool/types";
import {
  getStakePoolFromAccountInfo,
  getOrCreateAssociatedAddress,
  getWithdrawAuthority,
  getDefaultDepositAuthority,
} from  "./stake-pool/helpers";
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
  async depositSol(walletPubkey: PublicKey, amountLamports: Numberu64, referrerPoolTokensAccount?: PublicKey): Promise<Transaction | null> {
    const stakepool = await this.getStakePoolAccount();
    if (stakepool === null) return null;

    const tx = new Transaction();

    // get associated token account for scnSOL, if not exist create one
    const poolTokenTo = await getOrCreateAssociatedAddress(
      this.config.connection,
      walletPubkey,
      stakepool.account.data.poolMint,
      tx
    );

    // prep deposit sol instruction
    const stakePoolWithdrawAuthority = await getWithdrawAuthority(this.config.stakePoolProgramId, this.config.stakePoolAccountPubkey);
    const solDepositAuthority = await getDefaultDepositAuthority(this.config.stakePoolProgramId, this.config.stakePoolAccountPubkey);
    const ix = depositSolInstruction(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      stakePoolWithdrawAuthority,
      stakepool.account.data.reserveStake,
      walletPubkey,
      poolTokenTo,
      stakepool.account.data.managerFeeAccount,
      referrerPoolTokensAccount ?? stakepool.account.data.managerFeeAccount,
      stakepool.account.data.poolMint,
      TOKEN_PROGRAM_ID,
      amountLamports,
      solDepositAuthority,
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
