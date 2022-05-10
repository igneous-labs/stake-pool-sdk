/**
 * Stake Pool instructions
 *
 * @module
 */

import { struct, u8, u32 } from "@solana/buffer-layout";
import {
  PublicKey,
  StakeProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import * as Layout from "@/stake-pool/layout";
import {
  Numberu64,
  StakePoolInstruction,
  ValidatorAllStakeAccounts,
} from "@/stake-pool/types";

/**
 * Initializes a DepositSol stake pool instruction given the required accounts and data
 *
 * @param stakePoolProgramId: Pubkey of the stake pool program
 * @param stakePool: Pubkey of the stake pool to deposit to
 * @param stakePoolWithdrawAuthority: Pubkey of the stake pool's withdraw authority.
 *                                    PDA of the stake pool program, see StakePool docs for details.
 * @param reserveStake: Pubkey of the stake pool's reserve account
 * @param lamportsFrom: Pubkey of the SOL account to deduct SOL from to deposit.
 * @param poolTokenTo: Pubkey of the pool token account to mint the pool tokens to.
 * @param managerFeeAccount: Pubkey of the pool token account receiving the stake pool's fees.
 * @param referrerPoolTokenAccount: Pubkey of the pool token account of the referrer to receive referral fees
 * @param poolMint: Pubkey of the pool token mint
 * @param tokenProgramId: Pubkey of the SPL token program
 * @param amount: The amount of lamports to deposit
 * @param solDepositAuthority: Optional Pubkey of the stake pool's deposit authority.
 */
export const depositSolInstruction = (
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  stakePoolWithdrawAuthority: PublicKey,
  reserveStake: PublicKey,
  lamportsFrom: PublicKey,
  poolTokenTo: PublicKey,
  managerFeeAccount: PublicKey,
  referrerPoolTokenAccount: PublicKey,
  poolMint: PublicKey,
  tokenProgramId: PublicKey,
  amount: Numberu64,
  solDepositAuthority?: PublicKey,
): TransactionInstruction => {
  const dataLayout = struct<{
    instruction: number;
    amount: Uint8Array;
  }>([u8("instruction"), Layout.uint64("amount")]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: StakePoolInstruction.DepositSol,
      amount: new Numberu64(amount).toBuffer(),
    },
    data,
  );

  const hasDepositAuthority = solDepositAuthority !== undefined;
  const keys = [
    { pubkey: stakePool, isSigner: false, isWritable: true },
    {
      pubkey: stakePoolWithdrawAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: reserveStake, isSigner: false, isWritable: true },
    { pubkey: lamportsFrom, isSigner: true, isWritable: true },
    { pubkey: poolTokenTo, isSigner: false, isWritable: true },
    { pubkey: managerFeeAccount, isSigner: false, isWritable: true },
    { pubkey: referrerPoolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: poolMint, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
  ];
  if (hasDepositAuthority) {
    keys.push({
      pubkey: solDepositAuthority,
      isSigner: true,
      isWritable: false,
    });
  }
  return new TransactionInstruction({
    keys,
    programId: stakePoolProgramId,
    data,
  });
};

/**
 * Initializes a DepositStake stake pool instruction given the required accounts and data
 * This instruction assumes that the `depositStakeAddress` stake account's withdraw and deposit
 * authority has already been set to `stakePoolDepositAuthority`.
 * To use this in a transaction, prefix this instruction with two `StakeProgram.authorize` instructions
 * to change the stake account's authorities to `stakePoolDepositAuthority`.
 *
 * @param stakePoolProgramId: Pubkey of the stake pool program
 * @param stakePool: Pubkey of the stake pool to deposit to
 * @param validatorList: Pubkey of the stake pool's validator list.
 * @param stakePoolDepositAuthority: Pubkey of the stake pool's deposit authority.
 *                                   Either default PDA stake deposit authority or custom deposit authority.
 * @param stakePoolWithdrawAuthority: Pubkey of the stake pool's withdraw authority.
 *                                    PDA of the stake pool program, see StakePool docs for details.
 * @param depositStakeAddress: Pubkey of the stake account to be deposited.
 * @param validatorStakeAccount: Pubkey of the stake pool's stake account for the validator of the `depostStakeAddress` stake account.
 * @param reserveStake: Pubkey of the stake pool's reserve account
 * @param poolTokensTo: Pubkey of the pool token account to mint the pool tokens to.
 * @param managerFeeAccount: Pubkey of the pool token account receiving the stake pool's fees.
 * @param referrerPoolTokensAccount: Pubkey of the pool token account of the referrer to receive referral fees
 * @param poolMint: Pubkey of the pool token mint
 * @param tokenProgramId: Pubkey of the SPL token program
 */
export function depositStakeInstruction(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  validatorList: PublicKey,
  stakePoolDepositAuthority: PublicKey,
  stakePoolWithdrawAuthority: PublicKey,
  depositStakeAddress: PublicKey,
  validatorStakeAccount: PublicKey,
  reserveStake: PublicKey,
  poolTokensTo: PublicKey,
  managerFeeAccount: PublicKey,
  referrerPoolTokensAccount: PublicKey,
  poolMint: PublicKey,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  const dataLayout = struct<{ instruction: number }>([u8("instruction")]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: StakePoolInstruction.DepositStake,
    },
    data,
  );

  const keys = [
    { pubkey: stakePool, isSigner: false, isWritable: true },
    {
      pubkey: validatorList,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: stakePoolDepositAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: stakePoolWithdrawAuthority, isSigner: false, isWritable: false },
    { pubkey: depositStakeAddress, isSigner: false, isWritable: true },
    { pubkey: validatorStakeAccount, isSigner: false, isWritable: true },
    { pubkey: reserveStake, isSigner: false, isWritable: true },
    { pubkey: poolTokensTo, isSigner: false, isWritable: true },
    { pubkey: managerFeeAccount, isSigner: false, isWritable: true },
    { pubkey: referrerPoolTokensAccount, isSigner: false, isWritable: true },
    { pubkey: poolMint, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_STAKE_HISTORY_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    { pubkey: StakeProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: stakePoolProgramId,
    data,
  });
}

/**
 * Initializes a WithdrawStake stake pool instruction given the required accounts and data
 * @param stakePoolProgramId: Pubkey of the stake pool program
 * @param stakePool: Pubkey of the stake pool to deposit to
 * @param validatorList: Pubkey of the stake pool's validator list.
 * @param stakePoolWithdrawAuthority: Pubkey of the stake pool's withdraw authority.
 *                                    PDA of the stake pool program, see StakePool docs for details.
 * @param stakeSplitFrom: Pubkey of the stake pool's stake account to split off stake from
 * @param stakeSplitTo: Pubkey of the uninitialized stake account
 *                      (i.e. correct space for stake account allocated, but data all 0s)
 *                      that will take the stake split off
 * @param userStakeAuthority: Pubkey of the user's stake authority
 * @param userTokenTransferAuthority: Pubkey of the user's token transfer authority for `userPoolTokenAccount`
 * @param userPoolTokenAccount: Pubkey of the user's pool token account to deduct pool tokens from to withdraw
 * @param managerFeeAccount: Pubkey of the pool token account receiving the stake pool's fees.
 * @param poolMint: Pubkey of the pool token mint
 * @param tokenProgramId: Pubkey of the SPL token program
 * @param dropletsToUnstake: number of droplets to withdraw
 */
export function withdrawStakeInstruction(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  validatorList: PublicKey,
  stakePoolWithdrawAuthority: PublicKey,
  stakeSplitFrom: PublicKey,
  stakeSplitTo: PublicKey,
  userStakeAuthority: PublicKey,
  userTokenTransferAuthority: PublicKey,
  userPoolTokenAccount: PublicKey,
  managerFeeAccount: PublicKey,
  poolMint: PublicKey,
  tokenProgramId: PublicKey,
  dropletsToUnstake: Numberu64,
): TransactionInstruction {
  const dataLayout = struct<{
    instruction: number;
    amount: Uint8Array;
  }>([u8("instruction"), Layout.uint64("amount")]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: StakePoolInstruction.WithdrawStake,
      amount: dropletsToUnstake.toBuffer(),
    },
    data,
  );

  const keys = [
    { pubkey: stakePool, isSigner: false, isWritable: true },
    {
      pubkey: validatorList,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: stakePoolWithdrawAuthority, isSigner: false, isWritable: false },
    { pubkey: stakeSplitFrom, isSigner: false, isWritable: true },
    { pubkey: stakeSplitTo, isSigner: false, isWritable: true },
    { pubkey: userStakeAuthority, isSigner: false, isWritable: false },
    { pubkey: userTokenTransferAuthority, isSigner: true, isWritable: false },
    { pubkey: userPoolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: managerFeeAccount, isSigner: false, isWritable: true },
    { pubkey: poolMint, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    { pubkey: StakeProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: stakePoolProgramId,
    data,
  });
}

/**
 * Creates a transaction with a single UpdateValidatorListBalance instruction
 * Since UpdateValidatorListBalance must be the sole instruction of any transaction,
 * (there's a vulnerability if it isn't)
 * we don't export the instruction directly, only a containing transaction
 * @param stakePoolProgramId The stake pool prog
 * @param stakePool
 * @param stakePoolWithdrawAuthority
 * @param validatorList
 * @param reserveStake
 * @param validatorStakeAccounts
 * @param startIndex
 * @param noMerge
 * @returns
 * @throws
 */
export function updateValidatorListBalanceTransaction(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  stakePoolWithdrawAuthority: PublicKey,
  validatorList: PublicKey,
  reserveStake: PublicKey,
  validatorStakeAccounts: ValidatorAllStakeAccounts[],
  startIndex: number,
  noMerge: boolean,
): Transaction {
  const dataLayout = struct<{
    instruction: number;
    startIndex: number;
    noMerge: number;
  }>([
    u8("instruction"),
    u32("startIndex"),
    u8("noMerge"), // no boolean type in BufferLayout
  ]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: StakePoolInstruction.UpdateValidatorListBalance,
      startIndex,
      noMerge: noMerge ? 1 : 0,
    },
    data,
  );

  const keys = [
    { pubkey: stakePool, isSigner: false, isWritable: false },
    { pubkey: stakePoolWithdrawAuthority, isSigner: false, isWritable: false },
    { pubkey: validatorList, isSigner: false, isWritable: true },
    { pubkey: reserveStake, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_STAKE_HISTORY_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: StakeProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
  ];

  validatorStakeAccounts.forEach(({ main, transient }) => {
    keys.push({
      pubkey: main,
      isSigner: false,
      isWritable: true,
    });
    keys.push({
      pubkey: transient,
      isSigner: false,
      isWritable: true,
    });
  });

  return new Transaction().add(
    new TransactionInstruction({
      keys,
      programId: stakePoolProgramId,
      data,
    }),
  );
}

export function updateStakePoolBalanceInstruction(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  stakePoolWithdrawAuthority: PublicKey,
  validatorList: PublicKey,
  reserveStake: PublicKey,
  managerFeeAccount: PublicKey,
  poolMint: PublicKey,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  const dataLayout = struct<{ instruction: number }>([u8("instruction")]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: StakePoolInstruction.UpdateStakePoolBalance,
    },
    data,
  );

  const keys = [
    { pubkey: stakePool, isSigner: false, isWritable: true },
    { pubkey: stakePoolWithdrawAuthority, isSigner: false, isWritable: false },
    { pubkey: validatorList, isSigner: false, isWritable: true },
    { pubkey: reserveStake, isSigner: false, isWritable: false },
    { pubkey: managerFeeAccount, isSigner: false, isWritable: true },
    { pubkey: poolMint, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: stakePoolProgramId,
    data,
  });
}

export function cleanupRemovedValidatorsInstruction(
  stakePoolProgramId: PublicKey,
  stakePool: PublicKey,
  validatorList: PublicKey,
): TransactionInstruction {
  const dataLayout = struct<{ instruction: number }>([u8("instruction")]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: StakePoolInstruction.CleanupRemovedValidatorEntries,
    },
    data,
  );

  const keys = [
    { pubkey: stakePool, isSigner: false, isWritable: false },
    { pubkey: validatorList, isSigner: false, isWritable: true },
  ];

  return new TransactionInstruction({
    keys,
    programId: stakePoolProgramId,
    data,
  });
}
