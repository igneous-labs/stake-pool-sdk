import {
  AccountInfo,
  PublicKey,
  Transaction,
  SOLANA_SCHEMA,
  Connection,
} from "@solana/web3.js";
import {
  Token,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";

import BN = require('bn.js');

import { StakePoolAccount, ValidatorListAccount } from './types';
import * as schema from "./schema";
import { addStakePoolSchema, ValidatorStakeInfo, ValidatorList } from "./schema";
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
 * A generic helper function that splits an array into chunks
 * @param arr array to split
 * @param n the number of items in each chunk
 */
export const chunk = <T>(arr: T[], n: number): T[][] =>
  arr.reduce((acc: T[][], item: T, idx: number) => {
    const m = Math.floor(idx/n);
    acc[m] = ([] as T[]).concat(acc[m] || [], item);
    return acc;
  }, [] as T[][]);

/**
 * Parses stake pool account info into StakePoolAccount
 * @param connection active connection
 * @param owner pubkey of the owner of the associated account
 * @param mint mint address of the token account
 * @param tx transaction to add create instruction to if need be
 * @returns the public key of the associated token account
 */
export function getStakePoolFromAccountInfo(
  stakePoolAccountPubkey: PublicKey,
  account: AccountInfo<Buffer>,
): StakePoolAccount {
  const stakePool = schema.StakePool.decodeUnchecked(account.data);
  // reverse the pubkey fields (work-around for borsh.js)
  reverse(stakePool);

  return {
    publicKey: stakePoolAccountPubkey,
    account: {
      data: stakePool,
      executable: account.executable,
      lamports: account.lamports,
      owner: account.owner,
    },
  };
}

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


// TODO: any
// TODO: do we need to handle deposit fee in any way? or in the context of SDK withdrawal is the only thing?
export const calcPoolPriceAndFee = (stakePoolData: any): [number, number] => {
  const lamports = stakePoolData.totalStakeLamports.toNumber();
  const poolTokens = stakePoolData.poolTokenSupply.toNumber();
  const price = lamports == 0 || poolTokens == 0 ? 1 : lamports / poolTokens;
  const feeNum = stakePoolData.withdrawalFee.numerator.toNumber()
  const feeDenom = stakePoolData.withdrawalFee.denominator.toNumber();
  const withdrawalFee = feeNum / feeDenom;
  return [price, withdrawalFee];
}



/**
 * Algorithm to select which validators to withdraw from and how much from each
 *
 * @param withdrawalAmountDroplets: amount to withdraw in droplets
 * @param withdrawalAmountLamports: total amount to deduct from all involved validator stake accounts in lamports
 * @param validatorList: ValidatorList account data
 * @param reserve: Pubkey of the stake pool's reserve account
 *
 * @returns: array of [PublicKey, number] tuples, where
 *           [0] - pubkey of validator's stake account. Note: NOT vote account
 *           [1] - amount in SOCN to withdraw from that validator. Sum of all these must = withdrawalAmount
 *           Pass this array directly to StakePoolClient.withdrawStake()
 *
 *           Returns [[reserveAccPubkey, withdrawalAmountSocn]] if withdrawing from reserve account
 *           Returns null if algorithm is unable to fulfil request
 */
export async function validatorsToWithdrawFrom(
  stakePoolProgramAddress: PublicKey,
  stakePoolPubkey: PublicKey,
  withdrawalAmountDroplets: number,
  withdrawalAmountLamports: number,
  validatorList: ValidatorList,
  reserve: PublicKey,
): Promise<[PublicKey, number][] | null> {
  // For now just pick the validator with the largest stake
  const validators = validatorList.validators;
  // no active validators, withdraw from reserve
  // also, reduce() throws error if array empty
  if (validators.length < 1) return [[reserve, withdrawalAmountDroplets]];

  const sortedValidators = sortedValidatorStakeInfos(validators);
  const heaviest = sortedValidators[0];

  const available = stakeAvailableToWithdraw(heaviest);
  if (available.eq(new BN(0))) {
    return [[reserve, withdrawalAmountDroplets]];
  }
  if (available.lt(new BN(withdrawalAmountLamports))) {
    return null;
  }
  const isTransient = heaviest.activeStakeLamports.eq(new BN(0));
  const stakeAcc = await (isTransient
    ? getValidatorTransientStakeAccount(
        stakePoolProgramAddress,
        stakePoolPubkey,
        heaviest.voteAccountAddress,
      )
    : getValidatorStakeAccount(
        stakePoolProgramAddress,
        stakePoolPubkey,
        heaviest.voteAccountAddress,
      ));
  return [[stakeAcc, withdrawalAmountDroplets]];
}

export function sortedValidatorStakeInfos(
  validatorStakeInfos: ValidatorStakeInfo[],
): ValidatorStakeInfo[] {
  function compareValidatorStake(
    validatorA: ValidatorStakeInfo,
    validatorB: ValidatorStakeInfo,
  ): number {
    return validatorA.activeStakeLamports.gt(validatorB.activeStakeLamports)
      ? -1
      : validatorA.activeStakeLamports.lt(validatorB.activeStakeLamports)
      ? 1
      : validatorA.transientStakeLamports.gt(validatorB.transientStakeLamports)
      ? -1
      : 1;
  }
  return [...validatorStakeInfos].sort(compareValidatorStake);
}

export function stakeAvailableToWithdraw(validator: ValidatorStakeInfo): BN {
  return validator.activeStakeLamports.gt(new BN(0))
    ? validator.activeStakeLamports
    : validator.transientStakeLamports;
}

export function validatorTotalStake(validator: ValidatorStakeInfo): BN {
  return validator.activeStakeLamports.add(validator.transientStakeLamports);
}



/**
 * Gets the address of the stake pool's stake account for the given validator
 * @param stakePoolProgramId: Pubkey of the stake pool program
 * @param stakePool: Pubkey of the stake pool to deposit to
 * @param validatorVoteAccount: Pubkey of the validator to find the stake account of
 */
export async function getValidatorStakeAccount(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  validatorVoteAccount: PublicKey,
): Promise<PublicKey> {
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
    [validatorVoteAccount.toBuffer(), stakePool.toBuffer()],
    stakePoolProgramId,
  );
  return key;
}

