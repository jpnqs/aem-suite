import type { AppKey } from "./Apps";

export interface AppTarget {
  /** app key (Apps.js), e.g. "runs" (the HTML5 app is "comaemsuiteruns") */
  app: AppKey;
  /** route inside the app, e.g. "TestRuns(<id>)" */
  path: string;
  /** open in a new tab, so nothing being edited here is lost */
  newTab?: boolean;
}

declare const Navigation: {
  inLaunchpad(): boolean;
  toApp(target: AppTarget): void;
  handleAppLinks(): void;
};
export default Navigation;
