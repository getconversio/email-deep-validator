import { Options, ResultValue, VerifyResult } from './types';
import { Logger } from './logger';
import { RootLogger } from 'loglevel';
import dns from 'dns';
import net from 'net';

type CallbackFn<T, R, E> = (
  param: T,
  callback: (err: E | null, result: R) => void
) => void;

function ninvoke<T, R, E>(fn: CallbackFn<T, R, E>, params: T): Promise<R> {
  return new Promise((resolve, reject) => {
    fn(params, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

const isInvalidMailboxError = (smtpReply: string): boolean => {
  if (
    smtpReply &&
    /^(510|511|513|550|551|553)/.test(smtpReply) &&
    !/(junk|spam|openspf|spoofing|host|rbl.+blocked)/gi.test(smtpReply)
  )
    return true;

  return false;
};

const isMultilineGreet = (smtpReply: string): boolean => {
  return !!smtpReply && /^(250|220)-/.test(smtpReply);
};

export class EmailValidator {
  defaultOptions: Options = {
    timeout: 10000,
    verifyDomain: true,
    verifyMailbox: true,
  };
  options: Options;
  log: RootLogger;

  constructor(options?: Options) {
    this.options = { ...this.defaultOptions, ...options };
    this.log = options?.logger || Logger;
  }

  async verify(address: string): Promise<VerifyResult> {
    const result: VerifyResult = {
      wellFormed: ResultValue.INVALID,
      validDomain: ResultValue.UNKNOWN,
      validMailbox: ResultValue.UNKNOWN,
    };
    let local: string;
    let domain: string;
    let mxRecords: string[];

    try {
      [local, domain] = EmailValidator.extractAddressParts(address);
    } catch (err) {
      this.log.debug('Failed on wellFormed check', err);
      return result;
    }

    result.wellFormed = ResultValue.VALID;

    // save a DNS call
    if (!this.options.verifyDomain && !this.options.verifyMailbox)
      return result;

    try {
      mxRecords = await EmailValidator.resolveMxRecords(domain);
      this.log.debug('Found MX records', mxRecords);
    } catch (err) {
      this.log.debug('Failed to resolve MX records', err);
      mxRecords = [];
    }

    if (this.options.verifyDomain) {
      result.validDomain =
        mxRecords && mxRecords.length > 0
          ? ResultValue.VALID
          : ResultValue.INVALID;
    }

    if (this.options.verifyMailbox) {
      result.validMailbox = await EmailValidator.verifyMailbox(
        local,
        domain,
        mxRecords,
        this.options.timeout,
        this.log
      );
    }

    return result;
  }

  static isEmail(address: string): boolean {
    //return address.includes('@');
    return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(
      address
    );
  }

  static extractAddressParts(address: string): string[] {
    if (!EmailValidator.isEmail(address)) {
      throw new Error(`"${address}" is not a valid email address`);
    }

    return address.split('@');
  }

  static async resolveMxRecords(domain: string): Promise<string[]> {
    const records = await ninvoke(dns.resolveMx, domain);
    records.sort((a, b) => (a.priority > b.priority ? 1 : -1));
    return records.map((record) => record.exchange);
  }

  static async verifyMailbox(
    local: string,
    domain: string,
    [mxRecord]: string[],
    timeout: number | undefined,
    log: RootLogger
  ): Promise<ResultValue> {
    if (!mxRecord || /yahoo/.test(mxRecord)) {
      log.debug(
        'Cannot verify due to missing or unsupported MX record',
        mxRecord
      );
      return ResultValue.UNKNOWN;
    }

    return new Promise((resolve) => {
      const socket = net.connect(25, mxRecord);
      // eslint-disable-next-line prefer-const
      let resTimeout: NodeJS.Timeout;
      let retFlag = false;

      const ret = (result: ResultValue): void => {
        if (retFlag) return;

        if (!socket.destroyed) {
          socket.write('QUIT\r\n');
          socket.end();
        }

        clearTimeout(resTimeout);
        resolve(result);
        retFlag = true;
      };

      const messages = [
        `HELO ${domain}`,
        `MAIL FROM: <${local}@${domain}>`,
        `RCPT TO: <${local}@${domain}>`,
      ];

      socket.on('data', (data) => {
        const sData = data.toString();

        log.debug('Mailbox: got data', sData);

        if (isInvalidMailboxError(sData)) return ret(ResultValue.INVALID);
        if (!sData.includes('220') && !data.includes('250'))
          return ret(ResultValue.UNKNOWN);

        if (isMultilineGreet(sData)) return;

        if (messages.length > 0) {
          const message = messages.shift();
          log.debug('Mailbox: writing message', message);
          return socket.write(message + '\r\n');
        }

        ret(ResultValue.VALID);
      });

      socket.on('error', (err) => {
        log.debug('Mailbox: error in socket', err);
        ret(ResultValue.UNKNOWN);
      });

      resTimeout = setTimeout(() => {
        log.debug(`Mailbox: timed out (${timeout} ms)`);
        ret(ResultValue.UNKNOWN);
      }, timeout);
    });
  }
}
