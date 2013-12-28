module.exports = function (classes) {
    'use strict';

    var
        q = classes.q,
        _ = classes.lodash,
        uuid = classes.uuid;

    var Client = classes.Base.define('Client', function StratumClient() {
        return {
            construct: function (socket, isServer) {
                var self = this;

                this.$super();

                // although BFGMiner starts at id 0, we start at 1, because it makes sense
                this.currentId = 1;
                // our TCP_NODELAY and KeepAlive'd socket
                this.socket = Client.socket(socket);
                this.authorized = false;
                this.subscription = '';
                // Uniquely identify this socket, regardless of clusters or inter-processes,
                // it's unique.
                this.id = uuid.v4();
                this.lastCommand = {};

                // Last activity is now!
                this.setLastActivity();

                this.socket.on('end', function () {
                    self.emit('end', self);
                });

                this.socket.on('error', function () {
                    self.emit('error', self);
                });

                this.socket.on('drain', function () {
                    self.emit('drain', self);
                });

                if (isServer !== true) {
                    this.socket.on('data', this.handleData.bind(this, this));
                }
            },
            /**
             * Set the last received command from the server
             *
             * @param command
             */
            setLastCommand: function (command) {
                this.lastCommand = command;
            },
            /**
             * Keep track of idle sockets, update the last activity
             *
             * @param {Number} [time] Unix Timestamp
             */
            setLastActivity: function (time) {
                this.lastActivity = _.isNumber(time) ? time : Date.now();
            },
            /**
             * Get the current socket IP address
             *
             * @returns {{port: Number, address: String, family: String}}
             */
            address: function () {
                return this.socket.address();
            },
            /**
             * This method is exposed just for testing purposes
             *
             * @param {Socket} socket
             * @param {Buffer} buffer
             * @private
             */
            handleData: function (socket, buffer) {
                var
                    c = classes.Server.getStratumCommands(buffer),
                    string = c.string,
                    cmds = c.cmds;

                classes.Server.processCommands.call(this, this, cmds);
            },
            /**
             * Close the socket
             *
             * @param {String} [exception] Any exception
             */
            close: function (exception) {
                return this.socket.destroy(exception);
            },
            /**
             * Connect to somewhere
             *
             * @param {Object} opts Where to connect
             * @returns {Q.promise}
             */
            connect: function (opts) {
                var d = q.defer(), self = this;

                this.socket.connect(opts, function () {
                    d.resolve(self);
                });

                return d.promise;
            },
            /**
             * Don't use this functions directly, they are called from the server side,
             * it's not a client side command, but an answer
             *
             * @return {Q.promise}
             * @private
             */
            set_difficulty: function (args) {
                return classes.Server.commands.set_difficulty.apply(this, [null].concat(args));
            },
            /**
             * Don't use this functions directly, they are called from the server side
             * it's not a client side command, but an answer
             *
             * @return {Q.promise}
             * @private
             */
            notify: function (args) {
                return classes.Server.commands.notify.apply(this, [null].concat(args));
            },
            /**
             * Send HTTP header
             *
             * @param {String} hostname
             * @param {Number} port
             *
             * @return {Q.promise}
             */
            stratumHttpHeader: function (hostname, port) {
                var
                    result = '{"error": null, "result": false, "id": 0}',
                    d = q.defer(),
                    header = [
                        'HTTP/1.1 200 OK',
                        'X-Stratum: stratum+tcp://' + hostname + ':' + port,
                        'Connection: Close',
                        'Content-Length: ' + (result.length + 1),
                        '',
                        '',
                        result
                    ];

                Client.debug('Sending Stratum HTTP header');

                this.socket.write(header.join('\n'), d.resolve);

                return d.promise;
            },
            /**
             * Subscribe to the pool
             *
             * @param {String} [UA] Send the User-Agent
             * @returns {Q.promise}
             */
            stratumSubscribe: function (UA) {
                return this.stratumSend({
                    'method': 'mining.subscribe',
                    'id': this.currentId,
                    'params': typeof UA !== 'undefined' ? [UA] : []
                }, true);
            },
            /**
             * Asks for authorization
             *
             * @param {String} user
             * @param {String} pass
             * @returns {Q.promise}
             */
            stratumAuthorize: function (user, pass) {
                return this.stratumSend({
                    'method': 'mining.authorize',
                    'id': this.currentId,
                    'params': [user, pass]
                }, true);
            },
            /**
             * Sends a share
             *
             * @param {String} worker
             * @param {String} job_id
             * @param {String} extranonce2
             * @param {String} ntime
             * @param {String} nonce
             * @returns {Q.promise}
             */
            stratumSubmit: function (worker, job_id, extranonce2, ntime, nonce) {
                this.setLastActivity();

                return this.stratumSend({
                    'method': 'mining.submit',
                    'id': this.currentId,
                    'params': [worker, job_id, extranonce2, ntime, nonce]
                });
            },
            /**
             * Send Stratum command
             *
             * @param {Object} data
             * @param {Boolean} bypass Bypass unauthorized
             * @returns {Q.promise}
             */
            stratumSend: function (data, bypass) {
                if (this.authorized === true || bypass === true) {
                    return this.send(JSON.stringify(data) + '\n');
                } else {
                    var error = Client.debug(classes.server.errors.UNAUTHORIZED_WORKER);

                    this.emit('mining.error', error);

                    return classes.Server.rejected(error);
                }
            },
            /**
             * Send raw data to the server
             *
             * @param {*} data
             * @returns {Q.promise}
             */
            send: function (data) {
                Client.debug('(' + this.id + ') Sent command ' + (data));

                var d = q.defer(), self = this;

                self.socket.write(data, function (err) {
                    if (err) {
                        d.reject(self, err);
                    } else {
                        d.resolve(self);
                    }
                });

                return d.promise;
            }
        };
    }, {
        socket: function (socket) {
            if (!socket) {
                socket = classes.net.Socket();
            }
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 120);
            return socket;
        }
    });

    return Client;
};