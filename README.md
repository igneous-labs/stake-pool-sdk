# <p align="center"><a href="https://socean.fi/"><img src="https://raw.githubusercontent.com/lieuzhenghong/socean/master/src/frontend/socean-frontend/public/logos/horizontalLogo_black.png?token=GHSAT0AAAAAABNUAKFF3WQBV5FKGFXWMAZKYQLI6FQ" height="100" alt="Socean"></a>

# Socean Stake Pool Typescript SDK

(TODO: a brief brand intro copy)

This SDK provide a client to interact with the staking protocol and allows you to stake and unstake through socean stake pool within your applications.

(TODO: badges for project license, discord, npm version, size on npm)

![Build]( https://github.com/igneous-labs/stake-pool-sdk/actions/workflows/main.yml/badge.svg)
[![Discord](https://img.shields.io/discord/852171430089981982?label=discord&style=plastic)](https://discord.com/invite/socean)
[![Twitter](https://img.shields.io/twitter/follow/soceanfinance?style=social)](https://twitter.com/SoceanFinance)

Contents:
- [Installation](#installation)
- [Examples](#examples)
   - [Initialization](#initialization)
   - [Stake SOL and receive scnSOL](#stake-sol-and-receive-scnsol)
   - [UnStake scnSOL and receive SOL](#unstake-scnsol-and-receive-sol)
- [Learn more](#learn-more)


## Installation
### npm
```bash
$ npm install @soceanfi/stake-pool-sdk
```

### yarn
```bash
$ yarn add @soceanfi/stake-pool-sdk
```

## Examples

### Initialization

Import the main client class `Socean` and initialize it with the desired cluster type:
```ts
import { Socean } from '@soceanfi/stake-pool-sdk';

// initializes for mainnet-beta
const socean = new Socean('mainnet-beta');

// or for testnet
const socean = new Socean(); // or give 'testnet' as the argument
```


### Retreive on-chain state
```ts
const stakePoolAccount = socean.getStakePoolAccount();
```


### Stake SOL and Receive scnSOL

Frontend (react example):

```tsx
import { Socean, Numberu64 } from '@soceanfi/stake-pool-sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { FC } from 'react';

const socean = new Socean('mainnet-beta');

const StakeOneLamportWithSoceanButton: FC = () => {
   const wallet = useWallet();

   const onClick = async () => {
      const signatures = await socean.depositSol(
         wallet,
         new Numberu64(1),
      );
   }

   return (
      <button onClick={onClick}>
         Stake one lamport with Socean
      </button>
   );
}

```


### Unstake scnSOL and Receive SOL

Frontend (react example):

```tsx
import { Socean, Numberu64 } from '@soceanfi/stake-pool-sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { FC } from 'react';

const socean = new Socean('mainnet-beta');

const WithdrawOneDropletFromSoceanButton: FC = () => {
   const wallet = useWallet();

   const onClick = async () => {
      const { transactionSignatures, stakeAccounts } = await socean.withdrawStake(
         wallet,
         new Numberu64(1),
      );
   }

   return (
      <button onClick={onClick}>
         Withdraw one droplet (1 / 10 ** 9 scnSOL) from Socean
      </button>
   );
}
```


## Learn more
- [Socean stake pool](https://socean.fi)
- [Socean stake pool documentation](https://docs.socean.fi/)
