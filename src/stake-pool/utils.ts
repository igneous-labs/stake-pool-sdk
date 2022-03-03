/**
 * Utility functions
 *
 * @module
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SOLANA_SCHEMA,
  StakeProgram,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { BN } from "bn.js";

import { RpcError, WithdrawalUnserviceableError } from "@/socean/err";
import { TransactionWithSigners } from "@/socean/transactions";
import { withdrawStakeInstruction } from "@/stake-pool/instructions";
import * as schema from "@/stake-pool/schema";
import {
  addStakePoolSchema,
  ValidatorList,
  ValidatorStakeInfo,
} from "@/stake-pool/schema";
import {
  DepositReceipt,
  Numberu64,
  STAKE_STATE_LEN,
  StakePoolAccount,
  ValidatorListAccount,
  ValidatorStakeAvailableToWithdraw,
  ValidatorWithdrawalReceipt,
  WithdrawalReceipt,
} from "@/stake-pool/types";

addStakePoolSchema(SOLANA_SCHEMA);

export function reverse(object: any) {
  Object.keys(object).forEach((val) => {
    if (object[val] instanceof PublicKey) {
      object[val] = new PublicKey(object[val].toBytes().reverse());
      // console.log(val, object[val].toString());
    } else if (object[val] instanceof Object) {
      reverse(object[val]);
    } else if (object[val] instanceof Array) {
      object[val].forEach((elem) => {
        reverse(elem);
      });
    }
    /* else {
      console.log(val, object[val]);
    } */
  });
}

/**
 * Parses stake pool account info into StakePoolAccount
 * @param stakePoolAccountPubkey pubkey of the stake pool account
 * @param account stake pool account info
 * @returns StakePoolAccount
 */
export function getStakePoolFromAccountInfo(
  pubkey: PublicKey,
  account: AccountInfo<Buffer>,
): StakePoolAccount {
  const stakePool = schema.StakePool.decodeUnchecked(account.data);
  // reverse the pubkey fields (work-around for borsh.js)
  reverse(stakePool);

  return {
    publicKey: pubkey,
    account: {
      data: stakePool,
      executable: account.executable,
      lamports: account.lamports,
      owner: account.owner,
    },
  };
}

/**
 * Parses validator list account info into ValidatorListAccount
 * @param pubkey public key of the stake pool account
 * @param account stake pool account info
 * @returns ValidatorListAccount
 */
export function getValidatorListFromAccountInfo(
  pubkey: PublicKey,
  account: AccountInfo<Buffer>,
): ValidatorListAccount {
  const validatorList = schema.ValidatorList.decodeUnchecked(account.data);
  // reverse the pubkey fields (work-around for borsh.js)
  reverse(validatorList);

  return {
    publicKey: pubkey,
    account: {
      data: validatorList,
      executable: account.executable,
      lamports: account.lamports,
      owner: account.owner,
    },
  };
}

/**
 * Attempt to service part of a withdrawal with some amount of lamports available to withdraw
 * @param withdrawalAmountDroplets amount to withdraw in droplets.
 *                                 The returned `WithdrawalReceipt` should aim to service
 *                                 part of or all of this amount.
 * @param lamportsAvailable lamports available to service this withdrawal
 * @param stakePool
 * @returns the WithdrawalReceipt serviced by `lamportsAvailable`.
 *          `dropletsUnstaked` and/or `lamportsReceived` may be zero
 * @throws WithdrawalUnserviceableError if calculation error occurs
 */
function tryServiceWithdrawal(
  withdrawalAmountDroplets: Numberu64,
  lamportsAvailable: Numberu64,
  stakePool: schema.StakePool,
): WithdrawalReceipt {
  const dropletsServiceable = estDropletsUnstakedByWithdrawal(
    lamportsAvailable,
    stakePool,
  );
  const dropletsServiced = withdrawalAmountDroplets.lt(dropletsServiceable)
    ? withdrawalAmountDroplets
    : dropletsServiceable;
  const withdrawalReceipt = calcWithdrawalReceipt(dropletsServiced, stakePool);
  // check that the withdrawal is indeed serviceable
  if (withdrawalReceipt.lamportsReceived.gt(lamportsAvailable)) {
    // rounding error happened somewhere
    throw new WithdrawalUnserviceableError(
      `Stake account only has ${lamportsAvailable.toNumber()} lamports` +
        `, not enough to service ${withdrawalReceipt.lamportsReceived.toNumber()} lamports required for withdrawal`,
    );
  }
  return withdrawalReceipt;
}

