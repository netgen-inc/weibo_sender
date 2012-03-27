/**
从新浪读取微博转发和评论数据
执行过程：
1、按分钟从数据库中取到已发送的微博
2、将微博按20个为一个任务加入到sumQueue中
3、fetchsum函数从新浪微博读取某条微博的评论次数和转发次数
4、如果评论次数大于0，将微博加入到commentQueue中，等待获取评论列表，
   如果转发次数大于0，将微博加入到rtQueue中，等待获取转发列表   
5、将转发列表或者评论列表写入对应的表中


该程序有两种启动方式：
1、抓取指定日期的评论和转发，如
    node /path/to/stats.js 2012-01-31
    
2、常态执行，抓取24小时前的一分钟内发送的微博的评论和转发，如：
    node /path/to/stats.js
*/

var settings = require(__dirname + '/etc/settings.json');
var fs = require('fs');
var async = require('async');
var weibo = require('weibo');
weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);
var db = require('./lib/db').db;
db.init(settings);

var dbStats = require('./lib/db_stats').db;
dbStats.init(settings);

var getDateString = function(d, withTime){
    var d = d || new Date();
    var pad = function(x){
        if(x < 10){
            return '0' + x;   
        }
        return x;
    }
    var date = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
    if(withTime){
        var time = [pad(d.getHours()),  pad(d.getMinutes()), pad(d.getSeconds())].join(':')
        date += ' ' + time;
    } 
    return date;
}

var weiboAccounts;
db.loadAccounts(function(err, accounts){
    if(err){
        console.log('!!!load account error!!!');   
        return;
    }
    weiboAccounts = accounts;
    console.log('access token loaded');
    start();
});

//一天的毫秒数
var dayMicroSeconds = 24 * 60 * 60 * 1000;

//取每条微博的评论和转发总次数
var fetchSum = function(task, callback){
    var data = {ids:task.ids,blogType:'tsina'};
    var accounts = task.accounts;
    weibo.tapi.counts(data, function(err, body, response){
        if(err){
            console.log(['fetch counts error:', err]);
            if(task.retry >= 5){
                console.log(['fetch counts more than :' + task.retry, data, err]);
            }else{
                task.retry += 1;   
                sumQueue.push(task);
            }
            callback();
            return;
        }
        if(typeof body == 'string'){
            body = JSON.parse(body);   
        }
        for(var j = 0;j < body.length; j++){
            if(body[j].comments > 0){
                commentQueue.push({
                    id:body[j].id,
                    cnt:body[j].comments,
                    user:accounts[body[j].id],
                    retry:0,
                    type:task.type
                });
            }
            
            if(body[j].rt > 0){
                var pageCnt = Math.ceil(body[j].rt / 20);
                for(var p = 1; p <= pageCnt; p++){
                    rtQueue.push({
                        id:body[j].id,
                        cnt:20,
                        page:p,
                        user:accounts[body[j].id],
                        blogs:task.blogs,
                        retry:0,
                        type:task.type
                    });        
                }
            }
        }
        callback();
    });
}

//取每条微博详细的转发列表
var fetchRtList = function(task, callback){
    var user = task.user;
    var blogs = task.blogs;
    delete  task.blogs;
    weibo.tapi.repost_timeline(task, function(err, body, response){
        console.log(user);
        if(err){
            console.log([task, err]);
            if(task.retry < 5){
                task.retry += 1;
                rtQueue.push(task);
            }
            callback();
            return;
        }
        
        if(typeof body == 'string'){
            body = JSON.parse(body);   
        }
       
        var cnt = 0;
        for(var i = 0; i < body.length; i++){
            console.log(blogs[task.id].send_time);
            var rt = body[i];
            var rtTime = getDateString(new Date(body[i].created_at), true); 
            var sendTime = getDateString(new Date(blogs[task.id].send_time * 1000), true);
            dbStats.insertRt(task.id, rt.id, rtTime, sendTime, rt.text, rt.user.id, task.type, user.id, function(err, info){
                //不是1062错误（已经抓取过的转发）的话，打印错误
                if(err && err.number != 1062){
                    console.log(err);
                }
            });
        }
        callback();
        console.log('fetch rt ' + task.id + ' success');
    });   
}

