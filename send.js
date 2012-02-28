var fs = require('fs');
var settings = require(__dirname + '/etc/settings.json');
var url = require('url');
var de = require('devent').createDEvent('sender');
var queue = require('queuer');
var logger = require('./lib/logger').logger(settings.logFile);
var util = require('util');
var event = require('events').EventEmitter;
var _ = require('underscore');
var tool = require('./lib/tool').tool;

//发送队列的API
var sendQ = queue.getQueue('http://'+settings.queue.host+':'+settings.queue.port+'/queue', settings.queue.send);

var Sender = require('./lib/sender').Sender;

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
setInterval(function(){
    if(new Date().getMinutes() == 0){
        limitedAccounts = {};
    }
}, 60000)

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

var dequeue = function(){
    for(var i = 0; i < senders.length; i++){
        if(settings.mode == 'debug'){
            console.log('running status--'+ i + '--'+ senders[i].running);
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
    }, settings.queue.interval);  
    
    de.on('queued', function( queue ){
        if(queue == settings.queue.send){
            console.log( queue + "有内容");
            dequeue();
        }
    }); 
    console.log('sender start ok'); 
}


var send = function(task, sender, context){
    db.getBlogByUri(task.uri, function(err, results){
        if(err || results.length == 0){
            logger.info("error\tNot found the resource:" + task.uri);
            sender.running = false;
            dequeue();
            taskBack(task, true);
            return; 
        }
        
        blog = results[0];
        blog.stock_code = blog.stock_code.toLowerCase();
        
        //微博账号错误
        var account = getAccount(blog);
        
        if(!account){
            logger.info("error\t" + blog.id + "\t" + blog.stock_code + "\t"+blog.source+"\tNOT Found the account\t"); 
            sender.running = false;
            taskBack(task, true);
            return;
        }

        if(limitedAccounts[account.email]){
            sender.running = false;
            return;
        }
        
        blog.content = blog.content + blog.url;
        context.user = account;
        sender.send(blog, account, context);
    });
};

var getAccount = function(blog){
    var accountKey = blog.stock_code;
    if(blog.content_type == 'zixun'){
        accountKey = blog.source;
    }
    
    //debug模式下，总是使用stock0@netgen.com.cn发送微博
    if(settings.mode == 'debug'){
        var accountKey = 'sz900000';    
    }
    
    if(!weiboAccounts[accountKey] || 
        !weiboAccounts[accountKey].access_token || 
        !weiboAccounts[accountKey].access_token_secret){
        console.log('error account key ' + accountKey);
        return;
    }
    return weiboAccounts[accountKey];
}    

/**
 发送结束后的处理，返回true表示发送完成
*/
var complete = function(error, body, blog, context){
    var task = context.task;
    var user = context.user;
    if(!error){    
        logger.info("success\t" + blog.id + "\t" + blog.stock_code + "\t" + blog.content + "\t" + body.id + "\t" + body.t_url);
        db.sendSuccess(blog, body.id, body.t_url, user.id);
        return true;
    }

    var errMsg = error.error;
    logger.info("error\t" + blog.id +"\t"+ blog.stock_code + "\t" + errMsg); 

    //发送受限制
    if(errMsg && errMsg.match(/^40(308|090)/)){
        if(typeof limitedAccounts[user.email] !== 'object'){
            limitedAccounts[user.email] = {start:tool.timestamp()};
        } 
console.log(limitedAccounts);
        return 1;
    //40013太长, 40025重复
    }else if(errMsg && errMsg.match(/^400(13|25)/)){                                                                                                                          
        return true;
    }else{
        if(task.retry >= settings.queue.retry){
            logger.info("error\t" + blog.id +"\t"+ blog.stock_code + "\t"+ "\tretry count more than "+settings.queue.retry);
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

process.on('uncaughtException', function(e){
    console.log('uncaughtException:' + e);
});

/**
 * 测试代码

setTimeout(function(){
    var sender = new Sender();
    sender.init(settings);
    var task = {uri:'mysql://abc.com/stock_radar#45549'};
    sender.on('send', function(error, body, blog, context){
        console.log(context);
        console.log(error);
        taskBack(context.task, complete(error, body, blog, context));
    });
    send(task, sender, {task:task});
}, 1000);
 */




 
