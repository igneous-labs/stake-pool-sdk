/**
 * Socean class
 *
 * Implements the client that interacts with Socean stake pool.
 *
 * @module
 */
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Commitment,
  ConfirmOptions,
  Connection,
  Context,
  Keypair,
  PublicKey,
  Signer,
  StakeAuthorizationLayout,
  StakeProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";

import { signAndSendTransactionSequence } from "@/socean";
import { ClusterType, SoceanConfig } from "@/socean/config";
import {
  AccountDoesNotExistError,
  StakeAccountNotRentExemptError,
  StakeAccountToDepositInvalidError,
  WalletPublicKeyUnavailableError,
} from "@/socean/err";
import {
  TRANSACTION_SEQUENCE_DEFAULT_CONFIRM_OPTIONS,
  TransactionSequence,
  TransactionSequenceSignatures,
  TransactionWithSigners,
  WalletAdapter,
} from "@/socean/transactions";
import {
  cleanupRemovedValidatorsInstruction,
  depositSolInstruction,
  depositStakeInstruction,
  updateStakePoolBalanceInstruction,
  updateValidatorListBalanceTransaction,
} from "@/stake-pool/instructions";
import { ParsedStakeAccount } from "@/stake-pool/stakeAccount";
import {
  Numberu64,
  StakePoolAccount,
  ValidatorAllStakeAccounts,
  ValidatorListAccount,
} from "@/stake-pool/types";
import {
  calcWithdrawals,
  getOrCreateAssociatedAddress,
  getStakePoolFromAccountInfo,
  getValidatorListFromAccountInfo,
  getValidatorStakeAccount,
  getValidatorTransientStakeAccount,
  getWithdrawAuthority,
  getWithdrawStakeTransactions,
  STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS,
  tryRpc,
} from "@/stake-pool/utils";

export class Socean {
  public readonly config: SoceanConfig;

  /**
   * Instantiates a Socean client
   * @param clusterType The cluster, for eg. mainnet-beta, to connect to
   * @param connectionOption Accepts either a `Connection` or a `rpcEndpoint` string
   */
  constructor(
    clusterType: ClusterType = "testnet",
    connectionOption?: Connection | string,
  ) {
    this.config = new SoceanConfig(clusterType, connectionOption);
  }

  /**
   * Signs, sends and confirms the transactions required to deposit SOL
   * into the Socean stake pool.
   * Creates the scnSOL associated token account for the wallet if it doesnt exist.
   * @param walletAdapter SOL wallet to deposit SOL from
   * @param amountLamports amount to deposit in lamports
   * @param referrerPoolTokenAccount PublicKey of a scnSOL token account of the referrer for this deposit
   * @param confirmOptions transaction confirm options for each transaction
   * @returns the transaction signatures of the transactions sent and confirmed
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool does not exist
   * @throws WalletPublicKeyUnavailableError
   */
  async depositSol(
    walletAdapter: WalletAdapter,
    amountLamports: Numberu64,
    referrerPoolTokenAccount?: PublicKey,
    confirmOptions: ConfirmOptions = TRANSACTION_SEQUENCE_DEFAULT_CONFIRM_OPTIONS,
  ): Promise<TransactionSequenceSignatures> {
    const walletPubkey = walletAdapter.publicKey;
    if (!walletPubkey) throw new WalletPublicKeyUnavailableError();
    const txSeq = await this.depositSolTransactions(
      walletPubkey,
      amountLamports,
      referrerPoolTokenAccount,
    );
    return this.signAndSend(walletAdapter, txSeq, confirmOptions);
  }

  /**
   * Creates a `TransactionSequence` that deposits SOL into Socean stake pool
   * Each inner `TransactionWithSigners` array must be executed and confirmed
   * before going to the next one.
   * Creates the scnSOL associated token account for the wallet if it doesnt exist.
   * This is a lower-level API for compatibility, recommend using `depositSol()` instead if possible.
   * @param walletPubkey SOL wallet to deposit SOL from
   * @param amountLamports amount to deposit in lamports
   * @param referrerPoolTokenAccount PublicKey of a scnSOL token account of the referrer for this deposit
   * @returns the deposit transaction sequence
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool does not exist
   */
  async depositSolTransactions(
    walletPubkey: PublicKey,
    amountLamports: Numberu64,
    referrerPoolTokenAccount?: PublicKey,
  ): Promise<TransactionSequence> {
    const stakePool = await this.getStakePoolAccount();

    const tx = new Transaction();

    // get associated token account for scnSOL, if not exist create one
    const poolTokenTo = await getOrCreateAssociatedAddress(
      this.config.connection,
      stakePool.account.data.poolMint,
      walletPubkey,
      tx,
    );

    // prep deposit sol instruction
    const stakePoolWithdrawAuthority = await getWithdrawAuthority(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
    );
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
    );
    tx.add(ix);
    const transactionSequence: TransactionSequence = [
      [
        {
          tx,
          signers: [],
        },
      ],
    ];

