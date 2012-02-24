var settings = require('../etc/settings.json');
var tool = require('../lib/tool').tool;
var mysql = require('mysql');
var weibo = require('weibo');
var async = require('async');
var db = require('../lib/db').db;
db.init(settings);
var cli = mysql.createClient(settings.mysql);

weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);
var accounts;

//从api中读取粉丝数并写入数据库
var fans = function(task, callback){
    var user = task.user;
    weibo.tapi.user_show(task, function(err, result){
        if(err){
            console.log([user, err]);
            callback();
        }else{
            insert(user.stock_code, result.followers_count, user.id, function(err){
                if(err){
                    console.log(err);
                }
                if(q.length() == 0){
                    console.log('complete!!!');
                    process.exit(0);   
                }
                callback();
            });
        }
    });
}

var insert = function(stock, cnt, accountId, cb){
    var d = tool.getDateString(null, false);
    var sql = "INSERT INTO followers (stock_code, stat_date, cnt, account_id) VALUES(?, ?, ?, ?) " + 
              "ON DUPLICATE KEY UPDATE cnt = ?";
    cli.query(sql, [stock, d, cnt, accountId, cnt], function(err){
        if(err){
            console.log(err);   
        }
        cb(err);
    });
}

var q = async.queue(fans, 5);

//加载账号
db.loadAccounts(function(err, accs){
    accounts = accs;
    for(var stock in accounts){
        if(!accounts[stock].weibo_user_id){
            continue;   
        }
        var task = {user_id:accounts[stock].weibo_user_id, user:accounts[stock]};
        q.push(task);   
    }
});

setInterval(function(){
    console.log(q.length());
}, 1000);


