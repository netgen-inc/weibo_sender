var settings = require('../etc/settings.json');
var tool = require('../lib/tool').tool;
var mysql = require('mysql');
var weibo = require('weibo');
var async = require('async');
var db = require('../lib/db').db;
db.init(settings);

var dbStat = require('../lib/db_stats').db;
dbStat.init(settings);

var cli = mysql.createClient(settings.mysql);

weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);
var accounts;

//fetch fans count
var fansCount = function(task, callback){
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


var fansList = function(task, queueCallback){
    var localUser = task.user;
    weibo.tapi.followers(task, function(err, result){
        if(err || result.length == 0){
            console.log([err, result]);
            queueCallback();
            return;
        }
        if(result.next_cursor && result.next_cursor > 0){
            task.user = localUser;
            task.cursor = result.next_cursor;
            lq.push(task);
        }

        async.forEach(result.users, function(user, callback){
            user.weibo_user_id = user.id.toString();
            user.account_id = localUser.id;
            user.last_send_weibo = '0000-00-00 00:00:00';
            user.created_at = tool.getDateString(new Date(user.created_at));

            if(user.status){
                user.last_send_weibo = tool.getDateString(new Date(user.status.created_at));
            }

            delete user.id;
            dbStat.insertFollowerInfo(user, function(err, user){
                if(err){
                    console.log(err);
                    return;
                }
                dbStat.insertFollowerStatus(user);
                callback();
            });

        }, function(){
            queueCallback();
        });

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
};

var cq = async.queue(fansCount, 5);
var lq = async.queue(fansList, 5);

db.loadAccounts(function(err, accs){
    accounts = accs;
    for(var stock in accounts){
        if(!accounts[stock].weibo_user_id){
            continue;   
        }

        var taskCount = {user_id:accounts[stock].weibo_user_id, user:accounts[stock]};
        cq.push(taskCount);   

        var taskList = {user_id:accounts[stock].weibo_user_id, user:accounts[stock],cursor:-1, count:200};
        lq.push(taskList);
    }
});

setInterval(function(){
    console.log(lq.length());
}, 1000);


