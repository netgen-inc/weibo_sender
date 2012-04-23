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

var completer = {
    fc:false,
    fl:false,
    mention:false,
    reset:false,
    complete:function(t){
        this[t] = true;
        if(this.fc && this.fl && this.mention && this.reset){
            console.log("complete!!!");
            process.exit(0);
        }
    }
}

//fetch fans count
var fansCount = function(task, callback){
    var timer = setTimeout(function(){
        callback();
    }, 30000);
    var user = task.user;
    weibo.tapi.user_show(task, function(err, result){
        clearTimeout(timer);
        if(err){
            console.log(['fetch fanscount err:', user.stock_code, err]);
            if(task.retry < 5){
                task.retry += 1;
                task.user = user;
                cq.push(task);
            }
            callback();
        }else{
            dbStat.insertFollowers(user.id, result.followers_count, function(err){
                if(err){
                    console.log(err);
                }
                callback();
            });
        }
    });
}


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

var fetchMsgCount =  function(task, queueCallback){
    var timer = setTimeout(function(){
        queueCallback();
    }, 30000);
    var localUser = task.user;
    weibo.tapi.unread(task, function(err, result){
        clearTimeout(timer);
        if(err){
            if(task.retry < 5){
                task.retry += 1;
                task.user = localUser;
                mq.push(task);
            }
            console.log(["fetchMsgCount " + localUser.stock_code + ' err:', err]);
        }else{
            dbStat.insertMentions(localUser.id, result.mentions);
            completer.reset = false;
            resetQueue.push({user:localUser, type:2,retry:0});
        }
        queueCallback();
    });
}

var resetMsgCount = function(task, queueCallback){
    var timer = setTimeout(function(){
        queueCallback();
    }, 30000);
    var localUser = task.user;
    weibo.tapi.reset_count(task, function(err, result){
        clearTimeout(timer);
        if(err){
            console.log(["reset " + localUser.stock_code + 'err:', err]);
            if(task.retry < 5){
                task.retry += 1;
                task.user = localUser;
                resetQueue.push(task);
            }
        }
        queueCallback();
    });
}


var cq = async.queue(fansCount, 5);
var lq = async.queue(fansList, 5);
var mq = async.queue(fetchMsgCount, 5);
var resetQueue = async.queue(resetMsgCount, 5);
cq.drain = function(){
    completer.complete('fc');
}

lq.drain = function(){
    completer.complete('fl');
}

mq.drain = function(){
    completer.complete('mention');
}

resetQueue.drain = function(){
    completer.complete('reset');
}

db.loadAccounts(function(err, accs){
    accounts = accs;
    for(var stock in accounts){
        if(!accounts[stock].weibo_user_id){
            continue;   
        }

        var taskCount = {user_id:accounts[stock].weibo_user_id, user:accounts[stock],retry:0};
        cq.push(taskCount);   

        var taskList = {user_id:accounts[stock].weibo_user_id, user:accounts[stock],cursor:-1, count:200,retry:0};
        lq.push(taskList);

        mq.push({user:accounts[stock],retry:0});
    }
});

setInterval(function(){
    var o = {countQueu:cq.length(), listQueue:lq.length(), msgQueue:mq.length(), resetQueue:resetQueue.length()}
    console.log(o);
}, 1000);


