import { AccountInfo, PublicKey } from "@solana/web3.js";
import * as schema from "./schema";

export interface StakePoolAccount {
  publicKey: PublicKey;
  account: AccountInfo<schema.StakePool>;
}

//export interface ValidatorListAccount {
//  publicKey: PublicKey;
//  account: AccountInfo<schema.ValidatorList>;
//}

