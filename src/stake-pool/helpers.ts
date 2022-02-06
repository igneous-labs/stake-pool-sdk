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

import { StakePoolAccount } from './types';
import * as schema from "./schema";
import { addStakePoolSchema } from "./schema";
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

const FAILED_TO_FIND_ACCOUNT = "Failed to find account";
const INVALID_ACCOUNT_OWNER = "Invalid account owner";

/**
 * Adds the create associated token address instruciton to `tx` if not already created
 * @param connection active connection
 * @param owner pubkey of the owner of the associated account
 * @param mint mint address of the token account
 * @param tx transaction to add create instruction to if need be
 * @returns the public key of the associated token account
 */
export async function getOrCreateAssociatedAddress(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tx: Transaction,
): Promise<PublicKey> {
  const associatedAddress = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    owner,
  );

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
