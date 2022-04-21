import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import assert from "assert";
import { expect } from "chai";

import {
  calcSolDeposit,
  calcSolDepositInverse,
  calcWithdrawals,
  calcWithdrawalsInverse,
  Socean,
  totalWithdrawLamports,
} from "@/socean";
import { Numberu64 } from "@/stake-pool/types";
import {
  cleanupAllStakeAccs,
  getStakeAccounts,
  MockWalletAdapter,
  prepareStaker,
} from "@/tests/utils";

describe("test basic functionalities", () => {
  it("it initializes and gets stake pool account", async () => {
    const socean = new Socean();
    const res = await socean.getStakePoolAccount();
    expect(res.account.data.poolMint.toString()).to.eq(
      "5oVNVwKYAGeFhvat29XFVH89oXNpLsV8uCPEqSooihsw",
    );
  });

  it("it initializes mainnet and gets stake pool account", async () => {
    const socean = new Socean("mainnet-beta");
    const res = await socean.getStakePoolAccount();
    expect(res.account.data.poolMint.toString()).to.eq(
      "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm",
    );
  });

  it("it initializes devnet and gets stake pool account", async () => {
    const socean = new Socean("devnet");
    const res = await socean.getStakePoolAccount();
    expect(res.account.data.poolMint.toString()).to.eq(
      "6JWhqnxxkqvmkr23yDpsL1atjeiF6jpNAtV8AozZN5Qq",
    );
  });

  it("it generates deposit sol tx", async () => {
    const socean = new Socean();
    const staker = Keypair.generate();
    const referrer = Keypair.generate();

    const tx = await socean.depositSolTransactions(
      staker.publicKey,
      new Numberu64(1),
      referrer.publicKey,
    );
    console.log(JSON.stringify(tx, null, 4));
  });

  it("it generates deposit stake tx", async () => {
    const socean = new Socean();
    const staker = Keypair.generate();
    const referrer = Keypair.generate();
    // this is an active stake acc owned by B2iHXo4KLEBx5Cm8jjrdpj6BsCjbzLFZxAf7BDqJ3y7y
    const testnetStakeAcc = new PublicKey(
      "Ch1rDUSoRNzQMAjQSwsjwsRJJmYFZBBJfUFsTuKezkXD",
    );

    const tx = await socean.depositStakeTransactions(
      staker.publicKey,
      testnetStakeAcc,
      referrer.publicKey,
    );
    console.log(JSON.stringify(tx, null, 4));
  });

  it("fails deposit stake tx invalid stake account", async () => {
    const socean = new Socean();
    const staker = Keypair.generate();
    const referrer = Keypair.generate();
    const invalidStakeAcc = Keypair.generate();

    await assert.rejects(
      async () => {
        await socean.depositStakeTransactions(
          staker.publicKey,
          invalidStakeAcc.publicKey,
          referrer.publicKey,
        );
      },
      {
        reason: "stake account does not exist",
      },
    );
  });

  it("it generates withdraw txs", async () => {
    const socean = new Socean();
    const staker = Keypair.generate();

    const txs = await socean.withdrawStakeTransactions(
      staker.publicKey,
      new Numberu64(1),
    );
    console.log(JSON.stringify(txs, null, 4));
  });

  it("it appends update txs", async () => {
    const socean = new Socean();
    const staker = Keypair.generate();

    const txs = await socean.depositSolTransactions(
      staker.publicKey,
      new Numberu64(1),
    );
    const {
      account: {
        data: { lastUpdateEpoch },
      },
    } = await socean.getStakePoolAccount();
    const { epoch } = await new Connection(
      clusterApiUrl("testnet"),
    ).getEpochInfo();
    if (lastUpdateEpoch.toNumber() < epoch) {
      console.log(
        "Not updated this epoch, transactions should contain updates",
      );
      // 1. updateValidatorListBalance
      // 2. updateStakePool & cleanupRemovedValidators
      // 3. deposit
      expect(txs.length).to.eq(3);
    } else {
      console.log("Updated this epoch, transactions should not have updates");
      expect(txs.length).to.eq(1);
    }
  });

  it("it calcSolDeposit() and calcSolDepositsInverse() works correctly", async () => {
    const socean = new Socean("testnet");
    const stakePool = await socean.getStakePoolAccount();

    const depositAmountSol = Math.random();
    const depositAmount = Math.round(depositAmountSol * LAMPORTS_PER_SOL);
    const depositAmountLamports = new Numberu64(depositAmount);
    const { dropletsReceived, dropletsFeePaid, referralFeePaid } =
      calcSolDeposit(depositAmountLamports, stakePool.account.data);

    const {
      lamportsStaked,
      dropletsFeePaid: inverseDropletsFeePaid,
      referralFeePaid: inverseReferralFeePaid,
    } = calcSolDepositInverse(dropletsReceived, stakePool.account.data);

    expect(
      depositAmountLamports.toNumber() - lamportsStaked.toNumber(),
    ).to.be.at.most(2);
    expect(dropletsFeePaid.toNumber()).to.eq(inverseDropletsFeePaid.toNumber());
    expect(referralFeePaid.toNumber()).to.eq(inverseReferralFeePaid.toNumber());
  });

  it("it calcWithdrawals() and calcWithdrawalsInverse() works correctly", async () => {
    const socean = new Socean("testnet");
    const stakePool = await socean.getStakePoolAccount();
    const validatorList = await socean.getValidatorListAccount(
      stakePool.account.data.validatorList,
    );

    const withdrawAmountDroplets = new Numberu64(
      Math.round(
        Math.random() * stakePool.account.data.poolTokenSupply.toNumber(),
      ),
    );

    const validatorWithdrawalReceipts = await calcWithdrawals(
      withdrawAmountDroplets,
      stakePool,
      validatorList.account.data,
    );

    const totalLamportsReceived: Numberu64 = totalWithdrawLamports(
      validatorWithdrawalReceipts,
    );

    const validatorWithdrawalReceiptsInverse = await calcWithdrawalsInverse(
      totalLamportsReceived,
      stakePool,
      validatorList.account.data,
    );

    let totalDropletsToUnstake: Numberu64 = new Numberu64(0);
    let totalLamportsReceivedInverse: Numberu64 = new Numberu64(0);

    // Accumulating two values, so just used forEach
    validatorWithdrawalReceiptsInverse.forEach((receipt) => {
      totalDropletsToUnstake = Numberu64.cloneFromBN(
        totalDropletsToUnstake.add(receipt.withdrawalReceipt.dropletsUnstaked),
      );
      totalLamportsReceivedInverse = Numberu64.cloneFromBN(
        totalLamportsReceivedInverse.add(
          receipt.withdrawalReceipt.lamportsReceived,
        ),
      );
    });

    expect(totalDropletsToUnstake.toNumber()).to.be.above(
      withdrawAmountDroplets.toNumber(),
    );
    expect(totalLamportsReceivedInverse.toNumber()).to.be.above(
      totalLamportsReceived.toNumber(),
    );
  });
});

