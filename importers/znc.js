var fs = require('fs');
var path = require('path');
var glob = require("glob");
var lineReader = require('line-reader');

var RemoteStorage = require("remotestoragejs");
require("../lib/messages-irc.js");
var remoteStorage = new RemoteStorage({logging: true});
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
    console.log(pattern);
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
  remoteStorage.caching.disable("/");

  remoteStorage.on('ready', function() {
    console.log("remoteStorage ready");
  });
  remoteStorage.on('connected', function() {
    console.log("remoteStorage connected\n");
    pending.resolve();
  });
  remoteStorage.on('error', function(error) {
    console.error('Error:', error);
    process.exit(1);
  });

  remoteStorage.connect(program.rsUser, program.rsToken);

  return pending.promise;
};

var importFromFilesOld = function(program, dir, files) {
  console.log('Importing '+files.length+' (pre-1.6) log files from '+dir+'\n');
  var pending = Promise.defer();

  files.forEach(function(filename) {
    var matches = filename.match(/_(.+)_(.+)_(\d+)\.log/i);
    var network = matches[1];
    var channel = matches[2];
    var dateStr = matches[3].substr(0,4)+'-'+matches[3].substr(4,2)+'-'+matches[3].substr(6,2);
    var date = new Date(Date.parse(dateStr));
    // console.log(network, channel, date);

    var archive = new rsMessagesIrc.DailyArchive({
      network: { name: network, ircURI: 'change-me' },
      channelName: channel,
      date: date,
      isPublic: program.rsPublic || false
    });

    var messages = [];

    var content = fs.readFileSync(filename, {encoding: 'utf-8'})
                    .split('\n');

    content.forEach(function(line, index) {
      var message = {}
      var matchTextMessage = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \<(.+)\> (.+)$/);

      if (matchTextMessage) {
        var timeStr = matchTextMessage[1];

        message.timestamp = Date.parse(dateStr+' '+timeStr);
        message.from = matchTextMessage[2];
        message.text = matchTextMessage[3];
        message.type = "text"
      }

      if (Object.keys(message).length !== 0) {
        messages.push(message);
      };

      if (index === content.length-1 && messages.length > 0) {
        console.log('write archive', messages.length);
        archive.addMessages(messages, true);
      }
    });
  });

  return pending.promise;
};

var importFromFilesNew = function(program, dir, files) {
  console.log('Importing '+files.length+' log files from '+dir+'\n');
  files.forEach(function(filename) {
    // console.log(filename);
  });
};

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
      if (oldFiles.length > 0) { importFromFilesOld(program, logsDir, oldFiles); };
      if (newFiles.length > 0) { importFromFilesNew(program, logsDir, newFiles); };
    });
  } else {
    console.error('Error: No log files found');
    process.exit(1);
  }

};

function walk(dir, prefix){

  return fs.readdirSync(dir).filter(function(f){

    return f && f[0] != '.'; // Ignore hidden files

  }).map(function(f){

    var p = path.join(dir, f),
    stat = fs.statSync(p);

    if(stat.isDirectory()){

      return {
        name: f,
        type: 'folder',
        path: path.join(prefix, p),
        items: walk(p, prefix)
      };

    }

    return {
      name: f,
      type: 'file',
      path: path.join(prefix, p),
      size: stat.size
    }

  });

};
