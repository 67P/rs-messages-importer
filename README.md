# RemoteStorage Messages Importer

A CLI for bulk-importing chat messages to RemoteStorage accounts.

This program uses the chat-messages module to import your existing log files
from bouncers and clients to your remote storage. In order to log future
messages directly to your storage, you could use e.g. our
[hubot-remotestorage-logger](https://github.com/67P/hubot-remotestorage-logger).

Currently supported formats:

* [ZNC](http://wiki.znc.in/ZNC) log files

Planned:

* [WeeChat](https://weechat.org/)

## Installation

* Clone this repository
* `npm install`

(TODO: add binary and publish npm package)

## Usage

    npm run importer -- --help

The URLs of your imported logs will look something like this:

https://storage.5apps.com/kosmos/public/chat-messages/irc/freenode/channels/remotestorage/2015/06/17

When using the `--rs-public` option, log files are imported to your public
folder, but direct messages are not imported at all.
