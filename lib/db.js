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
                if(wa.block_id && wa.block_id > 0){
                    weiboAccounts[wa.block_id] = wa;
                }else{
                    weiboAccounts[wa.stock_code] = wa;    
                }
                
            }
            cb(null, weiboAccounts);
        });
    }

    _self.getBlogByUri = function(uri, cb){
        var uri = url.parse(uri);
        var id = uri.hash.substring(1);
        var getBlog = function(id, callback){
            var sql = "select * from micro_blog where id = '" + id + "' AND send_time = 0";
            cli.query(sql, function(err, results, fields){
                if(!err && results.length > 0){
                    results[0].block_id = 0;
                }
                callback(err, results);
            });
        }
        if(uri.query == 'article_subject'){
            var sql = "SELECT * FROM article_subject WHERE id = ?";
            cli.query(sql, [id], function(err, result){
                if(err){
                    cb(err);
                    return;
                }

                if(result.length == 0){
                    cb({message:"not found the record"});
                    return;
                }

                var  relation =  result[0];
                getBlog(relation.micro_blog_id, function(err, results){
                    if(err || results.length == 0){
                        cb({message:"not found the record"});
                        return;
                    }

                    var blog = results[0];
                    results[0].block_id = relation.block_id;
                    results[0].stock_code = relation.stock_code;
                    cb(null, results);
                });

            });
        }else{
            getBlog(id, cb);
        }
    };
    
    _self.sendSuccess = function(blog, sinaId, weiboUrl, accountId){
        var time = new Date().getTime();
        time = time.toString().substring(0, 10);
        var sql = "update micro_blog SET send_time = '"+time+"', status = 1 WHERE id = '"+blog.id+"'";
        cli.query(sql);
        
        var sql = "INSERT INTO sent_micro_blog(micro_blog_id, weibo_id, send_time, stock_code, weibo_url, account_id) "
                    + "values("+blog.id+", "+sinaId+", "+time+", '"+blog.stock_code+"', '"+weiboUrl+"', '"+accountId+"')";
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
    },

    _self.createReposts = function(id){

    }
}

exports.db = new Db();
