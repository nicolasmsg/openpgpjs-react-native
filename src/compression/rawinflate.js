import * as huffmanTable from './huffman.js';
var USE_TYPEDARRAY = true;

//-----------------------------------------------------------------------------

/** @define {number} buffer block size. */
var ZLIB_RAW_INFLATE_BUFFER_SIZE = 0x8000; // [ 0x8000 >= ZLIB_BUFFER_BLOCK_SIZE ]

//-----------------------------------------------------------------------------

/**
 * @constructor
 * @param {!(Uint8Array|Array.<number>)} input input buffer.
 * @param {Object} opt_params option parameter.
 *
 * opt_params は以下のプロパティを指定する事ができます。
 *   - index: input buffer の deflate コンテナの開始位置.
 *   - blockSize: バッファのブロックサイズ.
 *   - bufferType: Zlib.RawInflate.BufferType の値によってバッファの管理方法を指定する.
 *   - resize: 確保したバッファが実際の大きさより大きかった場合に切り詰める.
 */
export function RawInflate(input, opt_params) {
  /** @type {!(Array.<number>|Uint8Array)} inflated buffer */
  this.buffer;
  /** @type {!Array.<(Array.<number>|Uint8Array)>} */
  this.blocks = [];
  /** @type {number} block size. */
  this.bufferSize = ZLIB_RAW_INFLATE_BUFFER_SIZE;
  /** @type {!number} total output buffer pointer. */
  this.totalpos = 0;
  /** @type {!number} input buffer pointer. */
  this.ip = 0;
  /** @type {!number} bit stream reader buffer. */
  this.bitsbuf = 0;
  /** @type {!number} bit stream reader buffer size. */
  this.bitsbuflen = 0;
  /** @type {!(Array.<number>|Uint8Array)} input buffer. */
  this.input = new Uint8Array(input);
  /** @type {!(Uint8Array|Array.<number>)} output buffer. */
  this.output;
  /** @type {!number} output buffer pointer. */
  this.op;
  /** @type {boolean} is final block flag. */
  this.bfinal = false;

  /** @type {Zlib.RawInflate.BufferType} buffer management. */
  this.bufferType = this.BufferType.ADAPTIVE;
  /** @type {boolean} resize flag for memory size optimization. */
  this.resize = false;
  /** @type {number} previous RLE value */
  this.prev;

  // option parameters
  if (opt_params || !(opt_params = {})) {
    if (opt_params.index) {
      this.ip = opt_params.index;
    }
    if (opt_params.bufferSize) {
      this.bufferSize = opt_params.bufferSize;
    }
    if (opt_params.bufferType) {
      this.bufferType = opt_params.bufferType;
    }
    if (opt_params.resize) {
      this.resize = opt_params.resize;
    }
  }

  // initialize
  switch (this.bufferType) {
    case this.BufferType.BLOCK:
      this.op = this.MaxBackwardLength;
      this.output =
        new (Uint8Array)(
          this.MaxBackwardLength +
          this.bufferSize +
          this.MaxCopyLength
        );
      break;
    case this.BufferType.ADAPTIVE:
      this.op = 0;
      this.output = new (Uint8Array)(this.bufferSize);
      this.expandBuffer = this.expandBufferAdaptive;
      this.concatBuffer = this.concatBufferDynamic;
      this.decodeHuffman = this.decodeHuffmanAdaptive;
      break;
    default:
      throw new Error('invalid inflate mode');
  }
}

/**
 * @enum {number}
 */
RawInflate.prototype.BufferType = {
  BLOCK: 0,
  ADAPTIVE: 1
};

/**
 * decompress.
 * @return {!(Uint8Array|Array.<number>)} inflated buffer.
 */
RawInflate.prototype.decompress = function() {
  while (!this.bfinal) {
    this.parseBlock();
  }

  return this.concatBuffer();
};

/**
 * @const
 * @type {number} max backward length for LZ77.
 */
RawInflate.prototype.MaxBackwardLength = 32768;

/**
 * @const
 * @type {number} max copy length for LZ77.
 */
