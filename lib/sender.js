var util = require('util');
var event = require('events').EventEmitter;
var weibo = require('weibo');
var Sender = function(){
    var _self = this;
    _self.running = false;
    var settings, logger, db;
    
    _self.init = function(configs){
        settings = configs;
        logger = configs.logger;
        weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);
    }
    
    _self.send = function(blog, account, context){
        //防止发送超时，进程一直处理等待状态
        var to = setTimeout(function(){
            var error = {statusCode:0, error:'request timeout'};
            _self.emit('send', error, null, context);
        }, settings.weibo.timeout);
        
        fixAccount(account);
        var data = {user:account,status:blog.content};
        if(blog.pic){
            data.pic = blog.pic;   
        }
        
        weibo.tapi.update(data, function(err, body, response){
            clearTimeout(to);
            if(typeof body == 'string'){
                body = JSON.parse(body);   
            }
            
            _self.running = false;
            
            var error = null;
            if(err){
                error = err.message;
                console.log(error);
            }
           
            _self.emit('send', error, body, blog, context);
        });
    };
    
    _self.repost = function(id, status, account, context){
        status = status || '';
        fixAccount(account);
        var to = setTimeout(function(){
            var error = {statusCode:0, error:'request timeout'};
            _self.emit('send', error, null, context);
        }, settings.weibo.timeout);
        var data = {id:id, status:status,user:account};
        weibo.tapi.repost(data, function(err, body, response){
            clearTimeout(to);
            if(typeof body == 'string'){
                body = JSON.parse(body);   
            }
            
            _self.running = false;
            
            var error = null;
            if(err){
                error = err.message;
                console.log(error);
            }
           
            _self.emit('repost', error, body, id, status, context);
        });
    }
    
    var fixAccount = function(account){
        account.blogtype = 'tsina';
        account.authtype = 'oauth';
        account.oauth_token_key = account.access_token;
        account.oauth_token_secret = account.access_token_secret;
    }
}
util.inherits(Sender, event);
exports.Sender = Sender;
