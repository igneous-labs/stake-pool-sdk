/**
 * Custom types
 *
 * @module
 */

import { AccountInfo, PublicKey } from "@solana/web3.js";
import assert from "assert";
import BN from "bn.js";

import * as schema from "@/stake-pool/schema";

/** length of the stake account in bytes */
export const STAKE_STATE_LEN = 200;

/**
 * Deserialized representation of on-chain stake pool account
 */
export interface StakePoolAccount {
  publicKey: PublicKey;
  account: AccountInfo<schema.StakePool>;
}

/**
 * Deserialized representation of on-chain validator list account
 */
export interface ValidatorListAccount {
  publicKey: PublicKey;
  account: AccountInfo<schema.ValidatorList>;
}

/**
 * Numerical enum for the different Stake Pool instructions
 * NOTE: this must match the order in instruction.rs in order
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
 * NOTE: this must match the order in error.rs in order
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

function bnToNumberu64Buffer(bn: BN | Numberu64): Buffer {
  const a = bn.toArray().reverse();
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
 * Some amount of tokens
 * Copied from token-swap, for packing instruction buffer correctly
 */
export class Numberu64 extends BN {
  /**
   * Convert to Buffer representation
   */
  toBuffer(): Buffer {
    return bnToNumberu64Buffer(this);
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

  /**
   * Creates a new Numberu64 with the same value as an existing BN
   * `new Numberu64(bn)` doesnt work, only copies the reference
   * and doesnt override `toBuffer()`, so any BNs with buffer length < 8's `this.toBuffer()`
   * will return short buffer that cant be serialized to TransactionInstruction
   * @param bn: BN to copy
   */
  static cloneFromBN(bn: BN): Numberu64 {
    return Numberu64.fromBuffer(bnToNumberu64Buffer(bn));
  }

  /**
   * Saturating sub
   */
  satSub(other: Numberu64 | BN): Numberu64 {
    return this.gt(other)
      ? Numberu64.cloneFromBN(this.sub(other))
      : new Numberu64(0);
  }

  /**
   * Performs ceil division
   */
  ceilDiv(denominator: Numberu64 | BN): Numberu64 {
    return Numberu64.cloneFromBN(
      this.add(denominator).sub(new Numberu64(1)).div(denominator),
    );
  }
}

export type ValidatorAllStakeAccounts = {
  main: PublicKey;
  transient: PublicKey;
};

export type ValidatorStakeAvailableToWithdraw = {
  /**
   * Amount of lamports available to withdraw from this validator
   */
  lamports: Numberu64;
  /**
   * Which stakeAccount to withdraw from - main or transient
   */
  stakeAccount: PublicKey;
};

/**
 * Breakdown of a single deposit into the stake pool
 */
export type DepositReceipt = {
  /**
   * Number of lamports that was staked/deposited
   */
  lamportsStaked: Numberu64;
  /**
   * Number of droplets (1 / 10 ** 9 scnSOL) the user should receive in return
   * for the deposit, with deposit fees deducted
   */
  dropletsReceived: Numberu64;
  /**
   * Total number of droplets paid by the user in deposit fees,
   * including `referralFeePaid`
   */
  dropletsFeePaid: Numberu64;
  /**
   * Number of droplets paid by the user in referral fees.
   * This is a part of `dropletsFeePaid`, i.e.
   * deposit fee paid to socean = `dropletsFeePaid` - `referralFeePaid`
   */
  referralFeePaid: Numberu64;
};

/**
 * Breakdown of a single withdrawal from a single stake account in the stake pool
 */
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
};

/**
 * A withdrawal receipt for a single stake account in the stake pool
 * + the stakeAccount to make the withdrawal from
 */
export type ValidatorWithdrawalReceipt = {
  /**
   * The stake account to make this withdrawal from.
   * Can be a validator stake account, transient stake account, or the pool's reserve stake account.
   */
  stakeAccount: PublicKey;
  /**
   * The calculated withdrawal receipt for this stake account
   */
  withdrawalReceipt: WithdrawalReceipt;
};
