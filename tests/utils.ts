import { LAMPORTS_PER_SOL, Connection, Transaction, PublicKey, Keypair, StakeProgram } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { WalletAdapter } from '../src';
import path from 'path';
import { Numberu64, STAKE_STATE_LEN } from '../src/stake-pool/types';

export const airdrop = async (connection: Connection, pubkey: PublicKey, amount: number = 1): Promise<void> => {
  //airdrop tokens
  await connection.confirmTransaction(
    await connection.requestAirdrop(
      pubkey,
      amount * LAMPORTS_PER_SOL
    ),
    "finalized"
  );
};

export const keypairFromLocalFile = (filepath: string): Keypair => {
  return Keypair.fromSecretKey(
    Buffer.from(
      JSON.parse(
        readFileSync(path.resolve(__dirname, filepath), {
          encoding: "utf-8",
        })
      )
    )
  );
}

export class MockWalletAdapter implements WalletAdapter {
  publicKey: PublicKey;

  constructor(private _keypair: Keypair) {
    this.publicKey = _keypair.publicKey;
  }

  async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
    // Note: must use partialSign(). sign() overwrites all signatures
    txs.forEach((tx) => tx.partialSign(this._keypair));
    return txs;
  }
}

type PrepareStakerResult = {
  staker: MockWalletAdapter,
  stakerKeypair: Keypair,
  originalBalanceLamports: number,
}

// prep wallet and airdrop SOL if necessary
export const prepareStaker = async (connection: Connection, minStartingSol: number = 1): Promise<PrepareStakerResult> => {
  const stakerKeypair = keypairFromLocalFile("testnet-staker.json");
  const staker = new MockWalletAdapter(stakerKeypair);
  let originalBalanceLamports = await connection.getBalance(staker.publicKey, "finalized");
  if (originalBalanceLamports < minStartingSol * LAMPORTS_PER_SOL) {
      console.log("airdropping", minStartingSol, "SOL to", staker.publicKey.toString(), "...");
      await airdrop(connection, staker.publicKey, minStartingSol);
      originalBalanceLamports = await connection.getBalance(staker.publicKey, "finalized");
  }
  return {
    staker,
    stakerKeypair,
    originalBalanceLamports,
  };
}

export const transferStakeAcc = async (connection: Connection, stakeAccount: PublicKey, owner: Keypair, newOwner: PublicKey) => {
  const transferAuthTxs = [STAKE_AUTHORITY_ENUM, WITHDRAW_AUTHORITY_ENUM].map((authType) => StakeProgram.authorize({
    authorizedPubkey: owner.publicKey,
    newAuthorizedPubkey: newOwner,
    stakeAuthorizationType: { index: authType },
    stakePubkey: stakeAccount,
  }));
  const tx = transferAuthTxs[1];
  tx.add(transferAuthTxs[0].instructions[0]);
  await connection.sendTransaction(tx, [owner]);
}

// TODO: verify these transaction limits
const MAX_STAKE_DEACTIVATE_IX_PER_TX = 10;
const MAX_STAKE_WITHDRAW_IX_PER_TX = 6;

/**
 * For being nice to testnet and not taking too much storage.
 * Clean up all stake accounts owned by `owner` by:
 * - deactivating all active stake accounts
 * - deleting all inactive stake accounts
 * @param connection 
 * @param owner 
 * @returns 
 */
