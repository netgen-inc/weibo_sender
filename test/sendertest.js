/*
*****************************************************
*                     important!                    *
*          每次测试前需修改unit.json的内容          *
*****************************************************
*/
var assert = require('assert');
var vows = require('vows');
var settings = require('../etc/settings.json');
var unit = require('./etc/unit.json');
var Sender = require('../lib/sender').Sender;

var getSender = function() {
    var sender = new Sender();
    sender.init(settings);
    return sender;
}

var clone = function (a){
    var b = {};
    for(var x in a){
        b[x] = a[x];
    }
    return b;
}

var tBlog = unit.Blog;
var tAccount = unit.Account;
var tRepostId = unit.RepostId;
var tRepostMessage = unit.RepostMessage;

vows.describe('weibo-sender').addBatch({
    'normal':{
        topic:function(){
            var sender = getSender();
            var blog = clone(tBlog);
            sender.on('send', this.callback);
            sender.send(blog, tAccount);
        },
        'success':function(error, body, blog){
            assert.isNull(error);
            assert.match(body.id, /^\d+$/);
            assert.equal(body.text.substr(0, 30), blog.content.substr(0, 30));
        }
    },
    'too long':{
        topic:function(){
            var sender = getSender();
            var blog = clone(tBlog);
            blog.content += "最后再追加四十个字吧最后再追加四十个字吧最后再追加四十个字吧最后再追加四十个字吧";
            sender.on('send', this.callback);
            sender.send(blog, tAccount);
        },
        'return too long error':function(error, body, blog){
            assert.isObject(error);
            if(error.error != 'request timeout') {
                assert.equal(error.error, '40013:Error: Text too long, please input text less than 140 characters!');
            }
        }
    },
    'empty':{
        topic:function(){
            var sender = getSender();
            var blog = clone(tBlog);
            blog.content = "";
            sender.on('send', this.callback);
            sender.send(blog, tAccount);
        },
        'return empty error':function(error, body, blog){
            assert.isObject(error);
            if(error.error != 'request timeout') {
                assert.equal(error.error, '40012:Error: content is null!');
            }
        }
    },
    'empty access_token':{
        topic:function(){
            var sender = getSender();
            var account = clone(tAccount);
            account.access_token = '';
            sender.on('send', this.callback);
            sender.send(tBlog, account);
        },
        'return empty access_token error':function(error, body, blog){
            assert.isObject(error);
            if(error.error != 'request timeout') {
                assert.equal(error.error, '40302:Error: auth faild!');
            }
        }
    },
    'error access_token':{
        topic:function(){
            var sender = getSender();
            var account = clone(tAccount);
            account.access_token = 'aaaaaaaaaa';
            sender.on('send', this.callback);
            sender.send(tBlog, account);
        },
        'return access_token error':function(error, body, blog){
            assert.isObject(error);
            if(error.error != 'request timeout') {
                assert.equal(error.error, '40113:Oauth Error: token_rejected:: token =aaaaaaaaaa');
            }
        }
    },
    'error access_token_secret':{
        topic:function(){
            var sender = getSender();
            var account = clone(tAccount);
            account.access_token_secret = 'aaaaaaaaaa';
            sender.on('send', this.callback);
            sender.send(tBlog, account);
        },
        'return access_token_secret error':function(error, body, blog){
            assert.isObject(error);
            if(error.error != 'request timeout') {
                assert.equal(error.error, '40107:Oauth Error: signature_invalid!');
            }
        }
    }
}).addBatch({
    'weibo resend':{
        topic:function(){
            var sender = getSender();
            var blog = clone(tBlog);
            sender.on('send', this.callback);
            sender.send(blog, tAccount);
        },
        'repeat':function(error, body, blog){
            assert.isObject(error);
            assert.equal(error.error, '40025:Error: repeated weibo text!');
        }
    }
}).addBatch({
    'weibo repost':{
        topic:function(){
            var sender = getSender();
            var blog = clone(tBlog);
            sender.on('repost', this.callback);
            sender.repost(tRepostId, tRepostMessage, tAccount);
        },
        'success':function(error, body, blog){
            assert.isNull(error);
            assert.match(body.id, /^\d+$/);
            assert.equal(body.text, tRepostMessage);
        }
    },
    'empty repost':{
        topic:function(){
            var sender = getSender();
            var blog = clone(tBlog);
            sender.on('repost', this.callback);
            sender.repost(tRepostId, '', tAccount);
        },
        'repeat':function(error, body, blog){
            assert.isNull(error);
            assert.match(body.id, /^\d+$/);
            assert.equal(body.text, '转发微博');
        }
    }
}).addBatch({
    'repost resend':{
        topic:function(){
            var sender = getSender();
            var blog = clone(tBlog);
            sender.on('repost', this.callback);
            sender.repost(tRepostId, tRepostMessage, tAccount);
        },
        'repost repeat send':function(error, body, blog){
            assert.isObject(error);
            assert.equal(error.error, '40025:Error: repeated weibo text!');
        }
    }
}).run();