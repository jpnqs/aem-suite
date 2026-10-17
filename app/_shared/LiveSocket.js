sap.ui.define(["module"], function (module) {
  "use strict";

  // namespace of the app this module is loaded for (see scripts/ui5/shared-ui.js)
  var APP_NAMESPACE = module.id.replace(/\/shared\/[^/]+$/, "");
  var MAX_BACKOFF_MS = 30000;

  /**
   * Client for the CAP websocket service LiveService (/ws/live) with automatic reconnect.
   * Only events of entered contexts (run id / subscription id) are delivered.
   * Connects on the first enter(), so a dialog that never runs anything opens no socket.
   *
   * @param {function(string, object)} onEvent called with event name and data
   * @param {function(boolean)} [onState] called with true when (re)connected, false when the connection dropped
   */
  function LiveSocket(onEvent, onState) {
    this._onEvent = onEvent;
    this._onState = onState || function () {};
    this._contexts = [];
    this._closed = false;
    this._retry = 0;
    this._open = null;
  }

  LiveSocket.prototype._connect = function () {
    var that = this;
    // relative to the app (HTML5 repo / Work Zone serve it below a prefix; its xs-app.json routes ws/ to the backend)
    var url = new URL(sap.ui.require.toUrl(APP_NAMESPACE + "/ws/live"), window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // resolves when open - or when the attempt failed, so callers never wait forever (onState tells what happened)
    return new Promise(function (resolve) {
      var ws = new WebSocket(url);
      that._ws = ws;
      ws.addEventListener("open", function () {
        that._retry = 0;
        that._contexts.forEach(function (c) {
          that._send("wsContext", { context: c });
        });
        that._onState(true);
        resolve();
      });
      ws.addEventListener("message", function (msg) {
        var payload;
        try {
          payload = JSON.parse(msg.data);
        } catch (e) {
          return; // ignore malformed frames
        }
        that._onEvent(payload.event, payload.data);
      });
      ws.addEventListener("close", function () {
        resolve();
        if (that._closed) {
          return;
        }
        that._onState(false);
        var delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, that._retry++));
        setTimeout(function () {
          if (!that._closed) {
            that._open = that._connect();
          }
        }, delay);
      });
    });
  };

  LiveSocket.prototype._send = function (event, data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ event: event, data: data }));
    }
  };

  /** Connects now instead of on the first enter() - for pages that show the connection state from the start. */
  LiveSocket.prototype.connect = function () {
    this._open = this._open || this._connect();
    return this._open;
  };

  /** Enters a context (connecting first if needed); re-entered automatically after a reconnect. */
  LiveSocket.prototype.enter = function (context) {
    var that = this;
    if (this._contexts.indexOf(context) < 0) {
      this._contexts.push(context);
    }
    return this.connect().then(function () {
      that._send("wsContext", { context: context });
    });
  };

  LiveSocket.prototype.exit = function (context) {
    this._contexts = this._contexts.filter(function (c) {
      return c !== context;
    });
    this._send("wsContext", { context: context, exit: true });
  };

  LiveSocket.prototype.close = function () {
    this._closed = true;
    if (this._ws) {
      this._ws.close();
    }
  };

  return LiveSocket;
});
