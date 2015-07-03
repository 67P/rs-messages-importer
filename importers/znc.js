var fs          = require('fs');
var glob        = require("glob");
var async       = require('async');
var ProgressBar = require('progress');
var program     = null;

var RemoteStorage = require("remotestoragejs");
require("../lib/chat-messages.js");
var remoteStorage = new RemoteStorage();
global.remoteStorage = remoteStorage;
var chatMessages = remoteStorage["chat-messages"];
var dailyLogs = {};

var collectFilesOld = function() {
  var dir = program.input;

  if (!fs.existsSync(dir+'moddata/log/')) {
    console.log('Input directory doesn\'t contain old (<1.6) ZNC logs (should be in moddata/logs)');
    return false;
  }
  else {
    var logsDir = dir+'moddata/log/';
    var pattern = logsDir+program.zncUser+'_*.log';
    var files = glob.sync(pattern);

    // TODO allow only network filtering

    if (program.zncNetwork && program.zncChannel) {
      files = files.filter(function(filename) {
        var r = new RegExp(program.zncUser+'_'+program.zncNetwork+'_'+program.zncChannel+'_', 'i');
        return filename.match(r);
      });
    }

    return files;
  }
};

var collectFilesNew = function() {
  var dir = program.input;

  if (!fs.existsSync(dir+'moddata/log/'+program.zncUser+'/')) {
    console.log('Input directory doesn\'t contain new (>=1.6) ZNC logs (should be in moddata/logs/[znc-user]/)');
    return false;
  }
  else {
    var logsDir = dir+'moddata/log/';
    var pattern = logsDir+program.zncUser+'/**/*.log';
    var files = glob.sync(pattern);

    // TODO allow only network filtering

    if (program.zncNetwork && program.zncChannel) {
      files = files.filter(function(filename) {
        var r = new RegExp(program.zncUser+'\/'+program.zncNetwork+'\/'+program.zncChannel+'/', 'i');
        return filename.match(r);
      });
    }

    return files;
  }
};

var setupRemoteStorage = function() {
  var pending = Promise.defer();

  remoteStorage.access.claim("messages-irc", "rw");
  // remoteStorage.caching.disable("/");

  remoteStorage.on('connected', function() {
    console.log("Remote storage connected\n");
    pending.resolve();
  });
  remoteStorage.on('error', function(error) {
    console.error('Error:', error);
    process.exit(1);
  });

  remoteStorage.connect(program.rsUser, program.rsToken);

  return pending.promise;
};

var parseServerHostFromConfigFile = function(filename, network) {
  return fs.readFileSync(filename, {encoding: 'utf-8'})
           .match(new RegExp('<Network '+network+'>\[\\S\\s\]\*<Network', 'im'))[0]
           .match(/Server \= (.+) [\d\+]/im)[1];
};

var importFromFilesOld = function(dir, files) {
  let pending = Promise.defer();
  if (files.length === 0) { pending.resolve(); }

  console.log('Parsing '+files.length+' (pre-1.6) log files from '+dir);

  async.eachSeries(files, (filename, callback) => {

    let matches = filename.match(/_(.+)_(.+)_(\d+)\.log/i);
    let network = matches[1];
    let channel = matches[2];
    let dateStr = matches[3].substr(0,4)+'-'+matches[3].substr(4,2)+'-'+matches[3].substr(6,2);
    let dateId  = dateStr.replace(/\-/g, '\/');

    parseFile(filename, dateStr).then(function(messages) {
      if (messages.length > 0) {
        dailyLogs[network] = dailyLogs[network] || {};
        dailyLogs[network][channel] = dailyLogs[network][channel] || {};
        dailyLogs[network][channel][dateId] = messages;
        callback();
      } else {
        callback();
      }
    });

  }, () => {
    pending.resolve();
  });

  return pending.promise;
};

var importFromFilesNew = function(dir, files) {
  var pending = Promise.defer();
  if (files.length === 0) { pending.resolve(); }

  console.log('Parsing '+files.length+' log files from '+dir+program.zncUser+'/');

  async.eachSeries(files, (filename, callback) => {

    let matches = filename.match(new RegExp('log/'+program.zncUser+'/'+'\(\.\+\)'))[1]
                          .match(/(.+)\/(.+)\/(.+)\.log$/i);
    let network = matches[1];
    let channel = matches[2];
    let dateStr = matches[3];
    let dateId  = dateStr.replace(/\-/g, '\/');

    parseFile(filename, dateStr).then(function(messages) {
      if (messages.length > 0) {
        dailyLogs[network] = dailyLogs[network] || {};
        dailyLogs[network][channel] = dailyLogs[network][channel] || {};
        dailyLogs[network][channel][dateId] = messages;
        callback();
      } else {
        callback();
      }
    });
  }, () => {
    pending.resolve();
  });

  return pending.promise;
};

