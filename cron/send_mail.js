var async = require('async');
var mysql = require('mysql');
var settings = require('../etc/settings.json');
var client = mysql.createClient(settings.mysql);
var _ = require('underscore');

var mailer = require('nodemailer');
mailer.SMTP = {
    host: settings.mail.host,
    port: settings.mail.port,
    use_authentication: true, 
    user: settings.mail.user,
    pass: settings.mail.password
};

var sendMail = function(to, body, subject, attachments){
    var subject = subject || '新浪个股雷达统计';
    mailer.send_mail({
        sender:'"手机证券" <noreply@netgen.com.cn>',
        to:to,
        subject:subject,
        attachments:attachments,
        body:body,
    }, function(err, info){
        console.log([err, info]);
    });
}

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

var getHQBlog = function(callback) {
  client.query("SELECT id,stock_code FROM micro_blog WHERE FROM_UNIXTIME(send_time) > '" + beging_date + "' AND FROM_UNIXTIME(send_time) < '" + end_date + "' AND content LIKE '%盘播报%'", function(error, results) {
    callback(error, results);
  });
};

var getInfoBlog = function(callback) {
  client.query("SELECT id,stock_code FROM micro_blog WHERE FROM_UNIXTIME(send_time) > '" + beging_date + "' AND FROM_UNIXTIME(send_time) < '" + end_date + "' AND content NOT LIKE '%盘播报%'", function(error, results) {
    callback(error, results);
  });
};

var getDeletedBlog = function(callback) {
  client.query("SELECT micro_blog_id as id,stock_code FROM sent_micro_blog WHERE FROM_UNIXTIME(send_time) > '" + beging_date + "' AND FROM_UNIXTIME(send_time) < '" + end_date + "' AND deleted_time > 0", function(error, results) {
    callback(error, results);
  });
};

//获取微博发送之后的24小时内的转发列表
var getRtList = function(callback){
    var sql = "SELECT * FROM micro_blog_repost WHERE send_time >= ? AND send_time <= ? AND TIMESTAMPDIFF(SECOND, send_time, rt_time) <= 86400 ORDER BY send_time ASC";
    client.query(sql, [beging_date, end_date], function(err, results){
        var wids = [];
        var blogs = {};
        blogs.hqRtCount = 0;
        blogs.infoRtCount = 0;
        if(results.length == 0){
            callback(null, blogs);
            return;   
        }
        for(var i = 0; i < results.length;i++){
            wids.push(results[i].weibo_id);
            if(!blogs[results[i].weibo_id]){
                blogs[results[i].weibo_id] = {rts:[]};
            }
             blogs[results[i].weibo_id].rts.push(results[i]);
        }
        var ids = "'" + wids.join("','") + "'";
        var sql1 = "SELECT a.weibo_id, a.weibo_url, b.content, a.send_time FROM sent_micro_blog AS a LEFT JOIN micro_blog AS b ON a.micro_blog_id = b.id WHERE weibo_id IN (" + ids + ")";
        client.query(sql1, function(err, results1){
            for(var i = 0; i < results1.length; i++){
                blogs[results1[i].weibo_id].url =  results1[i].weibo_url; 
                blogs[results1[i].weibo_id].content =  results1[i].content; 
                blogs[results1[i].weibo_id].send_time =  results1[i].send_time; 
                if(results1[i].content.match(/^【.+?盘播报】/)){
                    blogs.hqRtCount += blogs[results1[i].weibo_id].rts.length;
                }else{
                    blogs.infoRtCount += blogs[results1[i].weibo_id].rts.length;
                }
            }
            callback(null, blogs);
        });
    });
}


//获取微博发送之后的24小时内的评论列表
var getCommentList = function(callback){
    var sql = "SELECT * FROM micro_blog_comment WHERE send_time >= ? AND send_time <= ? AND TIMESTAMPDIFF(SECOND, send_time, comment_time) <= 86400 ORDER BY send_time ASC";
    client.query(sql, [beging_date, end_date], function(err, results){
        var wids = [];
        var blogs = {};
        blogs.hqCommentCount = 0;
        blogs.infoCommentCount = 0;
        if(results.length == 0){
            callback(null, blogs);   
            return;
        }
        for(var i = 0; i < results.length;i++){
            wids.push(results[i].weibo_id);
            if(!blogs[results[i].weibo_id]){
                blogs[results[i].weibo_id] = {comments:[]};
            }
            blogs[results[i].weibo_id].comments.push(results[i]);
        }
        var ids = "'" + wids.join("','") + "'";
        var sql1 = "SELECT a.weibo_id, a.weibo_url, b.content, a.send_time FROM sent_micro_blog AS a LEFT JOIN micro_blog AS b ON a.micro_blog_id = b.id WHERE weibo_id IN (" + ids + ")";
        client.query(sql1, function(err, results1){
            for(var i = 0; i < results1.length;i++){
                blogs[results1[i].weibo_id].url =  results1[i].weibo_url; 
                blogs[results1[i].weibo_id].content =  results1[i].content; 
                blogs[results1[i].weibo_id].send_time=  results1[i].send_time; 
                if(results1[i].content.match(/^【.+?盘播报】/)){
                    blogs.hqCommentCount += blogs[results1[i].weibo_id].comments.length;
                }else{
                    blogs.infoCommentCount += blogs[results1[i].weibo_id].comments.length;
                }
            }
            callback(null, blogs);
        });
    });
}

