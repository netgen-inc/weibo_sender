var mysql = require('mysql'); 
var url = require('url');
var tool = require('../lib/tool').tool;

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
    
    _self.getBlogBySendTime = function(start, end, cb){
        var sql = "SELECT * FROM sent_micro_blog WHERE deleted = 0 AND send_time >= ? AND send_time < ?";
        cli.query(sql, [start, end], cb);
    }
    
    _self.insertRt = function(weiboId, rtWeiboId, rtTime, sendTime, rtContent, userId, repostType, accountId, cb){
        var sql = "INSERT INTO micro_blog_repost(weibo_id, rt_id, rt_time, send_time, content, user_id, repost_type, account_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?)";
        cli.query(sql, [weiboId, rtWeiboId, rtTime, sendTime, rtContent, userId, repostType, accountId], cb);
    }
    
    _self.insertComment = function(weiboId, commentId, commentTime, sendTime, content, userId, commentType, accountId, cb){
        var sql = "INSERT INTO micro_blog_comment(weibo_id, comment_id, comment_time, send_time, content, user_id, comment_type, account_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?)";
        cli.query(sql, [weiboId, commentId, commentTime, sendTime, content, userId, commentType, accountId], cb);
    }
    
    _self.getReposts = function(start, end, cb){
        var sql = "SELECT * FROM reposted_micro_blog WHERE repost_time >= ? AND repost_time < ?";
        cli.query(sql, [start, end], cb); 
    }


    _self.insertFollowers = function(accountId, followers, cb){
        var d = tool.getDateString(null, false);
        var sql = "INSERT INTO account_status (account_id, stat_date, followers) VALUES(?, ?, ?) " + 
                  "ON DUPLICATE KEY UPDATE followers = ?";
        cli.query(sql, [accountId, d, followers, followers], function(err){
            if(err){
                console.log(err);   
            }
            cb(err);
        });
    };


    _self.insertMentions = function(accountId, mentions, cb){
        var date = tool.getDateString(null, false);
        var sql = "INSERT INTO account_status (account_id, stat_date, mentions)";
        sql += " VALUES(?,?,?) ON DUPLICATE KEY UPDATE mentions = ?";
        cli.query(sql, [accountId, date, mentions, mentions], function(err, result){
            if(err){
                console.log(err);
            }
        });
    }

    _self.insertFollowerStatus = function(info){
        var statusDate = tool.getDateString();
        var sql = "INSERT INTO follower_status(follower_id,followers_count,friends_count,statuses_count,favourites_count,last_send_weibo, status_date)";
        sql += " VALUES(?, ? ,? ,? ,? ,?,?) ON DUPLICATE KEY UPDATE status_date = status_date";
        var data = [info.follower_id, info.followers_count, info.friends_count, info.statuses_count, info.favourites_count, info.last_send_weibo, statusDate];
        cli.query(sql, data, function(err){
            if(err){
                console.log(err);
            }
        });
    };

    _self.getFollowerInfo = function( weiboUserId, callback){
        var sql = "SELECT * FROM follower_info WHERE weibo_user_id = ?";
        cli.query(sql, [weiboUserId], function(err, result){
            if(err){
                callback(err);
                return;
            }
            callback(null, result);
        });
    };

    _self.updateFollowerLastSend = function(weiboUserId, lastSendWeibo){
        var sql = "UPDATE follower_info SET last_send_weibo = ? WHERE weibo_user_id = ?";
        cli.query(sql, [lastSendWeibo, weiboUserId])
    }

    _self.insertFollowerInfo = function(user, callback){
        _self.getFollowerInfo(user.weibo_user_id, function(err, result){
            if(err){
                console.log(["get FollowerInfo err:", err]);
                callback(err);
                return;
            }
            if(result.length > 0){
                user.follower_id = result[0].id;
                _self.updateFollowerLastSend(user.weibo_user_id, user.last_send_weibo);
                _self.insertAccountFollower(user.account_id, user.follower_id);
                callback(err, user);
            }else{
                var sql = "INSERT INTO follower_info(weibo_user_id, screen_name, city, description, verified, gender, url, profile_image_url, created_at, province, location, last_send_weibo)";
                sql += " VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE last_send_weibo = ?";
                var data = [user.weibo_user_id, user.screen_name, user.city, user.description, 
                            user.verified, user.gender, user.url, user.profile_image_url, 
                            user.created_at, user.province, user.location, user.last_send_weibo, user.last_send_weibo];
                cli.query(sql, data, function(err, result){
                    if(err){
                        console.log(["insert follower_info err:", err]);
                        callback(err);
                    }else{
                        user.follower_id = result.insertId;
                        _self.insertAccountFollower(user.account_id, user.follower_id);
                        callback(null,  user);
                    }
                });
            }

        })
    }

    _self.insertAccountFollower = function(accountId, followerId, callback){
        var sql = "INSERT INTO account_follower(account_id, follower_id) VALUES(?, ?) ON DUPLICATE KEY UPDATE account_id = ?";
        cli.query(sql, [accountId, followerId, accountId], function(err, result){
            if(err){
                console.log(["insert account_follower err:", err]);
            }
        });
    }
    
}

exports.db = new Db();
 
