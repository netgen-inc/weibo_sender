var mysql = require('mysql'); 
var url = require('url');

var Db = function(){
    var _self = this;
    var settings;
    var cli;
    _self.init = function(configs){
        settings = configs;
        cli = mysql.createClient(settings.mysql);
        cli.query('USE ' + settings.mysql.database);    
        cli.query('SET NAMES utf8');
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
            cb.call(null, err, results);
        });
    };
    
    _self.sendSuccess = function(blog, sinaId){
        var time = new Date().getTime();
        time = time.toString().substring(0, 10);
        var sql = "update micro_blog SET send_time = '"+time+"', status = 1 WHERE id = '"+blog.id+"'";
        cli.query(sql);
        
        var sql = "INSERT INTO sent_micro_blog(micro_blog_id, weibo_id, send_time, stock_code) values("+blog.id+", "+sinaId+", "+time+", '"+blog.stock_code+"')";
        cli.query(sql);
    }
    
    _self.updateAccount = function(account, cb){
        var sql = "UPDATE account SET weibo_user_id= ?, access_token = ?,access_token_secret = ? WHERE id = ?";
        var data = [account.weibo_user_id, account.access_token, account.access_token_secret, account.id];
        cli.query(sql, data, function(error, info){
            cb(error, info);
        });
    }
}

exports.db = new Db();
