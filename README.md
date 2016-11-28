# email-deep-validator

[![Build Status](https://travis-ci.org/getconversio/email-deep-validator.svg?branch=master)](https://travis-ci.org/getconversio/email-deep-validator)

Verify email address checking MX records, and SMTP connection.

## Installation

Install the module through NPM:

    $ npm install email-deep-validator --save

**Requires Node 6 or above**

## Examples

Include the module, create a new `EmailValidator` object and call `validate` method:

```javascript
const EmailValidator = require('email-deep-validator');

const emailValidator = new EmailValidator();
emailValidator.validate('foo@email.com')
  .then(() => console.log('Email is valid.');

emailValidator.validate('non-existent@email.com')
  .catch(err => console.log('Email is not valid', err.message));
```

## Configuration options

### timeout

Set a timeout in seconds for the smtp connection. Default: `10000`.

### verifyMxRecords

Enable or disable the check of mx records. Default: `true`.

### verifySmtpConnection

Enable or disable the SMTP check. Default `true`.

## Testing

    $ npm test

## Contributing

This module was originally written to be used with Conversio and is used in a production environment currently. This will ensure that this module is well maintained, bug free and as up to date as possible.

Conversio's developers will continue to make updates as often as required to have a consistently bug free platform, but we are happy to review any feature requests or issues and are accepting constructive pull requests.
