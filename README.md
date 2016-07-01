React-Native-OpenPGP
==========

[React-Native-OpenPGP](http://openpgpjs.org/) is a Javascript implementation of the OpenPGP protocol based on [OpenPGP.js](https://github.com/openpgpjs/openpgpjs).


### Getting started

#### Prerequisites

    React-Native-OpenPGP relies on the [React-Native-Random-Bytes](https://www.npmjs.com/package/react-native-randombytes) library.
    Please install and setup that first.

#### npm

    npm install --save github:orhan/react-native-openpgp


### Usage

```js
var openpgp = require('react-native-openpgp');
```

#### Before Usage

Before using any of the methods below, it is ~~highly recommended~~ **necessary** to generate some random values to seed the randomization algorithm of this library. You don't have to do this for every operation, but you are highly advised to do so.

Basic example:
```js
openpgp.prepareRandomValues()
  .then(() => {

    // YOUR CALLS START HERE!
    openpgp.encrypt(options).then(function(ciphertext) {
        encrypted = ciphertext.data;
    });

  })
```

#### Encrypt and decrypt *Uint8Array* data with a password

Encryption will use the algorithm specified in config.encryption_cipher (defaults to aes256), and decryption will use the algorithm used for encryption.

```js
var options, encrypted;

options = {
    message: openpgp.message.fromBinary(new Uint8Array([0x01, 0x01, 0x01])), // input as Message object
    passwords: ['secret stuff'],                                             // multiple passwords possible
    armor: false                                                             // don't ASCII armor (for Uint8Array output)
};

openpgp.encrypt(options).then(function(ciphertext) {
    encrypted = ciphertext.message.packets.write(); // get raw encrypted packets as Uint8Array
});
```

```js
options = {
    message: openpgp.readMessage(encrypted), // parse armored message
    password: 'secret stuff'                         // decrypt with password
};

openpgp.decrypt(options).then(function(plaintext) {
    return plaintext.data // Uint8Array([0x01, 0x01, 0x01])
});
```

#### Encrypt and decrypt *String* data with PGP keys

Encryption will use the algorithm preferred by the public key (defaults to aes256 for keys generated in OpenPGP.js), and decryption will use the algorithm used for encryption.

```js
const openpgp = require('openpgp') // use as CommonJS, AMD, ES6 module or via window.openpgp

openpgp.initWorker({ path:'openpgp.worker.js' }) // set the relative web worker path

// put keys in backtick (``) to avoid errors caused by spaces or tabs
const pubkey = `-----BEGIN PGP PUBLIC KEY BLOCK-----
...
-----END PGP PUBLIC KEY BLOCK-----`
const privkey = `-----BEGIN PGP PRIVATE KEY BLOCK-----
...
-----END PGP PRIVATE KEY BLOCK-----` //encrypted private key
const passphrase = `yourPassphrase` //what the privKey is encrypted with

const encryptDecryptFunction = async() => {
    const privKeyObj = (await openpgp.key.readArmored(privkey)).keys[0]
    await privKeyObj.decrypt(passphrase)

    const options = {
        message: openpgp.message.fromText('Hello, World!'),       // input as Message object
        publicKeys: (await openpgp.key.readArmored(pubkey)).keys, // for encryption
        privateKeys: [privKeyObj]                                 // for signing (optional)
    }

    openpgp.encrypt(options).then(ciphertext => {
        encrypted = ciphertext.data // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
        return encrypted
    })
    .then(async encrypted => {
        const options = {
            message: await openpgp.message.readArmored(encrypted),    // parse armored message
            publicKeys: (await openpgp.key.readArmored(pubkey)).keys, // for verification (optional)
            privateKeys: [privKeyObj]                                 // for decryption
        }

        openpgp.decrypt(options).then(plaintext => {
            console.log(plaintext.data)
            return plaintext.data // 'Hello, World!'
        })

    })
}

encryptDecryptFunction()
```

Encrypt with multiple public keys:

```js
const pubkeys = [`-----BEGIN PGP PUBLIC KEY BLOCK-----
...
-----END PGP PUBLIC KEY BLOCK-----`,
`-----BEGIN PGP PUBLIC KEY BLOCK-----
...
-----END PGP PUBLIC KEY BLOCK-----`
const privkey = `-----BEGIN PGP PRIVATE KEY BLOCK-----
...
-----END PGP PRIVATE KEY BLOCK-----` //encrypted private key
const passphrase = `yourPassphrase` //what the privKey is encrypted with
const message = 'Hello, World!'    // input as Message object

async encryptWithMultiplePublicKeys(pubkeys, privkey, passphrase, message) {
    const privKeyObj = (await openpgp.key.readArmored(privkey)).keys[0]
    await privKeyObj.decrypt(passphrase)

    pubkeys = pubkeys.map(async (key) => {
    	return (await openpgp.key.readArmored(key)).keys[0]
    });

    const options = {
        message: openpgp.message.fromText(message),
        publicKeys: pubkeys,           				  // for encryption
        privateKeys: [privKeyObj]                                 // for signing (optional)
    }

    return openpgp.encrypt(options).then(ciphertext => {
        encrypted = ciphertext.data // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
        return encrypted
    })
   };
```

#### Encrypt with compression

By default, `encrypt` will not use any compression. It's possible to override that behavior in two ways:

Either set the `compression` parameter in the options object when calling `encrypt`.

```js
var options, encrypted;

options = {
    data: new Uint8Array([0x01, 0x01, 0x01]),           // input as Uint8Array
    publicKeys: openpgp.readArmoredKey(pubkey).keys,   // for encryption
    privateKeys: openpgp.readArmoredKey(privkey).keys, // for signing (optional)
    armor: false                                        // don't ASCII armor
};

ciphertext = await openpgp.encrypt(options);     // use ciphertext
```

Or, override the config to enable compression:

```js
options = {
    message: openpgp.readBinaryMessage(encrypted),             // parse encrypted bytes
    publicKeys: openpgp.readArmoredKey(pubkey).keys,     // for verification (optional)
    privateKey: openpgp.readArmoredKey(privkey).keys[0], // for decryption
    format: 'binary'                                      // output as Uint8Array
};

openpgp.encrypt(options).then(async function(ciphertext) {
    const encrypted = ciphertext.message.packets.write(); // get raw encrypted packets as ReadableStream<Uint8Array>

    // Either pipe the above stream somewhere, pass it to another function,
    // or read it manually as follows:
    const reader = openpgp.stream.getReader(encrypted);
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        console.log('new chunk:', value); // Uint8Array
    }
});
```

For more information on creating ReadableStreams, see [the MDN Documentation on `new
ReadableStream()`](https://developer.mozilla.org/docs/Web/API/ReadableStream/ReadableStream).
For more information on reading streams using `openpgp.stream`, see the documentation of
[the web-stream-tools dependency](https://openpgpjs.org/web-stream-tools/), particularly
its [Reader class](https://openpgpjs.org/web-stream-tools/Reader.html).


#### Streaming encrypt and decrypt *String* data with PGP keys

```js
(async () => {
    let options;

    const pubkey = `-----BEGIN PGP PUBLIC KEY BLOCK-----
    ...
    -----END PGP PUBLIC KEY BLOCK-----`; // Public key
    const privkey = `-----BEGIN PGP PRIVATE KEY BLOCK-----
    ...
    -----END PGP PRIVATE KEY BLOCK-----`; // Encrypted private key
    const passphrase = `yourPassphrase`; // Password that privKey is encrypted with

    const privKeyObj = (await openpgp.key.readArmored(privkey)).keys[0];
    await privKeyObj.decrypt(passphrase);

    const readableStream = new ReadableStream({
        start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
        }
    });

    options = {
        message: openpgp.message.fromText(readableStream),        // input as Message object
        publicKeys: (await openpgp.key.readArmored(pubkey)).keys, // for encryption
        privateKeys: [privKeyObj]                                 // for signing (optional)
    };

    const encrypted = await openpgp.encrypt(options);
    const ciphertext = encrypted.data; // ReadableStream containing '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'

    options = {
        message: await openpgp.message.readArmored(ciphertext),   // parse armored message
        publicKeys: (await openpgp.key.readArmored(pubkey)).keys, // for verification (optional)
        privateKeys: [privKeyObj]                                 // for decryption
    };

    const decrypted = await openpgp.decrypt(options);
    const plaintext = await openpgp.stream.readToEnd(decrypted.data); // 'Hello, World!'
})();
```


#### Generate new key pair

RSA keys:
```js
var options = {
    userIds: [{ name:'Jon Smith', email:'jon@example.com' }], // multiple user IDs
    numBits: 2048,                                            // RSA key size
    passphrase: 'super long and hard to guess secret'         // protects the private key
};
```

ECC keys:

Possible values for curve are: `curve25519`, `ed25519`, `p256`, `p384`, `p521`, `secp256k1`,
`brainpoolP256r1`, `brainpoolP384r1`, or `brainpoolP512r1`.
Note that options both `curve25519` and `ed25519` generate a primary key for signing using Ed25519
and a subkey for encryption using Curve25519.

```js
var options = {
    userIds: [{ name:'Jon Smith', email:'jon@example.com' }], // multiple user IDs
    curve: "ed25519",                                         // ECC curve name
    passphrase: 'super long and hard to guess secret'         // protects the private key
};
```

```js
openpgp.generateKey(options).then(function(key) {
    var privkey = key.privateKeyArmored; // '-----BEGIN PGP PRIVATE KEY BLOCK ... '
    var pubkey = key.publicKeyArmored;   // '-----BEGIN PGP PUBLIC KEY BLOCK ... '
    var revocationCertificate = key.revocationCertificate; // '-----BEGIN PGP PUBLIC KEY BLOCK ... '
});
```

#### Revoke a key

Using a revocation certificate:
```js
var options = {
    key: openpgp.key.readArmored(pubkey).keys[0],
    revocationCertificate: revocationCertificate
};
```

Using the private key:
```js
var options = {
    key: openpgp.key.readArmored(privkey).keys[0]
};
```

```js
openpgp.revokeKey(options).then(function(key) {
    var pubkey = key.publicKeyArmored;   // '-----BEGIN PGP PUBLIC KEY BLOCK ... '
});
```
