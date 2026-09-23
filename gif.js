//
//  gif.js
//  A JavaScript GIF parser.
//
//  Copyright (c) 2011 antimatter15 (antimatter15@gmail.com)
//
var Stream = function (data) {
  this.data = data;
  this.len = this.data.length;
  this.pos = 0;

  this.readByte = function () {
    if (this.pos >= this.data.length) {
      throw new Error('Attempted to read past end of stream.');
    }
    if (data instanceof Uint8Array)
      return data[this.pos++];
    else
      return data.charCodeAt(this.pos++) & 0xFF;
  };

  this.readBytes = function (n) {
    var bytes = [];
    for (var i = 0; i < n; i++) {
      bytes.push(this.readByte());
    }
    return bytes;
  };

  this.read = function (n) {
    var s = '';
    for (var i = 0; i < n; i++) {
      s += String.fromCharCode(this.readByte());
    }
    return s;
  };

  this.readUnsigned = function () { // Little-endian.
    var a = this.readBytes(2);
    return (a[1] << 8) + a[0];
  };
};

var parseGIF = function (stream, handler) {
  handler || (handler = {});

  var parseCT = function (entries) { // Each entry is 3 bytes, for RGB.
    var ct = [];
    for (var i = 0; i < entries; i++) {
      ct.push(stream.readBytes(3));
    }
    return ct;
  };

  var readSubBlocks = function () {
    var size, data;
    data = '';
    do {
      size = stream.readByte();
      data += stream.read(size);
    } while (size !== 0);
    return data;
  };

  var parseHeader = function () {
    var hdr = {};
    hdr.sig = stream.read(3);
    hdr.ver = stream.read(3);
    if (hdr.sig !== 'GIF') throw new Error('Not a GIF file.'); // XXX: This should probably be handled more nicely.
    hdr.width = stream.readUnsigned();
    hdr.height = stream.readUnsigned();

    var bits = stream.readBytes(1)[0];
    hdr.gctFlag = (bits & 0x80) !== 0;
    hdr.colorRes = (bits & 0x70) >> 4;
    hdr.sorted = (bits & 0x08) !== 0;
    hdr.gctSize = 1 << ((bits & 0x07) + 1);

    hdr.bgColor = stream.readByte();
    hdr.pixelAspectRatio = stream.readByte(); // if not 0, aspectRatio = (pixelAspectRatio + 15) / 64
    if (hdr.gctFlag) {
      hdr.gct = parseCT(hdr.gctSize);
    }
    handler.hdr && handler.hdr(hdr);
  };

  var parseExt = function (block) {
    var parseGCExt = function (block) {
      var blockSize = stream.readByte(); // Always 4
      var bits = stream.readBytes(1)[0];
      block.reserved = (bits & 0xE0) >> 5;
      block.disposalMethod = (bits & 0x1C) >> 2;
      block.userInput = (bits & 0x02) !== 0;
      block.transparencyGiven = (bits & 0x01) !== 0;

      block.delayTime = stream.readUnsigned();

      block.transparencyIndex = stream.readByte();

      block.terminator = stream.readByte();

      handler.gce && handler.gce(block);
    };

    var parseComExt = function (block) {
      block.comment = readSubBlocks();
      handler.com && handler.com(block);
    };

    var parsePTExt = function (block) {
      var blockSize = stream.readByte(); // Always 12
      block.ptHeader = stream.readBytes(12);
      block.ptData = readSubBlocks();
      handler.pte && handler.pte(block);
    };

    var parseAppExt = function (block) {
      var parseNetscapeExt = function (block) {
        var blockSize = stream.readByte(); // Always 3
        block.unknown = stream.readByte(); // ??? Always 1? What is this?
        block.iterations = stream.readUnsigned();
        block.terminator = stream.readByte();
        handler.app && handler.app.netscape && handler.app.netscape(block);
      };

      var parseUnknownAppExt = function (block) {
        block.appData = readSubBlocks();
        handler.app && handler.app[block.identifier] && handler.app[block.identifier](block);
      };

      var blockSize = stream.readByte(); // Always 11
      block.identifier = stream.read(8);
      block.authCode = stream.read(3);
      switch (block.identifier) {
        case 'NETSCAPE':
          parseNetscapeExt(block);
          break;
        default:
          parseUnknownAppExt(block);
          break;
      }
    };

    var parseUnknownExt = function (block) {
      block.data = readSubBlocks();
      handler.unknown && handler.unknown(block);
    };

    block.label = stream.readByte();
    switch (block.label) {
      case 0xF9: block.extType = 'gce'; parseGCExt(block); break;
      case 0xFE: block.extType = 'com'; parseComExt(block); break;
      case 0x01: block.extType = 'pte'; parsePTExt(block); break;
      case 0xFF: block.extType = 'app'; parseAppExt(block); break;
      default: block.extType = 'unknown'; parseUnknownExt(block); break;
    }
  };

  var parseImg = function (img) {
    var deinterlace = function (pixels, width) {
      var newPixels = new Array(pixels.length);
      var rows = pixels.length / width;
      var cpRow = function (toRow, fromRow) {
        var fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
        newPixels.splice.apply(newPixels, [toRow * width, width].concat(fromPixels));
      };

      var offsets = [0, 4, 2, 1]; var steps = [8, 8, 4, 2];
      var fromRow = 0;
      for (var pass = 0; pass < 4; pass++) {
        for (var toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
          cpRow(toRow, fromRow);
          fromRow++;
        }
      }

      return newPixels;
    };

    img.leftPos = stream.readUnsigned();
    img.topPos = stream.readUnsigned();
    img.width = stream.readUnsigned();
    img.height = stream.readUnsigned();

    var bits = stream.readBytes(1)[0];
    img.lctFlag = (bits & 0x80) !== 0;
    img.interlaced = (bits & 0x40) !== 0;
    img.sorted = (bits & 0x20) !== 0;
    img.reserved = (bits & 0x18) >> 3;
    img.lctSize = 1 << ((bits & 0x07) + 1);

    if (img.lctFlag) {
      img.lct = parseCT(img.lctSize);
    }

    img.lzwMinCodeSize = stream.readByte();
    var lzwData = readSubBlocks();
    img.pixels = lzwDecode(img.lzwMinCodeSize, lzwData);

    if (img.interlaced) {
      img.pixels = deinterlace(img.pixels, img.width);
    }

    handler.img && handler.img(img);
  };

  var parseBlock = function () {
    var block = {};
    block.sentinel = stream.readByte();

    switch (String.fromCharCode(block.sentinel)) {
      case '!': block.type = 'ext'; parseExt(block); break;
      case ',': block.type = 'img'; parseImg(block); break;
      case ';': block.type = 'eof'; handler.eof && handler.eof(block); break;
      default: throw new Error('Unknown block: 0x' + block.sentinel.toString(16));
    }

    if (block.type !== 'eof') {
      parseBlock();
    }
  };

  var lzwDecode = function (minCodeSize, data) {
    var pos = 0;
    var readCode = function (size) {
      var code = 0;
      for (var i = 0; i < size; i++) {
        if (data.charCodeAt(pos >> 3) & (1 << (pos & 7))) {
          code |= 1 << i;
        }
        pos++;
      }
      return code;
    };

    var output = [];
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var dict = [];

    var clear = function () {
      dict = [];
      codeSize = minCodeSize + 1;
      for (var i = 0; i < clearCode; i++) {
        dict[i] = [i];
      }
      dict[clearCode] = [];
      dict[eoiCode] = null;
    };

    var code;
    var last;

    while (true) {
      last = code;
      code = readCode(codeSize);

      if (code === clearCode) {
        clear();
        continue;
      }
      if (code === eoiCode) break;

      if (code < dict.length) {
        if (last !== clearCode) {
          dict.push(dict[last].concat(dict[code][0]));
        }
      } else {
        if (code !== dict.length) throw new Error('Invalid LZW code.');
        dict.push(dict[last].concat(dict[last][0]));
      }
      output.push.apply(output, dict[code]);

      if (dict.length === (1 << codeSize) && codeSize < 12) {
        codeSize++;
      }
    }
    return output;
  };

  parseHeader();
  parseBlock();
};

