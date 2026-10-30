sap.ui.define(["module", "./Apps"], function (module, Apps) {
  "use strict";

  // namespace of the app this module is loaded for, e.g. "com/aem/suite/brokers" (see scripts/ui5/shared-ui.js)
  var APP_NAMESPACE = module.id.replace(/\/shared\/[^/]+$/, "");

  /** "#AEMSuiteTestCases-manage&/TestCases(...)" -> intent and route; undefined for other links */
  var INTENT_LINK = /^#(AEMSuite\w+-\w+)(?:&\/(.*))?$/;

  function inLaunchpad() {
    return !!(window.sap && window.sap.ushell && window.sap.ushell.Container);
  }

  /**
   * URL of another app of the suite when this app runs on its own (outside the launchpad).
   * The apps are siblings: locally and in the HTML5 repo at /comaemsuite<app>/, in Work Zone with a prefix
   * ("<service>.comaemsuite<app>-<version>"). The last path segment of this app's root names this app, so
   * swapping the app name there gives the other app in every one of these setups.
   */
  function standaloneUrl(app, hashPath) {
    var root = new URL(sap.ui.require.toUrl(APP_NAMESPACE + "/manifest.json"), window.location.href);
    var segments = root.pathname.replace(/\/manifest\.json$/, "").split("/");
    segments[segments.length - 1] = segments[segments.length - 1].replace(/comaemsuite[a-z]+/, "comaemsuite" + app);
    return root.origin + segments.join("/") + "/index.html#/" + hashPath;
  }

  /** The launchpad target of an app: semantic object, action and the route inside the app. */
  function shellTarget(target) {
    var intent = Apps.get(target.app).intent.split("-");
    return { target: { semanticObject: intent[0], action: intent[1] }, appSpecificRoute: "&/" + (target.path || "") };
  }

  /**
   * The address of the launchpad page that shows this app. In the suite's own launchpad that is this page. In SAP
   * Build Work Zone the app runs in an iframe: this page is the app, the site is the window around it - a hash of
   * the shell only means something there. Readable when the site and the app share the origin (Work Zone serves
   * both from the site's host); otherwise the frame's referrer is the site page.
   */
  function launchpadPage() {
    if (window.top && window.top !== window) {
      try {
        return window.top.location.href.split("#")[0];
      } catch (e) {
        if (document.referrer) {
          return document.referrer.split("#")[0];
        }
      }
    }
    return window.location.href.split("#")[0];
  }

  /** The address the launchpad of this page has for a hash ("#AEMSuite...") */
  function pageUrl(href) {
    return href.charAt(0) === "#" ? launchpadPage() + href : href;
  }

  /**
   * In a launchpad (the suite's own or SAP Build Work Zone) the shell's Navigation service finds the target app and
   * builds its address - setting the hash by hand works in the sandbox launchpad, but a Work Zone site cannot
   * resolve such a hash and shows its home page instead. The hash stays the fallback.
   */
  function inShell(target) {
    var hash = "#" + Apps.get(target.app).intent + "&/" + (target.path || "");
    // a new tab is opened right away, in the click: a window opened after waiting for the service is blocked
    var tab = target.newTab ? window.open("", "_blank") : null;
    if (tab) {
      tab.opener = null;
    }
    var fallback = function () {
      if (tab) {
        tab.location.href = pageUrl(hash);
      } else {
        window.location.hash = hash;
      }
    };
    window.sap.ushell.Container.getServiceAsync("Navigation")
      .then(function (navigation) {
        if (!tab) {
          return navigation.navigate(shellTarget(target));
        }
        return navigation.getHref(shellTarget(target)).then(function (href) {
          tab.location.href = pageUrl(href || hash);
        });
      })
      .catch(fallback);
  }

  var linksHandled = false;

  return {
    inLaunchpad: inLaunchpad,

    /**
     * Shows another app of the suite.
     * @param {object} target
     * @param {string} target.app app key (Apps.js), e.g. "runs" (the HTML5 app is "comaemsuiteruns")
     * @param {string} target.path route inside the app, e.g. "TestRuns(<id>)"
     * @param {boolean} [target.newTab] open in a new tab, so nothing being edited here is lost
     */
    toApp: function (target) {
      if (inLaunchpad()) {
        inShell(target);
        return;
      }
      window.open(standaloneUrl(target.app, target.path), "_blank", "noopener");
    },

    /**
     * Links in tables that point to another app of the suite ("#AEMSuiteTestCases-manage&/TestCases(...)", e.g. the
     * test case of a result) are followed through the launchpad's Navigation service as well (see toApp). Call once,
     * in the Component of an app that shows such links. Ctrl / middle clicks keep the browser's own behaviour.
     */
    handleAppLinks: function () {
      if (linksHandled) {
        return;
      }
      linksHandled = true;
      var that = this;
      document.addEventListener(
        "click",
        function (event) {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
          }
          var link = event.target && event.target.closest && event.target.closest("a[href^='#AEMSuite']");
          var match = link && INTENT_LINK.exec(link.getAttribute("href"));
          var app = match && Apps.byIntent(match[1]);
          if (!app) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          that.toApp({ app: app, path: match[2] || "" });
        },
        true
      );
    }
  };
});
