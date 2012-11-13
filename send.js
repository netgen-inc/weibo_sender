var fs = require('fs');
var settings = require(__dirname + '/etc/settings.json');
var async = require("async");
var url = require('url');
var de = require('devent').createDEvent('sender');
var queue = require('queuer');
var logger = require('./lib/logger').logger(settings.logFile);
var util = require('util');
var event = require('events').EventEmitter;
var _ = require('underscore');
var tool = require('./lib/tool').tool;
var redis = require("redis");
var redisCli = redis.createClient(settings.redis.port, settings.redis.host);

//发送队列的API
var middleQ = queue.getQueue('http://'+settings.queue.host+':'+settings.queue.port+'/queue', settings.queue.send);
var repostQ = queue.getQueue('http://'+settings.queue.host+':'+settings.queue.port+'/queue', 'weibo_repost');
var sendQ = queue.getQueue('http://'+settings.queue.host+':'+settings.queue.port+'/queue', 'weibo_to_center');

var Sender = require('./lib/sender_v3').Sender;

//发送对象保存在该数组中
var senders = [];

var db = require('./lib/db').db;
db.init(settings);

//所有微博账号和受限账号
var weiboAccounts = {}, limitedAccounts = {};
db.loadAccounts(function(err, accounts){
    if(err){
        console.log('!!!load account error!!!');   
        return;
    }
    weiboAccounts = accounts;
    console.log('access token loaded');
    //由于发送依赖账号，所以必须先加载完账号才能开始处理发送请求
    console.log('starting dequeue');
    start();
});

//每小时清空受限账号
//凌晨2点清空a_stock的计数器
//a_stock计时器
var aStockTimer = 0;
setInterval(function(){
    if(new Date().getMinutes() % 10 == 0){
        limitedAccounts = {};
    }
    var dt = new Date();
    if((dt.getHours() == 2 && dt.getMinutes() == 1) || Date.now() - aStockTimer > 600000){
        redisCli.set('a_stock_counter', 0, function(){});
    }
}, 60000);

//status == true 任务正常完成
//status == false 任务失败，重新入队
//status == 1 不处理，等待队列超时后任务重新入队
var taskBack = function(task,  status){
    if(status === 1){
        return;   
    }
    if(status){
        de.emit('task-finished', task);  
    }else{
        de.emit('task-error', task);     
    }
}

