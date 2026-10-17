// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
import type Context from "sap/ui/model/odata/v4/Context";

declare const Help: {
  SECTIONS: Record<string, string>;
  /** "Help" button: the section that explains this app */
  open(): void;
  /** Test cases list report: how to organize and run test cases */
  openForList(): void;
  /** Test cases object page: the folder or the test case section */
  openForObjectPage(context?: Context): void;
  /** Run dialog */
  openForRun(): void;
};
export default Help;
