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
  getAssociatedTokenAddress,
  getWithdrawAuthority,
  getDefaultDepositAuthority,
} from "./stake-pool/helpers";
import { tryAwait } from "./stake-pool/err";
import { depositSolInstruction, withdrawStakeInstruction } from "./stake-pool/instructions";

export class Socean {
  private readonly config: SoceanConfig;

  constructor(clusterType: ClusterType = 'testnet') {
    this.config = new SoceanConfig(clusterType);
  }

  /**
   * Returns Transaction that deposits sol into Socean stake pool
   */
  async depositSol(walletPubkey: PublicKey, amountLamports: Numberu64, referrerPoolTokenAccount?: PublicKey): Promise<Transaction | null> {
    const stakePool = await this.getStakePoolAccount();
    if (stakePool === null) return null;

    const tx = new Transaction();

    // get associated token account for scnSOL, if not exist create one
    const poolTokenTo = await getOrCreateAssociatedAddress(
      this.config.connection,
      stakePool.account.data.poolMint,
      walletPubkey,
      tx
    );

    // prep deposit sol instruction
    const stakePoolWithdrawAuthority = await getWithdrawAuthority(this.config.stakePoolProgramId, this.config.stakePoolAccountPubkey);
    const solDepositAuthority = await getDefaultDepositAuthority(this.config.stakePoolProgramId, this.config.stakePoolAccountPubkey);
    const ix = depositSolInstruction(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      stakePoolWithdrawAuthority,
      stakePool.account.data.reserveStake,
      walletPubkey,
      poolTokenTo,
      stakePool.account.data.managerFeeAccount,
      referrerPoolTokenAccount ?? stakePool.account.data.managerFeeAccount,
      stakePool.account.data.poolMint,
      TOKEN_PROGRAM_ID,
      amountLamports,
      solDepositAuthority,
    );
    tx.add(ix);

    return tx;
  }

//  async withdraw(walletPubkey: PublicKey, amountLamports: Numberu64): Promise<Transaction | null> {
//    const stakePool = await this.getStakePoolAccount();
//    if (stakePool === null) return null;
//
//    // TODO: get ValidatorListAccount
//    // TODO: for withdrawal from multiple validator, create tx for a set of validator
//    // in Validator list until the sum of withdraw amount from each validator selected
//    // is equal to the amountLamports.
//    // TODO: decide on the return type API (return an array of txs?)
//    const tx = new Transaction();
//
//    // get associated token account for scnSOL
//    const userPoolTokenAccount = await getAssociatedTokenAddress(stakePool.account.data.poolMint, walletPubkey);
//    const stakePoolWithdrawAuthority = await getWithdrawAuthority(this.config.stakePoolProgramId, this.config.stakePoolAccountPubkey);
//    //const ix = withdrawStakeInstruction(
//    //  this.config.stakePoolProgramId,
//    //  this.config.stakePoolAccountPubkey,
//    //  stakePool.account.data.validatorList,
//    //  stakePoolWithdrawAuthority,
//    //  // TODO: stakeSplitFrom,
//    //  // TODO: stakeSplitTo,
//    //  // TODO: userStakeAuthority,
//    //  // TODO: userTokenTransferAuthority,
//    //  userPoolTokenAccount,
//    //  stakePool.account.data.managerFeeAccount,
//    //  stakePool.account.data.poolMint,
//    //  TOKEN_PROGRAM_ID,
//    //  amountLamports,
//    //);
//    //tx.add(ix);
//
//    return tx;
//  }

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