/**
 * Calculates the withdrawal procedure - how many lamports to split and withdraw from each validator stake account
 * given a desired number of droplets to withdraw.
 *
 * @param withdrawalAmountDroplets: amount to withdraw in droplets (1 / 10 ** 9 scnSOL)
 * @param stakePoolAccount the stake pool account
 * @param validatorList: ValidatorList account data
 *
 * @returns: Array of `ValidatorWithdrawalReceipt`, where
 *           Sum of all their `dropletsUnstaked` must = withdrawalAmountDroplets
 *           Pass this array directly to `getWithdrawStakeTransactions()`
 *
 *           Returns array with single elem if withdrawing from reserve account
 * @throws WithdrawalUnserviceableError if a suitable withdraw procedure is not found
 */
export async function calcWithdrawals(
  withdrawalAmountDroplets: Numberu64,
  stakePoolAccount: StakePoolAccount,
  validatorList: ValidatorList,
): Promise<ValidatorWithdrawalReceipt[]> {
  const {
    publicKey: stakePoolPubkey,
    account: { data: stakePool, owner: stakePoolProgramId },
  } = stakePoolAccount;
  const { validators } = validatorList;
  // no active validators, withdraw from reserve
  // also, reduce() throws error if array empty
  if (validators.length < 1)
    return [
      {
        stakeAccount: stakePool.reserveStake,
        withdrawalReceipt: calcWithdrawalReceipt(
          withdrawalAmountDroplets,
          stakePool,
        ),
      },
    ];

  const sortedValidators = validatorsByTotalStakeAsc(validators);
  const validatorStakeAvailableToWithdraw = await Promise.all(
    sortedValidators.map((validator) =>
      stakeAvailableToWithdraw(validator, stakePoolProgramId, stakePoolPubkey),
    ),
  );
  const res: ValidatorWithdrawalReceipt[] = [];

  let dropletsRemaining = withdrawalAmountDroplets;

  // Withdraw from the lightest validators first
  validatorStakeAvailableToWithdraw.forEach(({ lamports, stakeAccount }) => {
    if (dropletsRemaining.isZero()) {
      return;
    }
    const withdrawalReceipt = tryServiceWithdrawal(
      dropletsRemaining,
      lamports,
      stakePool,
    );
    if (
      !withdrawalReceipt.dropletsUnstaked.isZero() &&
      !withdrawalReceipt.lamportsReceived.isZero()
    ) {
      res.push({
        stakeAccount,
        withdrawalReceipt,
      });
      dropletsRemaining = dropletsRemaining.satSub(
        withdrawalReceipt.dropletsUnstaked,
      );
    }
  });

  // might happen if many transient stake accounts
  if (!dropletsRemaining.isZero()) {
    // Cannot proceed directly to transient stake accounts
    // even if main stake account is exhausted because of
    // MIN_ACTIVE_LAMPORTS.
    // Cannot proceed directly to the reserves
    // unless absolutely all stake accounts (main and transient) are deleted
    // and you can only delete a main stake account with RemoveValidator instruction
    throw new WithdrawalUnserviceableError(
      "Too many transient stake accounts, please try again with a smaller withdraw amount or on the next epoch",
    );
  }

  return res;
}

function validatorsByTotalStakeAsc(
  validatorStakeInfos: ValidatorStakeInfo[],
): ValidatorStakeInfo[] {
  return [...validatorStakeInfos].sort((validatorA, validatorB) => {
    const a = validatorTotalStake(validatorA);
    const b = validatorTotalStake(validatorB);
    // Numberu64 is unsigned, cannot subtract directly
    // eslint-disable-next-line no-nested-ternary
    return a.eq(b) ? 0 : a.lt(b) ? -1 : 1;
  });
}

// A validator stake account needs this amount of active staked lamports
// for the staker to be able to remove the validator from the stake pool.
const MIN_ACTIVE_STAKE_LAMPORTS = new Numberu64(1_000_000); // 0.001 SOL

// TODO: this might change in the future if rent costs change
// but since this is a const in the on-chain prog too, fuck it
const STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS = new Numberu64(2_282_880);

/**
 * Gets the stake available to withdraw from a validator.
 * This is `activeStakeLamports` if there is an active stake account
 * or `transientStakeLamports` if there is none.
 * Also returns the pubkey of their stake account to withdraw from (either the active or transient stake account)
 * @param validator `ValidatorStakeInfo` for the validator
 * @param stakePoolProgramId
 * @param stakePoolPubkey
 * @returns
 * - lamports available for withdrawal
 * - pubkey of the stake account to withdraw from
 */
