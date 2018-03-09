'use strict';

const dns = require('dns'),
  net = require('net');

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
    !/(junk|spam)/ig.test(smtpReply)
  ) return true;

  return false;
};

class EmailValidator {
  constructor(options = { }) {
    this.options = Object.assign({
      timeout: 10000,
      verifyDomain: true,
      verifyMailbox: true
    }, options);
  }

  async verify(address) {
    const result = { wellFormed: false, validDomain: null, validMailbox: null };
    let local;
    let domain;
    let mxRecords;

    try {
      [local, domain] = EmailValidator.extractAddressParts(address);
    } catch (err) {
      return result;
    }

    result.wellFormed = true;

    // save a DNS call
    if (!this.options.verifyDomain && !this.options.verifyMailbox) return result;

    try {
      mxRecords = await EmailValidator.resolveMxRecords(domain);
    } catch (err) {
      mxRecords = [];
    }

    if (this.options.verifyDomain) {
      result.validDomain = mxRecords && mxRecords.length > 0;
    }

    if (this.options.verifyMailbox) {
      result.validMailbox = await EmailValidator.verifyMailbox(
        local, domain, mxRecords, this.options.timeout
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

  static async verifyMailbox(local, domain, [mxRecord], timeout) {
    if (!mxRecord || /yahoo/.test(mxRecord)) return null; // cannot verify

    return new Promise(resolve => {
      const socket = net.connect(25, mxRecord);

      const ret = result => {
        if (ret.resolved) return;

        socket.write('QUIT\r\n');
        socket.end();
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

        if (isInvalidMailboxError(data)) return ret(false);
        if (!data.includes(220) && !data.includes(250)) return ret(null);

        if (messages.length > 0) return socket.write(messages.shift() + '\r\n');

        ret(true);
      });

      socket.on('error', () => ret(null));

      setTimeout(() => ret(null), timeout);
    });
  }
}

module.exports = EmailValidator;
