var Bridge = require("matrix-appservice-bridge").Bridge;
var LogService = require("./LogService");
var AdminRoom = require("./matrix/AdminRoom");
var SmsStore = require("./storage/SmsStore");
var Promise = require('bluebird');
var _ = require('lodash');
var util = require("./utils");

class SmsBridge {
    constructor(config, registration) {
        LogService.info("SmsBridge", "Constructing bridge");

        this._config = config;
        this._registration = registration;
        this._adminRooms = {}; // { roomId: AdminRoom }

        this._bridge = new Bridge({
            registration: this._registration,
            homeserverUrl: this._config.homeserver.url,
            domain: this._config.homeserver.domain,
            controller: {
                onEvent: this._onEvent.bind(this),
                // none of these are used because the bridge doesn't allow users to create rooms or users
                // onAliasQuery: this._onAliasQuery.bind(this),
                // onAliasQueried: this._onAliasQueried.bind(this),
                // onUserQuery: this._onUserQuery.bind(this), // TODO: This
                onLog: (line, isError) => {
                    var method = isError ? LogService.error : LogService.verbose;
                    method("matrix-appservice-bridge", line);
                }
            },
            suppressEcho: false,
            queue: {
                type: "none",
                perRequest: false
            },
            intentOptions: {
                clients: {
                    dontCheckPowerLevel: true
                },
                bot: {
                    dontCheckPowerLevel: true
                }
            }
        });
    }

    run(port) {
        LogService.info("SmsBridge", "Starting bridge");
        return this._bridge.run(port, this._config)
            .then(() => this._updateBotProfile())
            .then(() => this._bridgeKnownRooms())
            .catch(error => LogService.error("SmsBridge", error));
    }

    /**
     * Gets the bridge bot powering the bridge
     * @return {AppServiceBot} the bridge bot
     */
    getBot() {
        return this._bridge.getBot();
    }

    /**
     * Gets the bridge bot as an intent
     * @return {Intent} the bridge bot
     */
    getBotIntent() {
        return this._bridge.getIntent(this._bridge.getBot().getUserId());
    }

    /**
     * Gets the intent for a sms virtual user
     * @param {string} phoneNumber the phone number (without leading +)
     * @return {Intent} the virtual user intent
     */
    getSmsIntent(phoneNumber) {
        return this._bridge.getIntentFromLocalpart("_sms_" + phoneNumber);
    }

    /**
     * Determines if the given user ID is a bridged user
     * @param {string} handle the matrix user ID to check
     * @returns {boolean} true if the user ID is a bridged user, false otherwise
     */
    isBridgeUser(handle) {
        return this.getBot().getUserId() == handle || (handle.startsWith("@_sms_") && handle.endsWith(":" + this._config.homeserver.domain));
    }

    getOrCreateAdminRoom(userId) {
        var roomIds = _.keys(this._adminRooms);
        for (var roomId of roomIds) {
            if (!this._adminRooms[roomId]) continue;
            if (this._adminRooms[roomId].owner === userId)
                return Promise.resolve(this._adminRooms[roomId]);
        }

        return this.getBotIntent().createRoom({
            createAsClient: false, // use bot
            options: {
                invite: [userId],
                is_direct: true,
                preset: "trusted_private_chat",
                visibility: "private",
                initial_state: [{content: {guest_access: "can_join"}, type: "m.room.guest_access", state_key: ""}]
            }
        }).then(room => {
            var newRoomId = room.room_id;
            return this._processRoom(newRoomId, /*adminRoomOwner=*/userId).then(() => {
                var room = this._adminRooms[newRoomId];
                if (!room) throw new Error("Could not create admin room for " + userId);
                return room;
            });
        });
    }

