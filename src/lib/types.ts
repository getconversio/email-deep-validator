import { RootLogger } from 'loglevel';

export enum ResultValue {
  VALID,
  INVALID,
  UNKNOWN,
}

export interface Options {
  timeout?: number;
  verifyDomain?: boolean;
  verifyMailbox?: boolean;
  logger?: RootLogger;
}

export interface VerifyResult {
  wellFormed: ResultValue;
  validDomain: ResultValue;
  validMailbox: ResultValue;
}