async function stakeAvailableToWithdraw(
  validator: ValidatorStakeInfo,
  stakePoolProgramId: PublicKey,
  stakePoolPubkey: PublicKey,
): Promise<ValidatorStakeAvailableToWithdraw> {
  // must withdraw from active stake account if active stake account has non-zero balance
  const hasActive = !validator.activeStakeLamports.isZero(); // false if validator is newly added
  // const hasTransient = !validator.transientStakeLamports.isZero();
  // this is fucking stupid but
  // `transientStakeLamports` = rent exempt reserve + delegation.stake, whereas
  // `activeStakeLamports` = delegation.stake - MIN_ACTIVE_STAKE_LAMPORTS.
  // You're only allowed to withdraw delegation.stake - MIN_ACTIVE_STAKE_LAMPORTS lamports.
  // I've forgotten WHY THE FUCK these 2 values are semantically different in the on-chain prog,
  // probably to make the merge transient stake to active stake calculation easier
  const activeWithdrawableLamports = Numberu64.cloneFromBN(
    validator.activeStakeLamports,
  );
  const transientUnwithdrawableLamports =
    STAKE_ACCOUNT_RENT_EXEMPT_LAMPORTS.add(MIN_ACTIVE_STAKE_LAMPORTS);
  const transientWithdrawableLamports = Numberu64.cloneFromBN(
    validator.transientStakeLamports,
  ).satSub(transientUnwithdrawableLamports);
  const transientStakeAccount = await getValidatorTransientStakeAccount(
    stakePoolProgramId,
    stakePoolPubkey,
    validator.voteAccountAddress,
  );
  const [lamports, stakeAccount] = hasActive
    ? [
        activeWithdrawableLamports,
        await getValidatorStakeAccount(
          stakePoolProgramId,
          stakePoolPubkey,
          validator.voteAccountAddress,
        ),
      ]
    : [transientWithdrawableLamports, transientStakeAccount];
  return { lamports, stakeAccount };
}

function validatorTotalStake(validator: ValidatorStakeInfo): Numberu64 {
  return Numberu64.cloneFromBN(
    validator.activeStakeLamports.add(validator.transientStakeLamports),
  );
}

/**
 * Gets the address of the stake pool's stake account for the given validator
 * @param stakePoolProgramId public key of the stake pool program
 * @param stakePoolPubkey public key of the stake pool to deposit to
 * @param validatorVoteAccount public key of the validator to find the stake account of
 */
export async function getValidatorStakeAccount(
  stakePoolProgramId: PublicKey,
  stakePoolPubkey: PublicKey,
  validatorVoteAccount: PublicKey,
): Promise<PublicKey> {
  const [
    key,
    // _bump_seed
  ] = await PublicKey.findProgramAddress(
    [validatorVoteAccount.toBuffer(), stakePoolPubkey.toBuffer()],
    stakePoolProgramId,
  );
  return key;
}

/**
 * Gets the address of the stake pool's transient stake account for the given validator
 * @param stakePoolProgramId public key of the stake pool program
 * @param stakePoolPubkey public key of the stake pool to deposit to
 * @param validatorVoteAccount public key of the validator to find the stake account of
 */
export async function getValidatorTransientStakeAccount(
  stakePoolProgramId: PublicKey,
  stakePoolPubkey: PublicKey,
  validatorVoteAccount: PublicKey,
): Promise<PublicKey> {
  const [
    key,
    // _bump_seed
  ] = await PublicKey.findProgramAddress(
    [
      Buffer.from("transient"),
      validatorVoteAccount.toBuffer(),
      stakePoolPubkey.toBuffer(),
    ],
    stakePoolProgramId,
  );
  return key;
}

export async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  return Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    owner,
  );
}

/**
 * Creates withdrawStake transactions
 * given a list of stake pool validator stake accounts and number of pool tokens to withdraw for each
 *
 * NOTE: if the validator does not have any stake accounts, will withdraw directly from reserves instead.
 * Fallible, caller must catch possible errors.
 *
 * @param connection active connection
 * @param walletPubkey wallet to withdraw SOL to
 * @param stakePoolProgramId program id of the stake pool program
 * @param stakePool stake pool account
 * @param validatorList validator list account
 * @param validatorWithdrawalReceipts: list of `ValidatorWithdrawalReceipt`s generated by
 *                                     `calcWithdrawals()`
 *
 * @returns [Transaction[], Keypair[]] tuple, where
 *          [0]: list of transactions for withdraw instruction
 *          [1]: list of generated stake account keypairs.
 *               A new stake account is created for each validator in `amounts`
 */
