# email-deep-validator

[![Build Status](https://travis-ci.org/getconversio/email-deep-validator.svg?branch=master)](https://travis-ci.org/getconversio/email-deep-validator)

Verify email address checking MX records, and SMTP connection.

## Installation

Install the module through NPM:

    $ npm install email-deep-validator --save

**Requires Node 7.6 or above**

## Examples

Include the module, create a new `EmailValidator` object and call `verify` method:

```javascript
const EmailValidator = require('email-deep-validator');

const emailValidator = new EmailValidator();
const { wellFormed, validDomain, validMailbox } = await emailValidator.verify('foo@email.com');
// wellFormed: true
// validDomain: true
// validMailbox: true
```

When a domain does not exist or has no MX records, the domain validation will fail, and the mailbox validation will return `null` because it could not be performed:

```javascript
const { wellFormed, validDomain, validMailbox } = await emailValidator.verify('foo@bad-domain.com');
// wellFormed: true
// validDomain: false
// validMailbox: null
```

A valid Yahoo domain will still return `validMailbox` true because their SMTP servers do not allow verifying if a mailbox exists.

## Configuration options

### `timeout`

Set a timeout in seconds for the smtp connection. Default: `10000`.

### `verifyDomain`

Enable or disable domain checking. This is done in two steps:

1. Verify that the domain does indeed exist;
2. Verify that the domain has valid MX records.

Default: `true`.

### `verifyMailbox`

Enable or disable mailbox checking. Only a few SMTP servers allow this, and even then whether it works depends on your IP's reputation with those servers. This library performs a best effort validation:

* It returns `null` for Yahoo addresses, for failed connections, for unknown SMTP errors.
* It returns `true` for valid SMTP responses.
* It returns `false` for SMTP errors specific to the address's formatting or mailbox existance.

Default: `true`.

## Testing

    $ npm test

## Changelog

### 2.0.0

* (BREAKING) Requires node 7.6 for `async`/`await`.
* (BREAKING) Instead of throwing on any invalidation, the lib now returns an object with which validations failed.
* (BREAKING) Configuration property `verifyMxRecords` renamed to `verifyDomain`.
* (BREAKING) Configuration property `verifySmtpConnection` renamed to `verifyMailbox`.

## Contributing

This module was originally written to be used with Conversio and is used in a production environment currently. This will ensure that this module is well maintained, bug free and as up to date as possible.

Conversio's developers will continue to make updates as often as required to have a consistently bug free platform, but we are happy to review any feature requests or issues and are accepting constructive pull requests.
