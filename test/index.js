'use strict';

const chai = require('chai'),
  sinon = require('sinon'),
  dns = require('dns'),
  net = require('net'),
  EmailValidator = require('../lib');

chai.should();

describe('lib/index', () => {
  const self = { };

  beforeEach(() => {
    self.sandbox = sinon.sandbox.create();
    self.validator = new EmailValidator();
    self.defaultOptions = new EmailValidator().options;
  });

  afterEach(() => self.sandbox.restore());

  const stubResolveMx = () => {
    self.resolveMxStub = self.sandbox.stub(dns, 'resolveMx')
      .yields(null, [
        { exchange: 'mx1.foo.com', priority: 30 },
        { exchange: 'mx2.foo.com', priority: 10 },
        { exchange: 'mx3.foo.com', priority: 20 }
      ]);
  };

  const stubSocket = () => {
    self.socket = new net.Socket({ });

    self.sandbox.stub(self.socket, 'write', function(data) {
      if (!data.includes('QUIT')) this.emit('data', '250 Foo');
    });

    self.connectStub = self.sandbox.stub(net, 'connect')
      .returns(self.socket);
  };

  describe('constructor', () => {
    it('should create an instance of EmailValidator', () => {
      const validator = new EmailValidator();
      validator.should.be.an.instanceof(EmailValidator);
      validator.options.should.deep.equal(self.defaultOptions);
    });

    it('should be possible to override options', () => {
      const validator = new EmailValidator({ timeout: 5000 });
      validator.options.timeout.should.equal(5000);
      validator.options.verifyMxRecords.should.equal(self.defaultOptions.verifyMxRecords);
    });
  });

  describe('verify', () => {
    beforeEach(() => {
      stubResolveMx();
      stubSocket();
    });

    it('should perform all tests', () => {
      setTimeout(() => self.socket.write('250 Foo'), 10);

      return self.validator.verify('foo@bar.com')
        .then(() => {
          sinon.assert.called(self.resolveMxStub);
          sinon.assert.called(self.connectStub);
        });
    });

    context('given no mx records', () => {
      beforeEach(() => {
        self.resolveMxStub.yields(null, []);
      });

      it('should throw an error', () => {
        return self.validator.verify('foo@bar.com')
          .then(() => Promise.reject('You shall not pass!'))
          .catch(err => err.should.be.an.instanceof(Error));
      });
    });

    context('given a verifySmtpConnection option false', () => {
      beforeEach(() => {
        self.validator = new EmailValidator({
          verifySmtpConnection: false
        });
      });

      it('should not check via socket', () => {
        return self.validator.verify('foo@bar.com')
          .then(() => {
            sinon.assert.called(self.resolveMxStub);
            sinon.assert.notCalled(self.connectStub);
          });
      });
    });

    context('given a verifyMxRecords option false', () => {
      beforeEach(() => {
        self.validator = new EmailValidator({
          verifyMxRecords: false,
          verifySmtpConnection: false
        });
      });

      it('should not check via socket', () => {
        return self.validator.verify('foo@bar.com')
          .then(() => {
            sinon.assert.notCalled(self.resolveMxStub);
            sinon.assert.notCalled(self.connectStub);
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

    it('should return false for an invalid address', () => {
      (() => EmailValidator.resolveMxRecords('bar.com')).should.throw(Error);
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

  describe('extractDomain', () => {
    it('should return the domain part of an email address', () => {
      EmailValidator.extractDomain('foo@bar.com').should.equal('bar.com');
    });

    it('should throw an error if the email is not valid', () => {
      (() => EmailValidator.extractDomain('foo')).should.throw(Error);
    });
  });

  describe('checkViaSmtp', () => {
    beforeEach(() => {
      stubResolveMx();
      stubSocket();
    });

    it('should resolve for a valid address', () => {
      setTimeout(() => self.socket.write('250 Foo'), 10);

      return self.validator.checkViaSmtp('bar@foo.com');
    });

    it('should throw an error on socket error', () => {
      const socket = {
        on: (event, callback) => {
          if (event === 'error') return callback(new Error());
        }
      };

      self.connectStub = self.connectStub.returns(socket);

      return self.validator.checkViaSmtp('bar@foo.com')
        .catch(err => err.should.be.an.instanceof(Error));
    });

    it('should throw an error on smtp errors', () => {
      const socket = new net.Socket({ });

      self.sandbox.stub(socket, 'write', function(data) {
        if (!data.includes('QUIT')) this.emit('data', '550 Foo');
      });

      self.connectStub.returns(socket);

      setTimeout(() => socket.write('250 Foo'), 10);

      return self.validator.checkViaSmtp('bar@foo.com')
        .then(() => Promise.reject('You shall not pass!'))
        .catch(err => err.should.be.an.instanceof(Error));
    });
  });
});