RawInflate.prototype.MaxCopyLength = 258;

/**
 * huffman order
 * @const
 * @type {!(Array.<number>|Uint8Array)}
 */
RawInflate.prototype.Order = (function(table) {
  return USE_TYPEDARRAY ? new Uint16Array(table) : table;
})([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

/**
 * huffman length code table.
 * @const
 * @type {!(Array.<number>|Uint16Array)}
 */
RawInflate.prototype.LengthCodeTable = (function(table) {
  return USE_TYPEDARRAY ? new Uint16Array(table) : table;
})([
  0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x0009, 0x000a, 0x000b,
  0x000d, 0x000f, 0x0011, 0x0013, 0x0017, 0x001b, 0x001f, 0x0023, 0x002b,
  0x0033, 0x003b, 0x0043, 0x0053, 0x0063, 0x0073, 0x0083, 0x00a3, 0x00c3,
  0x00e3, 0x0102, 0x0102, 0x0102
]);

/**
 * huffman length extra-bits table.
 * @const
 * @type {!(Array.<number>|Uint8Array)}
 */
RawInflate.prototype.LengthExtraTable = (function(table) {
  return USE_TYPEDARRAY ? new Uint8Array(table) : table;
})([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0, 0, 0
]);

/**
 * huffman dist code table.
 * @const
 * @type {!(Array.<number>|Uint16Array)}
 */
RawInflate.prototype.DistCodeTable = (function(table) {
  return USE_TYPEDARRAY ? new Uint16Array(table) : table;
})([
  0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0007, 0x0009, 0x000d, 0x0011,
  0x0019, 0x0021, 0x0031, 0x0041, 0x0061, 0x0081, 0x00c1, 0x0101, 0x0181,
  0x0201, 0x0301, 0x0401, 0x0601, 0x0801, 0x0c01, 0x1001, 0x1801, 0x2001,
  0x3001, 0x4001, 0x6001
]);

/**
 * huffman dist extra-bits table.
 * @const
 * @type {!(Array.<number>|Uint8Array)}
 */
RawInflate.prototype.DistExtraTable = (function(table) {
  return USE_TYPEDARRAY ? new Uint8Array(table) : table;
})([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13
]);

/**
 * fixed huffman length code table
 * @const
 * @type {!Array}
 */
RawInflate.prototype.FixedLiteralLengthTable = (function(table) {
  return table;
})((function() {
  var lengths = new (Uint8Array)(288);
  var i, il;

  for (i = 0, il = lengths.length; i < il; ++i) {
    lengths[i] =
      (i <= 143) ? 8 :
      (i <= 255) ? 9 :
      (i <= 279) ? 7 :
      8;
  }

  return huffmanTable.buildHuffmanTable(lengths);
})());

/**
 * fixed huffman distance code table
 * @const
 * @type {!Array}
 */
RawInflate.prototype.FixedDistanceTable = (function(table) {
  return table;
})((function() {
  var lengths = new (Uint8Array)(30);
  var i, il;

  for (i = 0, il = lengths.length; i < il; ++i) {
    lengths[i] = 5;
  }

  return huffmanTable.buildHuffmanTable(lengths);
})());

/**
 * parse deflated block.
 */
RawInflate.prototype.parseBlock = function() {
  /** @type {number} header */
  var hdr = this.readBits(3);

  // BFINAL
  if (hdr & 0x1) {
    this.bfinal = true;
  }

  // BTYPE
  hdr >>>= 1;
  switch (hdr) {
    // uncompressed
    case 0:
      this.parseUncompressedBlock();
      break;
    // fixed huffman
    case 1:
      this.parseFixedHuffmanBlock();
      break;
    // dynamic huffman
    case 2:
      this.parseDynamicHuffmanBlock();
      break;
    // reserved or other
    default:
      throw new Error('unknown BTYPE: ' + hdr);
  }
};

/**
 * read inflate bits
 * @param {number} length bits length.
 * @return {number} read bits.
 */
RawInflate.prototype.readBits = function(length) {
  var bitsbuf = this.bitsbuf;
  var bitsbuflen = this.bitsbuflen;
  var input = this.input;
  var ip = this.ip;

  /** @type {number} */
  var inputLength = input.length;
  /** @type {number} input and output byte. */
  var octet;

  // not enough buffer
  while (bitsbuflen < length) {
    // input byte
    if (ip >= inputLength) {
      throw new Error('input buffer is broken');
    }

    // concat octet
    bitsbuf |= input[ip++] << bitsbuflen;
    bitsbuflen += 8;
  }

  // output byte
  octet = bitsbuf & /* MASK */ ((1 << length) - 1);
  bitsbuf >>>= length;
  bitsbuflen -= length;

  this.bitsbuf = bitsbuf;
  this.bitsbuflen = bitsbuflen;
  this.ip = ip;

  return octet;
};

/**
 * read huffman code using table
 * @param {Array} table huffman code table.
 * @return {number} huffman code.
 */
RawInflate.prototype.readCodeByTable = function(table) {
  var bitsbuf = this.bitsbuf;
  var bitsbuflen = this.bitsbuflen;
  var input = this.input;
  var ip = this.ip;

  /** @type {number} */
  var inputLength = input.length;
  /** @type {!(Array.<number>|Uint8Array)} huffman code table */
  var codeTable = table[0];
  /** @type {number} */
  var maxCodeLength = table[1];
  /** @type {number} code length & code (16bit, 16bit) */
  var codeWithLength;
  /** @type {number} code bits length */
  var codeLength;

  // not enough buffer
  while (bitsbuflen < maxCodeLength) {
    if (ip >= inputLength) {
      break;
    }
    bitsbuf |= input[ip++] << bitsbuflen;
    bitsbuflen += 8;
  }

  // read max length
  codeWithLength = codeTable[bitsbuf & ((1 << maxCodeLength) - 1)];
  codeLength = codeWithLength >>> 16;

  this.bitsbuf = bitsbuf >> codeLength;
  this.bitsbuflen = bitsbuflen - codeLength;
  this.ip = ip;

  return codeWithLength & 0xffff;
};

/**
 * parse uncompressed block.
 */
RawInflate.prototype.parseUncompressedBlock = function() {
  var input = this.input;
  var ip = this.ip;
  var output = this.output;
  var op = this.op;

  /** @type {number} */
  var inputLength = input.length;
  /** @type {number} block length */
  var len;
  /** @type {number} number for check block length */
  var nlen;
  /** @type {number} output buffer length */
  var olength = output.length;
  /** @type {number} copy counter */
  var preCopy;

  // skip buffered header bits
  this.bitsbuf = 0;
  this.bitsbuflen = 0;

  // len
  if (ip + 1 >= inputLength) {
    throw new Error('invalid uncompressed block header: LEN');
  }
  len = input[ip++] | (input[ip++] << 8);

  // nlen
  if (ip + 1 >= inputLength) {
    throw new Error('invalid uncompressed block header: NLEN');
  }
  nlen = input[ip++] | (input[ip++] << 8);

  // check len & nlen
  if (len === ~nlen) {
    throw new Error('invalid uncompressed block header: length verify');
  }

  // check size
  if (ip + len > input.length) { throw new Error('input buffer is broken'); }

  // expand buffer
  switch (this.bufferType) {
    case this.BufferType.BLOCK:
      // pre copy
      while (op + len > output.length) {
        preCopy = olength - op;
        len -= preCopy;
        if (USE_TYPEDARRAY) {
          output.set(input.subarray(ip, ip + preCopy), op);
          op += preCopy;
          ip += preCopy;
        } else {
          while (preCopy--) {
            output[op++] = input[ip++];
          }
        }
        this.op = op;
        output = this.expandBuffer();
        op = this.op;
      }
      break;
    case this.BufferType.ADAPTIVE:
      while (op + len > output.length) {
        output = this.expandBuffer({fixRatio: 2});
      }
      break;
    default:
      throw new Error('invalid inflate mode');
  }

  // copy
  if (USE_TYPEDARRAY) {
    output.set(input.subarray(ip, ip + len), op);
    op += len;
    ip += len;
  } else {
    while (len--) {
      output[op++] = input[ip++];
    }
  }

  this.ip = ip;
  this.op = op;
  this.output = output;
};

/**
 * parse fixed huffman block.
 */
RawInflate.prototype.parseFixedHuffmanBlock = function() {
  this.decodeHuffman(
    this.FixedLiteralLengthTable,
    this.FixedDistanceTable
  );
};

/**
 * parse dynamic huffman block.
 */
RawInflate.prototype.parseDynamicHuffmanBlock = function() {
  /** @type {number} number of literal and length codes. */
  var hlit = this.readBits(5) + 257;
  /** @type {number} number of distance codes. */
  var hdist = this.readBits(5) + 1;
  /** @type {number} number of code lengths. */
  var hclen = this.readBits(4) + 4;
  /** @type {!(Uint8Array|Array.<number>)} code lengths. */
  var codeLengths =
    new (Uint8Array)(this.Order.length);
  /** @type {!Array} code lengths table. */
  var codeLengthsTable;
  /** @type {!(Uint8Array|Array.<number>)} literal and length code lengths. */
  var litlenLengths;
  /** @type {!(Uint8Array|Array.<number>)} distance code lengths. */
  var distLengths;
  /** @type {number} loop counter. */
  var i;

  // decode code lengths
  for (i = 0; i < hclen; ++i) {
    codeLengths[this.Order[i]] = this.readBits(3);
  }
  if (!USE_TYPEDARRAY) {
    for (i = hclen, hclen = codeLengths.length; i < hclen; ++i) {
      codeLengths[this.Order[i]] = 0;
    }
  }
  codeLengthsTable = huffmanTable.buildHuffmanTable(codeLengths);

  /**
   * decode function
   * @param {number} num number of lengths.
   * @param {!Array} table code lengths table.
   * @param {!(Uint8Array|Array.<number>)} lengths code lengths buffer.
   * @return {!(Uint8Array|Array.<number>)} code lengths buffer.
   */
  function decode(num, table, lengths) {
    /** @type {number} */
    var code;
    /** @type {number} */
    var prev = this.prev;
    /** @type {number} */
    var repeat;
    /** @type {number} */
    var i;

    for (i = 0; i < num;) {
      code = this.readCodeByTable(table);
      switch (code) {
        case 16:
          repeat = 3 + this.readBits(2);
          while (repeat--) { lengths[i++] = prev; }
          break;
        case 17:
          repeat = 3 + this.readBits(3);
          while (repeat--) { lengths[i++] = 0; }
          prev = 0;
          break;
        case 18:
          repeat = 11 + this.readBits(7);
          while (repeat--) { lengths[i++] = 0; }
          prev = 0;
          break;
        default:
          lengths[i++] = code;
          prev = code;
          break;
      }
    }

    this.prev = prev;

    return lengths;
  }

  // literal and length code
  litlenLengths = new (Uint8Array)(hlit);

  // distance code
  distLengths = new (Uint8Array)(hdist);

  this.prev = 0;
  this.decodeHuffman(
    huffmanTable.buildHuffmanTable(decode.call(this, hlit, codeLengthsTable, litlenLengths)),
    huffmanTable.buildHuffmanTable(decode.call(this, hdist, codeLengthsTable, distLengths))
  );
};

/**
 * decode huffman code
 * @param {!Array} litlen literal and length code table.
 * @param {!Array} dist distination code table.
 */
RawInflate.prototype.decodeHuffman = function(litlen, dist) {
  var output = this.output;
  var op = this.op;

  this.currentLitlenTable = litlen;

  /** @type {number} output position limit. */
  var olength = output.length - this.MaxCopyLength;
  /** @type {number} huffman code. */
  var code;
  /** @type {number} table index. */
  var ti;
  /** @type {number} huffman code distination. */
  var codeDist;
  /** @type {number} huffman code length. */
  var codeLength;

  while ((code = this.readCodeByTable(litlen)) !== 256) {
    // literal
    if (code < 256) {
      if (op >= olength) {
        this.op = op;
        output = this.expandBuffer();
        op = this.op;
      }
      output[op++] = code;

      continue;
    }

    // length code
    ti = code - 257;
    codeLength = this.LengthCodeTable[ti];
    if (this.LengthExtraTable[ti] > 0) {
      codeLength += this.readBits(this.LengthExtraTable[ti]);
    }

    // dist code
    code = this.readCodeByTable(dist);
    codeDist = this.DistCodeTable[code];
    if (this.DistExtraTable[code] > 0) {
      codeDist += this.readBits(this.DistExtraTable[code]);
    }

    // lz77 decode
    if (op >= olength) {
      this.op = op;
      output = this.expandBuffer();
      op = this.op;
    }
    while (codeLength--) {
      output[op] = output[(op++) - codeDist];
    }
  }

  while (this.bitsbuflen >= 8) {
    this.bitsbuflen -= 8;
    this.ip--;
  }
  this.op = op;
};

/**
 * decode huffman code (adaptive)
 * @param {!Array} litlen literal and length code table.
 * @param {!Array} dist distination code table.
 */
RawInflate.prototype.decodeHuffmanAdaptive = function(litlen, dist) {
  var output = this.output;
  var op = this.op;

  this.currentLitlenTable = litlen;

  /** @type {number} output position limit. */
  var olength = output.length;
  /** @type {number} huffman code. */
  var code;
  /** @type {number} table index. */
  var ti;
  /** @type {number} huffman code distination. */
  var codeDist;
  /** @type {number} huffman code length. */
  var codeLength;

  while ((code = this.readCodeByTable(litlen)) !== 256) {
    // literal
    if (code < 256) {
      if (op >= olength) {
        output = this.expandBuffer();
        olength = output.length;
      }
      output[op++] = code;

      continue;
    }

    // length code
    ti = code - 257;
    codeLength = this.LengthCodeTable[ti];
    if (this.LengthExtraTable[ti] > 0) {
      codeLength += this.readBits(this.LengthExtraTable[ti]);
    }

    // dist code
    code = this.readCodeByTable(dist);
    codeDist = this.DistCodeTable[code];
    if (this.DistExtraTable[code] > 0) {
      codeDist += this.readBits(this.DistExtraTable[code]);
    }

    // lz77 decode
    if (op + codeLength > olength) {
      output = this.expandBuffer();
      olength = output.length;
    }
    while (codeLength--) {
      output[op] = output[(op++) - codeDist];
    }
  }

  while (this.bitsbuflen >= 8) {
    this.bitsbuflen -= 8;
    this.ip--;
  }
  this.op = op;
};

/**
 * expand output buffer.
 * @param {Object=} opt_param option parameters.
 * @return {!(Array.<number>|Uint8Array)} output buffer.
 */
RawInflate.prototype.expandBuffer = function() {
  /** @type {!(Array.<number>|Uint8Array)} store buffer. */
  var buffer =
    new (Uint8Array)(
        this.op - this.MaxBackwardLength
    );
  /** @type {number} backward base point */
  var backward = this.op - this.MaxBackwardLength;
  /** @type {number} copy index. */
  var i;
  /** @type {number} copy limit */
  var il;

  var output = this.output;

  // copy to output buffer
  if (USE_TYPEDARRAY) {
    buffer.set(output.subarray(this.MaxBackwardLength, buffer.length));
  } else {
    for (i = 0, il = buffer.length; i < il; ++i) {
      buffer[i] = output[i + this.MaxBackwardLength];
    }
  }

  this.blocks.push(buffer);
  this.totalpos += buffer.length;

  // copy to backward buffer
  if (USE_TYPEDARRAY) {
    output.set(
      output.subarray(backward, backward + this.MaxBackwardLength)
    );
  } else {
    for (i = 0; i < this.MaxBackwardLength; ++i) {
      output[i] = output[backward + i];
    }
  }

  this.op = this.MaxBackwardLength;

  return output;
};

/**
 * expand output buffer. (adaptive)
 * @param {Object=} opt_param option parameters.
 * @return {!(Array.<number>|Uint8Array)} output buffer pointer.
 */
RawInflate.prototype.expandBufferAdaptive = function(opt_param) {
  /** @type {!(Array.<number>|Uint8Array)} store buffer. */
  var buffer;
  /** @type {number} expantion ratio. */
  var ratio = (this.input.length / this.ip + 1) | 0;
  /** @type {number} maximum number of huffman code. */
  var maxHuffCode;
  /** @type {number} new output buffer size. */
  var newSize;
  /** @type {number} max inflate size. */
  var maxInflateSize;

  var input = this.input;
  var output = this.output;

  if (opt_param) {
    if (typeof opt_param.fixRatio === 'number') {
      ratio = opt_param.fixRatio;
    }
    if (typeof opt_param.addRatio === 'number') {
      ratio += opt_param.addRatio;
    }
  }

  // calculate new buffer size
  if (ratio < 2) {
    maxHuffCode =
      (input.length - this.ip) / this.currentLitlenTable[2];
    maxInflateSize = (maxHuffCode / 2 * 258) | 0;
    newSize = maxInflateSize < output.length ?
      output.length + maxInflateSize :
      output.length << 1;
  } else {
    newSize = output.length * ratio;
  }

  // buffer expantion
  if (USE_TYPEDARRAY) {
    buffer = new Uint8Array(newSize);
    buffer.set(output);
  } else {
    buffer = output;
  }

  this.output = buffer;

  return this.output;
};

/**
 * concat output buffer.
 * @return {!(Array.<number>|Uint8Array)} output buffer.
 */
RawInflate.prototype.concatBuffer = function() {
  /** @type {number} buffer pointer. */
  var pos = 0;
  /** @type {number} buffer pointer. */
  var limit = this.totalpos + (this.op - this.MaxBackwardLength);
  /** @type {!(Array.<number>|Uint8Array)} output block array. */
  var output = this.output;
  /** @type {!Array} blocks array. */
  var blocks = this.blocks;
  /** @type {!(Array.<number>|Uint8Array)} output block array. */
  var block;
  /** @type {!(Array.<number>|Uint8Array)} output buffer. */
  var buffer = new (Uint8Array)(limit);
  /** @type {number} loop counter. */
  var i;
  /** @type {number} loop limiter. */
  var il;
  /** @type {number} loop counter. */
  var j;
  /** @type {number} loop limiter. */
  var jl;

  // single buffer
  if (blocks.length === 0) {
    return USE_TYPEDARRAY ?
      this.output.subarray(this.MaxBackwardLength, this.op) :
      this.output.slice(this.MaxBackwardLength, this.op);
  }

  // copy to buffer
  for (i = 0, il = blocks.length; i < il; ++i) {
    block = blocks[i];
    for (j = 0, jl = block.length; j < jl; ++j) {
      buffer[pos++] = block[j];
    }
  }

  // current buffer
  for (i = this.MaxBackwardLength, il = this.op; i < il; ++i) {
    buffer[pos++] = output[i];
  }

  this.blocks = [];
  this.buffer = buffer;

  return this.buffer;
};

/**
 * concat output buffer. (dynamic)
 * @return {!(Array.<number>|Uint8Array)} output buffer.
 */
RawInflate.prototype.concatBufferDynamic = function() {
  /** @type {Array.<number>|Uint8Array} output buffer. */
  var buffer;
  var op = this.op;

  if (USE_TYPEDARRAY) {
    if (this.resize) {
      buffer = new Uint8Array(op);
      buffer.set(this.output.subarray(0, op));
    } else {
      buffer = this.output.subarray(0, op);
    }
  } else {
    if (this.output.length > op) {
      this.output.length = op;
    }
    buffer = this.output;
  }

  this.buffer = buffer;

  return this.buffer;
};

/* vim:set expandtab ts=2 sw=2 tw=80: */
