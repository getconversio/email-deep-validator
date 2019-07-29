'use strict';

const chai = require('chai'),
  sinon = require('sinon'),
  dns = require('dns'),
  net = require('net'),
  EmailValidator = require('../lib');

chai.should();
const should = chai.expect;

describe('lib/index', () => {
  const self = { };

  beforeEach(() => {
    self.sandbox = sinon.createSandbox();
    self.validator = new EmailValidator();
    self.defaultOptions = new EmailValidator().options;
  });

  afterEach(() => self.sandbox.restore());

  const stubResolveMx = (domain = 'foo.com') => {
    self.resolveMxStub = self.sandbox.stub(dns, 'resolveMx')
      .yields(null, [
        { exchange: `mx1.${domain}`, priority: 30 },
        { exchange: `mx2.${domain}`, priority: 10 },
        { exchange: `mx3.${domain}`, priority: 20 }
      ]);
  };

  const stubSocket = () => {
    self.socket = new net.Socket({ });

    self.sandbox.stub(self.socket, 'write').callsFake(function(data) {
      if (!data.includes('QUIT')) this.emit('data', '250 Foo');
    });

    self.connectStub = self.sandbox.stub(net, 'connect').returns(self.socket);
  };

  describe('.constructor', () => {
    it('should create an instance of EmailValidator', () => {
      const validator = new EmailValidator();
      validator.should.be.an.instanceof(EmailValidator);
      validator.options.should.deep.equal(self.defaultOptions);
    });

    it('should be possible to override options', () => {
      const validator = new EmailValidator({ timeout: 5000 });
      validator.options.timeout.should.equal(5000);
      validator.options.verifyDomain.should.equal(self.defaultOptions.verifyDomain);
    });
  });

  describe('#verify', () => {
    beforeEach(() => {
      stubResolveMx();
      stubSocket();
    });

    it('should perform all tests', () => {
      setTimeout(() => self.socket.write('250 Foo'), 10);

      return self.validator.verify('foo@bar.com')
        .then(({ wellFormed, validDomain, validMailbox }) => {
          sinon.assert.called(self.resolveMxStub);
          sinon.assert.called(self.connectStub);
          should(wellFormed).equal(true);
          should(validDomain).equal(true);
          should(validMailbox).equal(true);
        });
    });

    it('returns immediately if email is malformed invalid', () => {
      return self.validator.verify('bar.com')
        .then(({ wellFormed, validDomain, validMailbox }) => {
          sinon.assert.notCalled(self.resolveMxStub);
          sinon.assert.notCalled(self.connectStub);
          should(wellFormed).equal(false);
          should(validDomain).equal(null);
          should(validMailbox).equal(null);
        });
    });

    describe('mailbox verification', () => {
      it('returns true when maibox exists', () => {
        setTimeout(() => self.socket.write('250 Foo'), 10);
        return self.validator.verify('bar@foo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(true));
      });

      it('returns null if mailbox is yahoo', () => {
        self.resolveMxStub.restore();
        stubResolveMx('yahoo.com');

        setTimeout(() => self.socket.write('250 Foo'), 10);

        return self.validator.verify('bar@yahoo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(null));
      });

      it('should return null on socket error', () => {
        const socket = {
          on: (event, callback) => {
            if (event === 'error') return callback(new Error());
          },
          write: () => {},
          end: () => {}
        };

        self.connectStub = self.connectStub.returns(socket);

        return self.validator.verify('bar@foo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(null));
      });

      it('dodges multiline spam detecting greetings', () => {
        const socket = new net.Socket({ });
        let greeted = false;

        self.sandbox.stub(socket, 'write').callsFake(function (data) {
          if (!data.includes('QUIT')) {
            if (!greeted) return this.emit('data', '550 5.5.1 Protocol Error');
            this.emit('data', '250 Foo');
          }
        });

        self.connectStub.returns(socket);

        setTimeout(() => {
          // the "-" indicates a multi line greeting
          socket.emit('data', '220-hohoho');

          // wait a bit and send the rest
          setTimeout(() => {
            greeted = true;
            socket.emit('data', '220 ho ho ho');
          }, 1000);
        }, 10);

        return self.validator.verify('bar@foo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(true));
      });

      it('regression: does not write infinitely if there is a socket error', () => {
        const writeSpy = self.sandbox.spy();
        const endSpy = self.sandbox.spy();

        const socket = {
          on: (event, callback) => {
            if (event === 'error') {
              return setTimeout(() => {
                socket.destroyed = true;
                callback(new Error());
              }, 100);
            };
          },
          write: writeSpy,
          end: endSpy
        };

        self.connectStub = self.connectStub.returns(socket);

        return self.validator.verify('bar@foo.com')
          .then(() => {
            sinon.assert.notCalled(writeSpy);
            sinon.assert.notCalled(endSpy);
          });
      });

      it('should return null on unknown SMTP errors', () => {
        const socket = new net.Socket({ });

        self.sandbox.stub(socket, 'write').callsFake(function(data) {
          if (!data.includes('QUIT')) this.emit('data', '500 Foo');
        });

        self.connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        return self.validator.verify('bar@foo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(null));
      });

      it('returns false on bad mailbox errors', () => {
        const socket = new net.Socket({ });

        self.sandbox.stub(socket, 'write').callsFake(function(data) {
          if (!data.includes('QUIT')) this.emit('data', '550 Foo');
        });

        self.connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        return self.validator.verify('bar@foo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(false));
      });

      it('returns null on spam errors', () => {
        const msg = '550-"JunkMail rejected - ec2-54-74-157-229.eu-west-1.compute.amazonaws.com';
        const socket = new net.Socket({ });

        self.sandbox.stub(socket, 'write').callsFake(function(data) {
          if (!data.includes('QUIT')) this.emit('data', msg);
        });

        self.connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        return self.validator.verify('bar@foo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(null));
      });

      it('returns null on spam errors-#2', () => {
        const msg = '553 5.3.0 flpd575 DNSBL:RBL 521< 54.74.114.115 >_is_blocked.For assistance forward this email to abuse_rbl@abuse-att.net';
        const socket = new net.Socket({ });

        self.sandbox.stub(socket, 'write').callsFake(function(data) {
          if (!data.includes('QUIT')) this.emit('data', msg);
        });

        self.connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        return self.validator.verify('bar@foo.com')
          .then(({ validMailbox }) => should(validMailbox).equal(null));
      });
    });

    context('given no mx records', () => {
      beforeEach(() => {
        self.resolveMxStub.yields(null, []);
      });

      it('should return false on the domain verification', () => {
        return self.validator.verify('foo@bar.com')
          .then(({ validDomain, validMailbox }) => {
            should(validDomain).equal(false);
            should(validMailbox).equal(null);
          });
      });
    });

    context('given a verifyMailbox option false', () => {
      beforeEach(() => {
        self.validator = new EmailValidator({ verifyMailbox: false });
      });

      it('should not check via socket', () => {
        return self.validator.verify('foo@bar.com')
          .then(({ validMailbox }) => {
            sinon.assert.called(self.resolveMxStub);
            sinon.assert.notCalled(self.connectStub);
            should(validMailbox).equal(null);
          });
      });
    });

    context('given a verifyDomain option false', () => {
      beforeEach(() => {
        self.validator = new EmailValidator({
          verifyDomain: false,
          verifyMailbox: false
        });
      });

      it('should not check via socket', () => {
        return self.validator.verify('foo@bar.com')
          .then(({ validDomain, validMailbox }) => {
            sinon.assert.notCalled(self.resolveMxStub);
            sinon.assert.notCalled(self.connectStub);
            should(validDomain).equal(null);
            should(validMailbox).equal(null);
          });
      });
    });
  });

  describe('resolveMxRecords', () => {
    beforeEach(() => stubResolveMx());

    it('should return a list of mx records, ordered by priority', () => {
      return EmailValidator.resolveMxRecords('bar@foo.com')
        .then(records => {
          records.should.deep.equal(['mx2.foo.com', 'mx3.foo.com', 'mx1.foo.com']);
        });
    });
  });

  describe('isEmail', () => {
    it('should validate a correct address', () => {
      EmailValidator.isEmail('foo@bar.com').should.equal(true);
    });

    it('should return false for an invalid address', () => {
      EmailValidator.isEmail('bar.com').should.equal(false);
    });
  });

  describe('extractAddressParts', () => {
    it('should local + domain parts of an email address', () => {
      EmailValidator.extractAddressParts('foo@bar.com').should.eql(['foo', 'bar.com']);
    });

    it('should throw an error if the email is not valid', () => {
      (() => EmailValidator.extractDomain('foo')).should.throw(Error);
    });
  });
});
