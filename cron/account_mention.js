var settings = require('../etc/settings.json');
var tool = require('../lib/tool').tool;
var weibo = require('weibo');
var async = require('async');
var db = require('../lib/db').db;
db.init(settings);

var dbStat = require('../lib/db_stats').db;
dbStat.init(settings);


weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);

var fetchMentionList = function(task, queueCallback){
    var timer = setTimeout(function(){
        queueCallback();
    }, 30000);
    var localUser = task.user;
    weibo.tapi.mentions(task, function(err, result){
        console.log([localUser.stock_code, task.page]);
        clearTimeout(timer);
        var delay = false;
        if(err){
            if(typeof err.message == 'object' && typeof err.message.error == 'string' && err.message.error.match(/^40312/)){
                delay = true;
            }
            if(task.retry < 5){
                task.retry += 1;
                task.user = localUser;
                lq.push(task);
            }
        }
        if(err || result.length == 0){
            if(delay){
                console.log("delaying");
                setTimeout(function(){
                    queueCallback();
                }, 10000);
            }else{
                queueCallback();
            }
            return;
        }

        var duplicated = false;
        var q = async.queue(function(mention, sCallback){
            if(duplicated){
                sCallback();
                return;
            }

            mention.account_id = localUser.id;
            dbStat.insertMention(mention, function(err, info){
                if(err && err.number == 1062){
                    duplicated = true;
                }
                sCallback();
            });
        }, 1);

        q.drain = function(){
            console.log(duplicated);
            if(!duplicated){
                task.user = localUser;
                task.page += 1;
                task.retry = 0;
                lq.push(task);
            }
            queueCallback();
        }
        async.forEach(result, function(mention, callback){
            q.push(mention);
            callback();
        });
    });
}



var lq = async.queue(fetchMentionList, 2);
lq.drain = function(){
    console.log("complete!!!");
    setTimeout(function(){
        process.exit(0);
    }, 1000 * 60);
}

db.loadAccounts(function(err, accs){
    accounts = accs;
    for(var stock in accounts){
        if(!accounts[stock].weibo_user_id){
            continue;   
        }

        var listTask = {user_id:accounts[stock].weibo_user_id, user:accounts[stock], page:1, count:200,retry:0};
        lq.push(listTask);
    }
});


setInterval(function(){
    var o = {listQueue:lq.length()}
    console.log(o);
}, 1000);