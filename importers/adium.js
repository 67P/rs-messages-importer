var fs          = require('fs');
var glob        = require("glob");
var async       = require('async');
var Promise     = require('bluebird');
var ProgressBar = require('progress');
var path        = require('path');
var program     = null;
var parseString = require('xml2js').parseString;

var RemoteStorage = require("remotestoragejs");
var ChatMessages = require("remotestorage-module-chat-messages");
var remoteStorage = new RemoteStorage({ cache: false, modules: [ ChatMessages.default ] });
var dailyLogs = {};

var collectFiles = function() {
  var dir = program.input;
  var mucServer = program.adiumMuc;

  if (!fs.existsSync(dir)) {
    console.log('Input directory doesn\'t contain Adium logs (should be in ~/Library/Application\ Support/Adium\ 2.0/Users/Default/Logs/Jabber.[adium-user]/)');
    return false;
  }
  else {
    var logsDir = dir;
    var pattern = logsDir+'/**/*'+mucServer+'*.xml';
    var files = glob.sync(pattern);

    return files;
  }
};

var setupRemoteStorage = function() {
  var pending = Promise.defer();

  remoteStorage.access.claim("messages-irc", "rw");

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

var importFromFiles = function(dir, files) {
  var pending = Promise.defer();
  if (files.length === 0) { pending.resolve(); }

  console.log('Parsing '+files.length+' log files from '+dir);

  async.eachSeries(files, (filename, callback) => {
    let baseName = path.basename(filename);
    let matches = baseName.match(/(.+)@.+\ \(\d{4}-\d{2}-\d{2}.+\)\.xml$/i)
    let network = '5apps'
    let room = matches[1];

    parseFile(filename).then(function(messages) {
      if (messages.length > 0) {
        let date = new Date(messages[0].timestamp).toISOString();
        let dateId = date.match(/(\d{4}-\d{2}-\d{2})/)[1].replace(/\-/g, '\/');
        dailyLogs[network] = dailyLogs[network] || {};
        dailyLogs[network][room] = dailyLogs[network][room] || {};
        dailyLogs[network][room][dateId] = dailyLogs[network][room][dateId] || [];
        messages.forEach(function(m) {
          dailyLogs[network][room][dateId].push(m);
        });
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
  var mucServer = program.adiumMuc;

  async.eachSeries(networks, (network, networkCallback) => {
    let rooms = Object.keys(dailyLogs[network]);

    async.eachSeries(rooms, (room, channelCallback) => {
      let days = Object.keys(dailyLogs[network][room]);

      console.log(`\nWriting archives for ${network}/${room} to storage`);
      let bar = new ProgressBar(':bar Progress: :current/:total (:percent) ETA: :etas', {
        total: days.length,
        width: 80
      });

      async.eachSeries(days, (day, dayCallback) => {
        let messages = dailyLogs[network][room][day];
        let indexToday = days.findIndex(x => x === day);
        let previousDay, nextDay;

        if (indexToday > 0) {
          previousDay = days[indexToday-1];
        }
        if (indexToday !== (days.length-1)) {
          nextDay = days[indexToday+1];
        }

        var archive = new remoteStorage.chatMessages.DailyArchive({
          server: { type: 'xmpp', name: network, xmppMUC: mucServer },
          channelName: room,
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
      pending.resolve();
    });
  }, () => {
    pending.resolve();
  });

  return pending.promise;
};

var parseFile = function(filename) {
  let pending = Promise.defer();
  let messages = [];
  let content = fs.readFileSync(filename);
  let r;
  let doc = parseString(content, function (err, result) { r = result; });

  if(r && r['chat'] && r['chat']['message']) {
    r['chat']['message'].forEach(function(m, index) {
      let message = {}
      if (program.noisy) {
        // TODO
      }

      message.timestamp = Date.parse(m['$']['time']);
      message.from = m['$']['sender'];
      var text;
      // FIXME: Find a way to recursively turn anything into text
      if(m['div'][0]['span']) {
        text = m['div'][0]['span'][0]['_'];
        if(m['div'][0]['span'][0]['a']) {
          text = text + m['div'][0]['span'][0]['a'][0]['_'];
        }
      } else if(m['div'][0]['a']) {
        text = m['div'][0]['a'][0]['_'];
      }
      message.text = text;
      message.type = "text";

      if (message.text && Object.keys(message).length !== 0) {
        messages.push(message);
      }

      if (index === r['chat']['message'].length-1) {
        pending.resolve(messages);
      }
    });
  } else {
    pending.resolve(messages);
  }

  return pending.promise;
};

module.exports = function(prog) {

  program = prog;

  let logsDir = program.input;
  let files = collectFiles() || [];

  if (files.length > 0) {
    setupRemoteStorage().then(function(){
      let privPub = program.rsPublic ? 'public' : 'private';
      console.log('Starting import to '+privPub+' folder\n');

      importFromFiles(logsDir, files).then(() => {
        writeDailyLogsToStorage().then(() => {
          console.log('\nAll done.');
        });
      });
    });
  } else {
    console.error('\nError: No log files found');
    process.exit(1);
  }

};
