var util = require('util');
var fs = require('fs');
var path = require('path');
var event = require('events').EventEmitter;
var hihttp = require('../lib/hihttp');
var tool = require("./tool").tool;
var Sender = function(){
    var _self = this;
    _self.running = false;
    var settings, logger, db;
    
    _self.init = function(configs){
        settings = configs;
    }

    _self.send = function(blog, account, context){
        //防止发送超时，进程一直处理等待状态
        var to = setTimeout(function(){
            var error = {code:0, msg:'request timeout'};
            _self.emit('send', error, null, blog, context);
        }, settings.weibo.timeout);
        
        var timestamp = tool.timestamp();
        var params = {
            status : blog.content, 
            fromApp : settings.weiboCenter.appName, 
            timestamp : timestamp, 
            sync:1, 
            accountId : account.weibo_center_id
        };

        var callback = function(err, result, response){
            clearTimeout(to);
            _self.running = false;
            if(err) {
                _self.emit('send', {error:"http request error", code:7000}, null, blog, context);    
            }else{
                var error = result.error;
                if(result.error) {
                    error = {error:result.error.msg, error_code:result.error.code};    
                }
                _self.emit('send', error, result.response, blog, context);    
            }
            
        };
        var fullUrl = settings.weiboCenter.urlRoot + "/weibo/update";
        if(blog.pic && fs.existsSync(blog.pic)){
            hihttp.upload(fullUrl, blog.pic, params, callback);
        }else{
            hihttp.post(fullUrl, params, callback);
        }
    };
}
util.inherits(Sender, event);
exports.Sender = Sender;


