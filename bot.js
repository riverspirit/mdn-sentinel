(function () {
    var mongojs = require('mongojs'),
        request = require('request'),
        cheerio = require('cheerio'),
        irc = require('irc'),
        dateCutOff = new Date('Dec 10, 2014').getTime(),
        uri = '', // Mongodb connection URL
        db = mongojs.connect(uri, ['trusted_users', 'alerted_revisions']),
        trustStatus = {},
        authorList = [],
        revisionCount,
        backgroundCheckCount = 0,
        revisions = {},
        channels = ['#sentinel', '#mdn'],
        bot,
        mdnRoot = 'http://developer.mozilla.org',
        spamTriggerWords = ['watch', 'stream', 'streaming', 'season', 'online', 'movie',
                            'episode', '2014', 'free', 'full', 'hd', 'premiere'];

    console.log('Sentinel is standing watch.');

    function checkRevisions(isManuallyInvoked) {
        revisionCount = 0;
        backgroundCheckCount = 0;

        isManuallyInvoked = isManuallyInvoked ? isManuallyInvoked : false;

        request('https://developer.mozilla.org/en-US/dashboards/revisions', function (error, response, html) {
            if (error) {
                console.error('Failed to fetch revisions dashboard.');
                return;
            }

            $ = cheerio.load(html);
            $('.dashboard-row').each(function (i, element) {
                var revisionId = $(this).data('revision-id');
                var author = $(this).children().last().text();
                var revisionTitle = $(this).children().eq(1).children().first().text();
                var pageLink = $(this).data('view-url');
                var thisRevision = {
                    revisionId: revisionId,
                    link: mdnRoot + pageLink,
                    revisionTitle: revisionTitle
                };

                if (revisions[author]) {
                    revisions[author].push(thisRevision);
                } else {
                    revisions[author] = [thisRevision];
                }

                if (authorList.indexOf(author) === -1) {
                    authorList.push(author);
                }

                revisionCount++;

                if (revisionCount == 50) {
                    backgroundCheckAuthors(isManuallyInvoked);
                }
            });
        });
    }

    function backgroundCheckAuthors(isManuallyInvoked) {
        authorList.forEach(function (author) {
            isAuthorTrusted(author, function (err, status) {
                backgroundCheckCount++;
                if (!err) {
                    trustStatus[author] = status;
                    if (status) {
                        addAsTrustedUser(author);
                    }
                }

                if (backgroundCheckCount == authorList.length) {
                    processRevisions();

                    if (isManuallyInvoked) { // isManuallyInvoked = channel name
                        bot.say(isManuallyInvoked, 'Check completed.');
                    }
                }
            });
        });
    }

    function processRevisions() {
        for (var user in trustStatus) {
            if (!trustStatus[user]) {
                alertHumans(user, revisions[user]);
            }
        }
    }

    function isAuthorTrusted(username, callback) {
        if (trustStatus[username]) {
            callback(null, trustStatus[username]);
            return;
        }

        db.trusted_users.find({"username": username}, function (err, records) {
            if (!err && records.length > 0) {
                callback(null, true);
                return;
            }

            try {
                var profileURL = 'https://developer.mozilla.org/en-US/profiles/' + username;
                request(profileURL, function (error, response, html) {
                    if (error) {
                        console.error('Failed to fetch user profile of ', username);
                        return;
                    }

                    var $ = cheerio.load(html);
                    var joinDate = new Date($('.memberSince').text().replace('Member since ', '')).getTime();

                    if (joinDate < dateCutOff) {
                        // User is old enough to be genuine
                        callback(null, true);
                    } else {
                        callback(null, false);
                        return;
                    }
                });

            } catch (e) {
                console.error(e);
                callback(null, false); // not trusted by age
            }
        });
    }

    function addAsTrustedUser(username, callback) {
        callback = typeof callback === 'function' ? callback : function () {};
        db.trusted_users.find({"username": username}, function (err, records) {
            if (err) {
                callback(err, false);
                return;
            }

            // Already exists
            if (records.length > 0) {
                callback(null, true, 'already existing');
                return;
            }

            db.trusted_users.insert({"username": username});
            callback(null, true);
        });
    }

    function markAsAlerted(revisionId, callback) {
        callback = typeof callback === 'function' ? callback : function () {};

        db.alerted_revisions.find({"revisionId": revisionId}, function (err, records) {
            if (err) {
                callback(err, false);
                return;
            }

            if (records.length > 0) {
                callback(null, true);
                return;
            }

            db.alerted_revisions.insert({"revisionId": revisionId});
            callback(null, true);
        });
    }

    function isRevisionAlreadyAlertedAbout(revisionId, callback) {
        db.alerted_revisions.find({"revisionId": revisionId}, function (err, records) {
            if (err) {
                callback(err, false);
                return;
            }

            if (records.length > 0) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        });
    }



    function hasAdminAccess(nick) {
        var adminNicknames = ['sheppy', 'teoli', 'alispivak', 'fscholz', 'jms', 'hoosteno', 'jsx',
                            'wbamberg', 'dcamp', 'HBloomer', 'jezdez', 'mars', 'openjck', 'groovecoder'];

        return adminNicknames.indexOf(nick) !== -1;
    }

    function alertHumans(user, edits) {
        var isRedFlag = false; // Red flag true for those edits with a high chance of being spam
        var revisionsToAlertAbout = [];
        var pluralify = edits.length > 1 ? 's' : '',
            editedPageLinks = '';

        edits.forEach(function (edit, i) {
            isRevisionAlreadyAlertedAbout(edit.revisionId, function (err, isAlreadyAlerted) {
                if (!isAlreadyAlerted) {
                    editedPageLinks += edit.link + "\n";
                    revisionsToAlertAbout.push(edit);

                    spamTriggerWords.forEach(function (keyword) {
                        if (edit.title.toLowerCase().indexOf(keyword) !== -1) {
                            isRedFlag = true;
                        }
                    });

                    markAsAlerted(edit.revisionId);
                }

                if (i == edits.length - 1) {
                    if (editedPageLinks) {
                        if (isRedFlag) {
                            bot.say(channels[1], 'Suspicious edit'+ pluralify +' from user '+ user +'');
                            bot.say(channels[1], editedPageLinks);
                        } else {
                            bot.say(channels[0], 'Red alert edit'+ pluralify +' from user '+ user +'');
                            bot.say(channels[0], editedPageLinks);
                        }
                    }
                }
            });
        });
    }

    function sentinelStart() {
        bot = new irc.Client('irc.mozilla.org', 'sentinel', {
            channels: channels,
            realName: 'Sentinel Bot'
        });

        bot.addListener('message', function (sender, to, text, message) {
            var tokens = text.toLowerCase().split(' ');
            if (tokens[0] && tokens[0] == 'sentinelx:') {
                if (tokens[1]) {
                    var command = tokens[1];
                    switch (command) {
                        case 'trust': {
                            if (tokens[2]) {
                                var author = tokens[2];

                                if (!hasAdminAccess(sender)) {
                                    bot.say(to, 'Sorry! You are not authorized to use this spell :(');
                                    return;
                                }

                                addAsTrustedUser(author, function (err, added, alreadyTrusted) {
                                   if (err || !added) {
                                       bot.say(to, 'Oops! Error adding author to trusted list.');
                                   } else if (alreadyTrusted) {
                                       bot.say(to, author + ' is a sweet angel and is already trusted.');
                                   } else {
                                       bot.say(to, 'Yay! ' + author + ' will be trusted from now on.');
                                   }
                                });
                            } else {
                                bot.say(to, 'Invalid message format. Try "sentinel: help');
                            }
                            break;
                        }

                        case 'checknow': {
                            if (!hasAdminAccess(sender)) {
                                bot.say(to, 'Sorry! You are not authorized to use this spell :(');
                                return;
                            }

                            bot.say(to, 'Checking revision list for possible spam...');
                            checkRevisions(to);

                            break;
                        }

                        case 'help': {
                            var response;

                            if (!tokens[2]) { // No topic mentioned for help, so show general help response
                                response = "---------------------------------------------------------------------\n";
                                response += "Sentinel is on the lookout for spam edits on MDN\n\n";
                                response += "You can run Sentinel commands by typing sentinel: command\n";
                                response += "For more info on a particular command, type sentinel: help <command>\n";
                                response += "Following are the available botzilla commands\n \n";
                                response += "  trust         Adds an MDN username to the list of trusted users.\n";
                                response += "  checknow      Manually invoke the periodic checking\n";
                                response += "  help          Display this help message.\n";
                                response += "---------------------------------------------------------------------";

                            } else {
                                // topic for help is specified

                                switch (tokens[2]) {
                                    case 'trust': {
                                        response = "---------------------------------------------------------------------\n";
                                        response += "trust adds an MDN username to the list of trusted users\n \n";
                                        response += "usage: sentinel: trust <username>\n";
                                        response += "If a username is added to the trusted list, future edits from that \n";
                                        response += "particular user won't trigger any alerts. Only a few people are allowed to\n";
                                        response += "run the trust command now. If you need this privilege, make a PR \n";
                                        response += "or ping jsx\n";
                                        response += "---------------------------------------------------------------------";
                                        break;
                                    }

                                    case 'checknow': {
                                        response = "---------------------------------------------------------------------\n";
                                        response += "checknow immediately invokes the spam check\n \n";
                                        response += "usage: sentinel: checknow\n";
                                        response += "Only a few people are allowed to run the trust command now.\n";
                                        response += "If you need this privilege, make a PR or ping jsx\n";
                                        response += "---------------------------------------------------------------------";
                                        break;
                                    }
                                }
                            }

                            bot.say(to, response);
                            break;
                        }

                        default: {
                            bot.say(to, 'Invalid command. Type "sentinel: help" for list of available commands.');
                        }

                    }
                }
            }
        });
    }

    sentinelStart();

    // Set the bot to check revisions every x minutes
    setInterval(function () {
        checkRevisions();
    }, 10 * 60 * 1000);
})();
