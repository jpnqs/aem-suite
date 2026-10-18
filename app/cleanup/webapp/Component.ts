import UIComponent from "sap/ui/core/UIComponent";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Control from "sap/ui/core/Control";

/**
 * @namespace com.aem.suite.cleanup
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
    // use the whole width in the launchpad (without it the shell limits the app to a centered column)
    config: { fullWidth: true }
  };

  /**
   * The view only after the service answered: without the Admin role its metadata is forbidden, and the app fails
   * to open - like the other admin apps (Fiori elements) - instead of showing an empty page.
   */
  public createContent(): Control | Promise<Control | null> | null {
    const model = this.getModel() as ODataModel;
    return model
      .getMetaModel()
      .requestObject("/")
      // later than createContent: the view still needs this component as its owner
      .then(() => this.runAsOwner(() => super.createContent()) as Control | Promise<Control | null> | null);
  }
}
