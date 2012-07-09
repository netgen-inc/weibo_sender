var settings = require('../etc/settings.json');
var tool = require('../lib/tool').tool;
var async = require('async');
var db = require('../lib/db').db;
db.init(settings);

var cp = require("child_process");

var dbStat = require('../lib/db_stats').db;
dbStat.init(settings);

var weibo = require('weibo'); 
weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);

var fetchCommentList = function(task, queueCallback){
    var localUser = task.user;
    weibo.tapi.comments_to_me(task, function(err, result){
        if(err){
            if(task.retry < 5){
                task.retry += 1;
                task.user = localUser;
                lq.push(task);
            }
        }
        if(err || !result || result.length == 0){
            queueCallback();
        }

        var duplicated = false;
        var q = async.queue(function(comment, sCallback){
            if(duplicated){
                sCallback();
                return;
            }

            comment.account_id = localUser.id;
            var data = [comment.account_id, comment.text, comment.id.toString(), tool.getDateString(new Date(comment.created_at)),
                        comment.user.id.toString(), comment.user.name, comment.status.text, comment.status.id.toString(),
                        tool.getDateString(new Date(comment.status.created_at))
                    ];
            dbStat.insertAccountComment(data, function(err, info){
                if(err && err.number == 1062){
                    duplicated = true;
                }
                sCallback();
            });
        }, 1);

        q.drain = function(){
            queueCallback();
        }
        async.forEach(result, function(comment, callback){
            q.push(comment);
            callback();
        });
    });
}



var lq = async.queue(fetchCommentList, 3);
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

        var listTask = {user:accounts[stock], page:1, count:200,retry:0};
        lq.push(listTask);
    }
});

process.on('uncaughtException', function(e){
    console.log('uncaughtException:' + e);
})

setInterval(function(){
    var o = {listQueue:lq.length()}
    console.log(o);
}, 1000);