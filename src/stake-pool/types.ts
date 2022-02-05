/**
 * Custom TS types
 *
 * @module
 */

import { AccountInfo, PublicKey } from "@solana/web3.js";
import assert from "assert";
import BN from "bn.js";

import * as schema from "./schema";

export interface StakePoolAccount {
  publicKey: PublicKey;
  account: AccountInfo<schema.StakePool>;
}

//export interface ValidatorListAccount {
//  publicKey: PublicKey;
//  account: AccountInfo<schema.ValidatorList>;
//}

/**
 * Numerical enum for the different Stake Pool instructions
 * Note: this must match the order in instruction.rs in order
 * for their numerical value to correctly correspond.
 */
export enum StakePoolInstruction {
  Initialize = 0,
  CreateValidatorStakeAccount,
  AddValidatorToPool,
  RemoveValidatorFromPool,
  DecreaseValidatorStake,
  // 5
  IncreaseValidatorStake,
  SetPreferredValidator,
  UpdateValidatorListBalance,
  UpdateStakePoolBalance,
  CleanupRemovedValidatorEntries,
  // 10
  DepositStake,
  WithdrawStake,
  SetManager,
  SetFee,
  SetStaker,
  // 15
  DepositSol,
  SetDepositAuthority,
}

/**
 * Numerical enum for the different Stake Pool Errors
 * Note: this must match the order in error.rs in order
 * for their numerical value to correctly correspond.
 */
export enum StakePoolError {
  AlreadyInUse = 0,
  InvalidProgramAddress,
  InvalidState,
  CalculationFailure,
  FeeTooHigh,
  // 5
  WrongAccountMint,
  WrongManager,
  SignatureMissing,
  InvalidValidatorStakeList,
  InvalidFeeAccount,
  // 10
  WrongPoolMint,
  WrongStakeState,
  UserStakeNotActive,
  ValidatorAlreadyAdded,
  ValidatorNotFound,
  // 15
  InvalidStakeAccountAddress,
  StakeListOutOfDate,
  StakeListAndPoolOutOfDate,
  UnknownValidatorStakeAccount,
  WrongMintingAuthority,
  // 20
  UnexpectedValidatorListAccountSize,
  WrongStaker,
  NonZeroPoolTokenSupply,
  StakeLamportsNotEqualToMinimum,
  IncorrectDepositVoteAddress,
  // 25
  IncorrectWithdrawVoteAddress,
  InvalidMintFreezeAuthority,
  FeeIncreaseTooHigh,
  InvalidStakeDepositAuthority,
  InvalidSolDepositAuthority,
}

/**
 * Some amount of tokens
 * Copied from token-swap, for packing instruction buffer correctly
 */
export class Numberu64 extends BN {
  /**
   * Convert to Buffer representation
   */
  toBuffer(): Buffer {
    const a = super.toArray().reverse();
    const b = Buffer.from(a);
    if (b.length === 8) {
      return b;
    }
    assert(b.length < 8, "Numberu64 too large");

    const zeroPad = Buffer.alloc(8);
    b.copy(zeroPad);
    return zeroPad;
  }

  /**
   * Construct a Numberu64 from Buffer representation
   */
  static fromBuffer(buffer: Buffer): Numberu64 {
    assert(buffer.length === 8, `Invalid buffer length: ${buffer.length}`);
    return new Numberu64(
      [...buffer] // have to enable ts compiler downlevelIteration just for this expr
        .reverse()
        .map((i) => `00${i.toString(16)}`.slice(-2)) // 0 left-padding for single digits
        .join(""),
      16,
    );
  }
}
