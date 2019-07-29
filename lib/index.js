'use strict';

const dns = require('dns'),
  net = require('net'),
  logger = require('./logger');

const ninvoke = (module, fn, ...args) => new Promise((resolve, reject) => {
  module[fn](...args, (err, res) => {
    if (err) return reject(err);
    resolve(res);
  });
});

/**
 * @see http://www.serversmtp.com/en/smtp-error
 * @param  {String} smtpReply A response from the SMTP server.
 * @return {Bool}             True if the error is recognized as a mailbox
 *                            missing error.
 */
const isInvalidMailboxError = smtpReply => {
  if (
    smtpReply &&
    /^(510|511|513|550|551|553)/.test(smtpReply) &&
    !/(junk|spam|openspf|spoofing|host|rbl.+blocked)/ig.test(smtpReply)
  ) return true;

  return false;
};

/**
 * @see https://www.ietf.org/mail-archive/web/ietf-smtp/current/msg06344.html
 * @param  {String}  smtpReply A message from the SMTP server.
 * @return {Boolean}           True if this is a multiline greet.
 */
const isMultilineGreet = smtpReply => {
  return smtpReply && /^(250|220)-/.test(smtpReply);
};

class EmailValidator {
  constructor(options = { }) {
    this.options = Object.assign({
      timeout: 10000,
      verifyDomain: true,
      verifyMailbox: true
    }, options);

    this.log = options.logger || logger;
  }

  async verify(address) {
    const result = { wellFormed: false, validDomain: null, validMailbox: null };
    let local;
    let domain;
    let mxRecords;

    try {
      [local, domain] = EmailValidator.extractAddressParts(address);
    } catch (err) {
      this.log.debug('Failed on wellFormed check', err);
      return result;
    }

    result.wellFormed = true;

    // save a DNS call
    if (!this.options.verifyDomain && !this.options.verifyMailbox) return result;

    try {
      mxRecords = await EmailValidator.resolveMxRecords(domain);
      this.log.debug('Found MX records', mxRecords);
    } catch (err) {
      this.log.debug('Failed to resolve MX records', err);
      mxRecords = [];
    }

    if (this.options.verifyDomain) {
      result.validDomain = mxRecords && mxRecords.length > 0;
    }

    if (this.options.verifyMailbox) {
      result.validMailbox = await EmailValidator.verifyMailbox(
        local, domain, mxRecords, this.options.timeout, this.log
      );
    }

    return result;
  }

  static isEmail(address) {
    return address.includes('@');
  }

  static extractAddressParts(address) {
    if (!EmailValidator.isEmail(address)) {
      throw new Error(`"${address}" is not a valid email address`);
    }

    return address.split('@');
  }

  static async resolveMxRecords(domain) {
    const records = await ninvoke(dns, 'resolveMx', domain);
    records.sort((a, b) => a.priority > b.priority);
    return records.map(record => record.exchange);
  }

  static async verifyMailbox(local, domain, [mxRecord], timeout, log) {
    if (!mxRecord || /yahoo/.test(mxRecord)) {
      log.debug('Cannot verify due to missing or unsupported MX record', mxRecord);
      return null;
    }

    return new Promise(resolve => {
      const socket = net.connect(25, mxRecord);
      let resTimeout;

      const ret = result => {
        if (ret.resolved) return;

        if (!socket.destroyed) {
          socket.write('QUIT\r\n');
          socket.end();
        }

        clearTimeout(resTimeout);
        resolve(result);
        ret.resolved = true;
      };

      const messages = [
        `HELO ${domain}`,
        `MAIL FROM: <${local}@${domain}>`,
        `RCPT TO: <${local}@${domain}>`
      ];

      socket.on('data', data => {
        data = data.toString();

        log.debug('Mailbox: got data', data);

        if (isInvalidMailboxError(data)) return ret(false);
        if (!data.includes(220) && !data.includes(250)) return ret(null);

        if (isMultilineGreet(data)) return;

        if (messages.length > 0) {
          const message = messages.shift();
          log.debug('Mailbox: writing message', message);
          return socket.write(message + '\r\n');
        }

        ret(true);
      });

      socket.on('error', err => {
        log.debug('Mailbox: error in socket', err);
        ret(null);
      });

      resTimeout = setTimeout(() => {
        log.debug(`Mailbox: timed out (${timeout} ms)`);
        ret(null);
      }, timeout);
    });
  }
}

module.exports = EmailValidator;
