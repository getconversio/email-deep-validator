import sinon, { SinonSandbox, SinonStub } from 'sinon';
import dns from 'dns';
import net, { Socket } from 'net';
import { EmailValidator } from '../src/lib';
import { ResultValue } from '../src/lib/types';

describe('Email Validator', () => {
  let sandbox: SinonSandbox;
  let validator: EmailValidator;
  let resolveMxStub: SinonStub;
  let socket: Socket;
  let connectStub: SinonStub;

  const stubResolveMx: (address?: string) => void = (domain = 'foo.com') => {
    resolveMxStub = sandbox.stub(dns, 'resolveMx').yields(null, [
      { exchange: `mx1.${domain}`, priority: 30 },
      { exchange: `mx2.${domain}`, priority: 10 },
      { exchange: `mx3.${domain}`, priority: 20 },
    ]);
  };

  const stubSocket: () => void = () => {
    socket = new net.Socket({});
    sandbox.stub(socket, 'write').callsFake(function (data) {
      const sData = data as string;
      let result = false;
      if (!sData.includes('QUIT')) result = socket.emit('data', '250 Foo');
      return result;
    });

    connectStub = sandbox.stub(net, 'connect').returns(socket);
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    validator = new EmailValidator();
  });

  afterEach(() => sandbox.restore());
  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create an instance of EmailValidator', () => {
      const validator = new EmailValidator();

      expect(validator).toBeInstanceOf(EmailValidator);
      expect(validator.options).toEqual(validator.defaultOptions);
    });

    it('should be possible to override options', () => {
      const validator = new EmailValidator({ timeout: 5000 });

      expect(validator.options.timeout).toBe(5000);
      expect(validator.options.verifyDomain).toBe(
        validator.defaultOptions.verifyDomain
      );
    });
  });

  describe('Verify', () => {
    beforeEach(() => {
      stubResolveMx();
      stubSocket();
    });

    it('returns immediately if email is malformed invalid', async () => {
      const validator = new EmailValidator();
      const result = await validator.verify('bar.com');
      const { wellFormed, validDomain, validMailbox } = result;

      expect(wellFormed).toBe(ResultValue.INVALID);
      expect(validDomain).toBe(ResultValue.UNKNOWN);
      expect(validMailbox).toBe(ResultValue.UNKNOWN);
    });

    it('should perform all tests', async () => {
      const validator = new EmailValidator();
      setTimeout(() => socket.write('250 Foo'), 10);
      const result = await validator.verify('foo@bar.com');
      const { wellFormed, validDomain, validMailbox } = result;

      expect(wellFormed).toBe(ResultValue.VALID);
      expect(validDomain).toBe(ResultValue.VALID);
      expect(validMailbox).toBe(ResultValue.VALID);
    });

    describe('mailbox verification', () => {
      it('returns true when maibox exists', async () => {
        setTimeout(() => socket.write('250 Foo'), 10);

        const result = await validator.verify('bar@foo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.VALID);
      });

      it('returns null if mailbox is yahoo', async () => {
        resolveMxStub.restore();
        stubResolveMx('yahoo.com');

        setTimeout(() => socket.write('250 Foo'), 10);

        const result = await validator.verify('bar@yahoo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
      });

      it('should return null on socket error', async () => {
        const socket = {
          on: (event: string, callback: (arg: Error) => never) => {
            if (event === 'error') return callback(new Error());
          },
          write: () => undefined,
          end: () => undefined,
        };

        connectStub = connectStub.returns(socket);

        const result = await validator.verify('bar@foo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
      });

      it('dodges multiline spam detecting greetings', async () => {
        const socket = new net.Socket({});
        let greeted = false;

        sandbox.stub(socket, 'write').callsFake(function (data) {
          const sData = data as string;
          if (!sData.includes('QUIT')) {
            if (!greeted)
              return socket.emit('data', '550 5.5.1 Protocol Error');
            return socket.emit('data', '250 Foo');
          }
          return false;
        });

        connectStub.returns(socket);

        setTimeout(() => {
          // the "-" indicates a multi line greeting
          socket.emit('data', '220-hohoho');

          // wait a bit and send the rest
          setTimeout(() => {
            greeted = true;
            socket.emit('data', '220 ho ho ho');
          }, 1000);
        }, 10);

        const result = await validator.verify('bar@foo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.VALID);
      });

      it('regression: does not write infinitely if there is a socket error', async () => {
        const writeSpy = sandbox.spy();
        const endSpy = sandbox.spy();

        const socket = {
          on: (event: string, callback: (arg: Error) => void) => {
            if (event === 'error') {
              return setTimeout(() => {
                socket.destroyed = true;
                callback(new Error());
              }, 100);
            }
          },
          write: writeSpy,
          end: endSpy,
          destroyed: false,
        };

        connectStub = connectStub.returns(socket);

        await validator.verify('bar@foo.com');
        sinon.assert.notCalled(writeSpy);
        sinon.assert.notCalled(endSpy);
      });

      it('should return null on unknown SMTP errors', async () => {
        const socket = new net.Socket({});

        sandbox.stub(socket, 'write').callsFake(function (data) {
          const sData = data as string;
          if (!sData.includes('QUIT')) return socket.emit('data', '500 Foo');
          return false;
        });

        connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        const result = await validator.verify('bar@foo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
      });

      it('returns false on bad mailbox errors', async () => {
        const socket = new net.Socket({});

        sandbox.stub(socket, 'write').callsFake(function (data) {
          const sData = data as string;
          if (!sData.includes('QUIT')) return socket.emit('data', '550 Foo');
          return false;
        });

        connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        const result = await validator.verify('bar@foo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.INVALID);
      });

      it('returns null on spam errors', async () => {
        const msg =
          '550-"JunkMail rejected - ec2-54-74-157-229.eu-west-1.compute.amazonaws.com';
        const socket = new net.Socket({});

        sandbox.stub(socket, 'write').callsFake(function (data) {
          const sData = data as string;
          if (!sData.includes('QUIT')) return socket.emit('data', msg);
          return false;
        });

        connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        const result = await validator.verify('bar@foo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
      });

      it('returns null on spam errors-#2', async () => {
        const msg =
          '553 5.3.0 flpd575 DNSBL:RBL 521< 54.74.114.115 >_is_blocked.For assistance forward this email to abuse_rbl@abuse-att.net';
        const socket = new net.Socket({});

        sandbox.stub(socket, 'write').callsFake(function (data) {
          const sData = data as string;
          if (!sData.includes('QUIT')) return socket.emit('data', msg);
          return false;
        });

        connectStub.returns(socket);

        setTimeout(() => socket.write('250 Foo'), 10);

        const result = await validator.verify('bar@foo.com');
        const { validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
      });
    });

    describe('given no mx records', () => {
      beforeEach(() => {
        resolveMxStub.yields(null, []);
      });

      it('should return false on the domain verification', async () => {
        const result = await validator.verify('bar@foo.com');
        const { validDomain, validMailbox } = result;
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
        expect(validDomain).toBe(ResultValue.INVALID);
      });
    });

    describe('given a verifyMailbox option false', () => {
      beforeEach(() => {
        validator = new EmailValidator({ verifyMailbox: false });
      });

      it('should not check via socket', async () => {
        const result = await validator.verify('foo@bar.com');
        const { validMailbox } = result;
        sinon.assert.called(resolveMxStub);
        sinon.assert.notCalled(connectStub);
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
      });
    });

    describe('given a verifyDomain option false', () => {
      beforeEach(() => {
        validator = new EmailValidator({
          verifyDomain: false,
          verifyMailbox: false,
        });
      });

      it('should not check via socket', async () => {
        const result = await validator.verify('foo@bar.com');
        const { validDomain, validMailbox } = result;

        sinon.assert.notCalled(resolveMxStub);
        sinon.assert.notCalled(connectStub);
        expect(validDomain).toBe(ResultValue.UNKNOWN);
        expect(validMailbox).toBe(ResultValue.UNKNOWN);
      });
    });

    describe('resolveMxRecords', () => {
      //beforeEach(() => stubResolveMx());

      it('should return a list of mx records, ordered by priority', async () => {
        const records = await EmailValidator.resolveMxRecords('bar@foo.com');

        expect(records).toEqual(['mx2.foo.com', 'mx3.foo.com', 'mx1.foo.com']);
      });
    });

    describe('isEmail', () => {
      it('should validate a correct address', () => {
        expect(EmailValidator.isEmail('foo@bar.com')).toBe(true);
      });

      it('should return false for an invalid address', () => {
        expect(EmailValidator.isEmail('bar.com')).toBe(false);
      });
    });

    describe('extractAddressParts', () => {
      it('should local + domain parts of an email address', () => {
        expect(EmailValidator.extractAddressParts('foo@bar.com')).toEqual([
          'foo',
          'bar.com',
        ]);
      });

      it("should throw an error if the email can't be splitted", () => {
        expect(() => EmailValidator.extractAddressParts('foo')).toThrow();
      });
    });
  });
});
