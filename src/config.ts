/**
 * SoceanConfig class
 *
 * @module
 */
import {
  Connection,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";

const MAINNET_STAKEPOOL_ACCOUNT_STR = "5oc4nmbNTda9fx8Tw57ShLD132aqDK65vuHH4RU1K4LZ";
const TESTNET_STAKEPOOL_ACCOUNT_STR = '5oc4nDMhYqP8dB5DW8DHtoLJpcasB19Tacu3GWAMbQAC';

export type ClusterType = 'mainnet-beta' | 'testnet';

export class SoceanConfig {
    stakePoolAccountPubkey: PublicKey;
    connection: Connection;

    constructor(clusterType: ClusterType) {
        if (clusterType == 'testnet') {
            this.stakePoolAccountPubkey = new PublicKey(TESTNET_STAKEPOOL_ACCOUNT_STR);
        } else if (clusterType == 'mainnet-beta') {
            this.stakePoolAccountPubkey = new PublicKey(MAINNET_STAKEPOOL_ACCOUNT_STR);
        }
        this.connection = new Connection(clusterApiUrl(clusterType));
    }
}
