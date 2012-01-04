var fs = require('fs');
var settings = JSON.parse(fs.readFileSync(__dirname + '/etc/settings.json', 'utf8'));
var url = require('url');
var de = require('devent').createDEvent('sender');
var queue = require('queuer');
var logger = require('./lib/logger').logger(settings.logFile);
var util = require('util');
var event = require('events').EventEmitter;
var mysql = require('mysql');
var myCli;

//删除队列的API
var sendQ = queue.getQueue('http://'+settings.queue.host+':'+settings.queue.port+'/queue', settings.queue.send);

//新浪微博的API
var weibo = new require('./lib/sina').weibo;
weibo.init(settings);

process.on('SIGUSR2', function () {
    settings = JSON.parse(fs.readFileSync(__dirname + '/etc/settings.json', 'utf8'));
    weibo.init(settings);
});

//初始化mysql客户端
myCli = mysql.createClient(settings.mysql);
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
/*
setTimeout(function(){
    var blog = {stock_code:'sz900001', content:'随业绩增长，""%000002明年一季报000001每股净资产达15元多，看多11http://finance.sina.com.cn/chanjing/gsnews/20111229/084311090945.shtml'};   
    weibo.send(blog, function(statusCode, body){
       console.log([statusCode, body]);
    });
}, 1000);
*/
setInterval(function(){
    dequeue();    
}, settings.queue.interval);

var senders = [];
var dequeue = function(){
    if(senders.length == 0){
        return;   
    }
    sendQ.dequeue(function(err, task){
        if(err == 'empty' || task == undefined){
            console.log('send queue is empty');
            return;
        }
        console.log(task);
        var sender = senders.pop();
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
               de.emit('task-finished', task); 
               _self.emit('end');
               return;
            }
            var blog = results[0];
//只发创业板
            if(!blog.stock_code.match(/^sz300/)){
                console.log('not sz300');
                de.emit('task-finished', task);
                _self.emit('end');
                return;
            }
            blog.stock_code = 'sz900000';
            //发送间隔太短
/*
            if(!_self.requestAble(blog.stock_code)){
                console.log('rate limit');
                de.emit('task-error', task);
                _self.emit('end');
                return;
            }
*/
            blog.task = task;
            weibo.send(blog, function(statusCode, body){
                sent[blog.stock_code] = parseInt(new Date().getTime());
                if(statusCode != 200){
                    logger.info("Send error\t" + statusCode +"\t" + body.error + "\t"+ task.uri);
                    de.emit('task-error', task);  
                }else{
                    _self.sendSuccess(blog, body.id, blog.stock_code);
                    de.emit('task-finished', task);
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
        var sql = "update micro_blog SET send_time = '"+time+"', status = 1 WHERE id = '"+blog.id+"'";
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
util.inherits(Sender, event); 
for(i = 0; i < 1; i++){
    var sender = new Sender();
    sender.on('end', function(){
	    senders.push(sender);
    })
    senders.push(sender);
}
fs.writeFileSync(__dirname + '/server.pid', process.pid.toString(), 'ascii');
