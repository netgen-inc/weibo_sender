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
        cli.query(sql, function(err, results){
            if(err){
                cb(err, null);
                return;
            }
            var as = {ids : {}, stocks : {}};
            for(var i = 0; i < results.length; i++){
                var wa = results[i];
                as.ids[wa.id] = wa;
                if(!as.stocks[wa.stock_code]) {
                    as.stocks[wa.stock_code] = {};
                }
                as.stocks[wa.stock_code][wa.provider] = wa;
            }
            cb(null, as);
        });
    };

    _self.getBlogById = function(id, table, cb){
        var getBlog = function(id, callback){
            var sql = "select * from micro_blog where LOCATE(UNHEX('EFBFBD'), content) = 0 AND id = '" + id + "'";
            cli.query(sql, function(err, results, fields){
                if(!err && results.length > 0){
                    results[0].block_id = 0;
                }
                callback(err, results);
            });
        }
        if(table == 'article_subject'){
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

    _self.sendToWeiboCenter = function (blog, callback) {
        var sql = "update micro_blog SET send_time = ?, status = 2 WHERE id = ?";
        cli.query(sql, [tool.timestamp(), blog.id], callback);
    }

    _self.getSent = function (blogId, accountId, callback) {
        var sql = "SELECT * FROM sent_micro_blog WHERE micro_blog_id = ? AND account_id = ?";
        sql = cli.format(sql, [blogId, accountId]);
        cli.query(sql, callback);
    }
    
    _self.sendSuccess = function(blog, sinaId, weiboUrl, account, callback){
        var time = new Date().getTime();
        time = time.toString().substring(0, 10);
        var sql = "update micro_blog SET send_time = '"+time+"', status = 1 WHERE id = '"+blog.id+"'";
        cli.query(sql);
        
        var sql = "INSERT INTO sent_micro_blog(micro_blog_id, weibo_id, send_time, stock_code, weibo_url, account_id) "
                    + "values("+blog.id+", "+sinaId+", "+time+", '"+account.stock_code+"', '"+weiboUrl+"', '"+accountId+"')";
        cli.query(sql, callback);
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

    _self.getReposts = function(id, callback){
        var sql = "SELECT * FROM repost_task WHERE micro_blog_id = " + id;
        cli.query(sql, callback);
    }
}

exports.db = new Db();
