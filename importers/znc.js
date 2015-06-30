var fs          = require('fs');
var path        = require('path');
var glob        = require("glob");
var lineReader  = require('line-reader');
var async       = require('async');
var ProgressBar = require('progress');

var RemoteStorage = require("remotestoragejs");
require("../lib/messages-irc.js");
var remoteStorage = new RemoteStorage();
global.remoteStorage = remoteStorage;
var rsMessagesIrc = remoteStorage["messages-irc"];

var collectFilesOld = function(program) {
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

var collectFilesNew = function(program) {
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

var setupRemoteStorage = function(program) {
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

var importFromFilesOld = function(program, dir, files) {
  let pending = Promise.defer();
  if (files.length === 0) { pending.resolve(); }

  console.log('Importing '+files.length+' (pre-1.6) log files from '+dir+'\n');

  let bar = new ProgressBar(':bar Progress: :current/:total (:percent) ETA: :etas', {
    total: files.length,
    width: 80
  });

  async.eachSeries(files, (filename, callback) => {

    let matches = filename.match(/_(.+)_(.+)_(\d+)\.log/i);
    let network = matches[1];
    let channel = matches[2];
    let dateStr = matches[3].substr(0,4)+'-'+matches[3].substr(4,2)+'-'+matches[3].substr(6,2);
    let date = new Date(Date.parse(dateStr));

    parseFile(filename, dateStr).then(function(messages) {
      if (messages.length > 0) {
        var serverHost = parseServerHostFromConfigFile(program.input+'configs/znc.conf', network);

        var archive = new rsMessagesIrc.DailyArchive({
          network: { name: network, ircURI: 'irc://'+serverHost },
          channelName: channel,
          date: date,
          isPublic: program.rsPublic || false
        });

        archive.addMessages(messages, true).then(() => {
          bar.tick();
          callback();
        });
      } else {
        bar.tick();
        callback();
      }
    });

  }, () => {
    console.log();
    pending.resolve();
  });

  return pending.promise;
};

var importFromFilesNew = function(program, dir, files) {
  var pending = Promise.defer();
  if (files.length === 0) { pending.resolve(); }

  console.log('Importing '+files.length+' log files from '+dir+program.zncUser+'/'+'\n');

  let bar = new ProgressBar(':bar Progress: :current/:total (:percent) ETA: :etas', {
    total: files.length,
    width: 80
  });

  async.eachSeries(files, (filename, callback) => {

    let matches = filename.match(new RegExp('log/'+program.zncUser+'/'+'\(\.\+\)'))[1]
                          .match(/(.+)\/(.+)\/(.+)\.log$/i);
    let network = matches[1];
    let channel = matches[2];
    let dateStr = matches[3];
    let date = new Date(Date.parse(dateStr));

    parseFile(filename, dateStr).then(function(messages) {
      if (messages.length > 0) {
        var serverHost = parseServerHostFromConfigFile(program.input+'configs/znc.conf', network);

        var archive = new rsMessagesIrc.DailyArchive({
          network: { name: network, ircURI: 'irc://'+serverHost },
          channelName: channel,
          date: date,
          isPublic: program.rsPublic || false
        });

        archive.addMessages(messages, true).then(() => {
          bar.tick();
          callback();
        });
      } else {
        bar.tick();
        callback();
      }
    });

  }, () => {
    console.log();
    pending.resolve();
  });

  return pending.promise;
};

var parseFile = function(filename, dateStr) {
  var pending = Promise.defer();
  var messages = [];
  var content = fs.readFileSync(filename, {encoding: 'utf-8'}).split('\n');

  content.forEach(function(line, index) {
    var message = {}
    var matchTextMessage = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \<(.+)\> (.+)$/);
    var matchJoinMessage = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \*\*\* Joins\: (\w+) \(/);
    var matchLeaveMessage = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \*\*\* Quits\: (\w+) \(/);

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
}

module.exports = function(program){

  if (!fs.existsSync(program.input)) {
    console.error('Input directory doesn\'t exist');
    process.exit(1);
  }

  var logsDir = program.input+'moddata/log/';
  var oldFiles = collectFilesOld(program) || [];
  var newFiles = collectFilesNew(program) || [];

  if (oldFiles.length > 0 || newFiles.length > 0) {
    setupRemoteStorage(program).then(function(){
      var privPub = program.rsPublic ? 'public' : 'private';
      console.log('Starting import to '+privPub+' folder\n');
      importFromFilesOld(program, logsDir, oldFiles).then(() => {
        importFromFilesNew(program, logsDir, newFiles);
      });
    });
  } else {
    console.error('\nError: No log files found');
    process.exit(1);
  }

};
