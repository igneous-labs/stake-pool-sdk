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
  tryRpc,
} from "./stake-pool/utils";
import { AccountDoesNotExistError } from "./stake-pool/err";
import { depositSolInstruction } from "./stake-pool/instructions";

export class Socean {
  private readonly config: SoceanConfig;

  constructor(clusterType: ClusterType = 'testnet') {
    this.config = new SoceanConfig(clusterType);
  }

  /**
   * Creates a transaction that deposits sol into Socean stake pool
   * @param walletPubkey SOL wallet to deposit SOL from
   * @param amountLamports amount to deposit in lamports
   * @param referrerPoolTokenAccount PublicKey of the referrer for this deposit
   * @returns the deposit transaction 
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool does not exist
   */
  async depositSol(walletPubkey: PublicKey, amountLamports: Numberu64, referrerPoolTokenAccount?: PublicKey): Promise<Transaction> {
    const stakePool = await this.getStakePoolAccount();

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

  /**
   * Creates the transactions to withdraw stake from the Socean stake pool
   * and the new stake accounts to receive the withdrawn stake
   * @param walletPubkey the SOL wallet to withdraw stake to. scnSOL is deducted from this wallet's associated token account.
   * @param amountDroplets amount of scnSOL to withdraw in droplets (1 scnSOL = 10^9 droplets)
   * @returns `[transactionsWithSigners, stakeAccounts]`, where
   *          `transactionsWithSigners` is the array of `TransactionWithSigners` that needs to be sent in order, and
   *          `stakeAccounts` is the array of `Keypair`s for the newly created stake accounts to receive the withdrawn stake
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool or validator list does not exist
   * @throws WithdrawalUnserviceableError if a suitable withdraw procedure is not found
   */
  // NOTE: amountDroplets is in type Numberu64 to enforce it to be in the unit of droplets (lamports)
  async withdraw(walletPubkey: PublicKey, amountDroplets: Numberu64): Promise<[TransactionWithSigners[], Keypair[]]> {
    const stakePool = await this.getStakePoolAccount();

    // get ValidatorListAccount
    const validatorListAcc = await this.getValidatorListAccount(stakePool.account.data.validatorList);

    // get price and fee information and calculate the amounts
    const [price, fee] = calcPoolPriceAndFee(stakePool);
    const fromAmountDroplets = amountDroplets.toNumber();
    const toAmountLamports = (1 - fee) * (fromAmountDroplets * price);

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
   * @returns The deserialized StakePoolAccount
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool does not exist
   */
  async getStakePoolAccount(): Promise<StakePoolAccount> {
    const account = await tryRpc(this.config.connection.getAccountInfo(this.config.stakePoolAccountPubkey))
    if (account === null) throw new AccountDoesNotExistError(this.config.stakePoolAccountPubkey);
    return getStakePoolFromAccountInfo(this.config.stakePoolAccountPubkey, account);
  }

  /**
   * Retrieves and deserializes a ValidatorList account
   * @returns The deserialized ValidatorListAccount
   * @throws RpcError
   * @throws AccountDoesNotExistError if validator list does not exist
   */
  async getValidatorListAccount(validatorListPubkey: PublicKey): Promise<ValidatorListAccount> {
    const account = await tryRpc(this.config.connection.getAccountInfo(validatorListPubkey));
    if (account === null) throw new AccountDoesNotExistError(validatorListPubkey);
    return getValidatorListFromAccountInfo(validatorListPubkey, account);
  }
}
