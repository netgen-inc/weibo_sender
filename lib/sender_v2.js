var util = require('util');
var fs = require('fs');
var path = require('path');
var event = require('events').EventEmitter;
var hihttp = require('../lib/hihttp');
var Sender = function(){
    var _self = this;
    _self.running = false;
    var settings, logger, db;
    
    _self.init = function(configs){
        settings = configs;
        //weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);
    }

    this.getParams = function(params, account) {
        params = params || {};
        params.oauth_consumer_key = settings.weibo.appkey;
        params.oauth_version = '2.a';
        params.scope = 'all';
        params.access_token = account.access_token;

        if(!params.clientip) {
            params.clientip = '127.0.0.1';
        }
        return params;
    };
    
    _self.send = function(blog, account, context){
        //防止发送超时，进程一直处理等待状态
        var to = setTimeout(function(){
            var error = {statusCode:0, error:'request timeout'};
            _self.emit('send', error, null, blog, context);
        }, settings.weibo.timeout);
        
        var params = {status: blog.content};
        params = this.getParams(params, account);
    
        var callback = function(err, result, response){
            clearTimeout(to);
            if(result.error_code || response.statusCode != 200){
                err = result;
            }
            _self.running = false;
            _self.emit('send', err, result, blog, context);
        };
        var fullUrl = 'https://api.weibo.com/2/statuses/update.json';
        if(blog.pic && path.existsSync(blog.pic)){
            fullUrl = 'https://upload.api.weibo.com/2/statuses/upload.json';
            hihttp.upload(fullUrl, blog.pic, params, callback);
        }else{
            hihttp.post(fullUrl, params, callback);
        }
    };
}
util.inherits(Sender, event);
exports.Sender = Sender;


