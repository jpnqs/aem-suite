import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type Context from "sap/ui/model/odata/v4/Context";

declare const Actions: {
  errorText(e: unknown): string;
  showError(e: unknown): void;
  /** Blocks the page with the busy indicator while the work runs (no second click); resolves / rejects with the work. */
  busy<T>(work: Promise<T>): Promise<T>;
  /** Calls an OData action and resolves with its result; the binding (incl. passwords) is destroyed afterwards. */
  invokeAction<T = Record<string, unknown>>(model: ODataModel, path: string, params?: Record<string, unknown>, context?: Context): Promise<T>;
};
export default Actions;
