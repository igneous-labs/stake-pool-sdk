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
//  StakeProgram,
//  SYSVAR_INSTRUCTIONS_PUBKEY,
//  Transaction,
} from "@solana/web3.js";
//import assert from "assert";

//import { PublicKey, SystemProgram, TransactionInstruction, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";

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
 * @param poolTokensTo: Pubkey of the pool token account to mint the pool tokens to.
 * @param managerFeeAccount: Pubkey of the pool token account receiving the stake pool's fees.
 * @param referrerPoolTokensAccount: Pubkey of the pool token account of the referrer to receive referral fees
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
  poolTokensTo: PublicKey,
  managerFeeAccount: PublicKey,
  referrerPoolTokensAccount: PublicKey,
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
    { pubkey: poolTokensTo, isSigner: false, isWritable: true },
    { pubkey: managerFeeAccount, isSigner: false, isWritable: true },
    { pubkey: referrerPoolTokensAccount, isSigner: false, isWritable: true },
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
