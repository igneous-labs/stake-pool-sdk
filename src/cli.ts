#!/usr/bin/env node
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { Socean } from '.';

const SOCEAN = new Socean();

const getStakePoolAccount = async (argv) => {
    if (argv.verbose) {
        console.info('fetching Socean stake pool account info');
    }
    console.log(await SOCEAN.getStakePoolAccount());
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noOp = () => {}; // used to indicate "no operation" for arg parsing

yargs(hideBin(process.argv))
    .strict()
    .help('h')
    .alias('h', 'help')
    .command('get-stakepool-account', 'fetch the stake-pool account info', noOp, getStakePoolAccount)
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      description: 'Run with verbose logging'
    })
    .parse();
