#!/usr/bin/env node

'use strict';

var path            = require('path');
var pkg             = require(path.join(__dirname, 'package.json'));
var program         = require('commander');
var importZncBackup = require('./importers/znc');
var importAdiumBackup = require('./importers/adium');

program
  .version(pkg.version)
  .option('-t, --type <type>', 'input type/format', /^(znc|adium)$/i)
  .option('-i, --input <type>', 'input directory')
  .option('--noisy', 'import join/leave messages as well')
  .option('--rs-user <user address>', 'user address of the RS account to import to')
  .option('--rs-token <token>', 'valid bearer token for the "messages-irc:rw" scope')
  .option('--rs-public', 'import to public folder')
  .option('--znc-user <username>', 'username of the ZNC user account')
  .option('--znc-network <network>', 'only import logs from given network')
  .option('--znc-channel <channel>', 'only import logs from given channel')
  .option('--adium-muc <muc>', 'muc server to import rooms')
  .parse(process.argv);

if (!(program.rsUser && program.rsToken &&
      program.input && (typeof program.type === 'string'))) {
  program.help();
} else {
  // console.log('Input type:', program.type);
  // console.log('RS account:', program.rsUser);
  // console.log();

  switch(program.type) {
    case 'znc':
      if (!program.zncUser) {
        console.error('Error: ZNC import needs value for --znc-user');
        process.exit(1);
      }
      importZncBackup(program);
      break;
    case 'adium':
      if (!program.adiumMuc) {
        console.error('Error: Adium import needs value for --adium-muc');
        process.exit(1);
      }
      importAdiumBackup(program);
      break;
  }
}
