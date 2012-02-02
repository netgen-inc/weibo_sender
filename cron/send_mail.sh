#!/bin/sh
cd /opt/weibo/sender/cron
/usr/local/bin/node send_mail.js `date +%Y-%m-%d -d -2day`
