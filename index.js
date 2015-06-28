#!/usr/bin/env node

'use strict';

var path            = require('path');
var pkg             = require(path.join(__dirname, 'package.json'));
var program         = require('commander');
var importZncBackup = require('./importers/znc');

program
  .version(pkg.version)
  .option('-t, --type <type>', 'Input type/format', /^(znc)$/i)
  .option('-i, --input <type>', 'Input directory')
  .option('--rs-user <user address>', 'User address of the RS account to import to')
  .option('--rs-token <token>', 'Valid bearer token for the "messages-irc:rw" scope')
  .option('--rs-public', 'Import to public folder')
  .option('--znc-user <username>', 'Username of the ZNC user account')
  .option('--znc-network <network>', 'Only import logs from given network')
  .option('--znc-channel <channel>', 'Only import logs from given channel')
  .parse(process.argv);

if (!(program.rsUser && program.rsToken &&
      program.input && (typeof program.type === 'string'))) {
  program.help();
} else {
  console.log('Input type:', program.type);
  console.log('RS account:', program.rsUser);
  console.log();

  switch(program.type) {
    case 'znc':
      if (!program.zncUser) {
        console.error('Error: ZNC import needs value for --znc-user');
        process.exit(1);
      }
      importZncBackup(program);
      break;
  }
}
