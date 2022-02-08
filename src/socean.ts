/**
 * Socean class
 *
 * @module
 */
import { Transaction, PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

import { SoceanConfig, ClusterType } from "./config";
import { ValidatorListAccount, StakePoolAccount, Numberu64, ValidatorAllStakeAccounts } from "./stake-pool/types";
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
  getValidatorStakeAccount,
} from "./stake-pool/utils";
import { AccountDoesNotExistError } from "./stake-pool/err";
import { cleanupRemovedValidatorsInstruction, depositSolInstruction, updateStakePoolBalanceInstruction, updateValidatorListBalanceTransaction } from "./stake-pool/instructions";
import { TransactionSequence, TransactionWithSigners } from "./transactions";

export class Socean {
  private readonly config: SoceanConfig;

  constructor(clusterType: ClusterType = 'testnet') {
    this.config = new SoceanConfig(clusterType);
  }

  /**
   * Creates a `TransactionSequence` that deposits sol into Socean stake pool
   * @param walletPubkey SOL wallet to deposit SOL from
   * @param amountLamports amount to deposit in lamports
   * @param referrerPoolTokenAccount PublicKey of the referrer for this deposit
   * @returns the deposit transaction sequence
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool does not exist
   */
  async depositSol(walletPubkey: PublicKey, amountLamports: Numberu64, referrerPoolTokenAccount?: PublicKey): Promise<TransactionSequence> {
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
    const transactionSequence: TransactionSequence = [[
      {
        tx,
        signers: [],
      }
    ]];

    const currEpoch = await this.getCurrentEpoch();
    if (stakePool.account.data.lastUpdateEpoch.lt(new BN(currEpoch))) {
      const validatorListAcc = await this.getValidatorListAccount(stakePool.account.data.validatorList);
      const updateTxSeq = await this.updateTransactionSequence(stakePool, validatorListAcc);
      transactionSequence.unshift(
        ...updateTxSeq
      );
    }
    return transactionSequence;
  }

  /**
   * Creates the transactions to withdraw stake from the Socean stake pool
   * and the new stake accounts to receive the withdrawn stake
   * @param walletPubkey the SOL wallet to withdraw stake to. scnSOL is deducted from this wallet's associated token account.
   * @param amountDroplets amount of scnSOL to withdraw in droplets (1 scnSOL = 10^9 droplets)
   * @returns `{transactionSequence, stakeAccounts}`, where
   *          `transactionSequence` is the `TransactionSequence` that needs to be sent in order, and
   *          `stakeAccounts` is the array of `Keypair`s for the newly created stake accounts to receive the withdrawn stake
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool or validator list does not exist
   * @throws WithdrawalUnserviceableError if a suitable withdraw procedure is not found
   */
  // NOTE: amountDroplets is in type Numberu64 to enforce it to be in the unit of droplets (lamports)
  async withdrawStake(walletPubkey: PublicKey, amountDroplets: Numberu64): Promise<WithdrawStakeReturn> {
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

    const [transactions, stakeAccounts] = await getWithdrawStakeTransactions(
      this.config.connection,
      walletPubkey,
      this.config.stakePoolProgramId,
      stakePool,
      validatorListAcc,
      amounts,
    );
    const res = {
      transactionSequence: [transactions],
      stakeAccounts,
    }

    const currEpoch = await this.getCurrentEpoch();
    if (stakePool.account.data.lastUpdateEpoch.lt(new BN(currEpoch))) {
      const updateTxSeq = await this.updateTransactionSequence(stakePool, validatorListAcc);
      res.transactionSequence.unshift(
        ...updateTxSeq
      );
    }
    return res;
  }

