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
    
    _self.getBlogBySendTime = function(start, end, cb){
        var sql = "SELECT * FROM sent_micro_blog WHERE deleted = 0 AND send_time >= ? AND send_time < ?";
        cli.query(sql, [start, end], cb);
    }
    
    _self.insertRt = function(weiboId, rtWeiboId, rtTime, sendTime, rtContent, userId, cb){
        var sql = "INSERT INTO micro_blog_repost(weibo_id, rt_id, rt_time, send_time, content, user_id) VALUES(?, ?, ?, ?, ?, ?)";
        cli.query(sql, [weiboId, rtWeiboId, rtTime, sendTime, rtContent, userId], cb);
    }
    
    _self.insertComment = function(weiboId, commentId, commentTime, sendTime, content, userId, cb){
        var sql = "INSERT INTO micro_blog_comment(weibo_id, comment_id, comment_time, send_time, content, user_id) VALUES(?, ?, ?, ?, ?, ?)";
        cli.query(sql, [weiboId, commentId, commentTime, sendTime, content, userId], cb);
    }
}

exports.db = new Db();
 