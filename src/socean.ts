/**
 * Socean class
 *
 * @module
 */
import { Transaction, PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { SoceanConfig, ClusterType } from "./config";
import { ValidatorListAccount, StakePoolAccount, TransactionWithSigners, Numberu64 } from "./stake-pool/types";
import {
  getStakePoolFromAccountInfo,
  getValidatorListFromAccountInfo,
  getOrCreateAssociatedAddress,
  getWithdrawAuthority,
  getWithdrawStakeTransactions,
  getDefaultDepositAuthority,
  validatorsToWithdrawFrom,
  calcPoolPriceAndFee,
} from "./stake-pool/utils";
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

  // NOTE: amountDroplets is in type Numberu64 to enforce it to be in the unit of droplets (lamports)
  async withdraw(walletPubkey: PublicKey, amountDroplets: Numberu64): Promise<[TransactionWithSigners[], Keypair[]] | null> {
    const stakePool = await this.getStakePoolAccount();
    if (stakePool == null) return null;

    // get ValidatorListAccount
    const validatorListAcc = await this.getValidatorListAccount(stakePool.account.data.validatorList);
    if (validatorListAcc === null) return null;

    // get price and fee information and calculate the amounts
    const [price, fee] = calcPoolPriceAndFee(stakePool);
    const fromAmountDroplets = amountDroplets.toNumber();
    const toAmountLamports = (1 - fee) * (fromAmountDroplets * price);

    // TODO: WIP
    // TODO: for withdrawal from multiple validator, create tx for a set of validator
    // in Validator list until the sum of withdraw amount from each validator selected
    // is equal to the amountLamports.
    //
    // TODO: The original code from the frontend calls the return of the
    // `validatorsToWithdrawFrom` `amounts` which is very confusing. Call it something else.
    const amounts = await validatorsToWithdrawFrom(
      new PublicKey(this.config.stakePoolProgramId),
      new PublicKey(this.config.stakePoolAccountPubkey),
      fromAmountDroplets,
      toAmountLamports,
      validatorListAcc.account.data,
      stakePool.account.data.reserveStake,
    );
    if (amounts === null) return null;


    return getWithdrawStakeTransactions(
      this.config.connection,
      walletPubkey,
      this.config.stakePoolProgramId,
      stakePool,
      validatorListAcc,
      amounts,
    );
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

  /**
   * Retrieves and deserializes a StakePool account
   */
  async getValidatorListAccount(validatorListPubkey: PublicKey): Promise<ValidatorListAccount | null> {
    const account = await tryAwait(this.config.connection.getAccountInfo(validatorListPubkey));
    if (account instanceof Error) return null;
    if (account === null) return null;

    return getValidatorListFromAccountInfo(validatorListPubkey, account);
  }
}