describe("testnet executions", () => {
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
    ({ stakerKeypair, staker, originalBalanceLamports } = await prepareStaker(
      connection,
    ));
    console.log("staker:", staker.publicKey.toBase58());
    console.log("original balance:", originalBalanceLamports);

    const socean = new Socean("testnet");
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

  it("it deposits and withdraws on testnet", async () => {
    const socean = new Socean("testnet");

    // deposit 0.5 sol
    const depositAmountSol = 0.5;
    const depositAmount = depositAmountSol * LAMPORTS_PER_SOL;
    console.log("deposit amount:", depositAmount);
    const lastDepositTxId = (
      await socean.depositSol(staker, new Numberu64(depositAmount))
    )
      .pop()
      ?.pop();
    // wait until the last tx (deposit) is finalized
    await connection.confirmTransaction(lastDepositTxId!, "finalized");
    console.log("deposit tx id:", lastDepositTxId);

    // assert the balance decreased by ~0.5
    const afterDepositBalanceLamports = await connection.getBalance(
      staker.publicKey,
      "finalized",
    );
    console.log("balance after deposit:", afterDepositBalanceLamports);
    expect(afterDepositBalanceLamports).to.be.below(
      originalBalanceLamports - depositAmountSol * LAMPORTS_PER_SOL,
    );

    // assert scnSOL balance > 0
    let scnSolAcct = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
    const scnSolAmt = scnSolAcct.amount;
    expect(scnSolAmt.toNumber()).to.be.above(0);

    // withdraw all scnSOL
    const { transactionSignatures, stakeAccounts } = await socean.withdrawStake(
      staker,
      Numberu64.cloneFromBN(scnSolAmt),
    );
    const lastWithdrawTxId = transactionSignatures.pop()?.pop();
    // wait until the last tx (withdraw) is finalized
    await connection.confirmTransaction(lastWithdrawTxId!, "finalized");
    console.log("withdraw tx id:", lastWithdrawTxId);

    // assert scnSOL account empty
    scnSolAcct = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
    expect(scnSolAcct.amount.toNumber()).to.eq(0);

    // assert stake accounts present after withdrawal and have stake
    const stakeAccountPubkeys = stakeAccounts.map(
      (stakeAccount) => stakeAccount.publicKey,
    );
    const allStakeAccounts = await getStakeAccounts(
      connection,
      stakeAccountPubkeys,
    );
    allStakeAccounts.forEach((stakeAccount) => {
      expect(Number(stakeAccount.delegation.stake)).to.be.above(0);
    });
  });

  it("it calcSolDeposit() matches actual droplets received", async () => {
    const socean = new Socean("testnet");
    const stakePool = await socean.getStakePoolAccount();
    let scnSolAtaAcctInfo = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
    const initialScnSolBalance = scnSolAtaAcctInfo.amount;

    // check using a random deposit of 0-0.25 SOL
    const depositAmountSol = Math.random() / 4;
    const depositAmount = Math.round(depositAmountSol * LAMPORTS_PER_SOL);
    const depositAmountLamports = new Numberu64(depositAmount);
    const { dropletsReceived } = calcSolDeposit(
      depositAmountLamports,
      stakePool.account.data,
    );
    // TODO: if an epoch boundary crosses at this point
    // and depositSol() updates the stake pool, the new supply would not match and this test will fail...
    const lastDepositTxId = (
      await socean.depositSol(staker, depositAmountLamports)
    )
      .pop()
      ?.pop();
    // wait until the last tx (deposit) is finalized
    await connection.confirmTransaction(lastDepositTxId!, "finalized");

    scnSolAtaAcctInfo = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
    expect(scnSolAtaAcctInfo.amount.toNumber()).to.eq(
      initialScnSolBalance.add(dropletsReceived).toNumber(),
    );
  });

  it("it calcWithdrawals() matches actual lamports received", async () => {
    const socean = new Socean("testnet");
    const stakePool = await socean.getStakePoolAccount();
    const validatorList = await socean.getValidatorListAccount(
      stakePool.account.data.validatorList,
    );
    const scnSolAtaAcctInfo = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
    const initialBalanceDroplets = scnSolAtaAcctInfo.amount;

    // check using a random withdrawal of 0-initialScnSolBalance scnSOL
    const withdrawAmountDroplets = new Numberu64(
      Math.round(Math.random() * initialBalanceDroplets.toNumber()),
    );
    const validatorWithdrawalReceipts = await calcWithdrawals(
      withdrawAmountDroplets,
      stakePool,
      validatorList.account.data,
    );
    // TODO: if an epoch boundary crosses at this point
    // and withdrawStake() updates the stake pool, the new supply would not match and this test will fail...
    const { stakeAccounts, transactionSignatures } = await socean.withdrawStake(
      staker,
      withdrawAmountDroplets,
    );
    // wait until the last tx (withdraw) is finalized
    await connection.confirmTransaction(transactionSignatures.pop()?.pop()!);

    const expectedLamports = totalWithdrawLamports(validatorWithdrawalReceipts);

    const stakeAccountPubkeys = stakeAccounts.map(
      (stakeAccount) => stakeAccount.publicKey,
    );
    const allStakeAccounts = await getStakeAccounts(
      connection,
      stakeAccountPubkeys,
    );
    const lamportsReceived = allStakeAccounts.reduce(
      (accum, stakeAcc) => accum + Number(stakeAcc.delegation.stake),
      0,
    );
    expect(lamportsReceived).to.eq(expectedLamports.toNumber());
  });

  after(async () => {
    console.log("cleaning up stake accounts...");
    await cleanupAllStakeAccs(connection, stakerKeypair);
    // delete scnSOL ATA
    const scnSolAtaAcctInfo = await scnSolToken.getAccountInfo(scnSolAtaPubkey);
    if (scnSolAtaAcctInfo.amount.gt(new Numberu64(0))) {
      console.log(
        `burning remaining ${scnSolAtaAcctInfo.amount.toNumber()} droplets...`,
      );
      await scnSolToken.burn(
        scnSolAtaPubkey,
        stakerKeypair,
        [],
        scnSolAtaAcctInfo.amount,
      );
    }
    console.log("deleting scnSOL ATA...");
    await scnSolToken.closeAccount(
      scnSolAtaPubkey,
      staker.publicKey,
      stakerKeypair,
      [],
    );
  });
});
