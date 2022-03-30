/**
 * JSON parsed stake account
 * Partial, just contains the fields that we need
 */
export interface ParsedStakeAccount {
  info: {
    stake: {
      delegation: {
        voter?: string;
      };
    };
  };
}
