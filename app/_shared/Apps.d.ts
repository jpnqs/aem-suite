export type AppKey = "home" | "testcases" | "runs" | "subscriber" | "messages" | "brokers" | "variables" | "numberranges" | "cleanup" | "help";

export interface AppInfo {
  /** launchpad intent, e.g. "AEMSuiteTestRuns-display" */
  intent: string;
  icon: string;
  /** the role needed to open the app; null = everyone */
  role: "tester" | "admin" | null;
}

/** The apps of the suite - see Apps.js. */
declare const Apps: {
  APPS: Record<AppKey, AppInfo>;
  get(key: AppKey): AppInfo;
  byIntent(intent: string): AppKey | undefined;
};
export default Apps;