  /**
   * Creates the `TransactionSequence` required to perform the full update
   */
  private async updateTransactionSequence(
    stakePool: StakePoolAccount,
    validatorListAcc: ValidatorListAccount,
  ): Promise<TransactionSequence> {
    const { stakePoolProgramId, stakePoolAccountPubkey } = this.config;

    const withdrawAuthority = await getWithdrawAuthority(
      stakePoolProgramId,
      stakePoolAccountPubkey,
    );

    const updateValidatorListBalance = await this.updateValidatorListBalanceTransactions(
      stakePool,
      validatorListAcc,
      withdrawAuthority
    );

    const { account: {
      data: {
        reserveStake,
        managerFeeAccount,
        poolMint,
        tokenProgramId,
      }
    }} = stakePool;

    const updateStakePoolBalanceTx = new Transaction();
    updateStakePoolBalanceTx.add(updateStakePoolBalanceInstruction(
      stakePoolProgramId,
      stakePoolAccountPubkey,
      withdrawAuthority,
      validatorListAcc.publicKey,
      reserveStake,
      managerFeeAccount,
      poolMint,
      tokenProgramId,
    ));
    const updateStakePoolBalance = {
      tx: updateStakePoolBalanceTx,
      signers: [],
    }

    const cleanupRemovedValidatorsTx = new Transaction();
    cleanupRemovedValidatorsTx.add(cleanupRemovedValidatorsInstruction(
      stakePoolProgramId,
      stakePoolAccountPubkey,
      validatorListAcc.publicKey,
    ));
    const cleanupRemovedValidators = {
      tx: cleanupRemovedValidatorsTx,
      signers: [],
    }

    return [updateValidatorListBalance, [updateStakePoolBalance], [cleanupRemovedValidators]];
  }

  /**
   * Creates the list of transactions to completely update the validator list
   * @param stakePool
   * @param validatorListAcc 
   * @param withdrawAuthority
   */
  private async updateValidatorListBalanceTransactions(
    stakePool: StakePoolAccount,
    validatorListAcc: ValidatorListAccount,
    withdrawAuthority: PublicKey,
  ): Promise<TransactionWithSigners[]> {
    // Based on transaction size limits
    const MAX_VALIDATORS_TO_UPDATE = 5;

    const voteAccounts = validatorListAcc.account.data.validators.map(
      (validator) => validator.voteAccountAddress,
    );

    const res: TransactionWithSigners[] = [];

    for (let i = 0; i < voteAccounts.length; i += MAX_VALIDATORS_TO_UPDATE) {
      const end = Math.min(voteAccounts.length, i + MAX_VALIDATORS_TO_UPDATE);
      const chunk = voteAccounts.slice(i, end);

      const validatorsAllStakeAccounts = await Promise.all(
        chunk.map(this.getValidatorAllStakeAccounts)
      );

      res.push({
        tx: updateValidatorListBalanceTransaction(
          this.config.stakePoolProgramId,
          this.config.stakePoolAccountPubkey,
          withdrawAuthority,
          validatorListAcc.publicKey,
          stakePool.account.data.reserveStake,
          validatorsAllStakeAccounts,
          i,
          false, // TODO: no_merge?
        ),
        signers: [],
      });
    }

    return res;
  }

  private async getCurrentEpoch(): Promise<number> {
    const { epoch } = await tryRpc(this.config.connection.getEpochInfo());
    return epoch;
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

  /**
   * Returns the validator stake account given the validator's vote account
   * @param voteAccount 
   */
  async validatorStakeAccount(voteAccount: PublicKey): Promise<PublicKey> {
    return getValidatorStakeAccount(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      voteAccount
    );
  }

  /**
   * Returns the transient stake account given the validator's vote account
   * @param voteAccount 
   */
   async transientStakeAccount(voteAccount: PublicKey): Promise<PublicKey> {
    return getValidatorStakeAccount(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      voteAccount
    );
  }

  /**
   * Returns both the validator stake account and transient stake account
   * given the validator's vote account
   */
  async getValidatorAllStakeAccounts(voteAccount: PublicKey): Promise<ValidatorAllStakeAccounts> {
    return {
      main: await this.validatorStakeAccount(voteAccount),
      transient: await this.transientStakeAccount(voteAccount),
    };
  }
}

type WithdrawStakeReturn = {
  transactionSequence: TransactionSequence,
  stakeAccounts: Keypair[],
}