//取每条微博详细评论列表
var fetchCommentList = function(task, callback){
    var user = task.user;
    weibo.tapi.comments(task, function(err, body, response){
        if(err){
            console.log([task, err]);
            if(task.retry < 5){
                task.retry += 1;
                commentQueue.push(task);
            }
            callback();
            return;
        }
        if(typeof body == 'string'){
            body = JSON.parse(body);   
        }
       
        var cnt = 0;
        for(var i = 0; i < body.length; i++){
            var comment = body[i];
            var commentTime = getDateString(new Date(comment.created_at), true); 
            var sendTime = getDateString(new Date(comment.status.created_at), true); 
            dbStats.insertComment(comment.status.id, comment.id, commentTime, sendTime, comment.text, comment.user.id, task.type, user.id, function(err, info){
                //不是1062错误（已经抓取过的评论）的话，打印错误
                if(err && err.number != 1062){
                    console.log(err);
                }
            });
        }
        callback();
        console.log('fetch comment ' + task.id + ' success');
    });
}

var sumQueue = async.queue(fetchSum, 1);
var rtQueue = async.queue(fetchRtList, 1);
var commentQueue = async.queue(fetchCommentList, 1);

//从数据库中取到需要获取评论数和转发数的微博
var getBlogs = function(start){
    if(!start){
        var before24Hour = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
        start = before24Hour - (before24Hour % 60);
    }else{
        start = start - start % 60; 
    }
    var end = start + 60;
    
    //将取评论和转发列表的任务写入队列
    //type标识是微博还是转发(blog,repost)
    var push = function(blogs, type){
        var ids = '', accounts = {}, someBlogs = {};
        for(var i = 0; i < blogs.length; i++){
            blogs[i].stock_code = blogs[i].stock_code.toLowerCase();
            var id = blogs[i].weibo_id;
            if(type == 'repost'){
                blogs[i].send_time = blogs[i].repost_time;
            }
            someBlogs[blogs[i].weibo_id] = blogs[i];
            ids += blogs[i].weibo_id + ',';
            var accKey = blogs[i].stock_code;
            if(type == 'blog' && (blogs[i].source == 'jrj' || blogs[i].source == 'sina')){
                accKey = blogs[i].source; 
            }
            accounts[blogs[i].weibo_id] = weiboAccounts[accKey];
            
            if((i != 0 && (i + 1) % 20 == 0) || i == blogs.length - 1){
                ids = ids.substr(0, ids.length - 1);
                sumQueue.push({ids:ids, accounts:accounts,blogs:someBlogs,retry:0,type:type});
                console.log(sumQueue.length());
                ids = '', accounts = {}, someBlogs = {};
            }
        }
    }
    
    db.getBlogBySendTime(start, end, function(err, blogs){
        if(err){
            console.log(['fetch blog error:', err]);   
            return;
        }
        console.log(getDateString(new Date(start * 1000), true) + '\tget blog from db :' + blogs.length);
        push(blogs, 'blog');
    });
    
    dbStats.getReposts(start, end, function(err, blogs){
        if(err){
            console.log(['fetch repost error:', err]);   
            return;
        }
        console.log(getDateString(new Date(start * 1000), true) + '\tget repost from db :' + blogs.length);
        push(blogs, 'repost');
    });
};


var start = function(){
    //如果进程有三个参数，抓取指定日期的评论和转发
    if(process.argv.length >= 3){
        if(process.argv[2].length != 10 ){
            console.log('!!!error:' + process.argv[2] + 'is not a date (yyyy-mm-dd)');
        }else{
            var datetime = parseInt(Math.floor(new Date(process.argv[2]).getTime() / 1000)) - 8 * 60 * 60;
            var start = parseInt(Math.floor(new Date(process.argv[2]).getTime() / 1000)) - 8 * 60 * 60;
            var si = setInterval(function(){
                getBlogs(start);
                start += 60;
                if(start >= datetime + 24 * 60 * 60){
                    clearInterval(si);  
                    console.log(process.argv[2] + '的转发和评论列表获取完成'); 
                }
            }, 100);  
        }
    
    //常态执行，每隔一分钟抓取24小时前的评论和转发    
    }else{
        getBlogs();
        setInterval(getBlogs, 60000);
    }
}

//每隔10秒打印一次队列长度
setInterval(function(){
    console.log(getDateString(null, true) + '\tsum queue:' + sumQueue.length() + '\trt queue:' + rtQueue.length()+'\tcomment queue:' + commentQueue.length());
}, 10000);


process.on('uncaughtException', function(e){
    console.log('uncaughtException:' + e);
});