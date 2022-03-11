# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.0] - 2022-03-10
### Changed
 - support for large withdrawal
 - `Socean` constructor to accept optional web3 connection or custom rpc url
 - `SoceanConfig` to be public

### Added
 - types for bn.js
 - devnet support
 - `WithdrawalUnserviceableError` to accept description string `reason`
 - types:
   - `ConfirmOptions` (default preflightCommitment: "processed", commitment: "confirmed")
   - `DepositReceipt`
   - `WithdrawalReceipt`
   - `ValidatorWithdrawalReceipt`
 - utils:
   - `calcSolDeposit`
   - `calcStakeDeposit`
   - `stakeAvailableToWithdraw`



## [0.1.2] - 2022-02-15
### Fixed
 - esm module export
 - build procedure


## [0.1.1] - 2022-02-13
### Changed
 - update dependency `@types/node`: `17.0.10` -> `17.0.18`
 - update dependency `mocha`: `9.1.4` -> `9.2.0`
 - update dependency `ts-node`: `10.4.0` -> `10.5.0`


## [0.1.0] - 2022-02-13
### Added
TODO: intial spec list