var getBlogID = function(list) {
  var len = list.length;
  var return_list = [];
  for ( var i = 0; i < len; i++) {
    return_list.push(list[i].id);
  }
  return return_list;
};

var getStockCode = function(list1, list2) {
  var len = list1.length;
  var return_list = [];
  for ( var i = 0; i < len; i++) {
    if (_.indexOf(return_list, list1[i].stock_code) == -1 && _.indexOf(list2, list1[i].id) > -1) {
      return_list.push(list1[i].stock_code);
    }
  }
  return return_list;
};

var stat_date = process.argv[2];
var beging_date = stat_date + ' 00:00:00';
var end_date = stat_date + ' 23:59:59';

async.series([ getHQBlog, getInfoBlog, getDeletedBlog, getRtList, getCommentList ], function(err, results) {
    
  client.end();
  var hq_list = getBlogID(results[0]);
  var info_list = getBlogID(results[1]);
  var del_list = getBlogID(results[2]);
  var rt = results[3];
  var comment = results[4];

  //console.log(hq_list.length, info_list.length, del_list.length);

  hq_list = _.difference(hq_list, del_list);
  info_list = _.difference(info_list, del_list);
  //console.log(hq_list.length, info_list.length, del_list.length);
  var hq_stock_list = getStockCode(results[0], hq_list);
  var info_stock_list = getStockCode(results[1], info_list);
  //console.log(hq_stock_list.length, info_stock_list.length);
  var total_cnt = hq_list.length + info_list.length;
  var mail_content = stat_date + '个股雷达统计\r\n共发送微博:' + total_cnt + "\r\n" + "行情微博:" + hq_list.length + "条(涉及股票" + hq_stock_list.length + "只)\r\n" + "资讯微博:" + info_list.length + "条(涉及股票" + info_stock_list.length + "只)\r\n";
  mail_content += "\r\n微博发送后24小时内,资讯转发" + rt.infoRtCount + "次,评论" + comment.infoCommentCount + "次；推送行情转发"+rt.hqRtCount+"次,评论"+comment.hqCommentCount+"次\r\n\r\n";
    var mailBody = mail_content;
    mailBody += "转发和评论列表请阅附件";
  mail_content += "===========================转发列表====================\r\n";
  delete rt.hqRtCount;
  delete rt.infoRtCount;
  delete comment.hqCommentCount;
  delete comment.infoCommentCount;
    for( var x in rt){
        mail_content += "微博原文：" + rt[x].content + "(微博地址："+rt[x].url+", 发送时间："+getDateString(new Date(rt[x].send_time * 1000), true)+")\r\n";
        mail_content += "转发留言：\r\n";
        for(i = 0; i < rt[x].rts.length; i++){
            mail_content += (i+1) + '.' + rt[x].rts[i].content + '(转发时间:'+getDateString(new Date(rt[x].rts[i].rt_time), true)+')\r\n'; 
        }
        mail_content += "\r\n";
    }
    
    mail_content += "===========================评论列表=======================\r\n";
    delete comment.commentCount;
    for( var x in comment){
        mail_content += "微博原文：" + comment[x].content + "(微博地址："+comment[x].url+", 发送时间："+getDateString(new Date(comment[x].send_time * 1000), true)+")\r\n";
        mail_content += "评论内容：\r\n";
        for(i = 0; i < comment[x].comments.length; i++){
            mail_content += (i+1) + '.' + comment[x].comments[i].content + '(评论时间：'+getDateString(new Date(comment[x].comments[i].comment_time), true)+')\r\n';
        }
        mail_content += "\r\n";
    }
    mail_content += "\r\n\r\n内容生成时间：" + getDateString(null, true);
    var subject = stat_date + '个股雷达统计';
    attachments = [{filename:subject + '.txt', contents:mail_content}];
    var tos = settings.mail.to.split(','); 
    for(var i =0; i < tos.length; i++){
        var to = tos[i].trim();
        if(!to){   
            continue;
        }        
        sendMail(to, mailBody, subject, attachments);    
    }
});

