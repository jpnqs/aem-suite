import ResourceBundle from "sap/base/i18n/ResourceBundle";
import ResourceModel from "sap/ui/model/resource/ResourceModel";

/** Looks up a text of the app's bundle (i18n/i18n.properties); args fill {0}, {1} ... */
export type Texts = (key: string, args?: unknown[]) => string;

/**
 * The texts of the app, from anything that carries its models: the Fiori elements ExtensionAPI, a control.
 * The i18n model of the manifest loads synchronously, so its bundle is there.
 */
export function textsOf(holder: { getModel(name: string): unknown }): Texts {
  const bundle = (holder.getModel("i18n") as ResourceModel).getResourceBundle() as ResourceBundle;
  return (key, args) => bundle.getText(key, args as string[] | undefined) ?? key;
}
