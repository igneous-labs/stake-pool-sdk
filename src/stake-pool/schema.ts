/* eslint-disable max-classes-per-file */
/**
 * Borsh schema for borsh de/serializing stake pool accounts
 *
 * @module
 */
import { Enum, PublicKey, Struct } from "@solana/web3.js";
import BN from "bn.js";
import { Schema } from "borsh";

export class Fee extends Struct {
  denominator: BN;

  numerator: BN;
}

export class AccountType extends Enum {}

class AccountTypeEnum extends Struct {}

export enum AccountTypeKind {
  Uninitialized = "Uninitialized",
  StakePool = "StakePool",
  ValidatorList = "ValidatorList",
}

export class StakePool extends Struct {
  accountType: AccountType;

  manager: PublicKey;

  staker: PublicKey;

  depositAuthority: PublicKey;

  withdrawBumpSeed: number;

  validatorList: PublicKey;

  reserveStake: PublicKey;

  poolMint: PublicKey;

  managerFeeAccount: PublicKey;

  tokenProgramId: PublicKey;

  totalStakeLamports: BN;

  poolTokenSupply: BN;

  lastUpdateEpoch: BN;

  lockup: Lockup;

  fee: Fee;

  nextEpochFee: Fee;

  preferredDepositValidatorVoteAddress: PublicKey;

  preferredWithdrawValidatorVoteAddress: PublicKey;

  stakeDepositFee: Fee;

  withdrawalFee: Fee;

  nextWithdrawalFee: Fee;

  stakeReferralFee: number;

  solDepositAuthority: PublicKey;

  solDepositFee: Fee;

  solReferralFee: number;
}

export class ValidatorList extends Struct {
  accountType: AccountType;

  maxValidators: number;

  validators: [ValidatorStakeInfo];
}
export class ValidatorStakeInfo extends Struct {
  activeStakeLamports: BN;

  transientStakeLamports: BN;

  lastUpdateEpoch: BN;

  transientSeedSuffixStart: BN;

  transientSeedSuffixEnd: BN;

  status: StakeStatus;

  voteAccountAddress: PublicKey;
}

export class StakeStatus extends Enum {}

class StakeStatusEnum extends Struct {}

export class Lockup extends Struct {
  unixtime: BN;

  epoch: BN;

  custodian: PublicKey;
}

export enum StakeStatusKind {
  Active = "Active",
  DeactivatingTransient = "DeactivatingTransient",
  ReadyForRemoval = "ReadyForRemoval",
}

export function addStakePoolSchema(schema: Schema): void {
  /**
   * Borsh requires something called a Schema,
   * which is a Map (key-value pairs) that tell borsh how to deserialise the raw data
   * This function adds a new schema to an existing schema object.
   */
  schema.set(PublicKey, {
    kind: "struct",
    fields: [["_bn", "u256"]],
  });

  schema.set(Fee, {
    kind: "struct",
    fields: [
      ["denominator", "u64"],
      ["numerator", "u64"],
    ],
  });

  schema.set(Lockup, {
    kind: "struct",
    fields: [
      ["unixtime", "u64"],
      ["epoch", "u64"],
      ["custodian", PublicKey],
    ],
  });

  schema.set(AccountType, {
    kind: "enum",
    field: "enum",
    values: [
      // if the account has not been initialized, the enum will be 0
      [AccountTypeKind.Uninitialized, AccountTypeEnum],
      [AccountTypeKind.StakePool, AccountTypeEnum],
      [AccountTypeKind.ValidatorList, AccountTypeEnum],
    ],
  });

  schema.set(AccountTypeEnum, { kind: "struct", fields: [] });

  schema.set(StakePool, {
    kind: "struct",
    fields: [
      ["accountType", AccountType],
      ["manager", PublicKey],
      ["staker", PublicKey],
      ["depositAuthority", PublicKey],
      ["withdrawBumpSeed", "u8"],
      ["validatorList", PublicKey],
      ["reserveStake", PublicKey],
      ["poolMint", PublicKey],
      ["managerFeeAccount", PublicKey],
      ["tokenProgramId", PublicKey],
      ["totalStakeLamports", "u64"],
      ["poolTokenSupply", "u64"],
      ["lastUpdateEpoch", "u64"],
      ["lockup", Lockup],
      ["fee", Fee],
      ["nextEpochFee", { kind: "option", type: Fee }],
      [
        "preferredDepositValidatorVoteAddress",
        { kind: "option", type: PublicKey },
      ],
      [
        "preferredWithdrawValidatorVoteAddress",
        { kind: "option", type: PublicKey },
      ],
      ["stakeDepositFee", Fee],
      ["withdrawalFee", Fee],
      ["nextWithdrawalFee", { kind: "option", type: Fee }],
      ["stakeReferralFee", "u8"],
      ["solDepositAuthority", { kind: "option", type: PublicKey }],
      ["solDepositFee", Fee],
      ["solReferralFee", "u8"],
    ],
  });

  schema.set(ValidatorList, {
    kind: "struct",
    fields: [
      ["accountType", AccountType],
      ["maxValidators", "u32"],
      ["validators", [ValidatorStakeInfo]],
    ],
  });

  schema.set(StakeStatus, {
    kind: "enum",
    field: "enum",
    values: [
      [StakeStatusKind.Active, StakeStatusEnum],
      [StakeStatusKind.DeactivatingTransient, StakeStatusEnum],
      [StakeStatusKind.ReadyForRemoval, StakeStatusEnum],
    ],
  });

  schema.set(StakeStatusEnum, { kind: "struct", fields: [] });

  // follow ValidatorStakeInfo NOT ValidatorStakeInfoPacked
  schema.set(ValidatorStakeInfo, {
    kind: "struct",
    fields: [
      ["activeStakeLamports", "u64"],
      ["transientStakeLamports", "u64"],
      ["lastUpdateEpoch", "u64"],
      ["transientSeedSuffixStart", "u64"],
      ["transientSeedSuffixEnd", "u64"],
      ["status", StakeStatus],
      ["voteAccountAddress", PublicKey],
    ],
  });
}
