if (typeof Buffer === 'undefined') {
  global.Buffer = require('buffer').Buffer
}

let RNOpenPGP = require('react-native').NativeModules.RNOpenPGP

function noop () {}

function toBuffer (nativeStr) {
  return new Buffer(nativeStr, 'base64')
}

export function randomBytes (length, cb) {
  if (!cb) {
    cb("Error: No callback function defined");
  }

  RNOpenPGP.randomBytes(length, function(err, base64String) {
    if (err) {
      cb(err)
    } else {
      cb(null, toBuffer(base64String))
    }
  })
}
