'use strict';

const chai = require('chai'),
  sinon = require('sinon'),
  dns = require('dns'),
  net = require('net'),
  EmailVerifier = require('../lib');

chai.should();

describe('lib/index', () => {
  const self = { };

  beforeEach(() => {
    self.sandbox = sinon.sandbox.create();
    self.verifier = new EmailVerifier();
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

  describe('constructor', () => {
    it('should create an instance of EmailVerifier', () => {
      const verifier = new EmailVerifier();
      verifier.should.be.an.instanceof(EmailVerifier);
    });
  });

  describe('resolveMxRecords', () => {
    beforeEach(() => stubResolveMx());

    it('should return a list of mx records, ordered by priority', () => {
      return EmailVerifier.resolveMxRecords('bar@foo.com')
        .then(records => {
          records.should.deep.equal(['mx2.foo.com', 'mx3.foo.com', 'mx1.foo.com']);
        });
    });

    it('should return false for an invalid address', () => {
      (() => EmailVerifier.resolveMxRecords('bar.com')).should.throw(Error);
    });
  });

  describe('isEmail', () => {
    it('should validate a correct address', () => {
      EmailVerifier.isEmail('foo@bar.com').should.equal(true);
    });

    it('should return false for an invalid address', () => {
      EmailVerifier.isEmail('bar.com').should.equal(false);
    });
  });

  describe('extractDomain', () => {
    it('should return the domain part of an email address', () => {
      EmailVerifier.extractDomain('foo@bar.com').should.equal('bar.com');
    });

    it('should throw an error if the email is not valid', () => {
      (() => EmailVerifier.extractDomain('foo')).should.throw(Error);
    });
  });

  describe('checkViaSmtp', () => {
    beforeEach(() => {
      stubResolveMx();

      self.socket = new net.Socket({ });

      self.sandbox.stub(self.socket, 'write', function(data) {
        if (!data.includes('QUIT')) this.emit('data', '250 Foo');
      });

      self.connectStub = self.sandbox.stub(net, 'connect')
        .returns(self.socket);
    });

    it('should resolve for a valid address', () => {
      setTimeout(() => self.socket.write('250 Foo'), 10);

      return self.verifier.checkViaSmtp('bar@foo.com');
    });

    it('should throw an error on socket error', () => {
      const socket = {
        on: (event, callback) => {
          if (event === 'error') return callback(new Error());
        }
      };

      self.connectStub = self.connectStub.returns(socket);

      return self.verifier.checkViaSmtp('bar@foo.com')
        .catch(err => err.should.be.an.instanceof(Error));
    });

    it('should throw an error on smtp errors', () => {
      const socket = new net.Socket({ });

      self.sandbox.stub(socket, 'write', function(data) {
        if (!data.includes('QUIT')) this.emit('data', '550 Foo');
      });

      self.connectStub.returns(socket);

      setTimeout(() => socket.write('250 Foo'), 10);

      return self.verifier.checkViaSmtp('bar@foo.com')
        .catch(err => err.should.be.an.instanceof(Error));
    });
  });
});
