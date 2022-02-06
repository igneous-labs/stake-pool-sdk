/**
 * Stake Pool instructions
 *
 * @module
 */

// use require to bypass lack of @types for buffer-layout
// note: this means theres no type checking for BufferLayout stuff
import BufferLayout = require("buffer-layout");

import {
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
//  SYSVAR_STAKE_HISTORY_PUBKEY,
  TransactionInstruction,
  StakeProgram,
//  SYSVAR_INSTRUCTIONS_PUBKEY,
//  Transaction,
} from "@solana/web3.js";
//import assert from "assert";

import * as Layout from "./layout";
import { Numberu64, StakePoolInstruction } from "./types";

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
  amount: number | Numberu64,
  solDepositAuthority?: PublicKey,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    Layout.uint64("amount"),
  ]);

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
 * @param amount: number of pool tokens to withdraw
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
  amount: number | Numberu64,
): TransactionInstruction {
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    Layout.uint64("amount"),
  ]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: StakePoolInstruction.WithdrawStake,
      amount: new Numberu64(amount).toBuffer(),
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
