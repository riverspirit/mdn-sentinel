MDN Sentinel Bot
===============

This is a spam checker with an IRC bot that checks MDN revision history
for suspicious edits and reports in the specified IRC channels.

The idea
--------
The program will frequently check the revisions dashboard for edits. All edits by user accounts created after a 
threshold date (say Dec 10, 2014) are considered suspicious. And such suspicious edits are reported in the
first channel specified (#sentinel).

If the title of such an edited page matches one of the defined spam trigger words, that edit is 
considered as 'most probably spam' and are reported in the second IRC channel specified too (#mdn).

An admin can tell the bot via IRC commands to trust a particualr username.
Future edits from such trusted usernames will not trigger an alert.

Install
-------
    sudo npm install


Configuration
-------------
Configurable options:
* IRC channels - Specify two channels in an array. The first channel will be used to alert all suspicious edits and 
the second channel will be alterted only in an edit is most probably spam.
* Threshold date - Edits from user accounts created before this date are considered genuine.
* adminNicknames - a set of IRC nicknames that are allowed to ask the bot to trust future edits from particular MDN usernames
* Frequency of checks - edit the setInterval function at the bottom. Default is 10 minutes.
* Database - Specify a mongodb connetion URL for the variable `url`. One easy way to get a 
mongodb URL is to signup at mongolab.com and use a free database from them. Also create the 
collections `trusted_users` and `alerted_revisions` in the database. A connection URL might look like this - 
`mongodb://username:password@xxxxxx.mongolab.com:27751/mdn-sentinel`

Run
---
node bot.js

IRC Commands
------------
* `sentinel: help`
* `sentinel: trust <username>`
* `sentinel: checknow` - check revisions immediately
The username need to be added to the adminNicknames array to be able to run IRC commands.

Dependency
----------
Node.js with npm