export async function getWithdrawStakeTransactions(
  connection: Connection,
  walletPubkey: PublicKey,
  stakePoolProgramId: PublicKey,
  stakePool: StakePoolAccount,
  validatorList: ValidatorListAccount,
  validatorWithdrawalReceipts: ValidatorWithdrawalReceipt[],
): Promise<[TransactionWithSigners[], Keypair[]]> {
  // TODO: confirm this number
  const MAX_WITHDRAWALS_PER_TX = 4;

  const stakePoolData = stakePool.account.data;
  const stakePoolWithdrawAuthority = await getWithdrawAuthority(
    stakePoolProgramId,
    stakePool.publicKey,
  );

  const lamportsReqStakeAcc =
    await connection.getMinimumBalanceForRentExemption(STAKE_STATE_LEN);

  // since user is withdrawing, pool token acc should exist
  const userPoolTokenAccount = await getAssociatedTokenAddress(
    stakePoolData.poolMint,
    walletPubkey,
  );

  const newStakeAccounts: Keypair[] = [];
  const transactions: TransactionWithSigners[] = [];

  for (
    let chunkOffset = 0;
    chunkOffset < validatorWithdrawalReceipts.length;
    chunkOffset += MAX_WITHDRAWALS_PER_TX
  ) {
    const tx = new Transaction();
    const signers: Signer[] = [];

    // Add WithdrawStake Instruction for each validator in the chunk
    for (
      let i = chunkOffset;
      i < validatorWithdrawalReceipts.length &&
      i < chunkOffset + MAX_WITHDRAWALS_PER_TX;
      i++
    ) {
      const {
        stakeAccount: stakeSplitFrom,
        withdrawalReceipt: { dropletsUnstaked },
      } = validatorWithdrawalReceipts[i];
      // create blank stake account
      const stakeSplitTo = Keypair.generate();
      newStakeAccounts.push(stakeSplitTo);
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: walletPubkey,
          lamports: lamportsReqStakeAcc,
          newAccountPubkey: stakeSplitTo.publicKey,
          programId: StakeProgram.programId,
          space: STAKE_STATE_LEN,
        }),
      );
      // The tx also needs to be signed by the new stake account's private key
      signers.push(stakeSplitTo);

      tx.add(
        withdrawStakeInstruction(
          stakePoolProgramId,
          stakePool.publicKey,
          validatorList.publicKey,
          stakePoolWithdrawAuthority,
          stakeSplitFrom,
          stakeSplitTo.publicKey,
          walletPubkey,
          walletPubkey,
          userPoolTokenAccount,
          stakePoolData.managerFeeAccount,
          stakePoolData.poolMint,
          TOKEN_PROGRAM_ID,
          dropletsUnstaked,
        ),
      );
    }

    transactions.push({
      tx,
      signers,
    });
  }

  return [transactions, newStakeAccounts];
}

/**
 * Wraps a fallible web3 rpc call, throwing an RpcError if it fails
 * @param fallibleRpcCall a promise to be wrapped
 * @returns result of the rpc call
 * @throws RpcError
 */
export async function tryRpc<T>(fallibleRpcCall: Promise<T>): Promise<T> {
  try {
    const res = await fallibleRpcCall;
    return res;
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new RpcError(err);
    } else {
      throw err;
    }
  }
}

/**
 * get associated token address and adds instruction to create one to `tx` if not exist
 * @param connection active connection
 * @param mint mint address of the token account
 * @param owner pubkey of the owner of the associated account
 * @param tx transaction to add create instruction to if need be
 * @returns the public key of the associated token account
 * @throws RpcError
 */
export async function getOrCreateAssociatedAddress(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tx: Transaction,
): Promise<PublicKey> {
  const associatedAddress = await getAssociatedTokenAddress(mint, owner);

  // This is the optimum logic, considering TX fee, client-side computation,
  // RPC roundtrips and guaranteed idempotent.
  // Sadly we can't do this atomically;
  const info = await tryRpc(connection.getAccountInfo(associatedAddress));
  // possible for account owner to not be token program if the associatedAddress has
  // already been received some lamports (= became system accounts).
  // Assuming program derived addressing is safe, this is the only case for that
  if (info === null || !info.owner.equals(TOKEN_PROGRAM_ID)) {
    tx.add(
      Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mint,
        associatedAddress,
        owner,
        owner,
      ),
    );
  }
  return associatedAddress;
}