    /**
     * Updates the bridge bot's appearance in matrix
     * @private
     */
    _updateBotProfile() {
        LogService.info("SmsBridge", "Updating appearance of bridge bot");

        var desiredDisplayName = this._config.smsBot.appearance.displayName || "SMS Bridge";
        var desiredAvatarUrl = this._config.smsBot.appearance.avatarUrl || "https://t2bot.io/_matrix/media/v1/download/t2l.io/SOZlqpJCUoecxNFZGGnDEhEy"; // sms icon

        var botIntent = this.getBotIntent();

        SmsStore.getAccountData('bridge').then(botProfile => {
            var avatarUrl = botProfile.avatarUrl;
            if (!avatarUrl || avatarUrl !== desiredAvatarUrl) {
                util.uploadContentFromUrl(this._bridge, desiredAvatarUrl, botIntent).then(mxcUrl => {
                    LogService.verbose("SmsBridge", "Avatar MXC URL = " + mxcUrl);
                    LogService.info("SmsBridge", "Updating avatar for bridge bot");
                    botIntent.setAvatarUrl(mxcUrl);
                    botProfile.avatarUrl = desiredAvatarUrl;
                    SmsStore.setAccountData('bridge', botProfile);
                });
            }
            botIntent.getProfileInfo(this._bridge.getBot().getUserId(), 'displayname').then(profile => {
                if (profile.displayname != desiredDisplayName) {
                    LogService.info("SmsBridge", "Updating display name from '" + profile.displayname + "' to '" + desiredDisplayName + "'");
                    botIntent.setDisplayName(desiredDisplayName);
                }
            });
        });
    }

    /**
     * Updates the bridge information on all rooms the bridge bot participates in
     * @private
     */
    _bridgeKnownRooms() {
        this._bridge.getBot().getJoinedRooms().then(rooms => {
            for (var roomId of rooms) {
                this._processRoom(roomId);
            }
        });
    }

    /**
     * Attempts to determine if a room is a bridged room or an admin room, based on the membership and other
     * room information. This will categorize the room accordingly and prepare it for it's purpose.
     * @param {string} roomId the matrix room ID to process
     * @param {String} [adminRoomOwner] the owner of the admin room. If provided, the room will be forced as an admin room
     * @param {boolean} [newRoom] if true, this indicates to the parser that the room is new and not part of a startup routine.
     * @return {Promise<>} resolves when processing is complete
     * @private
     */
    _processRoom(roomId, adminRoomOwner = null, newRoom=false) {
        LogService.info("SmsBridge", "Request to bridge room " + roomId);
        return this._bridge.getBot().getJoinedMembers(roomId).then(members => {
            var roomMemberIds = _.keys(members);
            var botIdx = roomMemberIds.indexOf(this._bridge.getBot().getUserId());

            if (roomMemberIds.length == 2 || adminRoomOwner) {
                var otherUserId = roomMemberIds[botIdx == 0 ? 1 : 0];
                this._adminRooms[roomId] = new AdminRoom(roomId, this, otherUserId || adminRoomOwner);
                LogService.verbose("SmsBridge", "Added admin room for user " + (otherUserId || adminRoomOwner));

                if (newRoom) {
                    this.getBotIntent().sendText(roomId, "Hello! This room can be used to manage various aspects of the bridge. Although this currently doesn't do anything, it will be more active in the future.");
                }
            } // else it is just a regular room

            // TODO: If @_sms_* is in a room but no bridge bot, then invite the bot & complain if we can't do the invite.
        });
    }

    /**
     * Tries to find an appropriate admin room to send the given event to. If an admin room cannot be found,
     * this will do nothing.
     * @param {MatrixEvent} event the matrix event to send to any reasonable admin room
     * @private
     */
    _tryProcessAdminEvent(event) {
        var roomId = event.room_id;

        if (this._adminRooms[roomId]) this._adminRooms[roomId].handleEvent(event);
    }

    /**
     * Bridge handler for generic events
     * @private
     */
    _onEvent(request, context) {
        var event = request.getData();

        this._tryProcessAdminEvent(event);

        if (event.type === "m.room.member" && event.content.membership === "invite" && this.isBridgeUser(event.state_key)) {
            LogService.info("SmsBridge", event.state_key + " received invite to room " + event.room_id);
            return this._bridge.getIntent(event.state_key).join(event.room_id).then(() => this._processRoom(event.room_id, /*owner:*/null, /*newRoom:*/true));
        } else if (event.type === "m.room.message" && event.sender !== this.getBot().getUserId()) {
            return this._processMessage(event);
        }

        // Default
        return Promise.resolve();
    }

    _processMessage(event) {
        // TODO: Do something
    }
}

module.exports = SmsBridge;