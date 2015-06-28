var fs = require('fs'),
    path = require('path');

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
}

module.exports = function(dir){

  if (!validateZncDir(dir)) { process.exit(1) };

  var logsDir = dir+'moddata/log/';
  var files = fs.readdirSync(logsDir);

  if (files.length > 0) {
    console.log('Importing '+files.length+' log files from '+logsDir+'\n');
  } else {
    console.error('Error No files found in '+logsDir);
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