var GIF = function (arrayBuffer) {
    var data = new Uint8Array(arrayBuffer);
    var stream = new Stream(data);
    var frames = [];
    var gce = null;
    var hdr = null;
    
    var handler = {
        hdr: function(h) {
            hdr = h;
        },
        gce: function(g) {
            gce = g;
        },
        img: function (img) {
            var ct = img.lctFlag ? img.lct : hdr.gct;
            var c = document.createElement('canvas');
            c.width = hdr.width;
            c.height = hdr.height;
            var ctx = c.getContext('2d');
            var imageData = ctx.createImageData(img.width, img.height);
            
            img.pixels.forEach(function(pixel, i) {
                imageData.data[i * 4 + 0] = ct[pixel][0];
                imageData.data[i * 4 + 1] = ct[pixel][1];
                imageData.data[i * 4 + 2] = ct[pixel][2];
                imageData.data[i * 4 + 3] = gce.transparencyGiven && gce.transparencyIndex === pixel ? 0 : 255;
            });
            
            ctx.putImageData(imageData, img.leftPos, img.topPos);
            
            frames.push({
                data: c,
                delay: gce.delayTime * 10,
                disposal: gce.disposalMethod,
                dims: {
                    width: img.width,
                    height: img.height,
                    top: img.topPos,
                    left: img.leftPos
                },
                patch: imageData.data
            });
        },
        eof: function(block) {
            // Nothing to do
        }
    };
    
    parseGIF(stream, handler);
    
    return {
        // AQUI ESTÁ A ÚNICA MUDANÇA: Expondo o 'hdr' para podermos ler a largura/altura
        hdr: hdr, 
        decompressFrames: function(asImageData) {
            return frames;
        }
    };
};