import { expect } from "chai";
import { clusterApiUrl, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Numberu64 } from '../src/stake-pool/types';
import { calcDropletsReceivedForSolDeposit, Socean } from '../src';
import { cleanupAllStakeAccs, MockWalletAdapter, prepareStaker } from './utils';
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

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


  it('it initializes devnet and gets stake pool account', async () => {
    const socean = new Socean('devnet');
    const res = await socean.getStakePoolAccount();
    expect(res.account.data.poolMint.toString()).to.eq("6JWhqnxxkqvmkr23yDpsL1atjeiF6jpNAtV8AozZN5Qq");
  })

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
      // 2. updateStakePool & cleanupRemovedValidators
      // 3. deposit
      expect(txs.length).to.eq(3);
    } else {
      console.log("Updated this epoch, transactions should not have updates");
      expect(txs.length).to.eq(1);
    }
  });

  describe('testnet executions', () => {
    let connection: Connection;
    let stakerKeypair: Keypair;
    let staker: MockWalletAdapter;
    let originalBalanceLamports: number;
    let scnSolMintPubkey: PublicKey;
    let scnSolToken: Token;
    let scnSolAtaPubkey: PublicKey;

    before(async () => {
      connection = new Connection(clusterApiUrl("testnet"));
      // prep wallet and airdrop SOL if necessary
      ({ stakerKeypair, staker, originalBalanceLamports } = await prepareStaker(connection, 0));
      console.log("staker:", staker.publicKey.toBase58());
      console.log("original balance:", originalBalanceLamports);

      const socean = new Socean();
      const stakePool = await socean.getStakePoolAccount();
      scnSolMintPubkey = stakePool.account.data.poolMint;
      scnSolToken = new Token(
        connection,
        scnSolMintPubkey,
        TOKEN_PROGRAM_ID,
        stakerKeypair,
      );
      scnSolAtaPubkey = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        scnSolMintPubkey,
        staker.publicKey,
      );
    });

    it('it deposits and withdraws on testnet', async () => {
      const socean = new Socean();
  
      // deposit 0.5 sol
      const depositAmountSol = 0.5;
      const depositAmount = depositAmountSol * LAMPORTS_PER_SOL;
      console.log("deposit amount:", depositAmount);
      const lastDepositTxId = (await socean.depositSol(staker, new Numberu64(depositAmount))).pop().pop();
      // wait until the last tx (deposit) is finalized
      await connection.confirmTransaction(lastDepositTxId, "finalized");
      console.log("deposit tx id: ", lastDepositTxId);
  
      // assert the balance decreased by ~0.5
      const afterDepositBalanceLamports = await connection.getBalance(staker.publicKey, "finalized");
      console.log("balance after deposit:", afterDepositBalanceLamports);
      expect(afterDepositBalanceLamports).to.be.below(originalBalanceLamports - depositAmountSol * LAMPORTS_PER_SOL);
  
      // assert scnSOL balance > 0
      let scnSolAcct = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
      const scnSolAmt = scnSolAcct.amount;
      expect(scnSolAmt.toNumber()).to.be.above(0);
  
      // withdraw all scnSOL
      const { transactionSignatures, stakeAccounts } = await socean.withdrawStake(staker, scnSolAmt);
      const lastWithdrawTxId = transactionSignatures.pop().pop();
      // wait until the last tx (withdraw) is finalized
      await connection.confirmTransaction(lastWithdrawTxId, "finalized");
  
      // assert scnSOL account empty
      scnSolAcct = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
      expect(scnSolAcct.amount.toNumber()).to.eq(0);
  
      // assert stake accounts present after withdrawal and have stake
      const stakeAccountPubkeys = stakeAccounts.map((stakeAccount) => stakeAccount.publicKey);
  
      const allStakeAccounts = await connection.getMultipleAccountsInfo(stakeAccountPubkeys);
      allStakeAccounts.map(async (stakeAccount, i) => {
        const { data } = stakeAccount;
        if (data instanceof Buffer) {
          throw new Error("expected stake account, got Buffer");
        }
        // stake account should be parsed, but no type available
        // @ts-ignore
        expect(data.delegation.stake.toNumber()).to.be.above(0);
      });
    });

    it("it calcDropletsReceivedForSolDeposit() matches actual droplets received", async () => {
      const socean = new Socean();
      const stakePool = await socean.getStakePoolAccount();
      let scnSolAtaAcctInfo = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
      const initialScnSolBalance = scnSolAtaAcctInfo.amount;

      // check using a random deposit of 0-0.25 SOL
      const depositAmountSol = Math.random() / 4;
      const depositAmount = Math.round(depositAmountSol * LAMPORTS_PER_SOL);
      const expectedDroplets = calcDropletsReceivedForSolDeposit(new Numberu64(depositAmount), stakePool.account.data);
      // TODO: if an epoch boundary crosses at this point
      // and depositSol() updates the stake pool, the new supply would not match and this test will fail...
      const lastDepositTxId = (await socean.depositSol(staker, new Numberu64(depositAmount))).pop().pop();
      // wait until the last tx (deposit) is finalized
      await connection.confirmTransaction(lastDepositTxId, "finalized");
      
      scnSolAtaAcctInfo = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
      expect(scnSolAtaAcctInfo.amount.toNumber()).to.eq(initialScnSolBalance.add(expectedDroplets).toNumber());
    });

    after(async () => {
      await cleanupAllStakeAccs(new Connection(clusterApiUrl("testnet")), stakerKeypair);
      // delete scnSOL ATA
      const scnSolAtaAcctInfo = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
      if (scnSolAtaAcctInfo.amount.gt(new Numberu64(0))) {
        console.log(`burning remaining ${scnSolAtaAcctInfo.amount.toNumber()} droplets...`);
        await scnSolToken.burn(scnSolAtaPubkey, stakerKeypair, [], scnSolAtaAcctInfo.amount);
      }
      console.log("deleting scnSOL ATA...");
      await scnSolToken.closeAccount(scnSolAtaPubkey, staker.publicKey, stakerKeypair, []);
    });
  })
});
