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

export const calcPoolPriceAndFee = (stakePool: StakePoolAccount): [number, number] => {
  const stakePoolData = stakePool.account.data;
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
 * @param stakePoolProgramId program id of the stake pool program
 * @param stakePoolPubkey public key of the stake pool account
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
 * @throws WithdrawalUnserviceableError if a suitable withdraw procedure is not found
 */
export async function validatorsToWithdrawFrom(
  stakePoolProgramId: PublicKey,
  stakePoolPubkey: PublicKey,
  withdrawalAmountDroplets: number,
  withdrawalAmountLamports: number,
  validatorList: ValidatorList,
  reserve: PublicKey,
): Promise<[PublicKey, number][]> {
  const validators = validatorList.validators;
  // no active validators, withdraw from reserve
  // also, reduce() throws error if array empty
  if (validators.length < 1) return [[reserve, withdrawalAmountDroplets]];

  const sortedValidators = sortedValidatorStakeInfos(validators);
  const dropletsPerLamport = withdrawalAmountDroplets / withdrawalAmountLamports;
  const res: [PublicKey, number][] = [];
  
  let lamportsRemaining = withdrawalAmountLamports;
  let dropletsRemaining = withdrawalAmountDroplets;

  // Withdraw from the lightest validators first
  let i = sortedValidators.length - 1;
  while (i >= 0) {
    if (lamportsRemaining === 0) {
      break;
    }
    const validator = sortedValidators[i];
    const { lamports, stakeAccount } = await stakeAvailableToWithdraw(validator, stakePoolProgramId, stakePoolPubkey);
    if (lamports.isZero()) {
      continue;
    }
    const lamportsServiced = Math.min(lamportsRemaining, lamports.toNumber());
    const dropletsServiced = Math.round(dropletsPerLamport * lamportsServiced);
    if (lamportsServiced === lamportsRemaining && dropletsServiced !== dropletsRemaining) {
      // rounding error happened somewhere
      throw new WithdrawalUnserviceableError();
    }

    res.push([stakeAccount, dropletsServiced]);
    i -= 1;
    lamportsRemaining -= lamportsServiced;
    dropletsRemaining -= dropletsServiced;
  }

  if (lamportsRemaining > 0) {
    // might happen if many transient stake accounts
    throw new WithdrawalUnserviceableError();
  }
  
  return res;
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


// Need this minimum activeStakeLamports for staker to be able to remove validator
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
  lamports: BN,
  stakeAccount: PublicKey,
}> {
  // must withdraw from active stake account if active stake account has non-zero balance
  const isActive = validator.activeStakeLamports.gt(new BN(0));
  const totalLamports = isActive ? validator.activeStakeLamports : validator.transientStakeLamports;
  const lamports = totalLamports.lte(MIN_ACTIVE_STAKE_LAMPORTS) ? new BN(0) : totalLamports;
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

export function validatorTotalStake(validator: ValidatorStakeInfo): BN {
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
 * @param amounts: list of [Pubkey, number] tuples, where each tuple is
 *                 [0]: Stake pool validator stake account
 *                 [1]: amount of pool tokens to withdraw from that account
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
  amounts: [PublicKey, number | Numberu64][],
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
    chunkOffset < amounts.length;
    chunkOffset += MAX_WITHDRAWALS_PER_TX
  ) {
    const tx = new Transaction();
    const signers: Signer[] = [];

    // Add WithdrawStake Instruction for each validator in the chunk
    for (
      let i = chunkOffset;
      i < amounts.length && i < chunkOffset + MAX_WITHDRAWALS_PER_TX;
      i++
    ) {
      const [stakeSplitFrom, amount] = amounts[i];
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
          amount,
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
 * get associated token address and adds instruciton to create one to `tx` if not exist
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
 * Helper function for calculating expected droplets given a deposit and the deposit fee struct
 * @param lamportsToStake 
 * @param stakePool 
 * @param depositFee the Fee struct for the given deposit type,
 *                   should either be stakePool.solDepositFee or stakePool.stakeDepositFee
 * @returns expected droplets given in return for staking `lamportsToStake`, with deposit fees factored in
 */
export function calcDropletsReceivedForDeposit(lamportsToStake: Numberu64, stakePool: schema.StakePool, depositFee: schema.Fee): Numberu64 {
  const dropletsMinted = lamportsToStake.mul(stakePool.poolTokenSupply).div(stakePool.totalStakeLamports);
  const depositFeeDroplets = depositFee.numerator.mul(dropletsMinted).div(depositFee.denominator);
  return dropletsMinted.sub(depositFeeDroplets);
}
