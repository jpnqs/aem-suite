// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
export interface AppTarget {
  /** app name, e.g. "runs" (the HTML5 app is "comaemsuiteruns") */
  app: string;
  /** launchpad intent, e.g. "AEMSuiteTestRuns-display" */
  intent: string;
  /** route inside the app, e.g. "TestRuns(<id>)" */
  path: string;
  /** open in a new tab, so nothing being edited here is lost */
  newTab?: boolean;
}

declare const Navigation: {
  inLaunchpad(): boolean;
  toApp(target: AppTarget): void;
};
export default Navigation;
