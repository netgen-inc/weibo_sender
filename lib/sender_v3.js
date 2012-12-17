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
        var timestamp = tool.timestamp();
        var params = {
            status : blog.content, 
            fromApp : settings.weiboCenter.appName, 
            timestamp : timestamp, 
            sync:1, 
            accountId : account.weibo_center_id
        };

        var callback = function(err, result, response){
            _self.running = false;
            if(err) {
                _self.emit('send', {error:"http request error:" + err.msg, nextAction:"delay", code:7000}, null, blog, context);    
            }else{
                var error = result.error;
                if(result.error) {
                    error = {error:result.error.msg, error_code:result.error.code, nextAction:result.error.nextAction};    
                }
                _self.emit('send', error, result.response, blog, context);    
            }
            
        };
        var fullUrl = settings.weiboCenter.urlRoot + "/weibo/update";
        if(blog.pic && path.existsSync(blog.pic)){
            hihttp.upload(fullUrl, blog.pic, params, callback);
        }else{
            hihttp.post(fullUrl, params, callback);
        }
    };
}
util.inherits(Sender, event);
exports.Sender = Sender;


