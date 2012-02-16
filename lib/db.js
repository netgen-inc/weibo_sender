var mysql = require('mysql'); 
var url = require('url');

var Db = function(){
    var _self = this;
    var settings;
    var cli;
    _self.init = function(configs){
        settings = configs;
        cli = mysql.createClient(settings.mysql);
    }   
    
    _self.loadAccounts = function(cb){
        var sql = "SELECT * FROM account";
        var expired = [], accounts = {};
        cli.query(sql, function(err, results){
            if(err){
                cb(err, null);
                return;
            }
            
            weiboAccounts = {};
            for(var i = 0; i < results.length;i++){
                var wa = results[i];
                if(!wa.access_token || !wa.access_token_secret){
                    console.log('No access_token:' + wa.stock_code);
                }
                wa.blogtype = 'tsina';
                wa.authtype = 'oauth';
                wa.oauth_token_key = wa.access_token;
                wa.oauth_token_secret = wa.access_token_secret;
                weiboAccounts[results[i].stock_code] = wa;
            }
            cb(null, weiboAccounts);
        });
    }

    _self.getBlogByUri = function(uri, cb){
        var uri = url.parse(uri);
        var id = uri.hash.substring(1);
        var sql = "select * from micro_blog where id = '" + id + "' AND send_time = 0";
        cli.query(sql, function(err, results, fields){
            cb(err, results);
        });
    };
    
    _self.sendSuccess = function(blog, sinaId, weiboUrl){
        var time = new Date().getTime();
        time = time.toString().substring(0, 10);
        var sql = "update micro_blog SET send_time = '"+time+"', status = 1 WHERE id = '"+blog.id+"'";
        cli.query(sql);
        
        var sql = "INSERT INTO sent_micro_blog(micro_blog_id, weibo_id, send_time, stock_code, weibo_url) values("+blog.id+", "+sinaId+", "+time+", '"+blog.stock_code+"', '"+weiboUrl+"')";
        cli.query(sql);
    };
    
    _self.updateAccount = function(account, cb){
        var sql = "UPDATE account SET weibo_user_id= ?, access_token = ?,access_token_secret = ? WHERE id = ?";
        var data = [account.weibo_user_id, account.access_token, account.access_token_secret, account.id];
        cli.query(sql, data, function(error, info){
            cb(error, info);
        });
    };
    
    _self.getBlogBySendTime = function(start, end, cb){
        var sql = "SELECT * FROM sent_micro_blog WHERE deleted = 0 AND send_time >= ? AND send_time < ?";
        cli.query(sql, [start, end], cb);
    }
}

exports.db = new Db();
