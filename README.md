# Socket.js

Socket.js is a real-time communication framework for [Node.js](https://nodejs.org/) powered by [WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API). It has no dependencies.

## Introduction

Socket.js is lightweight. The minified client is under 3kb. Contrast this with [socket.io](http://socket.io/), which is 95kb minified.

But it's not a fair comparison. Socket.js relies on WebSockets and does not include any fallback transport mechanisms. So only use it when you can assume WebSocket support in your audience's browsers. Most modern browsers support WebSockets; check [here](http://caniuse.com/#feat=websockets) for a compatibility chart.

Socket.js is a well-behaved library. Unlike most event-based communication engines, socket.js will not:

* ...deliver messages out of order.
* ...deliver duplicate messages.
* ...deliver messages after the application thinks the socket has been closed.
* ...deliver queued up messages before the "reconnect" event is fired in the case of a temporary network failure.
* ...leak memory in the server or client.
* ...have undefined or insecure behavior if it receives a malformed or malicious message from a client.

Socket.js will:

* ...automatically reconnect if the connection is lost, unless it was intentionally closed by the application.
* ...validate inputs to all methods and [fail fast](https://en.wikipedia.org/wiki/Fail-fast).
* ...drop messages (and not resend them) if there is a network interruption.

That last point may be surprising to you. If you want messages to be resent in the case of failure, you must build that functionality into your application. The server has no idea if or when the client will come back, so it would have to keep queued messages for some arbitrary TTL and then subsequently vacuum them if the client never reconnects. Then, if the client finally does connect after the queue has been deleted, those messages would be dropped anyway. Socket.js is honest about its behavior: it will start dropping messages immediately if there is a network interruption, and it will start sending new messages once the connection is reestablished.

Socket.js was designed to support many simultaneous connections. If a connection is dropped, the server will not hold references to any queued messages or other data structures for that client. It is up to the client to provide any context needed by the server (e.g., a session ID for some session store) when reconnecting.

## Installation

### Server

Install socket.js with [npm](https://www.npmjs.com/package/socket.js).

```bash
npm install socket.js
```

### Client

The minified JavaScript can be found in the root directory of this repository.

```html
<script src="socket.min.js"></script>
```

## Server API

Socket.js exposes a single function:

```javascript
var socketjs = require('socket.js');

socketjs(httpServer, handler);
```

`httpServer` is an instance of [`http.Server`](https://nodejs.org/api/http.html#http_class_http_server) from the Node.js standard library. For example:

```javascript
var http = require('http');

var server = http.createServer();
server.listen(3000, function() {
  console.log('Listening on port 3000.');
});
```

`handler` is a callback that takes two parameters, `socket` and `reconnectData`. `socket` is an object with the following methods:

* `socket.send(type, message)` sends a message to the client. `type` is a string indicating the type of message. `message` is any value that can be converted to JSON.
* `socket.receive(type, handler)` registers a handler for a particular type of message. `type` is a string, and `handler` is a function which takes the message as an argument. If `handler === null`, any existing handler for this message type is removed.
* `socket.close(handler)` registers a callback to be invoked when the connection is closed, either intentionally or because of a network interruption. If `handler === null`, any existing handler for this event is removed. If `handler` is not provided (or `handler === undefined`), this method closes the socket.

`reconnectData` is an optional value provided by the client when it reconnects in the case of a network interruption. If the client does not provide this value, it will be `null`.

### Example server

```javascript
var http = require('http');
var socketjs = require('socket.js');

// start an http server
var server = http.createServer();
server.listen(3000, function() {
  console.log('Listening on port 3000.');
});

socketjs(server, function(socket, reconnectData) {
  // if we get disconnected and subsequently reconnect, the client can pass data here
  if (reconnectData === null) {
    console.log('A user connected.');
  } else {
    console.log('A user reconnected with: ', reconnectData);
  }

  // log messages as they arrive
  socket.receive('greeting', function(message) {
    console.log('Received:', message);
  });

  // periodically send messages to the client
  var interval = setInterval(function() {
    socket.send('greeting', 'Hello from the server!');
  }, 1000);

  // if the client disconnects, stop sending messages to it
  socket.close(function() {
    console.log('A user disconnected.');

    clearInterval(interval);
  });
});
```

## Client API

Socket.js exposes a top-level object named `socketjs` with two methods:

* `socketjs.isSupported()` returns a boolean indicating whether the browser supports WebSockets.
* `socketjs.connect(host, secure)` returns an object representing the connection to the server. `host` is the name of the host and optionally the port, separated by a colon. `secure` is a boolean indicating whether to use the `WS` or the `WSS` protocol. If these parameters are missing, Socket.js will attempt to connect to the host that served the page, using the same port and security level.

The object returned by `socketjs.connect()` supports the following methods:

* `send(type, message)` sends a message to the server. `type` is a string indicating the type of message. `message` is any value that can be converted to JSON.
* `socket.receive(type, handler)` registers a handler for a particular type of message. `type` is a string, and `handler` is a function which takes the message as an argument. If `handler === null`, any existing handler for this message type is removed.
* `socket.disconnect(handler)` registers a callback to be invoked when the network is interrupted. If `handler === null`, any existing handler for this event is removed.
* `socket.reconnect(handler)` registers a callback to be invoked when the connection is restored after a network interruption. The value returned by the callback will be sent to the server (see `reconnectData` above). If `handler === null`, any existing handler for this event is removed.
* `socket.close(handler)` registers a callback to be invoked when the connection is closed by either the server or the client. If `handler === null`, any existing handler for this event is removed. If `handler` is not provided (or `handler === undefined`), this method closes the socket.

### Example client

```javascript
// make sure socket.js is supported
if (socketjs.isSupported()) {
  // connect to the server
  var socket = socketjs.connect();

  // log messages as they arrive
  socket.receive('greeting', function(data) {
    console.log('Received:', data);
  });

  // log a message if we get disconnected
  socket.disconnect(function() {
    console.log('Temporarily disconnected.');
  });

  // log a message when we reconnect
  socket.reconnect(function() {
    console.log('Reconnected.');

    // whatever we return here is sent back to the server
    return 'reconnected';
  });

  // periodically send messages the server
  var interval = setInterval(function() {
    socket.send('greeting', 'Hello from the client!');
  }, 1000);

  // if the server disconnects, stop sending messages to it
  socket.close(function() {
    console.log('Connection closed.');

    clearInterval(interval);
  });
} else {
  // let the user know that socket.js is not supported
  console.log('Your browser does not support WebSockets.');
}
```

## Demo

A simple demo is provided. To start the demo, run `npm start` at the root of this repository and point your browser to `http://localhost:3000`. The server should start printing messages from the client, and vice versa.

## License

Copyright (c) 2016 Stephan Boyer

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
