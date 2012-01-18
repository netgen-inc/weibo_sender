/**
从新浪读取微博的统计数据
*/
var settings = require(__dirname + '/etc/settings.json');
var fs = require('fs');
var weibo = require('weibo');
weibo.init('tsina', settings.weibo.appkey, settings.weibo.secret);
var commentLogger = require('./lib/logger').logger('comment.log');
var rtLogger = require('./lib/logger').logger('rt.log');
var db = require('./lib/db').db;
db.init(settings);

var weiboAccounts;
db.loadAccounts(function(err, accounts){
    if(err){
        console.log('!!!load account error!!!');   
        return;
    }
    weiboAccounts = accounts;
    console.log('access token loaded');
    run();
});

//一天的毫秒数
var dayMicroSeconds = 24 * 60 * 60 * 1000;
var countQueue = [], commentQueue = [], rtQueue = [];
var load = function(start){
    if(!start){
        var before24Hour = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
        start = before24Hour - (before24Hour % 60);
    }else{
        start = start - start % 60; 
    }
    console.log(new Date(start * 1000).toString());
    var end = start + 60;
    db.getBlogBySendTime(start, end, function(err, blogs){
        if(err){
            console.log(['fetch blog error:', err]);   
            return;
        }
        
        console.log('get blog from db :' + blogs.length);
        for(var i = 0; i < blogs.length; i++){
            var blog = blogs[i].toLowerCase();
            countQueue.push(blog);
        }
    });
};

//启动从数据库加载24小时前发送的微博到队列
if(process.argv.length >= 3){
    if(process.argv[2].length != 10 || !process.argv[2].match(/\d{10}/)){
        console.log('!!!error:' + process.argv[2] + 'is not a timestamp');   
    }else{
        var start = parseInt(process.argv[2]);
        var si = setInterval(function(){
            load(start);
            start += 60;
            if(start >= (Math.floor(Date.now() / 1000) - 24 * 60 * 60)){
                clearInterval(si);  
                console.log('运算老数据完成'); 
            }
        }, 100);  
    }
    
}else{
    load();
    setInterval(load, 60000);    
}



//取转发和评论总数
var Counts = function(){
    var _self = this;
    _self.running = false;
    
    _self.run = function(){
        if(_self.running){
            return;   
        }
        _self.running = true;
        var ids = '', accounts = {};
        for(var i = 0; i < 20 && countQueue.length > 0; i++){
            var blog = countQueue.shift();
            console.log(blog);
            ids += blog.weibo_id + ',';
            accounts[blog.weibo_id] = weiboAccounts[blog.stock_code];
        }
        if(ids == ''){
            _self.running = false;
            return;   
        }
        
        ids = ids.substr(0, ids.length - 1);
        console.log(ids);
        var data = {ids:ids,retry:0};
        req(data, accounts); 
    }
    
    var req = function(data, accounts){
        weibo.tapi.counts(data, function(err, body, response){
            if(err){
                console.log(['fetch stats error:', err]);
                if(data.retry >= 5){
                    console.log(['fetch counts more  than :' + data.retry, data, err]);
                    _self.running = false;
                }else{
                    data.retry += 1;   
                    req(data);
                }
                return;
            }
            if(typeof body == 'string'){
                body = JSON.parse(body);   
            }
            console.log(body);
            for(var j = 0;j < body.length; j++){
                if(body[j].comments > 0){
                    commentQueue.push({id:body[j].id,cnt:body[j].comments,user:accounts[body[j].id]});
                }
                
                if(body[j].rt > 0){
                    rtQueue.push({id:body[j].id,cnt:body[j].rt,user:accounts[body[j].id]});
                }
            }
            console.log(rtQueue);
            _self.running = false;
        });
    }
};

//取评论列表
var CommentFetcher = function(){
    var _self = this;
    _self.running = false;
    
    _self.run = function(){
        if(_self.running){
            return;   
        }
        _self.running = true;
        var task = commentQueue.shift()
        
        if(!task){
            _self.running = false;
            return;   
        }
        console.log(['comment task :', task.id]);
        var to = setTimeout(function(){
            _self.running = false;    
        }, 30000);
        weibo.tapi.comments(task, function(err, body, response){
            clearTimeout(to);
            if(err){
                error = err.message;
                commentQueue.push(task);
                _self.running = false;
                return;
            }
            
            if(typeof body == 'string'){
                body = JSON.parse(body);   
            }
           
            var cnt = 0;
            for(var i = 0; i < body.length; i++){
                var commentTime = new Date(body[i].created_at); 
                var updateTime = new Date(body[i].status.created_at); 
                if((commentTime.getTime() - updateTime.getTime()) < dayMicroSeconds){
                     cnt += 1;
                }
            }
            console.log('fetch rt ' + task.id + ' success:' + cnt);
            commentLogger.info(task.id + "\t" + cnt);
            _self.running = false;
        });
    }
}

//取转发列表
var RtFetcher = function(){
    var _self = this;
    _self.running = false;
    
    _self.run = function(){
        if(_self.running){
            return;   
        }
        _self.running = true;
        var task = rtQueue.shift()
        
        if(!task){
            _self.running = false;
            return;   
        }
        console.log(['rt task :', task.id]);
        var to = setTimeout(function(){
            _self.running = false;    
        }, 30000);
        weibo.tapi.repost_timeline(task, function(err, body, response){
            clearTimeout(to);
            if(err){
                error = err.message;
                rtQueue.push(task);
                _self.running = false;
                return;
            }
            
            if(typeof body == 'string'){
                body = JSON.parse(body);   
            }
           
            var cnt = 0;
            for(var i = 0; i < body.length; i++){
                var rtTime = new Date(body[i].created_at); 
                var updateTime = new Date(body[i].retweeted_status.created_at);  
                if((rtTime.getTime() - updateTime.getTime()) < dayMicroSeconds){
                     cnt += 1;
                }
            }
            console.log('fetch rt ' + task.id + ' success:' + cnt);
            rtLogger.info(task.id + "\t" + cnt);
            _self.running = false;
        });
    }
}

var cnts = [];
for(var i = 0; i < 5; i++){
    cnts.push(new Counts());
}

var cfs = [];
for(var i = 0; i < 5; i++){
    cfs.push(new CommentFetcher());
}

var rfs = [];
for(var i = 0; i < 5; i++){
    rfs.push(new RtFetcher());
}

var run = function(){
    //启动取评论和转发总数的工具
    setInterval(function(){
        for(var i = 0; i < cnts.length; i++){
            cnts[i].run();   
        }
    }, 100); 
    
    //启动获取评论列表的工具
    setInterval(function(){
        for(var i = 0; i < cfs.length; i++){
            cfs[i].run();   
        }
    }, 100); 
    
    //启动获取转发列表的工具
    setInterval(function(){
        for(var i = 0; i < rfs.length; i++){
            rfs[i].run();
        }
    }, 100); 
}
console.log('start stats ok');

/**
setTimeout(function(){
    countQueue.push({weibo_id:'3402935688404519', stock_code:'sz900000'});
    var cnts = new Counts();
    cnts.run(countQueue); 
    //var cf = new CommentFetcher();
    //setInterval(cf.run, 100); 
    var rf = new RtFetcher();
    setInterval(rf.run, 100); 
}, 500);

*/