var deMiddleQ = function ()  {
    middleQ.dequeue (function (err, task) {
        if (err == 'empty'|| !task) {
            return;
        }
        taskBack(task, true);
        var reg = task.uri.match(/#(\d+)$/);
        var id = reg[1];
        var uriObj = url.parse(task.uri);
        db.getBlogById(id, uriObj.query, function (err, result) {
            if(err || result.length == 0){
                logger.info("error\tNot found the resource:" + task.uri);
                deMiddleQ();
                return; 
            }

            var blog = result[0];
            var ak = settings.mode == 'debug' ? 'sz900000' : blog.stock_code.toLowerCase();
            var accounts = weiboAccounts.stocks[ak];
            if(!accounts) {
                deMiddleQ();
                return; 
            }
            for (var provider in accounts) {
                var uri = task.uri + "_" + accounts[provider].id;
                console.log(uri);
                sendQ.enqueue(uri);
            }
            logger.info("success:" + task.uri);
            deMiddleQ();
        });
    });
}

var dequeue = function(){
    for(var i = 0; i < senders.length; i++){
        if(settings.mode == 'debug'){
            //console.log('running status--'+ i + '--'+ senders[i].running);
        }
        
        if(senders[i].running){
            continue;   
        }
        (function(sender){
            sender.running = true;
            sendQ.dequeue(function(err, task){
                if(err == 'empty' || task == undefined){
                    sender.running = false;
                    console.log('send queue is empty');
                    return;
                }
                console.log(['dequeue', task]);
                send(task, sender, {task:task});
            });
        })(senders[i]);
    }
}

var start = function(){
    setInterval(function(){
        dequeue();  
        deMiddleQ();  
    }, settings.queue.interval);  
    
    de.on('queued', function( queue ){
        if(queue == 'weibo_to_center'){
            console.log( queue + "有内容");
            dequeue();
        }

        if(queue == 'weibo_send') {
            deMiddleQ();
        }
    }); 
    console.log('sender start ok'); 
}


var send = function(task, sender, context){
    var reg, uriObj = url.parse(task.uri);;
    if(!(reg = task.uri.match(/#(\d+)_(\d+)$/))) {
        return;
    }

    var blogId = reg[1], accountId = reg[2], table = uriObj.query;
    var account = weiboAccounts.ids[accountId];
    if (!account || !account.weibo_center_id) {
        logger.info("error\tNot found the account:" + task.uri);
        sender.running = false;
        dequeue();
        taskBack(task, true);
        return;
    } 
    db.getBlogById(blogId, table, function(err, results){
        if(err || results.length == 0){
            logger.info("error\tNot found the resource:" + task.uri);
            sender.running = false;
            dequeue();
            taskBack(task, true);
            return; 
        }
        
        var blog = results[0];
        blog.stock_code = blog.stock_code.toLowerCase();
        if(blog.stock_code == 'a_stock' && tool.timestamp() - blog.in_time > 3600){
            subAstockCounter();
            logger.info("error\ttimeout:" + task.uri);
            sender.running = false;
            dequeue();
            taskBack(task, true);
            return;
        }

        blog.content = blog.content + blog.url;
        sendAble(account, blog, function(err, result){
            if(err){
                if (err.msg == 'sent') {
                    logger.info("error\tsent:" + task.uri);
                    taskBack(task, true);
                }
                sender.running = false;
                dequeue();
            }else{
                context.user = account;
                sender.send(blog, account, context); 
            }
            
        });
    });
};

//判断账号是否能发送微博
//为了解决并发的情况，添加判断过程中的对账号的锁定
//首先检查锁定状态，然后检查是否3分钟限制和该账号微博是否发送过
var lockedAccounts = {};
var sendAble = function(account, blog, callback){
    var accountAble = function (cb) {
        if(blog.content_type != 'zixun'){
            cb(null, true);
            return;
        }
        var ts = tool.timestamp();
        var key = "SEND_LIMIT_" + account.id;
        redisCli.get(key, function(err, lastSend){
            if(!lastSend){
                redisCli.setex(key, 180, ts);
                cb(null, true);
            }else{
                cb({err:'limit'}, false);
            }
        });
    };

    var blogAble = function (cb) {
        db.getSent(blog.id, account.id, function (err, result) {
            if(result.length == 0) {
                cb(null, true);
            }else {
                cb({msg:'sent'}, false);
            } 
        });
    }

    async.series([blogAble, accountAble], function (err, result) {
        callback(err);
    });
}

var subAstockCounter = function(){
    aStockTimer = Date.now();
    redisCli.decr('a_stock_counter', function(err, count){
        if(count < 0){
            redisCli.set('a_stock_counter', 0, function(){});
        }
    });
}

var pushRepostTask = function (microBlogId, sentId) {
    db.getReposts(microBlogId, function (err, result) {
        if(err || result.length == 0) {
            return;
        }

        var uri = "mysql://" + settings.mysql.host + ":"
                 + settings.mysql.port + "/"
                 + settings.mysql.database + "?repost_task#";

        async.forEach(result, function (task, cb) {
            var turi = uri + task.id + "_" + sentId;
            console.log(turi);
            repostQ.enqueue(turi);
            cb();
        }, function () {

        });                 
    });
}

/**
 发送结束后的处理，返回true表示发送完成
*/
var complete = function(error, body, blog, context){
    var task = context.task;
    var user = context.user;

    if(!error){    
        logger.info("success\t" + blog.id + "\t" + user.id + "\t" + user.stock_code + "\t" + blog.block_id + "\t" + blog.content_type + "\t" + blog.source + "\t" + blog.content + "\t" + body.id);
        db.sendSuccess(blog, body.id, body.t_url, user, function (err, result) {
            if(!err) {
                pushRepostTask(blog.id, result.insertId);    
            }
            
        });
        if(user.stock_code == 'a_stock'){
            subAstockCounter();
        }
        return true;
    }
    if(!error.error_code){
        error.error_code = 70000;
    }

    var errMsg = error.error;
    logger.info("error\t" + blog.id +"\t"+ blog.stock_code + "\t" + blog.source +"\t"+ errMsg); 

    //发送受限制
    if(error.nextAction == 'delay'){
        limitedAccounts[user.email] = {start:tool.timestamp()};
        console.log(limitedAccounts);
        return 1;
    //40013太长, 40025重复
    //40095: content is illegal!
    }else if(error.nextAction == 'drop'){
        if(user.stock_code == 'a_stock'){
            subAstockCounter();
        }
        return true;
    }else{
        if(task.retry >= settings.queue.retry){
            logger.info("error\t" + blog.id +"\t"+ blog.stock_code + "\t"+ "\tretry count more than "+settings.queue.retry);
            if(user.stock_code == 'a_stock'){
                subAstockCounter();
            }
            return true;
        }else{
            return false;
        }
    }
}


for(i = 0; i < settings.sendersCount; i++){
    var sender = new Sender();
    sender.init(settings);
    (function(s){
        s.on('send', function(error, body, blog, context){
            s.running = false;
            taskBack(context.task, complete(error, body, blog, context));
            dequeue();
        })    
    })(sender);
    senders.push(sender);
}

fs.writeFileSync(__dirname + '/server.pid', process.pid.toString(), 'ascii');

//收到进程信号重新初始化
process.on('SIGUSR2', function () {
    settings = require('./etc/settings.json');
    db.init(settings);
    for(i = 0; i < senders.length; i++){
        senders[i].init(settings);
    }
});

/*
process.on('uncaughtException', function(e){
    console.log('uncaughtException:' + e);
});
*/
/**
 * 测试代码
 * 
setTimeout(function(){
    var sender = new Sender();
    sender.init(settings);
    var task = {uri:'mysql://172.16.33.238:3306/weibo?micro_blog#143915'};
    sender.on('send', function(error, body, blog, context){
        console.log(context);
        console.log(error);
        taskBack(context.task, complete(error, body, blog, context));
    });
    send(task, sender, {task:task});
}, 1000);
 */





 
