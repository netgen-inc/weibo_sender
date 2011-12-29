var request = require('request');

var tryPop = function( url, queue, cb ){
  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      cb( null, { queue: queue, uri: body } );
    }
    if (!error && response.statusCode == 404) {
      cb( 'empty' );
    }
  })
};

var Queue = function(base, queue){
  this.base  = base;
  this.queue = queue;
};

Queue.prototype.dequeue = function(cb){
  tryPop( this.base + '/' + this.queue, this.queue, cb );
};

Queue.prototype.enqueue = function(uri, cb){
  request( { method : 'PUT',
             uri    : this.base + '/' + this.queue,
             headers:{'Content-Type': 'application/x-www-form-urlencoded'},
             body   : 'uri=' + uri 
           }, function (error, response, body) {
             console.log(body);
           });
};

exports.getQueue = function( base, queue ){
  return new Queue( base, queue );
};
