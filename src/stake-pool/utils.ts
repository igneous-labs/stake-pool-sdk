/**
 * Utility functions
 *
 * @module
 */
import {
  AccountInfo,
  PublicKey,
  Transaction,
  SOLANA_SCHEMA,
  Connection,
  Keypair,
  SystemProgram,
  StakeProgram,
  Signer,
} from "@solana/web3.js";
import {
  Token,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";

import BN from 'bn.js';

import {
  StakePoolAccount,
  STAKE_STATE_LEN,
  ValidatorListAccount,
  Numberu64,
} from './types';
import { withdrawStakeInstruction } from "./instructions";
import * as schema from "./schema";
import { addStakePoolSchema, ValidatorStakeInfo, ValidatorList } from "./schema";
import { RpcError, WithdrawalUnserviceableError } from "../err";
import { TransactionWithSigners } from "../transactions";
addStakePoolSchema(SOLANA_SCHEMA);

export function reverse(object: any) {
  for (const val in object) {
    if (object[val] instanceof PublicKey) {
      object[val] = new PublicKey(object[val].toBytes().reverse());
      //console.log(val, object[val].toString());
    } else if (object[val] instanceof Object) {
      reverse(object[val]);
    } else if (object[val] instanceof Array) {
      for (const elem of object[val]) {
        reverse(elem);
      }
    }
    /*else {
      console.log(val, object[val]);
    }*/
  }
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
  const { publicKey: stakePoolPubkey, account: { data: stakePool, owner: stakePoolProgramId } } = stakePoolAccount;
  const validators = validatorList.validators;
  // no active validators, withdraw from reserve
  // also, reduce() throws error if array empty
  if (validators.length < 1) return [{
    stakeAccount: stakePool.reserveStake,
    withdrawalReceipt: calcWithdrawalReceipt(
      withdrawalAmountDroplets,
      stakePool,
    ),
  }];


  const sortedValidators = validatorsByTotalStakeAsc(validators);
  const res: ValidatorWithdrawalReceipt[] = [];
  
  let dropletsRemaining = withdrawalAmountDroplets;

  // Withdraw from the lightest validators first
  for (const validator of sortedValidators) {
    if (dropletsRemaining.isZero()) {
      break;
    }
    const { lamports, stakeAccount } = await stakeAvailableToWithdraw(validator, stakePoolProgramId, stakePoolPubkey);
    if (lamports.isZero()) {
      continue;
    }
    const dropletsServiceable = estDropletsUnstakedByWithdrawal(lamports, stakePool);
    const dropletsServiced = Numberu64.min(dropletsRemaining, dropletsServiceable);
    
    // check that the withdrawal indeed serviceable
    const withdrawalReceipt = calcWithdrawalReceipt(
      dropletsServiced,
      stakePool
    );
    if (withdrawalReceipt.lamportsReceived.gt(lamports)) {
      // rounding error happened somewhere
      throw new WithdrawalUnserviceableError(
        `Stake account ${stakeAccount.toString()} only has ${lamports.toNumber()} lamports`
        + `, not enough to service requested ${withdrawalReceipt.lamportsReceived.toNumber()} withdrawal`
      );
    }

    res.push({
      stakeAccount,
      withdrawalReceipt,
    });
    dropletsRemaining = dropletsRemaining.sub(dropletsServiced);
  }

  // might happen if many transient stake accounts
  if (!dropletsRemaining.isZero()) {
    // try using the reserves
    res.push({
      stakeAccount: stakePool.reserveStake,
      withdrawalReceipt: calcWithdrawalReceipt(
        dropletsRemaining,
        stakePool,
      ),
    });
  }
  
  return res;
}

function validatorsByTotalStakeAsc(
  validatorStakeInfos: ValidatorStakeInfo[],
): ValidatorStakeInfo[] {
  return [...validatorStakeInfos].sort((
      validatorA,
      validatorB,
    ) => {
      const a = validatorTotalStake(validatorA);
      const b = validatorTotalStake(validatorB);
      // Numberu64 is unsigned, cannot subtract directly
      return a.eq(b) ? 0 : a.lt(b) ? -1 : 1;
    }
  );
}


// A validator stake account needs this amount of active staked lamports
// for the staker to be able to remove the validator from the stake pool.
const MIN_ACTIVE_STAKE_LAMPORTS = new BN(1_000_000_00); // 0.1 SOL

/**
 * Gets the stake available to withdraw from a validator, minus the minimum required to remove the validator
 * and the pubkey of their stake account to withdraw from (either the active or transient stake account)
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
  stakePoolPubkey: PublicKey
): Promise<{
  lamports: Numberu64,
  stakeAccount: PublicKey,
}> {
  // must withdraw from active stake account if active stake account has non-zero balance
  const isActive = validator.activeStakeLamports.gt(new Numberu64(0));
  const totalLamports = isActive ? validator.activeStakeLamports : validator.transientStakeLamports;
  const lamports = totalLamports.lte(MIN_ACTIVE_STAKE_LAMPORTS) ? new Numberu64(0) : totalLamports;
  const stakeAccount = await (isActive
    ? getValidatorStakeAccount(
        stakePoolProgramId,
        stakePoolPubkey,
        validator.voteAccountAddress,
      )
    : getValidatorTransientStakeAccount(
      stakePoolProgramId,
      stakePoolPubkey,
      validator.voteAccountAddress,
    )
  );
  return { lamports, stakeAccount };
}

function validatorTotalStake(validator: ValidatorStakeInfo): Numberu64 {
  return validator.activeStakeLamports.add(validator.transientStakeLamports);
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
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
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
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
    [
      Buffer.from("transient"),
      validatorVoteAccount.toBuffer(),
      stakePoolPubkey.toBuffer(),
    ],
    stakePoolProgramId,
  );
  return key;
}

export async function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  return await Token.getAssociatedTokenAddress(
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
    await connection.getMinimumBalanceForRentExemption(
      STAKE_STATE_LEN,
    );

  // since user is withdrawing, pool token acc should exist
  const userPoolTokenAccount = await getAssociatedTokenAddress(stakePoolData.poolMint, walletPubkey);

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
      i < validatorWithdrawalReceipts.length && i < chunkOffset + MAX_WITHDRAWALS_PER_TX;
      i++
    ) {
      const {
        stakeAccount: stakeSplitFrom,
        withdrawalReceipt: {
          dropletsUnstaked,
        }
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
export async function tryRpc<T>(
  fallibleRpcCall: Promise<T>,
): Promise<T> {
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
  const info = await tryRpc(connection.getAccountInfo(
    associatedAddress,
  ));
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
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
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
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
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
 * @returns expected droplets given in return for staking `lamportsToStake`, with deposit fees factored in
 */
function calcDropletsReceivedForDeposit(lamportsToStake: Numberu64, stakePool: schema.StakePool, depositFee: schema.Fee): Numberu64 {
  const dropletsMinted = lamportsToStake.mul(stakePool.poolTokenSupply).div(stakePool.totalStakeLamports);
  const hasFee = !depositFee.numerator.isZero() && !depositFee.denominator.isZero();
  const depositFeeDroplets = hasFee ? depositFee.numerator.mul(dropletsMinted).div(depositFee.denominator) : new Numberu64(0);
  return dropletsMinted.sub(depositFeeDroplets);
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
export function calcDropletsReceivedForSolDeposit(lamportsToStake: Numberu64, stakePool: schema.StakePool): Numberu64 {
  return calcDropletsReceivedForDeposit(lamportsToStake, stakePool, stakePool.solDepositFee);
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
export function calcDropletsReceivedForStakeDeposit(lamportsToStake: Numberu64, stakePool: schema.StakePool): Numberu64 {
  return calcDropletsReceivedForDeposit(lamportsToStake, stakePool, stakePool.stakeDepositFee);
}

export type WithdrawalReceipt = {
  /**
   * Number of droplets that was unstaked/withdrawn
   */
  dropletsUnstaked: Numberu64;
  /**
   * Number of lamports the user should receive from the withdrawal,
   * with withdrawal fees deducted
   */
  lamportsReceived: Numberu64;
  /**
   * Number of droplets paid by the user in withdrawal fees
   */
  dropletsFeePaid: Numberu64;
}

export type ValidatorWithdrawalReceipt = {
  /**
   * The stake account to make this withdrawal from.
   * Can be a validator stake account, transient stake account, or the pool's reserve stake account.
   */
  stakeAccount: PublicKey;
  withdrawalReceipt: WithdrawalReceipt;
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
function calcWithdrawalReceipt(dropletsToUnstake: Numberu64, stakePool: schema.StakePool): WithdrawalReceipt {
  const { withdrawalFee, totalStakeLamports, poolTokenSupply } = stakePool;
  // on-chain logic: the withdrawal fee is levied first
  const hasFee = !withdrawalFee.numerator.isZero() && !withdrawalFee.denominator.isZero();
  const dropletsFeePaid = hasFee ? withdrawalFee.numerator.mul(dropletsToUnstake).div(withdrawalFee.denominator) : new Numberu64(0);
  const dropletsBurnt = dropletsToUnstake.sub(dropletsFeePaid);
  const num = dropletsBurnt.mul(totalStakeLamports);
  if (num.lt(poolTokenSupply) || poolTokenSupply.isZero()) {
    return {
      dropletsUnstaked: dropletsToUnstake,
      lamportsReceived: new Numberu64(0),
      dropletsFeePaid,
    };
  }
  // on-chain logic is ceil div
  const lamportsReceived = num.add(poolTokenSupply).sub(new Numberu64(1)).div(poolTokenSupply);
  return {
    dropletsUnstaked: dropletsToUnstake,
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
function estDropletsUnstakedByWithdrawal(lamportsReceived: Numberu64, stakePool: schema.StakePool): Numberu64 {
  const { withdrawalFee, totalStakeLamports, poolTokenSupply } = stakePool;
  const estDropletsBurnt = lamportsReceived.mul(poolTokenSupply).div(totalStakeLamports);
  const hasFee = !withdrawalFee.numerator.isZero() && !withdrawalFee.denominator.isZero();
  if (!hasFee) {
    return estDropletsBurnt;
  }
  const base = withdrawalFee.denominator.sub(withdrawalFee.numerator);
  // Note: loss of precision for small estDropletsBurnt
  return estDropletsBurnt.mul(withdrawalFee.denominator).div(base);
}