/**
 * Gets the address of the stake pool's transient stake account for the given validator
 * @param stakePoolProgramId: Pubkey of the stake pool program
 * @param stakePool: Pubkey of the stake pool to deposit to
 * @param validatorVoteAccount: Pubkey of the validator to find the stake account of
 */
export async function getValidatorTransientStakeAccount(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  validatorVoteAccount: PublicKey,
): Promise<PublicKey> {
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
    [
      Buffer.from("transient"),
      validatorVoteAccount.toBuffer(),
      stakePool.toBuffer(),
    ],
    stakePoolProgramId,
  );
  return key;
}





const FAILED_TO_FIND_ACCOUNT = "Failed to find account";
const INVALID_ACCOUNT_OWNER = "Invalid account owner";

export async function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  return await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    owner,
  );
}

/**
 * get associated token address and adds instruciton to create one to `tx` if not exist
 * @param connection active connection
 * @param mint mint address of the token account
 * @param owner pubkey of the owner of the associated account
 * @param tx transaction to add create instruction to if need be
 * @returns the public key of the associated token account
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
  try {
    const info = await connection.getAccountInfo(
      associatedAddress,
    );
    if (info === null) {
      throw new Error(FAILED_TO_FIND_ACCOUNT);
    }
    if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new Error(INVALID_ACCOUNT_OWNER);
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      // INVALID_ACCOUNT_OWNER can be possible if the associatedAddress has
      // already been received some lamports (= became system accounts).
      // Assuming program derived addressing is safe, this is the only case
      // for the INVALID_ACCOUNT_OWNER in this code-path
      if (
        err.message === FAILED_TO_FIND_ACCOUNT ||
        err.message === INVALID_ACCOUNT_OWNER
      ) {
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
    }
  }
  return associatedAddress;
}

/**
 * Gets the withdraw authority PDA of the given stake pool
 * @param stakePoolProgramId: Pubkey of the stake pool program
 * @param stakePool: Pubkey of the stake pool to deposit to
 */
export async function getWithdrawAuthority(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
): Promise<PublicKey> {
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
    [stakePool.toBuffer(), Buffer.from("withdraw")],
    stakePoolProgramId,
  );
  return key;
}

/**
 * Gets the default deposit authority PDA of the given stake pool
 * @param stakePoolProgramId: Pubkey of the stake pool program
 * @param stakePool: Pubkey of the stake pool to deposit to
 */
export async function getDefaultDepositAuthority(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
): Promise<PublicKey> {
  const [key, _bump_seed] = await PublicKey.findProgramAddress(
    [stakePool.toBuffer(), Buffer.from("deposit")],
    stakePoolProgramId,
  );
  return key;
}