    const currEpoch = await this.getCurrentEpoch();
    if (stakePool.account.data.lastUpdateEpoch.lt(new BN(currEpoch))) {
      const validatorListAcc = await this.getValidatorListAccount(
        stakePool.account.data.validatorList,
      );
      const updateTxSeq = await this.updateTransactionSequence(
        stakePool,
        validatorListAcc,
      );
      transactionSequence.unshift(...updateTxSeq);
    }
    return transactionSequence;
  }

  /**
   * Signs, sends and confirms the transactions required to deposit a stake account
   * into the Socean stake pool
   * Creates the scnSOL associated token account for the wallet if it doesnt exist.
   * @param walletAdapter SOL wallet to deposit SOL from
   * @param stakeAccount The stake account to deposit.
   *                     Must be active and delegated to a validator in the stake pool.
   * @param amountLamports The amount of stake to split from `stakeAccount` to deposit.
   *                       If not provided, 0, or greater than the staked balance, the entire stake account is deposited.
   *                       Otherwise, a stake account containing `amountLamports` is first split from `stakeAccount` and then deposited.
   *                       Must be greater than `STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS` and leave more than `STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS`
   *                       remaining in the stake account it is split from.
   * @param referrerPoolTokenAccount PublicKey of a scnSOL token account of the referrer for this deposit
   * @param confirmOptions transaction confirm options for each transaction
   * @returns the transaction signatures of the transactions sent and confirmed
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool or main validator stake account for `stakeAccount`'s validator does not exist
   * @throws WalletPublicKeyUnavailableError
   * @throws StakeAccountToDepositInvalidError if stake account to deposit does not meet deposit requirements
   * @throws StakeAccountNotRentExempt if provided `amountLamports` leaves a stake account at or below below rent-exempt balance
   */
  async depositStake(
    walletAdapter: WalletAdapter,
    stakeAccount: PublicKey,
    amountLamports?: Numberu64,
    referrerPoolTokenAccount?: PublicKey,
    confirmOptions: ConfirmOptions = TRANSACTION_SEQUENCE_DEFAULT_CONFIRM_OPTIONS,
  ): Promise<TransactionSequenceSignatures> {
    const walletPubkey = walletAdapter.publicKey;
    if (!walletPubkey) throw new WalletPublicKeyUnavailableError();
    const txSeq = await this.depositStakeTransactions(
      walletPubkey,
      stakeAccount,
      amountLamports,
      referrerPoolTokenAccount,
    );
    return this.signAndSend(walletAdapter, txSeq, confirmOptions);
  }

  /**
   * Creates a `TransactionSequence` that deposits an active stake account currently staked
   * with one of the Socean stake pool's validators into Socean stake pool
   * Each inner `TransactionWithSigners` array must be executed and confirmed
   * before going to the next one.
   * Creates the scnSOL associated token account for the wallet if it doesnt exist.
   * This is a lower-level API for compatibility, recommend using `depositStake()` instead if possible.
   * @param walletPubkey SOL wallet to deposit SOL from
   * @param stakeAccount The stake account to deposit.
   *                     Must be active and delegated to a validator in the stake pool.
   * @param amountLamports The amount of stake to split from `stakeAccount` to deposit.
   *                       If not provided, 0, or greater than the staked balance, the entire stake account is deposited.
   *                       Otherwise, a stake account containing `amountLamports` is first split from `stakeAccount` and then deposited.
   *                       Must be greater than `STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS` and leave more than `STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS`
   *                       remaining in the stake account it is split from.
   * @param referrerPoolTokenAccount PublicKey of a scnSOL token account of the referrer for this deposit
   * @returns the deposit transaction sequence
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool or main validator stake account for `stakeAccount`'s validator does not exist
   * @throws StakeAccountToDepositInvalidError if stake account to deposit does not meet deposit requirements
   * @throws StakeAccountNotRentExempt if provided `amountLamports` leaves a stake account at or below rent-exempt balance
   */
  async depositStakeTransactions(
    walletPubkey: PublicKey,
    stakeAccount: PublicKey,
    amountLamports?: Numberu64,
    referrerPoolTokenAccount?: PublicKey,
  ): Promise<TransactionSequence> {
    const { value } = await this.config.connection.getParsedAccountInfo(
      stakeAccount,
    );
    if (!value)
      throw new StakeAccountToDepositInvalidError(
        "stake account does not exist",
      );
    if (
      value.data instanceof Buffer ||
      !value.owner.equals(StakeProgram.programId)
    )
      throw new StakeAccountToDepositInvalidError("not a stake account");
    const stakeAccountInfo: ParsedStakeAccount = value.data.parsed;
    const stakeAccountLamports = new Numberu64(value.lamports);
    if (
      !stakeAccountInfo.info.stake.delegation.voter ||
      !stakeAccountInfo.info.stake.delegation.stake
    )
      throw new StakeAccountToDepositInvalidError(
        "stake account not delegated",
      );
    const voteAcc = new PublicKey(stakeAccountInfo.info.stake.delegation.voter);
    const vsa = await getValidatorStakeAccount(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      voteAcc,
    );
    const { value: vsaAcc } = await this.config.connection.getParsedAccountInfo(
      vsa,
    );
    if (!vsaAcc) throw new AccountDoesNotExistError(vsa);

    const stakePool = await this.getStakePoolAccount();

    const tx = new Transaction();

    // get associated token account for scnSOL, if not exist create one
    const poolTokenTo = await getOrCreateAssociatedAddress(
      this.config.connection,
      stakePool.account.data.poolMint,
      walletPubkey,
      tx,
    );

    const stakePoolWithdrawAuthority = await getWithdrawAuthority(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
    );

    const signers: Signer[] = [];
    let stakeAccountToDeposit = stakeAccount;

    if (
      amountLamports &&
      !amountLamports.isZero() &&
      amountLamports.lt(stakeAccountLamports)
    ) {
      if (
        amountLamports.lte(STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS) ||
        stakeAccountLamports
          .sub(amountLamports)
          .lte(STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS)
      ) {
        throw new StakeAccountNotRentExemptError();
      }

      const splitStakeAccount = Keypair.generate();
      signers.push(splitStakeAccount);
      stakeAccountToDeposit = splitStakeAccount.publicKey;

      const splitTx = StakeProgram.split({
        stakePubkey: stakeAccount,
        authorizedPubkey: walletPubkey,
        splitStakePubkey: splitStakeAccount.publicKey,
        lamports: amountLamports.toNumber(),
      });
      tx.add(splitTx);
    }

    // set stake and withdraw authority to stake pool deposit authority
    tx.add(
      StakeProgram.authorize({
        stakePubkey: stakeAccountToDeposit,
        authorizedPubkey: walletPubkey,
        newAuthorizedPubkey: stakePool.account.data.depositAuthority,
        stakeAuthorizationType: StakeAuthorizationLayout.Staker,
      }),
    );
    tx.add(
      StakeProgram.authorize({
        stakePubkey: stakeAccountToDeposit,
        authorizedPubkey: walletPubkey,
        newAuthorizedPubkey: stakePool.account.data.depositAuthority,
        stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
      }),
    );

    const ix = depositStakeInstruction(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      stakePool.account.data.validatorList,
      stakePool.account.data.depositAuthority,
      stakePoolWithdrawAuthority,
      stakeAccountToDeposit,
      vsa,
      stakePool.account.data.reserveStake,
      poolTokenTo,
      stakePool.account.data.managerFeeAccount,
      referrerPoolTokenAccount ?? stakePool.account.data.managerFeeAccount,
      stakePool.account.data.poolMint,
      TOKEN_PROGRAM_ID,
    );
    tx.add(ix);
    const transactionSequence: TransactionSequence = [
      [
        {
          tx,
          signers,
        },
      ],
    ];

    const currEpoch = await this.getCurrentEpoch();
    if (stakePool.account.data.lastUpdateEpoch.lt(new BN(currEpoch))) {
      const validatorListAcc = await this.getValidatorListAccount(
        stakePool.account.data.validatorList,
      );
      const updateTxSeq = await this.updateTransactionSequence(
        stakePool,
        validatorListAcc,
      );
      transactionSequence.unshift(...updateTxSeq);
    }
    return transactionSequence;
  }

  /**
   * Signs, sends and confirms the transactions required to withdraw stake from the Socean stake pool
   * @param walletAdapter the SOL wallet to withdraw stake to. scnSOL is deducted from this wallet's associated token account.
   * @param amountDroplets amount of scnSOL to withdraw in droplets (1 scnSOL = 10^9 droplets)
   * @param confirmOptions transaction confirm options for each transaction
   * @returns the transaction signatures of the transactions sent and confirmed
   *          and the newly created stake accounts to receive the withdrawn stake
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool does not exist
   * @throws WalletPublicKeyUnavailableError
   */
  async withdrawStake(
    walletAdapter: WalletAdapter,
    amountDroplets: Numberu64,
    confirmOptions: ConfirmOptions = TRANSACTION_SEQUENCE_DEFAULT_CONFIRM_OPTIONS,
  ): Promise<WithdrawStakeReturn> {
    const walletPubkey = walletAdapter.publicKey;
    if (!walletPubkey) throw new WalletPublicKeyUnavailableError();
    const { transactionSequence, stakeAccounts } =
      await this.withdrawStakeTransactions(walletPubkey, amountDroplets);
    const transactionSignatures = await this.signAndSend(
      walletAdapter,
      transactionSequence,
      confirmOptions,
    );
    return {
      transactionSignatures,
      stakeAccounts,
    };
  }

  /**
   * Creates a set of transactions and signer keypairs for withdrawing stake from the Socean stake pool,
   * and the new stake accounts to receive the withdrawn stake
   * Each inner `TransactionWithSigners` array of `transactionSequence` must be executed and confirmed
   * before going to the next one.
   * This is a lower-level API for compatibility, recommend using `withdrawStake()` instead if possible.
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
  async withdrawStakeTransactions(
    walletPubkey: PublicKey,
    amountDroplets: Numberu64,
  ): Promise<WithdrawStakeTransactionsReturn> {
    const stakePool = await this.getStakePoolAccount();

    // get ValidatorListAccount
    const validatorListAcc = await this.getValidatorListAccount(
      stakePool.account.data.validatorList,
    );

    // calculate the amounts to withdraw from for each validator
    const validatorWithdrawalReceipts = await calcWithdrawals(
      amountDroplets,
      stakePool,
      validatorListAcc.account.data,
    );

    const [transactions, stakeAccounts] = await getWithdrawStakeTransactions(
      this.config.connection,
      walletPubkey,
      this.config.stakePoolProgramId,
      stakePool,
      validatorListAcc,
      validatorWithdrawalReceipts,
    );
    const res = {
      transactionSequence: [transactions],
      stakeAccounts,
    };

    const currEpoch = await this.getCurrentEpoch();
    if (stakePool.account.data.lastUpdateEpoch.lt(new BN(currEpoch))) {
      const updateTxSeq = await this.updateTransactionSequence(
        stakePool,
        validatorListAcc,
      );
      res.transactionSequence.unshift(...updateTxSeq);
    }
    return res;
  }

  private async signAndSend(
    walletAdapter: WalletAdapter,
    transactionSequence: TransactionSequence,
    confirmOptions: ConfirmOptions,
  ): Promise<TransactionSequenceSignatures> {
    return signAndSendTransactionSequence(
      walletAdapter,
      transactionSequence,
      this.config.connection,
      confirmOptions,
    );
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

    const updateValidatorListBalance =
      await this.updateValidatorListBalanceTransactions(
        stakePool,
        validatorListAcc,
        withdrawAuthority,
      );

    const {
      account: {
        data: { reserveStake, managerFeeAccount, poolMint, tokenProgramId },
      },
    } = stakePool;

    const finalTx = new Transaction();
    finalTx.add(
      updateStakePoolBalanceInstruction(
        stakePoolProgramId,
        stakePoolAccountPubkey,
        withdrawAuthority,
        validatorListAcc.publicKey,
        reserveStake,
        managerFeeAccount,
        poolMint,
        tokenProgramId,
      ),
    );
    finalTx.add(
      cleanupRemovedValidatorsInstruction(
        stakePoolProgramId,
        stakePoolAccountPubkey,
        validatorListAcc.publicKey,
      ),
    );
    const finalTxWithSigners = {
      tx: finalTx,
      signers: [],
    };

    return [updateValidatorListBalance, [finalTxWithSigners]].filter(
      (arr) => arr.length > 0,
    );
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

    const currentEpoch = new BN(await this.getCurrentEpoch());

    const { validators } = validatorListAcc.account.data;
    const voteAccounts = validators.map(
      (validator) => validator.voteAccountAddress,
    );

    const res: TransactionWithSigners[] = [];
    let startIndex = 0;

    do {
      const remaining = validators.slice(startIndex);
      const firstNonUpdated = remaining.findIndex((validator) =>
        validator.lastUpdateEpoch.lt(currentEpoch),
      );
      if (firstNonUpdated === -1) {
        break;
      }
      startIndex += firstNonUpdated;
      const endIndex = startIndex + MAX_VALIDATORS_TO_UPDATE;
      const chunk = voteAccounts.slice(startIndex, endIndex);

      // eslint-disable-next-line no-await-in-loop
      const validatorsAllStakeAccounts = await Promise.all(
        chunk.map((voteAccount) =>
          this.getValidatorAllStakeAccounts(voteAccount),
        ),
      );

      res.push({
        tx: updateValidatorListBalanceTransaction(
          this.config.stakePoolProgramId,
          this.config.stakePoolAccountPubkey,
          withdrawAuthority,
          validatorListAcc.publicKey,
          stakePool.account.data.reserveStake,
          validatorsAllStakeAccounts,
          startIndex,
          false, // TODO: no_merge?
        ),
        signers: [],
      });

      startIndex = endIndex;
    } while (startIndex < voteAccounts.length);

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
    const account = await tryRpc(
      this.config.connection.getAccountInfo(this.config.stakePoolAccountPubkey),
    );
    if (account === null)
      throw new AccountDoesNotExistError(this.config.stakePoolAccountPubkey);
    return getStakePoolFromAccountInfo(
      this.config.stakePoolAccountPubkey,
      account,
    );
  }

  /**
   * Retrieves and deserializes a ValidatorList account
   * @returns The deserialized ValidatorListAccount
   * @throws RpcError
   * @throws AccountDoesNotExistError if validator list does not exist
   */
  async getValidatorListAccount(
    validatorListPubkey: PublicKey,
  ): Promise<ValidatorListAccount> {
    const account = await tryRpc(
      this.config.connection.getAccountInfo(validatorListPubkey),
    );
    if (account === null)
      throw new AccountDoesNotExistError(validatorListPubkey);
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
      voteAccount,
    );
  }

  /**
   * Returns the transient stake account given the validator's vote account
   * @param voteAccount
   */
  async transientStakeAccount(voteAccount: PublicKey): Promise<PublicKey> {
    return getValidatorTransientStakeAccount(
      this.config.stakePoolProgramId,
      this.config.stakePoolAccountPubkey,
      voteAccount,
    );
  }

  /**
   * Returns both the validator stake account and transient stake account
   * given the validator's vote account
   */
  async getValidatorAllStakeAccounts(
    voteAccount: PublicKey,
  ): Promise<ValidatorAllStakeAccounts> {
    const main = await this.validatorStakeAccount(voteAccount);
    const transient = await this.transientStakeAccount(voteAccount);
    return {
      main,
      transient,
    };
  }

  /**
   * Register an onAccountChange websocket listener for the stake pool account
   * and returns the websocket clientSubscriptionId
   * To remove, call this.config.connection.removeAccountChangeListener(clientSubscriptionId)
   * @param callback
   * @param commitment
   * @returns clientSubscriptionId
   */
  onStakePoolChange(
    callback: (stakePoolAccount: StakePoolAccount, context: Context) => void,
    commitment?: Commitment,
  ): number {
    return this.config.connection.onAccountChange(
      this.config.stakePoolAccountPubkey,
      (account, context) => {
        const stakePoolAccount = getStakePoolFromAccountInfo(
          this.config.stakePoolAccountPubkey,
          account,
        );
        callback(stakePoolAccount, context);
      },
      commitment,
    );
  }

  /**
   * Register an onAccountChange websocket listener for the validator list account
   * and returns the websocket clientSubscriptionId
   * To remove, call this.config.connection.removeAccountChangeListener(clientSubscriptionId)
   * @param callback
   * @param commitment
   * @returns clientSubscriptionId
   * @throws RpcError
   * @throws AccountDoesNotExistError if stake pool does not exist
   */
  async onValidatorListChange(
    callback: (
      validatorListAccount: ValidatorListAccount,
      context: Context,
    ) => void,
    commitment?: Commitment,
  ): Promise<number> {
    const {
      account: {
        data: { validatorList },
      },
    } = await this.getStakePoolAccount();
    return this.config.connection.onAccountChange(
      validatorList,
      (account, context) => {
        const validatorListAccount = getValidatorListFromAccountInfo(
          validatorList,
          account,
        );
        callback(validatorListAccount, context);
      },
      commitment,
    );
  }
}

type WithdrawStakeTransactionsReturn = {
  transactionSequence: TransactionSequence;
  stakeAccounts: Keypair[];
};

type WithdrawStakeReturn = {
  transactionSignatures: TransactionSequenceSignatures;
  stakeAccounts: Keypair[];
};
