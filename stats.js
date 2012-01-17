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

var lastFetch = Math.floor(new Date().getTime() / 1000) - 24 * 60 * 60; 

var commentQueue = [], rtQueue = [];
var load = function(){
    var start = lastFetch - (lastFetch % 60);
    var end = start + 60;
    lastFetch = end;
    db.getBlogBySendTime(start, end, function(err, blogs){
        if(err){
            console.log(['fetch blog error:', err]);   
            return;
        }
        
        console.log('get blog from db :' + blogs.length);
        console.log(blogs);
        var ids = '', accounts = {};
        for(var i = 0; i < blogs.length; i++){
            ids += blogs[i].weibo_id + ',';
            accounts[blogs[i].weibo_id] = weiboAccounts[blogs[i].stock_code];
        }
        ids = ids.substr(0, ids.length - 1);
        var data = {ids:ids,retry:0};
        var req = function(datax){
            weibo.tapi.counts(datax, function(err, body, response){
                if(err){
                    console.log(['fetch stats error:', err]);
                    if(datax.retry >= 5){
                        console.log(['fetch counts more  than :' + datax.retry, datax, err]);
                    }else{
                        datax.retry += 1;   
                        req(datax);   
                    }
                    return;
                }
                if(typeof body == 'string'){
                    body = JSON.parse(body);   
                }
                
                for(var j = 0;j < body.length; j++){
                    if(body[j].commnets > 0){
                        commentQueue.push({id:body[j].id,cnt:body[j].comments,user:accounts[body[j].id]});
                    }
                    
                    if(body.rt > 0){
                        rtQueue.push({id:body[j].id,cnt:body[j].rt,user:accounts[body[j].id]});
                    }
                }
            });   
        }
         
        if(lastFetch < (Math.floor(Date.now() / 1000) - 24 * 60 * 60 - 60)){
            load();
        }else{
            setTimeout(load, 30000);
        }
    });
};
load();

var CommentFetcher = function(){
    var _self = this;
    _self.running = false;
    
    _self.run = function(){
        if(_self.running){
            return;   
        }
        _self.running = true;
        var task = commentQueue.shift()
        console.log(['task :', task]);
        if(!task){
            console.log('no fetch comment task');
            _self.running = false;
            return;   
        }
        
        var to = setTimeout(function(){
            _self.running = false;    
        }, 30000);
        weibo.tapi.comments(task, function(err, body, response){
            clearTimeout(to);
            console.log([err, body, response]);
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
                var updateTime = new Date(body[i].status.create_at);  
                if((commentTime.getTime() - updateTime.getTime()) < dayMicroSeconds){
                     cnt += 1;
                }
            }
            commentLogger.info(task.id + "\t" + cnt);
            _self.running = false;
        });
    }
}

var RtFetcher = function(){
    var _self = this;
    _self.running = false;
    
    _self.run = function(){
        if(_self.running){
            return;   
        }
        _self.running = true;
        var task = rtQueue.shift()
        console.log(['task :', task]);
        if(!task){
            console.log('no fetch rt task');
            _self.running = false;
            return;   
        }
        
        var to = setTimeout(function(){
            _self.running = false;    
        }, 30000);
        weibo.tapi.repost_timeline(task, function(err, body, response){
            clearTimeout(to);
            console.log([err, body]);
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
                var updateTime = new Date(body[i].status.create_at);  
                if((rtTime.getTime() - updateTime.getTime()) < dayMicroSeconds){
                     cnt += 1;
                }
            }
            rtLogger.info(task.id + "\t" + cnt);
            _self.running = false;
        });
    }
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
    setInterval(function(){
        for(var i = 0; i < cfs.length; i++){
            cfs[i].run();   
        }
    }, 100); 
    
    setInterval(function(){
        for(var i = 0; i < rfs.length; i++){
            rfs[i].run();   
        }
    }, 100); 
}
/*



*/
//console.log('start stats ok');








