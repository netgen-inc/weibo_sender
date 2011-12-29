var settings = require('./etc/settings').settings;
var url = require('url');
var de = require('../event/lib/devent').createDEvent('sender');
var queue = require('./lib/queue');
var logger = require('./lib/logger').logger(settings.logFile);

var util = require('util');


//删除队列的API
var sendQ = queue.getQueue('http://'+settings.queue.host+':'+settings.queue.port+'/queue', settings.queue.send);

//新浪微博的API
var weibo = require('./lib/sina').weibo;
weibo.init(settings);

//初始化mysql客户端
var mysql = require('mysql');
var myCli = mysql.createClient(settings.mysql);
myCli.query('use ' + settings.mysql.database);
myCli.query('set names utf8');

Date.prototype.getStamp = function(){
    var time = this.getTime();   
    return parseInt(time / 1000);
}

de.on('queued', function( queue ){
    if(queue == settings.queue.send){
        console.log( queue + "有内容");
        dequeue();
    }
});


setInterval(function(){
    dequeue();    
}, settings.queue.interval);

var senders = [];
setTimeout(function(){
    for(i = 0; i < 10; i++){
        var sender = new Sender();
        senders.push(sender);
   }
}, 1000);
var dequeue = function(){
    if(sender.length == 0){
        return;   
    }
    sendQ.dequeue(function(err, task){
        if(err == 'empty' || task == undefined){
            console.log('send queue is empty');
            return;
        }
        var sender = senders.pop();
        sender.on('end', function(){
	    senders.push(sender);
        });
        sender.send(task);
    });
}

//记录股票最后下发时间，用于控制下发频率
var sent = {};
var Sender = function(){
    var _self = this;
    this.send = function(task){
        _self.getBlogByUri(task.uri, function(err, results){
            if(err || results.length == 0){
               logger.info("Not found the resource:" + task.uri);
               hook.emit('task-finished', task); 
               _self.emit('end');
               return;
            }
            var blog = results[0];
            
            //debug 记得删除
            if(blog.stock_code != 'sh601988'){
                 //hook.emit('task-finished', task); 
                 //return; 
            }
            //发送间隔太短
            if(!_self.requestAble(blog.stock_code)){
                console.log('rate limit');
                _self.emit('end');
                return;
            }
                
            weibo.update(blog, function(statusCode, body){
                sent[blog.stock_code] = parseInt(new Date().getTime());
                console.log(body);
                if(statusCode != 200){
                    logger.info("Send error\t" + statusCode +"\t" + task.uri);
                    hook.emit('task-error', task);  
                }else{
                    hook.emit('task-finished', task);
                    _self.sendSuccess(blog, body.id, blog.stock_code);
                }
                _self.emit('end');
            });
        });
    };
    
    this.getBlogByUri = function(uri, cb){
        var uri = url.parse(uri);
        var id = uri.hash.substring(1);
        var sql = "select * from micro_blog where id = '" + id + "' AND send_time = 0";
        myCli.query(sql, function(err, results, fields){
            cb.call(null, err, results);
        });
    };
    
    this.sendSuccess = function(blog, sinaId, stockCode){
        var time = new Date().getTime();
        time = time.toString().substring(0, 10);
        var sql = "update micro_blog SET send_time = '"+time+"' WHERE id = '"+blog.id+"'";
        myCli.query(sql);
        
        var sql = "INSERT INTO sent_micro_blog(micro_blog_id, weibo_id, send_time, stock_code) values("+blog.id+", "+sinaId+", "+time+", '"+stockCode+"')";
        myCli.query(sql);
    }
    
    this.requestAble = function (stockCode){
        if(sent[stockCode] && (parseInt(new Date().getTime()) - sent[stockCode]) < settings.weibo.interval * 1000){ 
            return false; 
        }
        return true; 
    }
};
util.inherits(Sender, events.EventEmitter); 
