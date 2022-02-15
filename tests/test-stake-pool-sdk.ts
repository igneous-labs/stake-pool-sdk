import { expect } from "chai";
import { clusterApiUrl, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, StakeProgram, SystemProgram, Transaction } from '@solana/web3.js';

import { Numberu64 } from '../src/stake-pool/types';
import { Socean, WalletAdapter } from '../src';
import { airdrop, keypairFromLocalFile, MockWalletAdapter } from './utils';
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe('test basic functionalities', () => {
  it('it initializes and gets stake pool account', async () => {
    const socean = new Socean();
    const res = await socean.getStakePoolAccount();
    expect(res.account.data.poolMint.toString()).to.eq("5oVNVwKYAGeFhvat29XFVH89oXNpLsV8uCPEqSooihsw");
  });

  it('it initializes mainnet and gets stake pool account', async () => {
    const socean = new Socean('mainnet-beta');
    const res = await socean.getStakePoolAccount();
    expect(res.account.data.poolMint.toString()).to.eq("5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm");
  });

  it('it generates deposit sol tx', async () => {
    const socean = new Socean();
    const staker = Keypair.generate();
    const referrer = Keypair.generate();

    const tx = await socean.depositSolTransactions(staker.publicKey, new Numberu64(1), referrer.publicKey);
    console.log(JSON.stringify(tx, null, 4));
  });

  it('it generates withdraw txs', async () => {
    const socean = new Socean();
    const staker = Keypair.generate();

    const txs = await socean.withdrawStakeTransactions(staker.publicKey, new Numberu64(1));
    console.log(JSON.stringify(txs, null, 4));
  });

  it('it appends update txs', async () => {
    const socean = new Socean();
    const staker = Keypair.generate();

    const txs = await socean.depositSolTransactions(staker.publicKey, new Numberu64(1));
    const { account: { data: { lastUpdateEpoch } }} = await socean.getStakePoolAccount();
    const { epoch } = await new Connection(clusterApiUrl("testnet")).getEpochInfo();
    if (lastUpdateEpoch.toNumber() < epoch) {
      console.log("Not updated this epoch, transactions should contain updates");
      // 1. updateValidatorListBalance
      // 2. updateStakePool
      // 3. cleanupRemovedValidators
      // 4. deposit
      expect(txs.length).to.eq(4);
    } else {
      console.log("Updated this epoch, transactions should not have updates");
      expect(txs.length).to.eq(1);
    }
  });

  it('it deposits and withdraws on testnet', async () => {
    const socean = new Socean();
    const connection = new Connection(clusterApiUrl("testnet"));
    
    // prep wallet and airdrop 1 SOL
    const stakerKeypair = keypairFromLocalFile("testnet-staker.json");
    const staker: WalletAdapter = new MockWalletAdapter(stakerKeypair);
    const airdropSol = 1;
    console.log("airdropping", airdropSol, "SOL to", staker.publicKey.toString(), "...");
    await airdrop(connection, staker.publicKey, airdropSol);
    const originalBalanceLamports = await connection.getBalance(staker.publicKey, "finalized");
    console.log("staker:", staker.publicKey.toBase58());
    console.log("original balance:", originalBalanceLamports);

    // deposit 0.5 sol
    const depositAmountSol = 0.5;
    const depositAmount = depositAmountSol * LAMPORTS_PER_SOL;
    console.log("deposit amout:", depositAmount);
    const lastDepositTxId = (await socean.depositSol(staker, new Numberu64(depositAmount))).pop().pop();
    // wait until the last tx (deposit) is finalized
    await connection.confirmTransaction(lastDepositTxId, "finalized");
    console.log("deposit tx id: ", lastDepositTxId);

    // assert the balance decreased by 0.5
    const afterDepositBalanceLamports = await connection.getBalance(staker.publicKey, "finalized");
    console.log("balance after deposit:", afterDepositBalanceLamports);
    expect(afterDepositBalanceLamports).to.be.below(originalBalanceLamports - depositAmountSol * LAMPORTS_PER_SOL);

    // assert scnSOL balance > 0
    const stakePool = await socean.getStakePoolAccount();
    const scnSolMint = stakePool.account.data.poolMint;
    const scnSolToken = new Token(
      connection,
      scnSolMint,
      TOKEN_PROGRAM_ID,
      stakerKeypair,
    );
    let scnSolAcct = await scnSolToken.getOrCreateAssociatedAccountInfo(staker.publicKey);
    const scnSolAmt = scnSolAcct.amount;
    expect(scnSolAmt.toNumber()).to.be.above(0);

    // withdraw all scnSOL
    const { transactionSignatures, stakeAccounts } = await socean.withdrawStake(staker, scnSolAmt);
    const lastWithdrawTxId = transactionSignatures.pop().pop();
    // wait until the last tx (withdraw) is finalized
    await connection.confirmTransaction(lastWithdrawTxId, "finalized");

    // assert scnSOL account empty
    scnSolAcct = await scnSolToken.getOrCreateAssociatedAccountInfo(staker.publicKey);
    expect(scnSolAcct.amount.toNumber()).to.eq(0);

    // assert stake accounts present after withdrawal and have stake
    const stakeAccountPubkeys = stakeAccounts.map((stakeAccount) => stakeAccount.publicKey);
    const allStakeAccounts = await connection.getMultipleAccountsInfo(stakeAccountPubkeys);
    allStakeAccounts.map(async (stakeAccount, i) => {
      const { data } = stakeAccount;
      if (data instanceof Buffer) {
        throw new Error("expected stake account, got Buffer");
      }
      // @ts-ignore
      expect(data.delegation.stake.toNumber()).to.be.above(0);

      // cleanup: send account to manager
      // 0 is stake authority, 1 is withdraw authority
      const transferAuthTxs = [0, 1].map((authType) => StakeProgram.authorize({
        authorizedPubkey: staker.publicKey,
        newAuthorizedPubkey: stakePool.account.data.manager,
        stakeAuthorizationType: { index: authType },
        stakePubkey: stakeAccountPubkeys[i],
      }));
      const tx = transferAuthTxs[1];
      tx.add(transferAuthTxs[0].instructions[0]);
      await connection.sendTransaction(tx, [stakerKeypair]);
    });

    // cleanup: delete temp accounts to be nice to testnet
    console.log("deleting scnSOL ATA...");
    await scnSolToken.closeAccount(scnSolAcct.address, staker.publicKey, stakerKeypair, []);
  });
});
