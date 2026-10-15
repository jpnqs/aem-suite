sap.ui.define(
  ["sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "sap/ui/model/Sorter"],
  function (Controller, JSONModel, Sorter) {
    "use strict";

    /** Plain text for case-insensitive searching. */
    function lower(text) {
      return String(text || "").toLowerCase();
    }

    return Controller.extend("com.aem.suite.help.controller.Main", {
      onInit: function () {
        this._doc = new JSONModel({
          ready: false,
          error: "",
          query: "",
          matches: "",
          sections: [],
          nav: [],
          selectedKey: "",
          current: null,
          prev: null,
          next: null
        });
        this.getView().setModel(this._doc, "doc");
        this._anchor = null; // heading to scroll to after the section is shown
        this._requestedId = undefined;
        var router = this.getOwnerComponent().getRouter();
        router.getRoute("page").attachPatternMatched(function (event) {
          this._requestedId = event.getParameter("arguments").id;
          if (this._doc.getProperty("/ready")) {
            this._show(this._requestedId);
          }
        }, this);
        // start only now, so the address the app was opened with (a deep link) reaches the handler above
        router.initialize();
        this._load();
      },

      // ------------------------------------------------------------------ data

      /** Reads all sections of the guide (rendered on the server from docs/user-guide.md). */
      _load: function () {
        var model = this.getOwnerComponent().getModel();
        model
          .bindList("/Sections", undefined, [new Sorter("number")])
          .requestContexts(0, 200)
          .then(
            function (contexts) {
              var sections = contexts.map(function (c) {
                var s = c.getObject();
                var headings = [];
                try {
                  headings = JSON.parse(s.headings || "[]");
                } catch {
                  headings = [];
                }
                return {
                  id: s.id,
                  number: s.number,
                  title: s.title,
                  // one root element: the HTML control only knows its first element, links / search / scrolling need all of it
                  html: '<div class="aemDocBody">' + s.html + "</div>",
                  headings: headings,
                  search: lower(s.title + "\n" + s.text)
                };
              });
              this._doc.setProperty("/sections", sections);
              this._doc.setProperty("/ready", true);
              this._buildNav();
              this._show(this._requestedId);
            }.bind(this)
          )
          .catch(
            function (e) {
              this._doc.setProperty("/ready", true);
              this._doc.setProperty("/error", "The help could not be loaded: " + ((e && e.message) || e));
            }.bind(this)
          );
      },

      /** Sections that match the search (all without a search), with their sub headings. */
      _visibleSections: function () {
        var query = lower(this._doc.getProperty("/query")).trim();
        var sections = this._doc.getProperty("/sections");
        return query
          ? sections.filter(function (s) {
              return s.search.indexOf(query) >= 0;
            })
          : sections;
      },

      _buildNav: function () {
        var currentId = this._doc.getProperty("/current/id");
        var visible = this._visibleSections();
        this._doc.setProperty(
          "/nav",
          visible.map(function (s) {
            return {
              key: s.id,
              title: s.title,
              expanded: s.id === currentId,
              items: s.headings
                .filter(function (h) {
                  return h.level === 3;
                })
                .map(function (h) {
                  return { key: h.id, title: h.title };
                })
            };
          })
        );
        var query = (this._doc.getProperty("/query") || "").trim();
        var total = this._doc.getProperty("/sections").length;
        this._doc.setProperty(
          "/matches",
          query
            ? visible.length
              ? visible.length + " of " + total + " sections mention \"" + query + "\""
              : "Nothing found for \"" + query + "\""
            : ""
        );
      },

      // ------------------------------------------------------------------ showing a section

      /**
       * Shows the section with this id, or the section a sub heading with this id belongs to (and scrolls to the
       * heading). Unknown or empty: the first section.
       */
      _show: function (id) {
        var sections = this._doc.getProperty("/sections");
        if (!sections.length) {
          return;
        }
        var section;
        var anchor = null;
        if (id) {
          section = sections.filter(function (s) {
            return s.id === id;
          })[0];
          if (!section) {
            section = sections.filter(function (s) {
              return s.headings.some(function (h) {
                return h.id === id;
              });
            })[0];
            anchor = section ? id : null;
          }
        }
        section = section || sections[0];

        this._anchor = anchor;
        this._doc.setProperty("/current", section);
        this._doc.setProperty("/selectedKey", anchor || section.id);
        this._buildNav();

        var visible = this._visibleSections();
        var index = visible.findIndex(function (s) {
          return s.id === section.id;
        });
        this._doc.setProperty("/prev", index > 0 ? visible[index - 1] : null);
        this._doc.setProperty("/next", index >= 0 && index < visible.length - 1 ? visible[index + 1] : null);
        // The HTML control swaps its content in place (no "after rendering" event), so finish explicitly once the
        // new text is in the page: links, search marks, scrolling.
        setTimeout(this._afterShow.bind(this), 0);
      },

      _go: function (id) {
        this.getOwnerComponent().getRouter().navTo("page", { id: id });
      },

      // ------------------------------------------------------------------ events

      onNavSelect: function (event) {
        this._go(event.getParameter("item").getKey());
      },

      onSearch: function (event) {
        var text = event && event.getParameter && (event.getParameter("newValue") !== undefined ? event.getParameter("newValue") : event.getParameter("query"));
        if (text !== undefined) {
          this._doc.setProperty("/query", text);
        }
        this._buildNav();
        // the current section stays; previous / next follow the matches
        this._show(this._doc.getProperty("/current/id"));
      },

      onPrev: function () {
        this._go(this._doc.getProperty("/prev/id"));
      },

      onNext: function () {
        this._go(this._doc.getProperty("/next/id"));
      },

      /** The control drew its content (first time, or again after the page was invalidated). */
      onArticleRendered: function () {
        this._afterShow();
      },

      /** The section is in the page: make links work, mark search hits, scroll. */
      _afterShow: function () {
        var dom = this.byId("article").getDomRef();
        if (!dom) {
          return;
        }
        if (!dom.__aemBound) {
          dom.__aemBound = true;
          // links inside the text that point to a heading of the guide stay inside the app
          dom.addEventListener(
            "click",
            function (event) {
              var link = event.target.closest && event.target.closest("a");
              var href = link && link.getAttribute("href");
              if (href && href.charAt(0) === "#" && href.length > 1) {
                event.preventDefault();
                this._go(decodeURIComponent(href.slice(1)));
              }
            }.bind(this)
          );
        }
        this._highlight(dom, (this._doc.getProperty("/query") || "").trim());
        this._scroll();
        clearInterval(this._scrollTimer);
        if (!this._anchor) {
          return;
        }
        // The page is still settling right after rendering (the layout and the navigation change, which can move the
        // scroll position back to the top): for a heading, scroll again for a moment - until the person scrolls.
        var tries = 0;
        var stop = function () {
          clearInterval(this._scrollTimer);
          scroller.removeEventListener("wheel", stop);
          scroller.removeEventListener("touchmove", stop);
          scroller.removeEventListener("keydown", stop);
        }.bind(this);
        var scroller = this.byId("scroll").getDomRef();
        ["wheel", "touchmove", "keydown"].forEach(function (name) {
          scroller.addEventListener(name, stop, { passive: true });
        });
        this._scrollTimer = setInterval(
          function () {
            this._scroll();
            if (++tries >= 8) {
              stop();
            }
          }.bind(this),
          250
        );
      },

      /** To the heading that was asked for, or to the top of the section. */
      _scroll: function () {
        var scroller = this.byId("scroll").getDomRef();
        var dom = this.byId("article").getDomRef();
        if (!scroller || !dom) {
          return;
        }
        var target = this._anchor && dom.querySelector('[id="' + this._anchor.replace(/"/g, "") + '"]');
        // computed against the content container, so nothing outside of it scrolls
        scroller.scrollTop = target ? target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16 : 0;
      },

      /** Marks the search words in the text (not inside code blocks, so copied commands stay intact). */
      _highlight: function (root, query) {
        root.querySelectorAll("mark.aemHit").forEach(function (m) {
          m.replaceWith(document.createTextNode(m.textContent));
        });
        root.normalize();
        if (!query) {
          return;
        }
        var needle = query.toLowerCase();
        var walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT, {
          acceptNode: function (node) {
            return node.parentElement.closest("pre") || node.nodeValue.toLowerCase().indexOf(needle) < 0
              ? window.NodeFilter.FILTER_REJECT
              : window.NodeFilter.FILTER_ACCEPT;
          }
        });
        var nodes = [];
        while (walker.nextNode()) {
          nodes.push(walker.currentNode);
        }
        nodes.forEach(function (node) {
          var text = node.nodeValue;
          var fragment = document.createDocumentFragment();
          var from = 0;
          var at;
          while ((at = text.toLowerCase().indexOf(needle, from)) >= 0) {
            fragment.appendChild(document.createTextNode(text.slice(from, at)));
            var mark = document.createElement("mark");
            mark.className = "aemHit";
            mark.textContent = text.slice(at, at + needle.length);
            fragment.appendChild(mark);
            from = at + needle.length;
          }
          fragment.appendChild(document.createTextNode(text.slice(from)));
          node.replaceWith(fragment);
        });
      }
    });
  }
);