/**
 * Gets the withdraw authority PDA of the given stake pool
 * @param stakePoolProgramId public key of the stake pool program
 * @param stakePoolPubkey public key of the stake pool to deposit to
 */
export async function getWithdrawAuthority(
  stakePoolProgramId: PublicKey,
  stakePoolPubkey: PublicKey,
): Promise<PublicKey> {
  const [
    key,
    // _bump_seed
  ] = await PublicKey.findProgramAddress(
    [stakePoolPubkey.toBuffer(), Buffer.from("withdraw")],
    stakePoolProgramId,
  );
  return key;
}

/**
 * Gets the default deposit authority PDA of the given stake pool
 * @param stakePoolProgramId public key of the stake pool program
 * @param stakePoolPubkey public key of the stake pool to deposit to
 */
export async function getDefaultDepositAuthority(
  stakePoolProgramId: PublicKey,
  stakePoolPubkey: PublicKey,
): Promise<PublicKey> {
  const [
    key,
    // _bump_seed
  ] = await PublicKey.findProgramAddress(
    [stakePoolPubkey.toBuffer(), Buffer.from("deposit")],
    stakePoolProgramId,
  );
  return key;
}

/**
 * Helper function for calculating expected droplets given a deposit and the deposit fee struct.
 * Mirrors on-chain math exactly.
 * @param lamportsToStake
 * @param stakePool
 * @param depositFee the Fee struct for the given deposit type,
 *                   should either be stakePool.solDepositFee or stakePool.stakeDepositFee
 * @param referralFee the referral fee percentage for the given deposit type,
 *                    should either be stakePool.solReferralFee or stakePool.stakeReferralFee
 * @returns expected droplets given in return for staking `lamportsToStake`, with deposit fees factored in
 */
function calcDeposit(
  lamportsToStake: Numberu64,
  stakePool: schema.StakePool,
  depositFee: schema.Fee,
  referralFee: number,
): DepositReceipt {
  const dropletsMinted = lamportsToStake
    .mul(stakePool.poolTokenSupply)
    .div(stakePool.totalStakeLamports);
  const hasFee =
    !depositFee.numerator.isZero() && !depositFee.denominator.isZero();
  const dropletsFeePaid = hasFee
    ? Numberu64.cloneFromBN(
        depositFee.numerator.mul(dropletsMinted).div(depositFee.denominator),
      )
    : new Numberu64(0);
  const referralFeePaid = Numberu64.cloneFromBN(
    dropletsFeePaid.mul(new BN(referralFee)).div(new BN(100)),
  );
  // overflow safety: depositFee < 1.0
  const dropletsReceived = Numberu64.cloneFromBN(
    dropletsMinted.sub(dropletsFeePaid),
  );
  return {
    lamportsStaked: lamportsToStake,
    dropletsReceived,
    dropletsFeePaid,
    referralFeePaid,
  };
}

/**
 * Calculates and returns the expected amount of droplets (1 / 10 ** 9 scnSOL) to be received
 * by the user for staking SOL, with deposit fees factored in.
 * Note: if an epoch boundary crosses and the stake pool is updated, the scnSOL supply
 * will no longer match and the result of this function will be incorrect
 * @param lamportsToStake amount of SOL to be staked, in lamports
 * @param stakePool the stake pool to stake to
 * @returns the amount of droplets (1 / 10 ** 9 scnSOL) to be received by the user
 */
export function calcSolDeposit(
  lamportsToStake: Numberu64,
  stakePool: schema.StakePool,
): DepositReceipt {
  return calcDeposit(
    lamportsToStake,
    stakePool,
    stakePool.solDepositFee,
    stakePool.solReferralFee,
  );
}

/**
 * Calculates and returns the expected amount of droplets (1 / 10 ** 9 scnSOL) to be received
 * by the user for staking stake account(s), with deposit fees factored in.
 * Note: if an epoch boundary crosses and the stake pool is updated, the scnSOL supply
 * will no longer match and the result of this function will be incorrect
 * @param lamportsToStake SOL value of the stake accounts to be staked, in lamports
 * @param stakePool the stake pool to stake to
 * @returns the amount of droplets (1 / 10 ** 9 scnSOL) to be received by the user
 */
