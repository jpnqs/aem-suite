sap.ui.define([], function () {
  "use strict";

  /**
   * Thin client for the CAP websocket service LiveService (/ws/live).
   * Events are only delivered for contexts the socket entered (run id / subscription id).
   */
  function LiveSocket(onEvent) {
    this._onEvent = onEvent;
    this._contexts = [];
    this._closed = false;
    this._ready = this._connect();
  }

  LiveSocket.prototype._connect = function () {
    var that = this;
    // relative to the app (HTML5 repo / Work Zone serve it below a prefix; its xs-app.json routes ws/ to the backend)
    var url = new URL(sap.ui.require.toUrl("com/aem/suite/testcases/ws/live"), window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket(url);
      that._ws = ws;
      ws.addEventListener("open", function () {
        that._contexts.forEach(function (c) {
          that._send("wsContext", { context: c });
        });
        resolve();
      });
      ws.addEventListener("error", function (e) {
        reject(e);
      });
      ws.addEventListener("message", function (msg) {
        try {
          var payload = JSON.parse(msg.data);
          that._onEvent(payload.event, payload.data);
        } catch (e) {
          /* ignore malformed frames */
        }
      });
    });
  };

  LiveSocket.prototype._send = function (event, data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ event: event, data: data }));
    }
  };

  /** Enters a context; resolves when the socket is open and the request was sent. */
  LiveSocket.prototype.enter = function (context) {
    var that = this;
    this._contexts.push(context);
    return this._ready.then(function () {
      that._send("wsContext", { context: context });
    });
  };

  LiveSocket.prototype.close = function () {
    this._closed = true;
    if (this._ws) {
      this._ws.close();
    }
  };

  return LiveSocket;
});
