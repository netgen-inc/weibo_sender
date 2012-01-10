// change appkey to yours



Date.prototype.getStamp = function(){
    var time = this.getTime();   
    return parseInt(time / 1000);
}

var crypto = require('crypto');
var https = require('https');
var http = require('http');
var qs = require('querystring');
var util = require('util');
var event = require('events').EventEmitter;
var mysql = require('mysql');

var Weibo = function(){
    var _self = this;
    var appKey, appSecret; //新浪微博
    var myCli;
    var weiboAccounts = {}; //所有的微博账户
    var settings;
    
    this.init = function(configs){
        settings = configs;
        appKey = settings.weibo.appkey;
        appSecret = settings.weibo.secret;
        
        myCli = mysql.createClient(settings.mysql);
        myCli.query('use ' + settings.mysql.database);
        myCli.query('set names utf8');
        
        console.log('loading the micro blog accounts.....');
        var time = new Date().getStamp();
        var sql = "SELECT * FROM account";
        var expired = [], accounts = {};
        myCli.query(sql, function(err, results){
            if(err){
                console.log('!!!!!!!start error, access token load failure!');  
                return; 
            }
            for(var i = 0; i < results.length;i++){
                weiboAccounts[results[i].stock_code] = results[i];
            }
            console.log('access token loaded');
        });
    }
    
    this.send = function(blog, callback){
        getAccount(blog.stock_code, function(account){
            if(!account.access_token){
                if(callback){
                    callback.call(null, 0, {error:'invalid account'});
                }
            }else{
                send(account, blog, callback);
            }
        });
    };
    
    this.remove = function(sentBlog, callback){
        getAccount(sentBlog.stock_code, function(account){
            if(!account.access_token){
                if(callback){
                    callback.call(null, 0, {error:'invalid account'});
                }
            }else{
                remove(account, sentBlog, callback);
             }
        });
    };
    
    var send = function(account, blog, callback){
        var requestUri = 'http://api.t.sina.com.cn/statuses/update.json';
        var hash = crypto.createHash('md5');
        hash.update(new Date().getTime().toString());
        var nonce = hash.digest('hex');
        
        var params = {
            oauth_consumer_key:appKey,
            oauth_nonce:nonce,
            oauth_signature_method:'HMAC-SHA1',
            oauth_timestamp : new Date().getStamp(),
            oauth_token:account.access_token,
            oauth_version:'1.0',
            status:blog.content
        };
        
        var paramStr = qs.stringify(params);
        var signRaw = 'POST&' + encodeURIComponent(requestUri) + '&' + encodeURIComponent(paramStr); 
        
        var hmac = crypto.createHmac('sha1', appSecret + '&' + account.access_token_secret);
        hmac.update(signRaw);
        var sign = hmac.digest('base64');
        params.oauth_signature =sign;
        
        var options = {
            host:'api.t.sina.com.cn',
            port:80,
            path:'/statuses/update.json',
            method:'POST'
        };
        
        var paramStr = qs.stringify(params)
        var headers = {};
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8;';
        headers['Content-Length'] = paramStr.length;
        options.headers = headers;
        console.log(params);        
    
        var req = http.request(options, function(res){
            var body = '';
            res.on('data', function(chunk){
                body += chunk;
            });
            
            res.on('end', function(){
                body = JSON.parse(body);
                _self.emit('send', blog, res.statusCode, body);
                if(typeof callback == 'function'){
                    callback.call(null, res.statusCode, body);
                }
                if(res.status != 200){
                    console.log(['send error' , body]);
                }
            });
        });
        req.write(paramStr);
        req.end();
    }
    
    var remove = function(account, sentBlog, callback){
        var requestUri = 'http://api.t.sina.com.cn/statuses/destroy/'+ sentBlog.weibo_id +'.json';
        var hash = crypto.createHash('md5');
        hash.update(new Date().getTime().toString());
        var nonce = hash.digest('hex');
        
        var params = {
            oauth_consumer_key:appKey,
            oauth_nonce:nonce,
            oauth_signature_method:'HMAC-SHA1',
            oauth_timestamp : new Date().getStamp(),
            oauth_token:account.access_token,
            oauth_version:'1.0',
            source:appKey
        };
        
        var paramStr = qs.stringify(params);
        var signRaw = 'POST&' + encodeURIComponent(requestUri) + '&' + encodeURIComponent(paramStr); 
        
        var hmac = crypto.createHmac('sha1', appSecret + '&' + account.access_token_secret);
        hmac.update(signRaw);
        var sign = hmac.digest('base64');
        params.oauth_signature = sign;
        
        var options = {
            host:'api.t.sina.com.cn',
            port:80,
            path:'/statuses/destroy/'+ sentBlog.weibo_id +'.json',
            method:'POST'
        };
        
        var paramStr = qs.stringify(params)
        var headers = {};
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8;';
        headers['Content-Length'] = paramStr.length;
        options.headers = headers;
        
    
        var req = http.request(options, function(res){
            var body = '';
            res.on('data', function(chunk){
                body += chunk;
            });
            
            res.on('end', function(){
                body = JSON.parse(body);
                _self.emit('delete', sentBlog, res.statusCode, body);
                if(typeof callback == 'function'){
                   callback.call(null, res.statusCode, body); 
                }
            });
        });
        req.write(paramStr);
        req.end();
    }
        
    _self.on('reqToken', function(account){
        authorize(account);
    });
    
    _self.on('authorize', function(account){
        reqAccessToken(account);
    });
    
    _self.on('accessToken', function(account){
        if(!account.access_token){
            return;
        }
        account.token_expire = 5555555555;
        weiboAccounts[account.stock_code] = account;
        var sql = "UPDATE account SET ";
        for(var x in account){
            if(x == 'id' || x == 'email' || x == 'stock_code'){
                continue;   
            }
            sql += " " + x + "='"+account[x]+"',";
        }
        
        sql = sql.substr(0, sql.length - 1);
        sql += " WHERE stock_code='"+account.stock_code+"'";
        myCli.query(sql, function(err){
            
        });
    });
    
    var getAccount = function(stockCode, callback){
        stockCode = stockCode.toLower();
        if(!weiboAccounts[stockCode]){
            callback({});
            return;
        }
        
        //如果用户还没有授权
        var wa = weiboAccounts[stockCode];
        if(wa.accessToken == '' || wa.authorize_code == '' || wa.req_token == ''){
            getReqToken(wa);
            
            var timeout = setTimeout(function(){
                _self.emit('accessToken' + stockCode, {});    
            }, 30000);
            
            _self.once('accessToken' + stockCode, function(account){
                clearTimeout(timeout);
                callback.call(null, account);   
            });
        }else{
            callback.call(null, wa);    
        }
    } //EOF getAccessToken
     
    var getReqToken =  function(account){
        var requestTokenUri = 'http://api.t.sina.com.cn/oauth/request_token';
        var hash = crypto.createHash('md5');
        hash.update(new Date().getTime().toString());
        var nonce = hash.digest('hex');
        
        var params = {
            oauth_consumer_key:appKey,
            oauth_nonce:nonce,
            oauth_signature_method:'HMAC-SHA1',
            oauth_timestamp : new Date().getStamp(),
            oauth_version:'1.0'    
        };
        
        var paramStr = qs.stringify(params);
        var signRaw = 'GET&' + encodeURIComponent(requestTokenUri) + '&' + encodeURIComponent(paramStr); 
        
        var hmac = crypto.createHmac('sha1', appSecret + '&');
        hmac.update(signRaw);
        var sign = hmac.digest('base64');
        params.oauth_signature = sign;
        
        var options = {
            host:'api.t.sina.com.cn',
            port:80,
            path:'/oauth/request_token?' + qs.stringify(params)
        };
        
    
        var req = http.get(options, function(res){
            var body = '';
            res.on('data', function(chunk){
                body += chunk;
            });
            
            res.on('end', function(){
                body = qs.parse(body); 
                account.req_token = body.oauth_token;
                account.req_token_secret = body.oauth_token_secret;
                console.log(['reqToken', account]);
                _self.emit('reqToken', account);
                  
            });
        });
    }; //EOF getReqToken
    
    
    var authorize = function(account){
        var url = "http://api.t.sina.com.cn/oauth/authorize";
        var params = {
             oauth_token:account.req_token,
             oauth_callback:'json',
             display:'json',
             userId: account.email,
             passwd: account.password 
        };
        
        var options = {
            host:'api.t.sina.com.cn',
            port:80,
            path:'/oauth/authorize?' + qs.stringify(params)
        };
        
        var req = http.get(options, function(res){
            var body = '';
            res.on('data', function(chunk){
                body += chunk;
            });
            
            res.on('end', function(){
                body = JSON.parse(body);
                account.authorize_code = body.oauth_token;
                account.authorize_verify = body.oauth_verifier;
                _self.emit('authorize', account);
            });
        });
    }; //EOF authorize
    
    var reqAccessToken = function(account){
        var requestTokenUri = 'http://api.t.sina.com.cn/oauth/access_token';
        
        var hash = crypto.createHash('md5');
        hash.update(new Date().getTime().toString());
        var nonce = hash.digest('hex');
        
        var params = {
            oauth_consumer_key:appKey,
            oauth_nonce:nonce,
            oauth_signature_method:'HMAC-SHA1',
            oauth_timestamp : new Date().getStamp(),
            oauth_token:account.authorize_code,
            oauth_verifier:account.authorize_verify,
            oauth_version:'1.0'    
        };
        
        var paramStr = qs.stringify(params);
        var signRaw = 'GET&' + encodeURIComponent(requestTokenUri) + '&' + encodeURIComponent(paramStr); 
        
        var hmac = crypto.createHmac('sha1', appSecret + '&' + account.req_token_secret);
        hmac.update(signRaw);
        var sign = hmac.digest('base64');
        params.oauth_signature = sign;
        
        
        var options = {
            host:'api.t.sina.com.cn',
            port:80,
            path:'/oauth/access_token?' + qs.stringify(params)
        };
        
    
        var req = http.get(options, function(res){
            console.log(res.statusCode);
            var body = '';
            res.on('data', function(chunk){
                body += chunk;
            });
            
            res.on('end', function(){
                body = qs.parse(body);
                account.weibo_user_id = body.user_id;
                account.access_token_secret = body.oauth_token_secret;
                account.access_token = body.oauth_token;
                _self.emit('accessToken', account);
                _self.emit('accessToken' + account.stock_code, account);
            });
        });
    }// EOF requestAccessToken
    
    this.testToken = function(){
        getAccount('sz000001', function(account){
            console.log(account);
        });   
    }
};
util.inherits(Weibo, event); 
exports.weibo = new Weibo();


/*
weibo.on('send', function(blog, statusCode, body){
    console.log([statusCode, body]); 
});
setTimeout(function(){
    weibo.send({stock_code:'sz000001', content:'随业绩增长，明年一季报000001每股净资产达15元多，看多'});    
    //weibo.remove({stock_code:'sz000001', weibo_id:'3396734828810147'});    
}, 1000);
*/






