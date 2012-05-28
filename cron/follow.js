var settings = require('../etc/settings.json');
var tool = require('../lib/tool').tool;
var weibo = require('weibo');
var async = require('async');
var mysql = require('mysql'); 
var db = require('../lib/db').db;
db.init(settings);

var mcli = mysql.createClient(settings.mysql);

weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);

var limited[];
var follow = function(task, qc){
    var localUser = task.user;
    if(limited.indexOf(localUser.email)){
        qc();
        return;
    }
    weibo.tapi.friendships_create(task, function(err, result){
        if(err){
            if(err.message.error.match(/^40028/)){
                limited.push(localUser.email);
                console.log(localUser.email + ' is limited!');
            }
            qc();
            return;
        }
        if(!err || (err.message && err.message.error.match(/^40303/))){
            var sql = "update account_followed set follow_time = NOW(), followed = 1 WHERE id = " +  task.id;
            mcli.query(sql, function(err, result){
                if(err){
                    console.log(err);    
                }
            });
        }
        qc();
    });
    
}
var q = async.queue(follow, 5);

db.loadAccounts(function(err, accs){
    var accounts = {};
    for(var stock in accs){
        accounts[accs[stock].id] = accs[stock];
    }
    var sql = "SELECT * FROM account_followed WHERE followed = 0 LIMIT 1";
    mcli.query(sql, function(err, result){
        if(result.length == 0){
            console.log("No task");
            process.exit();
            return;
        }

        for(var i = 0; i < result.length; i++){
            var task = result[i];
            task.user_id = task.weibo_user_id;
            delete task.follow_time;
            task.user = accounts[task.account_id];
            if(task.weibo_user_id == task.user.weibo_user_id){
                continue;
            }
            q.push(task);
        }
    });

});