var utilUrl = require("url");
var http = require("http");
var qs = require("querystring");
var get = function(url, data, callback){
	if(typeof data == 'function'){
		callback = data;
		data = null;
	}
	request(url, 'GET', data, null, callback);
}

var post = function(url, data, callback){
	if(typeof data == 'function'){
		callback = data;
		data = null;
	}
	request(url, 'POST', data, null, callback);
}


var request = function(url, method, data, headers, callback){
	if(typeof method == 'function'){
		callback = method;
		method = 'GET';
	}

	if(method == 'POST' && typeof data == 'function'){
		callback = data;
		data = '';
	}

	if(data && typeof data != 'string'){
		data = qs.stringify(data);
	}

	var url = utilUrl.parse(url);
	url.port = url.port || "80";
	url.path = url.path || '/';
	if(data && method == 'GET'){
		if(url.path.indexOf('?') != -1){
			url.path += '&' + data
		}else{
			url.path += '?' + data
		}
	}

	var options = {};
	options.host = url.hostname;
	options.port = url.port;
	options.path = url.path;
	options.method = method;

	if(!headers || typeof headers != 'object'){
		headers = {};
	}

	if(method == 'POST'){
		if(!headers['Content-Type']){
			headers['Content-Type'] = 'application/x-www-form-urlencoded';	
		}
		headers['Content-Length'] = data.length;
	}
	options.headers = headers;

	var req = http.request(options, function(res){
		if(res.statusCode != 200){
			callback({status:res.statusCode});
			return;
		}
		var body = '';
		res.on('data', function(chunk){
			body += chunk;
		});

		res.on('end', function(){
			callback(null, body, res);
		});
	});

	req.setTimeout(30000, function(){
		callback({message:"timeout", status:0});
	});

	req.on('error', function(err){
		callback(err);
	});
	
	if(method == 'POST'){
		req.write(data);
	}
	req.end();
}

module.exports = {
	get:get,
	post:post,
	reqest:request
};


