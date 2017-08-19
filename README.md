# matrix-appservice-sms

[![Greenkeeper badge](https://badges.greenkeeper.io/turt2live/matrix-appservice-sms.svg)](https://greenkeeper.io/)
[![TravisCI badge](https://travis-ci.org/turt2live/matrix-appservice-sms.svg?branch=master)](https://travis-ci.org/turt2live/matrix-appservice-sms) 
[![Targeted for next release](https://badge.waffle.io/turt2live/matrix-appservice-sms.png?label=sorted&title=Targeted+for+next+release)](https://waffle.io/turt2live/waffle-matrix?utm_source=badge)
[![WIP](https://badge.waffle.io/turt2live/matrix-appservice-sms.png?label=wip&title=WIP)](https://waffle.io/turt2live/waffle-matrix?utm_source=badge)

Uses Twilio to send and receive SMS messages in Matrix. Talk about it on Matrix: [#webhooks:t2bot.io](https://matrix.to/#/#webhooks:t2bot.io)

# Requirements

* [NodeJS](https://nodejs.org/en/) (Node 6 or higher recommended)
* A [Twilio](https://twilio.com) account with a phone number
* A [Synapse](https://github.com/matrix-org/synapse) server

# Installation

**Before you begin:** A Synapse server is required. The instructions here assume that Synapse server is a default setup.

1. Clone this repository and install the dependencies
   ```
   git clone http://github.com/turt2live/matrix-appservice-sms
   cd matrix-appservice-sms
   npm install
   ```

2. Copy `config/sample.yaml` to `config/config.yaml` and fill in the appropriate fields
3. Generate the registration file
   ```
   node index.js -r -u "http://localhost:9000" -c config/config.yaml
   ```
   *Note:* The default URL to run the appservice is `http://localhost:9000`. If you have other appservices, or other requirements, pick an appropriate hostname and port.

4. Copy/symlink the registration file to your Synapse directory
   ```
   cd ~/.synapse
   ln -s ../matrix-appservice-sms/appservice-registration-sms.yaml appservice-registration-sms.yaml
   ```

5. Add the registration file to your `homeserver.yaml`
   ```
   ...
   app_service_config_files: ["appservice-registration-sms.yaml"]
   ...
   ```

6. Restart Synapse (`synctl restart`, for example)

# Running

Using the port specified during the install (`9000` by default), use `node index.js -p 9000 -c config/config.yaml` from the repository directory.

The bridge should start working shortly afterwards.

# Usage

To send messages to a phone number (`+1 555 123 4567` for example), open a conversation with `@_sms_15551234567:yourdomain.com` and start chatting! All messages sent to that room will be sent via text message to the phone number. If they reply, it'll show up in the room.