export const cleanupAllStakeAccs = async (connection: Connection, owner: Keypair) => {
  const allStakeAccounts = await getAllStakeAccounts(connection, owner.publicKey);
  for (let i = 0; i < allStakeAccounts.active.length; i += MAX_STAKE_DEACTIVATE_IX_PER_TX) {
    const chunk = allStakeAccounts.active.slice(i, Math.min(allStakeAccounts.active.length, i + MAX_STAKE_DEACTIVATE_IX_PER_TX));
    const tx = chunk.reduce((tx, { pubkey }) => {
      tx.add(StakeProgram.deactivate({
        authorizedPubkey: owner.publicKey,
        stakePubkey: pubkey,
      }).instructions[0]);
      return tx;
    }, new Transaction());
    await connection.sendTransaction(tx, [owner]);
  }
  for (let i = 0; i < allStakeAccounts.inactive.length; i += MAX_STAKE_WITHDRAW_IX_PER_TX) {
    const chunk = allStakeAccounts.inactive.slice(i, Math.min(allStakeAccounts.inactive.length, i + MAX_STAKE_WITHDRAW_IX_PER_TX));
    const tx = chunk.reduce((tx, { pubkey, lamports }) => {
      tx.add(StakeProgram.withdraw({
        authorizedPubkey: owner.publicKey,
        lamports,
        stakePubkey: pubkey,
        toPubkey: owner.publicKey,
      }).instructions[0]);
      return tx;
    }, new Transaction());
    await connection.sendTransaction(tx, [owner]);
  }
}

type ReqStakeAccountData = {
  pubkey: PublicKey,
  lamports: number,
}

type UserStakeAccounts = {
  activating: ReqStakeAccountData[],
  active: ReqStakeAccountData[],
  deactivating: ReqStakeAccountData[],
  inactive: ReqStakeAccountData[],
}

const STAKE_ACCOUNT_WITHDRAW_AUTHORITY_OFFSET = 44;

// "jsonParsed" returns all BNs/u64s in strings
// accountinfo.stake
interface ParsedStake {
  delegation: {
    activationEpoch: string;
    deactivationEpoch: string;
    stake: string;
  }
}

type StakeActivationState = keyof UserStakeAccounts; 

const getAllStakeAccounts = async (connection: Connection, owner: PublicKey): Promise<UserStakeAccounts> => {
  const { epoch } = await connection.getEpochInfo();
  const parsedStakeAccounts = await connection.getParsedProgramAccounts(
    StakeProgram.programId,
    {
      filters: [
        { dataSize: STAKE_STATE_LEN },
        {
          memcmp: {
            offset: STAKE_ACCOUNT_WITHDRAW_AUTHORITY_OFFSET,
            bytes: owner.toBase58(),
          },
        },
      ],
    },
  );
  return parsedStakeAccounts.reduce((res, account) => {
    const activationState = determineStakeActivation(
      // @ts-ignore
      account.account.data.parsed.info.stake,
      epoch
    );
    res[activationState].push({
      pubkey: account.pubkey,
      lamports: account.account.lamports,
    });
    return res;
  }, {
    activating: [],
    active: [],
    deactivating: [],
    inactive: [],
  })
}

const EPOCH_MAX_STRING = "18446744073709551615";

const determineStakeActivation = (parsedStakeAccount: ParsedStake, currentEpoch: number): StakeActivationState => {
  const { delegation: { activationEpoch, deactivationEpoch } } = parsedStakeAccount;
  if (activationEpoch === EPOCH_MAX_STRING) return "inactive";
  else if (Number(activationEpoch) >= currentEpoch) return "activating";
  else if (deactivationEpoch === EPOCH_MAX_STRING) return "active";
  else if (Number(deactivationEpoch) >= currentEpoch) return "deactivating";
  else return "inactive";
}

export const getStakeAccounts = async (
  connection: Connection, stakeAccountPubkeys: PublicKey[]
): Promise<ParsedStake[]> => {
  const allStakeAccounts = await connection.getMultipleAccountsInfo(
    stakeAccountPubkeys,
    { encoding: "jsonParsed" }
  );
  return allStakeAccounts.map(
    // stake account should be parsed automatically, but no type info available
    // @ts-ignore
    (stakeAccount) => stakeAccount.data.parsed.info.stake
  );
}

// corresponding numeric values for stake program authority enum
export const STAKE_AUTHORITY_ENUM = 0;
export const WITHDRAW_AUTHORITY_ENUM = 1;