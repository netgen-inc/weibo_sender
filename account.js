var qs = require('querystring');
var settings = require('./etc/settings.json');
var OAuth = require('oauth').OAuth;
var db = require('./lib/db').db;
db.init(settings);

var uri1 = 'http://api.t.sina.com.cn/oauth/request_token';
var uri2 = 'http://api.t.sina.com.cn/oauth/access_token';
var uri3 = 'http://api.t.sina.com.cn/oauth/authorize';

var authorize = function(account, token){
    var params = {
         oauth_token:token,
         oauth_callback:'json',
         display:'json',
         userId: account.email,
         passwd: account.password
    };
}

var oauth = new OAuth(uri1, uri2, settings.weibo.appkey, settings.weibo.secret, '1.0', '', 'HMAC-SHA1');

var getAccessToken = function(account, cb){
    oauth.getOAuthRequestToken(function(err, oauthToken, oauthTokenSecret, result){
        var params = {
             oauth_token:oauthToken,
             oauth_callback:'json',
             display:'json',
             userId: account.email,
             passwd: account.password
        }; 
        var url = uri3 + '?' + qs.stringify(params);
        oauth.get(url, settings.weibo.appkey, settings.weibo.secret, function(error, body){
            if(error){
                cb(error , null);
            }else{
                body = JSON.parse(body);
                oauth.getOAuthAccessToken(oauthToken, oauthTokenSecret, body.oauth_verifier, function(error, accessToken, accessTokenSecret, results){
                    if(error){
                        cb(error, null);
                        return;
                    }
                    account.access_token = accessToken;
                    account.access_token_secret = accessTokenSecret;
                    account.weibo_user_id = results.user_id;
                    cb(error, account);
                });
            }
        });
    });
};

db.loadAccounts(function(error, accounts){
    if(error){
        console.log(['load accounts error:', error]);
        return;
    }
    var was = [];
    for(var code in accounts){
        was.push(accounts[code]);
    }

    var update = function(error, account){
        if(error){
            console.log(['request token error:', error, account]);
        }else{
            db.updateAccount(account, function(error, info){
                if(error){
                    console.log(['update error:', account, error]);
                }else{
                    console.log(['update success:', account]);
                }
            });
            if(was.length > 0){
                console.log('rest ' + was.length);
                setTimeout(function(){
                    getAccessToken(was.pop(), update);
                }, 100);
            }
        }
    }
    var account = was.pop();
    getAccessToken(account, update);
});
