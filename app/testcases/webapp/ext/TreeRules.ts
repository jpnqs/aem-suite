import Context from "sap/ui/model/odata/v4/Context";

function isFolderOrRoot(parentContext?: Context | null): boolean {
  return !parentContext || parentContext.getProperty("kind") === "FOLDER";
}

/** Tree table hooks (manifest tableSettings). Nodes can only be placed in folders or on root level. */
export default {
  /** creationMode.isCreateEnabled: (nodeType, parentContext) */
  isCreateEnabled(_nodeType: string, parentContext?: Context | null): boolean {
    return isFolderOrRoot(parentContext);
  },

  /** isMoveToPositionAllowed: (sourceContext, targetParentContext) */
  isMoveToPositionAllowed(_sourceContext: Context, parentContext?: Context | null): boolean {
    return isFolderOrRoot(parentContext);
  }
};
