sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/DateFormat",
    "com/aem/suite/home/shared/Navigation",
    "com/aem/suite/home/shared/Actions",
    "com/aem/suite/home/shared/Apps",
    "com/aem/suite/home/shared/Prefs"
  ],
  function (Controller, JSONModel, DateFormat, Navigation, Actions, Apps, Prefs) {
    "use strict";

    /** The app tiles of the page, in this order; intent, icon and role come from shared/Apps.js. */
    var APPS = [
      { key: "testcases", color: "Accent6" },
      { key: "runs", color: "Accent8" },
      { key: "subscriber", color: "Accent5" },
      { key: "messages", color: "Accent4" },
      { key: "brokers", color: "Accent1" },
      { key: "variables", color: "Accent3" },
      { key: "numberranges", color: "Accent2" },
      { key: "cleanup", color: "Accent7" },
      { key: "help", color: "Accent10" }
    ].map(function (a) {
      return Object.assign({}, Apps.get(a.key), a);
    });
    /** The groups of tiles: the apps for testers, then the apps for administrators (Apps.js: role of an app) */
    var GROUPS = [{ role: "tester" }, { role: "admin" }];
    var LAST_RUNS = 3;
    /** Prefs key (this browser): ids of the notices the user clicked OK on */
    var DISMISSED_KEY = "homeDismissedNotices";
    /** while a run is in progress, the page follows it */
    var REFRESH_WHILE_RUNNING_MS = 10000;

    var relative = DateFormat.getDateTimeInstance({ relative: true, relativeScale: "auto" });

    function appByKey(key) {
      return APPS.filter(function (a) {
        return a.key === key;
      })[0];
    }

    function open(key, path) {
      var app = appByKey(key);
      if (app) {
        Navigation.toApp({ app: app.key, path: path || "" });
      }
    }

    return Controller.extend("com.aem.suite.home.controller.Main", {
      onInit: function () {
        this._home = new JSONModel({ loaded: false, busy: true, tester: false, attention: [], apps: [], lastRuns: [] });
        this.getView().setModel(this._home, "home");
        this._load();
      },

      onExit: function () {
        clearTimeout(this._refreshTimer);
      },

      onRefresh: function () {
        this._load();
      },

      /** a tile or an attention item: the item names the app it opens */
      onOpenApp: function (event) {
        var item = event.getSource().getBindingContext("home").getObject();
        open(item.target || item.key);
      },

      /**
       * "OK" on a notice: it is not shown again - as long as it stays the same. A notice is named after what it is about
       * (e.g. "failedResults:5"): when the number or the broker changes, it is a new notice and shows up again.
       */
      onDismiss: function (event) {
        var id = event.getSource().getBindingContext("home").getProperty("id");
        var dismissed = Prefs.get(DISMISSED_KEY, []);
        if (dismissed.indexOf(id) < 0) {
          dismissed.push(id);
          Prefs.set(DISMISSED_KEY, dismissed);
        }
        this._show(this._overview);
      },

      /** "Show again": the dismissed notices come back. */
      onShowDismissed: function () {
        Prefs.set(DISMISSED_KEY, []);
        this._show(this._overview);
      },

      onOpenKey: function (event) {
        open(event.getSource().data("app"));
      },

      onOpenRun: function (event) {
        open("runs", "TestRuns(" + event.getSource().getBindingContext("home").getProperty("ID") + ")");
      },

      _text: function (key, args) {
        return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
      },

      _load: function () {
        var that = this;
        var home = this._home;
        clearTimeout(this._refreshTimer);
        home.setProperty("/busy", true);
        var binding = this.getOwnerComponent().getModel().bindContext("/overview()");
        return binding
          .requestObject()
          .then(function (o) {
            that._show(o || {});
            if (o && o.runningRuns) {
              that._refreshTimer = setTimeout(that._load.bind(that), REFRESH_WHILE_RUNNING_MS);
            }
          })
          .catch(function (e) {
            home.setProperty("/error", that._text("error.load", [Actions.errorText(e)]));
          })
          .finally(function () {
            binding.destroy();
            home.setProperty("/busy", false);
          });
      },

      _show: function (o) {
        var that = this;
        this._overview = o;
        var notices = this._attention(o);
        // dismissed notices that are gone (solved) are forgotten, so the list does not grow
        var dismissed = Prefs.get(DISMISSED_KEY, []).filter(function (id) {
          return notices.some(function (n) {
            return n.id === id;
          });
        });
        Prefs.set(DISMISSED_KEY, dismissed);
        var allowed = function (app) {
          return !app.role || (app.role === "tester" && o.tester) || (app.role === "admin" && o.admin);
        };
        var hour = new Date().getHours();
        this._home.setData({
          loaded: true,
          busy: false,
          error: null,
          tester: !!o.tester,
          greeting: this._text(hour < 12 ? "greeting.morning" : hour < 18 ? "greeting.afternoon" : "greeting.evening", [o.firstName || o.user || ""]),
          attention: notices.filter(function (n) {
            return dismissed.indexOf(n.id) < 0;
          }),
          dismissedCount: dismissed.length,
          dismissedText: dismissed.length === 1 ? this._text("attention.dismissed.one") : this._text("attention.dismissed.many", [dismissed.length]),
          groups: GROUPS.map(function (g) {
            return {
              key: g.role,
              title: that._text("apps.group." + g.role),
              description: that._text("apps.group." + g.role + ".description"),
              apps: APPS.filter(function (a) {
                return a.role === g.role && allowed(a);
              }).map(function (a) {
                return { key: a.key, title: that._text("app." + a.key + ".title"), line: that._line(a.key, o), icon: a.icon, color: a.color };
              })
            };
          }).filter(function (g) {
            return g.apps.length > 0;
          }),
          lastRuns: (o.lastRuns || []).slice(0, LAST_RUNS).map(function (r) {
            return {
              ID: r.ID,
              summary: r.summary,
              state: r.outcome === "PASSED" ? "Success" : r.outcome === "FAILED" ? "Error" : r.outcome === "STOPPED" ? "Warning" : "Information",
              icon:
                r.outcome === "PASSED"
                  ? "sap-icon://sys-enter-2"
                  : r.outcome === "FAILED"
                    ? "sap-icon://error"
                    : r.outcome === "STOPPED"
                      ? "sap-icon://stop"
                      : "sap-icon://pending",
              when: r.startedAt ? relative.format(new Date(r.startedAt)) : ""
            };
          })
        });
      },

      /** Only what needs to be done - empty when all is well. */
      _attention: function (o) {
        var t = this._text.bind(this);
        if (!o.tester) {
          return [{ id: "noRole", text: t("attention.noRole"), state: "Information", icon: "sap-icon://message-information" }];
        }
        var items = [];
        // id: what the notice is about, with the facts that make it a different notice when they change
        var error = function (id, text, action, target) {
          items.push({ id: id, text: text, state: "Error", icon: "sap-icon://error", action: action, target: target });
        };
        var info = function (id, text, action, target) {
          items.push({ id: id, text: text, state: "Information", icon: "sap-icon://message-information", action: action, target: target });
        };
        var brokersLink = o.admin ? "brokers" : null;
        if (o.resultsFailed) {
          error("failedResults:" + o.resultsFailed, t("attention.failedResults", [o.resultsFailed]), t("action.runs"), "runs");
        }
        var failing = o.failingBrokers || [];
        if (failing.length === 1) {
          error("failingBrokers:" + failing.join("|"), t("attention.failingBroker", [failing[0]]), t("action.brokers"), brokersLink);
        }
        if (failing.length > 1) {
          error("failingBrokers:" + failing.join("|"), t("attention.failingBrokers", [failing.join(", ")]), t("action.brokers"), brokersLink);
        }
        if (!o.brokers) {
          info("noBroker", t(o.admin ? "attention.noBroker.admin" : "attention.noBroker.tester"), t("action.brokers"), brokersLink);
        }
        if (!o.testCases) {
          info("noTestCases", t("attention.noTestCases"), t("action.testcases"), "testcases");
        }
        return items;
      },

      /** The one short line of an app tile. */
      _line: function (key, o) {
        var t = this._text.bind(this);
        switch (key) {
          case "testcases":
            return o.testCases ? t("line.testcases", [o.testCases]) : t("line.testcases.none");
          case "runs":
            return o.runsLast7Days ? t("line.runs", [o.runsLast7Days]) : t("line.runs.none");
          case "subscriber":
            return o.liveSubscriptions ? t("line.subscriber.running", [o.liveSubscriptions]) : t("line.subscriber.none");
          case "messages":
            return t("line.messages", [o.savedMessages || 0]);
          case "brokers":
            return o.brokers ? t("line.brokers", [o.brokers]) : t("line.brokers.none");
          case "variables":
            return t("line.variables");
          case "numberranges":
            return t("line.numberranges");
          case "cleanup":
            return t("line.cleanup");
          default:
            return t("line.help");
        }
      }
    });
  }
);
