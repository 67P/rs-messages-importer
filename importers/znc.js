var fs = require('fs');
var path = require('path');
var RemoteStorage = require("remotestoragejs");
require("../lib/messages-irc.js");
var remoteStorage = new RemoteStorage();
global.remoteStorage = remoteStorage;
var rsMessagesIrc = remoteStorage["messages-irc"];

var validateZncDir = function(dir) {
  if (!fs.existsSync(dir)) {
    console.error('Error: Input directory doesn\'t exist');
    return false;
  }
  else if (!fs.existsSync(dir+'moddata/log/')) {
    console.error('Error: Input directory doesn\'t contain ZNC logs (should be in moddata/logs)');
    return false;
  }
  else {
    return true;
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

module.exports = function(program){

  if (!validateZncDir(program.input)) { process.exit(1) };

  var logsDir = program.input+'moddata/log/';
  var files = fs.readdirSync(logsDir);

  if (program.zncNetwork && program.zncChannel) {
    files = files.filter(function(filename) {
      var r = new RegExp('_'+program.zncNetwork+'_'+program.zncChannel+'_', 'i');
      return filename.match(r);
    });
  }

  if (files.length > 0) {
    console.log('Importing '+files.length+' log files from '+logsDir+'\n');

    setupRemoteStorage(program).then(function(){
      var privPub = program.rsPublic ? 'public' : 'private';
      console.log('Starting import to '+privPub+' folder...\n');
    });
  } else {
    console.error('Error: No files found in', logsDir);
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
