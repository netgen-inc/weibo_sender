// change appkey to yours
/*
var appkey = '196346996';
var secret = '4b1ee49ec3474192d9c3ed208db79a30';
var access_token:'2.00pBzasB0CpqRN38aa28f1ccRX25fB';
*/


Date.prototype.getStamp = function(){
    var time = this.getTime();   
    return parseInt(time / 1000);
}

var settings;

//所有的微博账户
var weiboAccessTokens = {};

//初始化mysql客户端
var mysql = require('mysql');
var myCli;

//加载所有的账号
var init = function(configs){
    settings = configs;
    myCli = mysql.createClient(settings.mysql);
    myCli.query('use ' + settings.mysql.database);
    myCli.query('set names utf8');
    loadAccount();   
};

var loadAccount = function(){
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
            weiboAccessTokens[results[i].stock_code] = results[i];
        }
        console.log('access token loaded');
    });
}

process.on('SIGUSR2', function () {
    loadAccount();
});

function request(act, data, cb)
{   
    var https = require('https');
    var qs = require('querystring');
    var path = settings.weibo[act];
    var options = {
        host: 'api.weibo.com',
        port: 443,
        path: path,
        method: 'POST'
    };
    
    console.log(data);
    if(typeof data == 'object'){
        data = qs.stringify(data);   
    }
    
    var headers = {};
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8;';
    headers['Content-Length'] = data.length;
    options.headers = headers;
    
    var res;
    var req = https.request(options, function(res){
        var body = '';
        res.on('data', function(chunk){
            body += chunk.toString();
        });
        
        res.on('end', function(){
            cb.call(null, res.statusCode, JSON.parse(body));
        });
    });
    
    //10秒超时
    req.setTimeout(10, function(){
        req.abort();
        cb.call(null, 0, '');
    });
    
    req.write(data);
    req.end();
}

var update = function(blog, cb){
    getAccessToken(blog.stock_code, function(token){
        if(!token){
            cb.call(null, 403, '');
            return;   
        }
        var data = {
            access_token:token.access_token,
            status:blog.content
        };
        request('update', data, cb);
    });
}

var remove = function(weibo, cb){
    getAccessToken(weibo.stock_code, function(token){
         if(!token){
            cb.call(null, 403, '');
            return;   
        }
        var data = {
            access_token:token.access_token,
            id:weibo.weibo_id   
        };
        request('remove', data, cb);
    });
}

//从sina请求一个access token
var requestAccessToken = function(username, password, cb){
     var data = {
        client_id : settings.weibo.appkey,
        client_secret:settings.weibo.secret,
        grant_type:'password',
        username:username,
        password:password   
     };
     
     request('token', data, cb);
     
    //return '2.00pBzasB0CpqRNc21c99241aW1fNBC';
}



var getAccessToken = function(stockCode, cb){
    if(!weiboAccessTokens[stockCode]){
        cb.call(null, undefined);
        return;   
    }
    
    if(new Date().getStamp() < weiboAccessTokens[stockCode].token_expire){
           cb.call(null, weiboAccessTokens[stockCode]);
           return;
    }

    var account = weiboAccessTokens[stockCode];
    requestAccessToken(account.email, account.password, function(statusCode, body){
        if(statusCode != 200){
            delete weiboAccessTokens[stockCode]; 
            cb.call(null, undefined);
        }else{
            var expire = new Date().getStamp() + parsetInt(body.expires_in);
            weiboAccessTokens[stockCode].access_token = body.access_token;
            weiboAccessTokens[stockCode].expire = expire; 
            
            
            var sql = "INSERT INTO account SET stock_code = '"+stockCode+"', access_token = '"+ body.access_token+"', token_expire = " + expire; 
            sql += " ON DUPLICATE KEY UPDATE access_token = '"+ body.access_token+"', expire = " + expire;
            myCli.query(sql);
            cb.call(null, account);
        }
    });   
}


exports.weibo = {
    update:update,
    remove:remove,
    init:init
};



