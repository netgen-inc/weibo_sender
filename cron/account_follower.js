var settings = require('../etc/settings.json');
var tool = require('../lib/tool').tool;
var weibo = require('weibo');
var async = require('async');
var db = require('../lib/db').db;
db.init(settings);

var dbStat = require('../lib/db_stats').db;
dbStat.init(settings);
//dbStat.truncateAccountFollower();

weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);
var accounts;

var fansList = function(task, queueCallback){
    var timer = setTimeout(function(){
        queueCallback();
    }, 30000);
    var localUser = task.user;
    weibo.tapi.followers(task, function(err, result){
        clearTimeout(timer);
        if(err){
            if(task.retry < 5){
                task.retry += 1;
                task.user = localUser;
                lq.push(task);
            }
        }
        if(err || result.length == 0){
            console.log([err, result]);
            queueCallback();
            return;
        }
        console.log([result.users.length, result.next_cursor]);
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
                }else{
                    dbStat.insertFollowerStatus(user);    
                }
                callback();
            });

        }, function(){
            queueCallback();
        });

    });
}


var lq = async.queue(fansList, 5);
lq.drain = function(){
    console.log("complete!!!");
    setTimeout(function(){
        process.exit(0);
    }, 1000 * 60);
    
}

db.loadAccounts(function(err, accs){
    var as = [];
    if(process.argv[2]){
        as = process.argv[2].split(',');
    }
    accounts = accs;
    for(var stock in accounts){
        if(!accounts[stock].weibo_user_id){
            continue;   
        }

        if(as.length > 0 && as.indexOf(stock) == -1){
            continue;
        }
        var listTask = {user_id:accounts[stock].weibo_user_id, user:accounts[stock],cursor:-1, count:200,retry:0};
        lq.push(listTask);
    }
});

setInterval(function(){
    var o = {listQueue:lq.length()}
    console.log(o);
}, 1000);


