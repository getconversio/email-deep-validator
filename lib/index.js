'use strict';

const dns = require('dns'),
  net = require('net');

class EmailValidator {
  constructor(options = { }) {
    this.options = Object.assign({
      timeout: 10000,
      verifyMxRecords: true,
      verifySmtpConnection: true
    }, options);
  }

  verify(address) {
    const domain = EmailValidator.extractDomain(address);

    return Promise.resolve()
      .then(() => {
        if (!this.options.verifyMxRecords) return;

        return EmailValidator.resolveMxRecords(address)
          .then(mxRecords => {
            if (mxRecords.length === 0) throw new Error('No MX records found for ' + domain);

            if (!this.options.verifySmtpConnection) return;

            return this.checkViaSmtp(address);
          });
      });
  }

  checkViaSmtp(address) {
    const domain = EmailValidator.extractDomain(address);

    return EmailValidator.resolveMxRecords(address)
      .then(mxRecords => {
        return new Promise((resolve, reject) => {
          const socket = net.connect(25, mxRecords[0]);

          const errorHandler = message => {
            socket.write('QUIT\r\n');
            socket.end();

            reject(new Error('Got an error from the server: ' + message));
          };

          const messages = [
            `EHLO ${domain}`,
            `MAIL FROM: <${address}>`,
            `RCPT TO: <${address}>`
          ];

          socket.on('data', data => {
            data = data.toString();

            if (!data.includes(220) && !data.includes(250)) return errorHandler(data);

            if (messages.length > 0) {
              return socket.write(messages.shift() + '\r\n');
            }

            socket.write('QUIT\r\n');
            socket.end();

            resolve();
          });
          socket.on('error', err => reject(err));

          setTimeout(() => reject(new Error('Connection timed out')), this.options.timeout);
        });
      });
  }

  static isEmail(address) {
    return address.includes('@');
  }

  static extractDomain(address) {
    if (!EmailValidator.isEmail(address)) {
      throw new Error(`"${address}" is not a valid email address`);
    }

    return address.split('@')[1];
  }

  static resolveMxRecords(address) {
    const domain = EmailValidator.extractDomain(address);

    return new Promise((resolve, reject) => {
      dns.resolveMx(domain, (err, records) => {
        if (err) return reject(err);

        records = records.sort((a, b) => a.priority > b.priority)
          .map(record => record.exchange);

        resolve(records);
      });
    });
  }
}

module.exports = EmailValidator;
