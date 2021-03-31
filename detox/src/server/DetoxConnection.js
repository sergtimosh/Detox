const _ = require('lodash');
const { WebSocket } = require('ws');
const DetoxRuntimeError = require('../errors/DetoxRuntimeError');
const DetoxInvariantError = require('../errors/DetoxInvariantError');
const AnonymousConnectionHandler = require('./handlers/AnonymousConnectionHandler');
const logger = require('../utils/logger').child({ __filename });

const EVENTS = {
  GET: { event: 'GET_FROM' },
  SEND: { event: 'SEND_TO' },
  ERROR: { event: 'ERROR' },
  SOCKET_ERROR: { event: 'SOCKET_ERROR' },
};

class DetoxConnection {
  /**
   * @param {DetoxSessionManager} sessionManager
   * @param {WebSocket} webSocket
   * @param {Socket} socket
   */
  constructor({ sessionManager, webSocket, socket }) {
    this._onMessage = this._onMessage.bind(this);
    this._onError = this._onError.bind(this);
    this._onClose = this._onClose.bind(this);

    this._log = logger.child({ trackingId: socket.remotePort });
    this._sessionManager = sessionManager;
    this._webSocket = webSocket;
    this._webSocket.on('message', this._onMessage);
    this._webSocket.on('error', this._onError);
    this._webSocket.on('close', this._onClose);

    const log = this._log;
    this._handler = new AnonymousConnectionHandler({
      api: {
        get log() { return log; },
        appendLogDetails: (details) => { this._log = this._log.child(details); },

        registerSession: (params) => this._sessionManager.registerSession(this, params),
        setHandler: (handler) => { this._handler = handler; },
        sendAction: (action) => this.sendAction(action),
      },
    });
  }

  sendAction(action) {
    const messageAsString = JSON.stringify(action);
    this._log.trace(EVENTS.SEND, messageAsString);
    this._webSocket.send(messageAsString + '\n ');
  }

  _onMessage(rawData) {
    const data = _.isString(rawData) ? rawData : rawData.toString('utf8');
    this._log.trace(EVENTS.GET, data);

    try {
      const action = _.attempt(() => JSON.parse(data));

      if (_.isError(action)) {
        throw new DetoxRuntimeError({
          message: 'The payload received is not a valid JSON.',
          hint: DetoxInvariantError.reportIssue,
          debugInfo: data,
        });
      }

      if (!action.type) {
        throw new DetoxRuntimeError({
          message: 'Cannot process an action without a type.',
          hint: DetoxInvariantError.reportIssue,
          debugInfo: action,
        });
      }

      try {
        this._handler.handle(action);
      } catch (handlerError) {
        this._handler.onError(handlerError, action);
      }
    } catch (error) {
      this._log.warn({ ...EVENTS.ERROR }, error instanceof DetoxRuntimeError ? error.message : `${error}`);
    }
  }

  _onError(e) {
    this._log.warn(EVENTS.SOCKET_ERROR, DetoxRuntimeError.format(e));
  }

  _onClose() {
    this._sessionManager.unregisterConnection(this._webSocket);
  }
}

module.exports = DetoxConnection;