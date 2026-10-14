sap.ui.define([], function () {
  "use strict";

  function isFolderOrRoot(parentContext) {
    return !parentContext || parentContext.getProperty("kind") === "FOLDER";
  }

  /** Tree table hooks (manifest tableSettings). Nodes can only be placed in folders or on root level. */
  return {
    /** creationMode.isCreateEnabled: (nodeType, parentContext) */
    isCreateEnabled: function (nodeType, parentContext) {
      return isFolderOrRoot(parentContext);
    },

    /** isMoveToPositionAllowed: (sourceContext, targetParentContext) */
    isMoveToPositionAllowed: function (sourceContext, parentContext) {
      return isFolderOrRoot(parentContext);
    }
  };
});
