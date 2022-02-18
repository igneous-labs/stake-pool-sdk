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

const TESTNET_STAKEPOOL_ACCOUNT = '5oc4nDMhYqP8dB5DW8DHtoLJpcasB19Tacu3GWAMbQAC';
const TESTNET_STAKEPOOL_PROGRAM_ID = "5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx";

const MAINNET_STAKEPOOL_ACCOUNT = "5oc4nmbNTda9fx8Tw57ShLD132aqDK65vuHH4RU1K4LZ";
const MAINNET_STAKEPOOL_PROGRAM_ID = "5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx";

export type ClusterType = 'mainnet-beta' | 'testnet';

/**
 */
export class SoceanConfig {
    stakePoolAccountPubkey: PublicKey;
    stakePoolProgramId: PublicKey;
    connection: Connection;

    constructor(clusterType: ClusterType, rpcEndpoint?: string) {
        if (clusterType == 'testnet') {
            this.stakePoolAccountPubkey = new PublicKey(TESTNET_STAKEPOOL_ACCOUNT);
            this.stakePoolProgramId = new PublicKey(TESTNET_STAKEPOOL_PROGRAM_ID);
        } else if (clusterType == 'mainnet-beta') {
            this.stakePoolAccountPubkey = new PublicKey(MAINNET_STAKEPOOL_ACCOUNT);
            this.stakePoolProgramId = new PublicKey(MAINNET_STAKEPOOL_PROGRAM_ID);
        }
        this.connection = new Connection(rpcEndpoint ?? clusterApiUrl(clusterType));
    }
}
