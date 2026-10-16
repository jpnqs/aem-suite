sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/DateFormat",
    "com/aem/suite/home/shared/Navigation",
    "com/aem/suite/home/shared/Actions"
  ],
  function (Controller, JSONModel, DateFormat, Navigation, Actions) {
    "use strict";

    /**
     * The apps of the suite, in the order of the page. role: what the user needs to open the app (null = everyone).
     * Icons as on the launchpad tiles (app/launchpad/webapp/index.html).
     */
    var APPS = [
      { key: "testcases", intent: "AEMSuiteTestCases-manage", icon: "sap-icon://lab", color: "Accent6", role: "tester" },
      { key: "runs", intent: "AEMSuiteTestRuns-display", icon: "sap-icon://kpi-managing-my-area", color: "Accent8", role: "tester" },
      { key: "subscriber", intent: "AEMSuiteSubscriber-display", icon: "sap-icon://feeder-arrow", color: "Accent5", role: "tester" },
      { key: "messages", intent: "AEMSuiteSavedMessages-display", icon: "sap-icon://inbox", color: "Accent4", role: "tester" },
      { key: "brokers", intent: "AEMSuiteBrokers-manage", icon: "sap-icon://connected", color: "Accent1", role: "admin" },
      { key: "variables", intent: "AEMSuiteVariables-manage", icon: "sap-icon://key-user-settings", color: "Accent3", role: "admin" },
      { key: "numberranges", intent: "AEMSuiteNumberRanges-manage", icon: "sap-icon://numbered-text", color: "Accent2", role: "admin" },
      { key: "help", intent: "AEMSuiteHelp-display", icon: "sap-icon://sys-help", color: "Accent10", role: null }
    ];
    var LAST_RUNS = 3;
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
        Navigation.toApp({ app: app.key, intent: app.intent, path: path || "" });
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
        var allowed = function (app) {
          return !app.role || (app.role === "tester" && o.tester) || (app.role === "admin" && o.admin);
        };
        var hour = new Date().getHours();
        this._home.setData({
          loaded: true,
          busy: false,
          error: null,
          tester: !!o.tester,
          greeting: this._text(hour < 12 ? "greeting.morning" : hour < 18 ? "greeting.afternoon" : "greeting.evening", [o.user || ""]),
          attention: this._attention(o),
          apps: APPS.filter(allowed).map(function (a) {
            return { key: a.key, title: that._text("app." + a.key + ".title"), line: that._line(a.key, o), icon: a.icon, color: a.color };
          }),
          lastRuns: (o.lastRuns || []).slice(0, LAST_RUNS).map(function (r) {
            return {
              ID: r.ID,
              summary: r.summary,
              state: r.outcome === "PASSED" ? "Success" : r.outcome === "FAILED" ? "Error" : "Information",
              icon: r.outcome === "PASSED" ? "sap-icon://sys-enter-2" : r.outcome === "FAILED" ? "sap-icon://error" : "sap-icon://pending",
              when: r.startedAt ? relative.format(new Date(r.startedAt)) : ""
            };
          })
        });
      },

      /** Only what needs to be done - empty when all is well. */
      _attention: function (o) {
        var t = this._text.bind(this);
        if (!o.tester) return [{ text: t("attention.noRole"), state: "Information", icon: "sap-icon://message-information" }];
        var items = [];
        var error = function (text, action, target) {
          items.push({ text: text, state: "Error", icon: "sap-icon://error", action: action, target: target });
        };
        var info = function (text, action, target) {
          items.push({ text: text, state: "Information", icon: "sap-icon://message-information", action: action, target: target });
        };
        var brokersLink = o.admin ? "brokers" : null;
        if (o.resultsFailed) error(t("attention.failedResults", [o.resultsFailed]), t("action.runs"), "runs");
        var failing = o.failingBrokers || [];
        if (failing.length === 1) error(t("attention.failingBroker", [failing[0]]), t("action.brokers"), brokersLink);
        if (failing.length > 1) error(t("attention.failingBrokers", [failing.join(", ")]), t("action.brokers"), brokersLink);
        if (!o.brokers) info(t(o.admin ? "attention.noBroker.admin" : "attention.noBroker.tester"), t("action.brokers"), brokersLink);
        if (!o.testCases) info(t("attention.noTestCases"), t("action.testcases"), "testcases");
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
          default:
            return t("line.help");
        }
      }
    });
  }
);
