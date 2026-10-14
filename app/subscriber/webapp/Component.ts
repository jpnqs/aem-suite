import UIComponent from "sap/ui/core/UIComponent";

/**
 * @namespace aem.suite.subscriber
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"]
  };
}