var writeDailyLogsToStorage = function() {
  let pending = Promise.defer();
  let networks = Object.keys(dailyLogs);

  async.eachSeries(networks, (network, networkCallback) => {
    let channels = Object.keys(dailyLogs[network]);

    async.eachSeries(channels, (channel, channelCallback) => {
      let days = Object.keys(dailyLogs[network][channel]);

      console.log(`\nWriting archives for ${network}/${channel} to storage`);
      let bar = new ProgressBar(':bar Progress: :current/:total (:percent) ETA: :etas', {
        total: days.length,
        width: 80
      });

      async.eachSeries(days, (day, dayCallback) => {
        let messages = dailyLogs[network][channel][day];
        // TODO cache in memory instead of looking up for every day
        let serverHost = parseServerHostFromConfigFile(program.input+'configs/znc.conf', network);
        let indexToday = days.findIndex(x => x === day);
        let previousDay, nextDay;

        if (indexToday > 0) {
          previousDay = days[indexToday-1];
        }
        if (indexToday !== (days.length-1)) {
          nextDay = days[indexToday+1];
        }

        var archive = new chatMessages.DailyArchive({
          server: { type: 'irc', name: network, ircURI: 'irc://'+serverHost },
          channelName: channel,
          date: new Date(messages[0].timestamp),
          isPublic: program.rsPublic || false,
          previous: previousDay,
          next: nextDay
        });

        archive.addMessages(messages, true).then(() => {
          bar.tick();
          dayCallback();
        }, (error) => {
          console.log('Something went wrong:', error);
        });
      }, () => {
        channelCallback();
      });
    }, () => {
      networkCallback();
    });
  }, () => {
    pending.resolve();
  });

  return pending.promise;
};

var parseFile = function(filename, dateStr) {
  let pending = Promise.defer();
  let messages = [];
  let content = fs.readFileSync(filename, {encoding: 'utf-8'}).split('\n');

  content.forEach(function(line, index) {
    let message = {};
    let matchTextMessage = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \<(.+)\> (.+)$/);
    let matchJoinMessage = false;
    let matchLeaveMessage = false;
    if (program.noisy) {
      matchJoinMessage= line.match(/^\[(\d{2}:\d{2}:\d{2})\] \*\*\* Joins\: (\w+) \(/);
      matchLeaveMessage = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \*\*\* Quits\: (\w+) \(/);
    }

    if (matchTextMessage) {
      message.timestamp = Date.parse(dateStr+' '+matchTextMessage[1]);
      message.from = matchTextMessage[2];
      message.text = matchTextMessage[3];
      message.type = "text";
    }
    else if (matchJoinMessage) {
      message.timestamp = Date.parse(dateStr+' '+matchJoinMessage[1]);
      message.from = matchJoinMessage[2];
      message.type = "join";
    }
    else if (matchLeaveMessage) {
      message.timestamp = Date.parse(dateStr+' '+matchLeaveMessage[1]);
      message.from = matchLeaveMessage[2];
      message.type = "leave";
    }

    if (Object.keys(message).length !== 0) {
      messages.push(message);
    }

    if (index === content.length-1) {
      pending.resolve(messages);
    }
  });

  return pending.promise;
};

module.exports = function(prog){

  program = prog;

  if (!fs.existsSync(program.input)) {
    console.error('Input directory doesn\'t exist');
    process.exit(1);
  }

  let logsDir = program.input+'moddata/log/';
  let oldFiles = collectFilesOld() || [];
  let newFiles = collectFilesNew() || [];

  if (oldFiles.length > 0 || newFiles.length > 0) {
    setupRemoteStorage().then(function(){
      let privPub = program.rsPublic ? 'public' : 'private';
      console.log('Starting import to '+privPub+' folder\n');

      importFromFilesOld(logsDir, oldFiles).then(() => {
        importFromFilesNew(logsDir, newFiles).then(() => {
          writeDailyLogsToStorage().then(() => {
            console.log('\nAll done.');
          });
        });
      });
    });
  } else {
    console.error('\nError: No log files found');
    process.exit(1);
  }

};
