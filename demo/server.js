'use strict';

var fs = require('fs');
var http = require('http');
var socketjs = require('../server/socket.js');

// serve the HTML and JavaScript
function requestListener(request, response) {
  if (request.method === 'GET') {
    if (request.url === '/') {
      fs.readFile('demo/index.html', function(err, data) {
        if (err) {
          throw err;
        }
        response.setHeader('Content-Type', 'text/html');
        response.end(data);
      });
      return;
    }
    if (request.url === '/socket.js') {
      fs.readFile('socket.min.js', function(err, data) {
        if (err) {
          throw err;
        }
        response.setHeader('Content-Type', 'application/javascript');
        response.end(data);
      });
      return;
    }
  }
  response.statusCode = 404;
  response.end('Not found');
}

// start an http server
var server = http.createServer(requestListener);
server.listen(3000, function() {
  console.log('Listening on port %d.', server.address().port);
});

socketjs(server, function(socket, reconnectData) {
  // if we get disconnected and subsequently reconnect, the client can pass data here
  if (reconnectData === null) {
    console.log('A user connected.');
  } else {
    console.log('A user reconnected with:', reconnectData);
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