export function calcStakeDeposit(
  lamportsToStake: Numberu64,
  stakePool: schema.StakePool,
): DepositReceipt {
  return calcDeposit(
    lamportsToStake,
    stakePool,
    stakePool.stakeDepositFee,
    stakePool.stakeReferralFee,
  );
}

/**
 * Helper function for calculating expected lamports given the amount of droplets to withdraw.
 * Mirrors on-chain math exactly.
 * Due to loss of precision from int arithmetic, this function should be ran per validator instead of
 * on an entire withdrawal amount.
 * @param dropletsToWithdraw
 * @param stakePool
 * @returns expected lamports given in return for unstaking `dropletsToUnstake`, with withdrawal fees factored in,
 *          and the withdrawal fees charged
 * @throws
 */
function calcWithdrawalReceipt(
  dropletsToUnstake: Numberu64,
  stakePool: schema.StakePool,
): WithdrawalReceipt {
  const { withdrawalFee, totalStakeLamports, poolTokenSupply } = stakePool;
  // on-chain logic: the withdrawal fee is levied first
  const hasFee =
    !withdrawalFee.numerator.isZero() && !withdrawalFee.denominator.isZero();
  const dropletsFeePaid = hasFee
    ? Numberu64.cloneFromBN(
        withdrawalFee.numerator
          .mul(dropletsToUnstake)
          .div(withdrawalFee.denominator),
      )
    : new Numberu64(0);
  // overflow safety: withdrawalFee < 1.0
  const dropletsBurnt = dropletsToUnstake.sub(dropletsFeePaid);
  const num = dropletsBurnt.mul(totalStakeLamports);
  if (num.lt(poolTokenSupply) || poolTokenSupply.isZero()) {
    return {
      dropletsUnstaked: Numberu64.cloneFromBN(dropletsToUnstake),
      lamportsReceived: new Numberu64(0),
      dropletsFeePaid,
    };
  }
  // on-chain logic is ceil div
  // overflow safety: 1 < num + poolTokenSupply
  const lamportsReceived = Numberu64.cloneFromBN(
    num.add(poolTokenSupply).sub(new Numberu64(1)).div(poolTokenSupply),
  );
  return {
    dropletsUnstaked: Numberu64.cloneFromBN(dropletsToUnstake),
    lamportsReceived,
    dropletsFeePaid,
  };
}

/**
 * Helper function for estimating number of droplets that were unstaked
 * given the output lamports withdrawn, with fees accounted for.
 * The inverse of `calcWithdrawal`.
 * Not exact due to int division.
 * @returns estimated number of droplets that was usntaked
 */
function estDropletsUnstakedByWithdrawal(
  lamportsReceived: Numberu64,
  stakePool: schema.StakePool,
): Numberu64 {
  const { withdrawalFee, totalStakeLamports, poolTokenSupply } = stakePool;
  const estDropletsBurnt = lamportsReceived
    .mul(poolTokenSupply)
    .div(totalStakeLamports);
  const hasFee =
    !withdrawalFee.numerator.isZero() && !withdrawalFee.denominator.isZero();
  if (!hasFee) {
    return Numberu64.cloneFromBN(estDropletsBurnt);
  }
  // overflow safety: denominator > numerator enforced on-chain
  const base = withdrawalFee.denominator.sub(withdrawalFee.numerator);
  // Note: loss of precision for small estDropletsBurnt
  return Numberu64.cloneFromBN(
    estDropletsBurnt.mul(withdrawalFee.denominator).div(base),
  );
}

/**
 * Sums up the total number of lamports withdrawn
 * given an array of `ValidatorWithdrawalReceipt`s
 * @param receipts
 * @returns
 */
export function totalWithdrawLamports(
  receipts: ValidatorWithdrawalReceipt[],
): Numberu64 {
  return receipts.reduce(
    (accum, receipt) =>
      Numberu64.cloneFromBN(
        accum.add(receipt.withdrawalReceipt.lamportsReceived),
      ),
    new Numberu64(0),
  );
}

/**
 * Sums up the total number of droplets (1 / 10 ** 9 scnSOL) paid
 * in withdrawal fees given an array of `ValidatorWithdrawalReceipt`s
 * @param receipts
 * @returns
 */
export function totalWithdrawalFeesDroplets(
  receipts: ValidatorWithdrawalReceipt[],
): Numberu64 {
  return receipts.reduce(
    (accum, receipt) =>
      Numberu64.cloneFromBN(
        accum.add(receipt.withdrawalReceipt.dropletsFeePaid),
      ),
    new Numberu64(0),
  );
}
