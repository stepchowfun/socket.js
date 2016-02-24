var socketjs = (function() {
  'use strict';

  // messages are converted to JSON before being sent down the wire
  // this function is used to validate that an object can be converted to JSON
  var jsonConvertible = function(x) {
    try {
      if (typeof JSON.stringify(x) !== 'string') {
        return false;
      }
    } catch (e) {
      return false;
    }
    return true;
  };

  return {
    // check if the browser supports WebSockets
    isSupported: function() {
      return typeof WebSocket !== 'undefined';
    },

    // initiate a connection
    connect: function(host, secure) {
      if (host !== undefined && typeof host !== 'string') {
        throw 'Invalid parameter: host';
      }

      if (secure !== undefined && typeof secure !== 'boolean') {
        throw 'Invalid parameter: secure';
      }

      if (!socketjs.isSupported()) {
        throw 'WebSockets are not supported';
      }

      var wss = secure === undefined ? (location.protocol.toLowerCase() === 'https:') : secure;
      var url = (wss ? 'wss://' : 'ws://') + (host === undefined ? window.location.host : host) + '/';
      var websocket = null;
      var permanentlyClosed = false;
      var temporarilyDisconnected = false;
      var messageHandlers = {};
      var disconnectHandler = null;
      var reconnectHandler = null;
      var closeHandler = null;
      var outgoingQueue = [];

      // this function creates a WebSocket and ensures that
      // the appropriate callbacks are attached before any
      // events are fired
      var makeWebSocket = function(url) {
        var connection = new WebSocket(url);
        connection.onopen = onSocketOpen;
        connection.onmessage = onSocketMessage;
        connection.onclose = onSocketClose;
        return connection;
      };

      // called once the socket is connected
      var onSocketOpen = function() {
        // check if we just reconnected after some downtime
        if (temporarilyDisconnected) {
          temporarilyDisconnected = false;

          // clear the outgoing queue
          if (outgoingQueue.length > 0) {
            outgoingQueue.splice(0, outgoingQueue.length);
          }

          // notify the application and gather any context to send to the server
          var reconnectData = null;
          if (reconnectHandler !== null) {
            reconnectData = reconnectHandler();
            if (reconnectData === undefined) {
              reconnectData = null;
            }
            if (!jsonConvertible(reconnectData)) {
              throw 'Invalid reconnectData';
            }
          }

          // let the server know we reconnected from a previously severed connection
          outgoingQueue.push({
            type: 'reconnect',
            reconnectData: reconnectData
          });
        }

        // send any messages in the queue
        flushOutgoingQueue();
      };

      // called when there is new data from the server
      var onSocketMessage = function(e) {
        var data = JSON.parse(e.data);
        if (data.type === 'message') {
          // send the message to the application
          if (messageHandlers[data.messageType] !== undefined) {
            messageHandlers[data.messageType](data.message);
          }
        } else if (data.type === 'close') {
          // the server wants to close the socket
          close();
        }
      };

      // called when the socket is closed
      var onSocketClose = function() {
        if (!permanentlyClosed) {
          // we didn't get a "close" message from the server
          // so interpret this as a temporary network interruption
          if (!temporarilyDisconnected) {
            temporarilyDisconnected = true;

            if (disconnectHandler !== null) {
              disconnectHandler();
            }
          }

          // attempt to set up a new socket, retry on failure
          var reconnectingInterval = setInterval(function() {
            if (!permanentlyClosed) {
              try {
                websocket = makeWebSocket(url);
              } catch (e) {
                return;
              }
            }
            clearInterval(reconnectingInterval);
          }, 2000);
        }
      };

      // attempt to send all messages in the queue
      var flushOutgoingQueue = function() {
        if (permanentlyClosed || temporarilyDisconnected) {
          // just drop messages if the connection is down
          if (outgoingQueue.length > 0) {
            outgoingQueue.splice(0, outgoingQueue.length);
          }
        } else {
          // send the messages to the server if the socket is ready
          if (websocket.readyState === WebSocket.OPEN) {
            for (var i = 0; i < outgoingQueue.length; i += 1) {
              websocket.send(JSON.stringify(outgoingQueue[i]));
            }
            if (i > 0) {
              outgoingQueue.splice(0, i);
            }
          }
        }
      };

      // call this function to close the socket
      var close = function() {
        if (!permanentlyClosed) {
          permanentlyClosed = true;

          // actually close the WebSocket
          if (websocket.readyState !== WebSocket.CLOSING &&
              websocket.readyState !== WebSocket.CLOSED) {
            websocket.close();
          }

          // let the application know the connection was closed
          if (closeHandler !== null) {
            closeHandler();
          }
        }
      };

      // connect to the server for the first time
      websocket = makeWebSocket(url);

      // let the server know this is the first connection (we aren't
      // reconnecting from a temporary network failure)
      outgoingQueue.push({
        type: 'connect'
      });
      flushOutgoingQueue();

      return {
        // send a message to the server
        send: function(type, message) {
          if (typeof type !== 'string') {
            throw 'Invalid parameter: type';
          }

          if (!jsonConvertible(message)) {
            throw 'Invalid parameter: message';
          }

          if (permanentlyClosed) {
            throw 'Attempted to transmit after the connection has been closed';
          }

          if (!temporarilyDisconnected) {
            outgoingQueue.push({
              type: 'message',
              messageType: type,
              message: message
            });
            flushOutgoingQueue();
          }
        },

        // register a callback to receive messages from the server
        receive: function(type, handler) {
          if (typeof type !== 'string') {
            throw 'Invalid parameter: type';
          }

          if (handler !== null && typeof handler !== 'function') {
            throw 'Invalid parameter: handler';
          }

          if (permanentlyClosed) {
            throw 'Attempted to set message handler after the connection has been closed';
          }

          if (handler === null) {
            delete messageHandlers[type];
          } else {
            messageHandlers[type] = handler;
          }
        },

        // register a callback to be invoked when the network is interrupted
        disconnect: function(handler) {
          if (handler !== null && typeof handler !== 'function') {
            throw 'Invalid parameter: handler';
          }

          if (permanentlyClosed) {
            throw 'Attempted to set disconnect handler after the connection has been closed';
          }

          disconnectHandler = handler;
        },

        // register a callback to be invoked when the network is restored
        reconnect: function(handler) {
          if (handler !== null && typeof handler !== 'function') {
            throw 'Invalid parameter: handler';
          }

          if (permanentlyClosed) {
            throw 'Attempted to set reconnect handler after the connection has been closed';
          }

          reconnectHandler = handler;
        },

        // close the connection or register a callback to be notified when the connection is closed
        close: function(handler) {
          if (handler !== undefined && handler !== null && typeof handler !== 'function') {
            throw 'Invalid parameter: handler';
          }

          if (handler === undefined) {
            close();
          } else {
            closeHandler = handler;
          }
        }
      };
    }
  };
})();

if (typeof module !== 'undefined') {
  module.exports = socketjs;
}
