'use strict';

var crypto = require('crypto');

// messages are converted to JSON before being sent down the wire
// this function is used to validate that an object can be converted to JSON
function jsonConvertible(x) {
  try {
    if (typeof JSON.stringify(x) !== 'string') {
      return false;
    }
  } catch (e) {
    return false;
  }
  return true;
}

// this function registers a callback to receive the connection
module.exports = function(httpServer, handler) {
  // this event is fired whenever the client attempts to initiate a connection upgrade
  httpServer.on('upgrade', function(req, socket, head) {
    // make sure the upgrade is for the WebSockets protocol
    if (req.headers['upgrade'].toLowerCase() === 'websocket') {
      // we only support version 13 of the protocol, which
      // is the latest at the time of this writing
      var version = req.headers['sec-websocket-version'];
      if (version === '13') {
        // we have to send back this magic to the client to finish the handshake
        var key = req.headers['sec-websocket-key'];
        socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n' +
          '\r\n');

        var started = false;
        var closed = false;
        var closeHandler = null;
        var messageHandlers = {};
        var dataReceived = new Buffer(0);
        var payloadReceived = new Buffer(0);

        // send a message to the client
        var sendMessage = function(message) {
          if (!closed) {
            // convert to JSON for sending down the wire
            var data = JSON.stringify(message);

            // FIN, RSV1-3, and opcode
            socket.write(new Buffer([129]));

            // funky variable-width encoding of the payload length
            var payloadLengthBuffer;
            if (data.length < 126) {
              payloadLengthBuffer = new Buffer([data.length]);
            } else if (data.length < 65536) {
              payloadLengthBuffer = new Buffer(3);
              payloadLengthBuffer.writeUInt8(126, 0);
              payloadLengthBuffer.writeUInt16BE(data.length, 1);
            } else {
              payloadLengthBuffer = new Buffer(9);
              payloadLengthBuffer.writeUInt8(127, 0);
              payloadLengthBuffer.writeUInt16BE(0, 1);
              payloadLengthBuffer.writeUInt16BE(data.length, 5);
            }
            socket.write(payloadLengthBuffer);

            // send the actual payload
            socket.write(data);
          }
        };

        // call this when the connection is closed
        // or when we want to close the connection
        var close = function(needToCloseSocket) {
          if (!closed) {
            // ask the client to close the socket if necessary
            if (needToCloseSocket) {
              sendMessage({
                type: 'close'
              });
            }

            // mark the connection as closed and clean up
            closed = true;
            dataReceived = new Buffer(0);

            // notify the application
            if (closeHandler !== null) {
              closeHandler();
            }
          }
        };

        socket.on('data', function(data) {
          if (closed) {
            return;
          }

          // collect all the unprocessed data received so far
          dataReceived = Buffer.concat([dataReceived, data], dataReceived.length + data.length);

          // eat as much data as possible, one frame at a time
          while (true) {
            // read the FIN bit
            var nextByteIndex = 0;
            if (dataReceived.length < nextByteIndex + 1) {
              return;
            }
            var fin = (dataReceived.readUInt8(0) >> 7) === 1;

            // read the opcode
            var opcode = dataReceived.readUInt8(0) & 15;
            if (opcode === 8) {
              // client closed the connection
              close(true);
              return;
            }
            nextByteIndex += 1;

            // read the mask bit
            if (dataReceived.length < nextByteIndex + 1) {
              return;
            }
            var mask = (dataReceived.readUInt8(1) >> 7) === 1;

            // read the payload length (it's a variable-width encoding)
            var payloadLength;
            if ((dataReceived.readUInt8(1) & 127) < 126) {
              payloadLength = dataReceived.readUInt8(1) & 127;
              nextByteIndex += 1;
            } else if ((dataReceived.readUInt8(1) & 127) === 126) {
              if (dataReceived.length < nextByteIndex + 3) {
                return;
              }
              payloadLength = dataReceived.readUInt16BE(2);
              nextByteIndex += 3;
            } else {
              if (dataReceived.length < nextByteIndex + 9) {
                return;
              }
              payloadLength = (dataReceived.readUInt32BE(2) << 32) + dataReceived.readUInt32BE(6);
              nextByteIndex += 9;
            }

            // read the masking key for decrypting the message, if there is one
            var maskingKey;
            if (mask) {
              if (dataReceived.length < nextByteIndex + 4) {
                return;
              }
              maskingKey = dataReceived.slice(nextByteIndex, nextByteIndex + 4);
              nextByteIndex += 4;
            }

            // check if we got the whole frame yet
            if (dataReceived.length < nextByteIndex + payloadLength) {
              return;
            }

            // decrypt the message if necessary
            if (mask) {
              for (var i = 0; i < payloadLength; i += 1) {
                dataReceived.writeUInt8(dataReceived.readUInt8(nextByteIndex + i) ^ maskingKey.readUInt8(i % 4), nextByteIndex + i);
              }
            }

            // read the payload
            payloadReceived = Buffer.concat([payloadReceived, dataReceived.slice(nextByteIndex, nextByteIndex + payloadLength)], payloadReceived.length + payloadLength);
            nextByteIndex += payloadLength;

            // if the message fits in one frame, we got it all
            if (fin) {
              if (opcode === 1) {
                var messageData;
                try {
                  // try to parse the message
                  messageData = JSON.parse(payloadReceived.toString());
                } catch (e) {
                  close(true);
                  return;
                }
                if (messageData.type === 'connect') {
                  // the client is connecting for the first time
                  if (!started) {
                    started = true;
                    start(null);
                  }
                } else if (messageData.type === 'reconnect') {
                  // the client is reconnecting
                  if (!started) {
                    started = true;
                    start(messageData.reconnectData);
                  }
                } else if (messageData.type === 'message') {
                  // send the message to the application
                  if (messageHandlers[messageData.messageType] !== undefined) {
                    messageHandlers[messageData.messageType](messageData.message);
                  }
                }
              }
              payloadReceived = new Buffer(0);
            }

            // free the data for this frame
            if (dataReceived.length === nextByteIndex) {
              dataReceived = new Buffer(0);
            } else {
              dataReceived = dataReceived.slice(nextByteIndex);
            }
          }
        });

        // when the socket is closed, we're done here
        socket.on('close', function(data) {
          close(false);
        });

        // this is called once the client tells us that
        // a) this is a new connection, or
        // b) we are reconnecting
        var start = function(reconnectData) {
          handler({
            // send a message to the client
            send: function(type, message) {
              if (typeof type !== 'string') {
                throw 'Invalid parameter: type';
              }

              if (!jsonConvertible(message)) {
                throw 'Invalid parameter: message';
              }

              if (closed) {
                throw 'Attempted to transmit after the connection has been closed';
              }

              sendMessage({
                type: 'message',
                messageType: type,
                message: message
              });
            },

            // register a callback to receive messages from the client
            receive: function(type, handler) {
              if (typeof type !== 'string') {
                throw 'Invalid parameter: type';
              }

              if (handler !== null && typeof handler !== 'function') {
                throw 'Invalid parameter: handler';
              }

              if (handler === null) {
                delete messageHandlers[type];
              } else {
                messageHandlers[type] = handler;
              }
            },

            // close the connection or register a callback to be notified when the connection is closed
            close: function(handler) {
              if (handler !== undefined && handler !== null && typeof handler !== 'function') {
                throw 'Invalid parameter: handler';
              }

              if (handler === undefined) {
                close(true);
              } else {
                closeHandler = handler;
              }
            }
          }, reconnectData);
        };
      } else {
        socket.end();
      }
    } else {
      socket.end();
    }
  });
};
