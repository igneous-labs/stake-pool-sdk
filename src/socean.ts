/**
 * Socean class
 *
 * @module
 */
import { Transaction } from "@solana/web3.js";
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
  async depositSol(amountLamports: BN, ): Promise<Transaction | null> {
    const tx = new Transaction();
    console.log(amountLamports);

    // check if the wallet public key as scnSOL associated token account
    // if not create one
    //tx.add();

    // prep deposit sol instruction
    /**
    * Initializes a DepositSol stake pool instruction given the required accounts and data
    * @param stakePoolProgramId: Pubkey of the stake pool program
    * @param stakePool: Pubkey of the stake pool to deposit to
    * @param stakePoolWithdrawAuthority: Pubkey of the stake pool's withdraw authority.
    *                                    PDA of the stake pool program, see StakePool docs for details.
    * @param reserveStake: Pubkey of the stake pool's reserve account
    * @param lamportsFrom: Pubkey of the SOL account to deduct SOL from to deposit.
    * @param poolTokensTo: Pubkey of the pool token account to mint the pool tokens to.
    * @param managerFeeAccount: Pubkey of the pool token account receiving the stake pool's fees.
    * @param referrerPoolTokensAccount: Pubkey of the pool token account of the referrer to receive referral fees
    * @param poolMint: Pubkey of the pool token mint
    * @param tokenProgramId: Pubkey of the SPL token program
    *
    * @param amount: The amount of lamports to deposit
    *
    * @param solDepositAuthority: Optional Pubkey of the stake pool's deposit authority.
    */

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
      // TODO: referrerPoolTokensAcount,
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
