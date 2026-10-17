import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import Dialog from "sap/m/Dialog";
import List from "sap/m/List";
import Event from "sap/ui/base/Event";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Context from "sap/ui/model/odata/v4/Context";
import ExtensionAPI from "sap/fe/core/ExtensionAPI";
import Prefs from "com/aem/suite/testcases/shared/Prefs";
import Actions from "com/aem/suite/testcases/shared/Actions";
import Help from "com/aem/suite/testcases/shared/Help";
import LiveSocket from "com/aem/suite/testcases/shared/LiveSocket";
import Navigation from "com/aem/suite/testcases/shared/Navigation";
import { textsOf, Texts } from "./i18n";

/**
 * The Run dialog (RunDialog.fragment.xml): broker selection, credentials of direct brokers, the advanced
 * settings, then the run with its live progress (websocket, plus a poll in case progress is lost) and its
 * problems. Opened by the Run actions of TestCaseActions.ts.
 */

const { errorText } = Actions;

/** How often the run dialog reads the run while it waits (in case live progress is lost or the run aborts). */
const POLL_MS = 5000;
/** Problems shown in the run dialog - the rest are in the results app. */
const MAX_PROBLEMS = 50;

/** A row of the credentials list (one per selected DIRECT broker). */
interface CredentialRow {
  brokerId: string;
  name: string;
  username: string;
  needsUsername: boolean;
  enteredUsername: string;
  password: string;
  missing: boolean;
}

interface BrokerRow {
  ID: string;
  name: string;
  credentialMode: string;
  username?: string | null;
}

interface RunRow {
  status: string;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount?: number | null;
}

/** Navigates to the run in the runs app. */
function openRun(runId: string): void {
  Navigation.toApp({ app: "runs", path: "TestRuns(" + runId + ")" });
}

/** "45 s", "3 min 20 s", "1 h 5 min" */
function formatDuration(ms: number, t: Texts): string {
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return t("run.seconds", [Math.max(s, 1)]);
  }
  const m = Math.floor(s / 60);
  return m < 60 ? t("run.minutesSeconds", [m, s % 60]) : t("run.hoursMinutes", [Math.floor(m / 60), m % 60]);
}

/**
 * Opens the broker selection dialog and runs the given test cases.
 * `api` is the FE ExtensionAPI (this of a custom action handler).
 */
function openRunDialog(api: ExtensionAPI, testCaseIds: string[], label: string): Promise<void> {
  const model = api.getModel() as ODataModel;
  const t = textsOf(api);
  const state = new JSONModel({
    label: label,
    credentials: [] as CredentialRow[],
    problems: [] as object[],
    runId: null as string | null,
    starting: false,
    // advanced settings (remembered for the next run)
    repetitions: Prefs.get("runRepetitions", 1),
    delayMs: Prefs.get("runDelayMs", 0),
    order: Prefs.get("runOrder", "ROUND"),
    stopOnFailure: Prefs.get("runStopOnFailure", false),
    estimate: "",
    stopping: false,
    skipped: 0,
    total: 0,
    done: 0,
    passed: 0,
    failed: 0,
    /** failures beyond MAX_PROBLEMS (not listed in the dialog) */
    moreProblems: 0,
    finished: false,
    aborted: false,
    connectionLost: false
  });
  const socket = new LiveSocket(
    (event, data) => {
      if (event !== "runProgress" || data.runId !== state.getProperty("/runId")) {
        return;
      }
      state.setProperty("/total", data.total);
      state.setProperty("/done", data.done);
      state.setProperty("/passed", data.passed);
      state.setProperty("/failed", data.failed);
      state.setProperty("/skipped", data.skipped || 0);
      if (data.status !== "RUNNING") {
        finish(String(data.runId));
      }
    },
    (connected) => state.setProperty("/connectionLost", !connected)
  );
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let dialog: Dialog;
  let preselected = false;
  /** the broker list of the dialog - taken from its own events (updateFinished comes first), not looked up by id */
  let brokers: List | undefined;

  function finish(runId: string): void {
    if (state.getProperty("/finished")) {
      return;
    }
    state.setProperty("/finished", true);
    clearInterval(pollTimer);
    loadProblems(runId);
  }

  /**
   * Reads the run itself: catches up if it finished before the live context was entered, and ends the wait
   * when no progress arrives (connection lost, or the run was aborted on the server). The run's counts are
   * written when it ends; the total is right from the start (the dialog's own estimate is not for folders).
   */
  function poll(runId: string): Promise<void> {
    const binding = model.bindContext("/TestRuns(" + runId + ")");
    return binding
      .requestObject()
      .then((r: RunRow | undefined) => {
        if (r) {
          state.setProperty("/total", r.totalCount);
        }
        if (r && r.status !== "RUNNING") {
          state.setProperty("/done", r.totalCount);
          state.setProperty("/passed", r.passedCount);
          state.setProperty("/failed", r.failedCount);
          state.setProperty("/skipped", r.skippedCount || 0);
          state.setProperty("/aborted", r.status === "FAILED");
          finish(runId);
        }
      })
      .catch(() => {
        /* try again on the next tick */
      })
      .finally(() => binding.destroy());
  }

  /** Failed / errored results of the run, shown directly in the dialog. */
  function loadProblems(runId: string): void {
    if (!state.getProperty("/failed")) {
      return;
    }
    const filters = [
      new Filter("run_ID", FilterOperator.EQ, runId),
      new Filter("status", FilterOperator.NE, "PASSED"),
      new Filter("status", FilterOperator.NE, "SKIPPED")
    ];
    model
      .bindList("/RunResults", undefined, [], filters, { $select: "testCaseName,brokerName,status,errorMessage" })
      .requestContexts(0, MAX_PROBLEMS)
      .then((contexts) => {
        state.setProperty(
          "/problems",
          contexts.map((c) => c.getObject())
        );
        state.setProperty("/moreProblems", Math.max(0, (state.getProperty("/failed") as number) - contexts.length));
      })
      .catch(() => {
        /* details remain available in the results */
      });
  }

  function selectedBrokers(): Context[] {
    return brokers ? (brokers.getSelectedContexts() as Context[]) : [];
  }

  /**
   * One credentials row per selected DIRECT broker (password, plus username if the broker has none);
   * typed values are kept while the selection changes.
   */
  function syncCredentials(): void {
    const typed: Record<string, CredentialRow> = {};
    for (const c of state.getProperty("/credentials") as CredentialRow[]) typed[c.brokerId] = c;
    const rows = selectedBrokers()
      .map((c) => c.getObject() as BrokerRow)
      .filter((b) => b.credentialMode !== "DESTINATION")
      .map((b): CredentialRow => {
        const prev = typed[b.ID];
        return {
          brokerId: b.ID,
          name: b.name,
          username: b.username || "",
          needsUsername: !b.username,
          enteredUsername: prev?.enteredUsername || "",
          password: prev?.password || "",
          missing: false
        };
      });
    state.setProperty("/credentials", rows);
  }

  /** "5 test cases x 2 brokers x 10 = at least 100 messages; the pauses alone take about 2 min" */
  function updateEstimate(): void {
    const brokerCount = selectedBrokers().length;
    const reps = Math.max(1, Number(state.getProperty("/repetitions")) || 1);
    const delay = Math.max(0, Number(state.getProperty("/delayMs")) || 0);
    const perBroker = testCaseIds.length * reps;
    let text = "";
    if (brokerCount && (reps > 1 || delay > 0)) {
      text = t("run.estimate", [perBroker * brokerCount, testCaseIds.length, t(brokerCount === 1 ? "run.brokerOne" : "run.brokerMany", [brokerCount]), reps]);
      if (delay > 0 && perBroker > 1) {
        text += t("run.estimatePauses", [formatDuration((perBroker - 1) * delay, t)]);
      }
    }
    state.setProperty("/estimate", text);
  }

  const handler = {
    onHelp(): void {
      Help.openForRun();
    },
    onBrokerSelection(event: Event): void {
      brokers = event.getSource() as List;
      syncCredentials();
      updateEstimate();
    },
    onOptionsChange(): void {
      updateEstimate();
    },
    /** Stops the run: messages not sent yet are skipped. */
    onStop(): void {
      state.setProperty("/stopping", true);
      Actions.invokeAction(model, "/cancelRun(...)", { runId: state.getProperty("/runId") }).catch((e) => {
        state.setProperty("/stopping", false);
        MessageBox.error(errorText(e));
      });
    },
    /** Preselects the brokers of the last run, or the only broker there is. */
    onBrokersLoaded(event: Event): void {
      const list = event.getSource() as List;
      brokers = list;
      const items = list.getItems();
      if (preselected || !items.length) {
        return;
      }
      preselected = true;
      const last = Prefs.get<string[]>("lastBrokers", []);
      let hit = false;
      for (const item of items) {
        if (last.includes(item.getBindingContext()!.getProperty("ID") as string)) {
          list.setSelectedItem(item, true);
          hit = true;
        }
      }
      if (!hit && items.length === 1) {
        list.setSelectedItem(items[0], true);
      }
      syncCredentials();
      updateEstimate();
    },
    onPrimary(): void {
      const runId = state.getProperty("/runId") as string | null;
      if (runId) {
        dialog.close();
        openRun(runId);
        return;
      }
      const brokerIds = selectedBrokers().map((c) => c.getProperty("ID") as string);
      if (!brokerIds.length) {
        MessageToast.show(t("run.selectBroker"));
        return;
      }
      const credentials = state.getProperty("/credentials") as CredentialRow[];
      const missing = credentials.filter((c) => !c.password || (c.needsUsername && !c.enteredUsername.trim()));
      if (missing.length) {
        for (const c of credentials) c.missing = true;
        state.refresh(true);
        MessageToast.show(t("run.missingCredentials", [missing.map((c) => c.name).join(", ")]));
        return;
      }
      Prefs.set("lastBrokers", brokerIds);
      const options = {
        repetitions: Math.max(1, Math.round(Number(state.getProperty("/repetitions")) || 1)),
        delayMs: Math.max(0, Math.round(Number(state.getProperty("/delayMs")) || 0)),
        order: state.getProperty("/order") as string,
        stopOnFailure: !!state.getProperty("/stopOnFailure")
      };
      Prefs.set("runRepetitions", options.repetitions);
      Prefs.set("runDelayMs", options.delayMs);
      Prefs.set("runOrder", options.order);
      Prefs.set("runStopOnFailure", options.stopOnFailure);
      state.setProperty("/starting", true);
      Actions.invokeAction<{ runId: string; total: number }>(model, "/runTests(...)", {
        testCaseIds,
        brokerIds,
        credentials: credentials.map((c) => ({
          brokerId: c.brokerId,
          username: c.needsUsername ? c.enteredUsername.trim() : null,
          password: c.password
        })),
        options
      })
        .then((result) => {
          // passwords are not kept in the UI after the run was started
          state.setProperty("/credentials", []);
          const id = result.runId;
          state.setProperty("/total", result.total);
          state.setProperty("/runId", id);
          pollTimer = setInterval(() => void poll(id), POLL_MS);
          return socket.enter(id).then(() => poll(id));
        })
        .catch((e) => MessageBox.error(errorText(e)))
        .finally(() => state.setProperty("/starting", false));
    },
    onClose(): void {
      dialog.close();
    }
  };

  return (
    api.loadFragment({
      id: "runDialog" + Date.now(),
      name: "com.aem.suite.testcases.ext.RunDialog",
      controller: handler
    }) as Promise<Dialog>
  ).then((d) => {
    dialog = d;
    dialog.setModel(state, "run");
    dialog.attachAfterClose(() => {
      clearInterval(pollTimer);
      socket.close();
      dialog.destroy();
    });
    dialog.open();
  });
}

export default {
  /**
   * Opens the dialog for the given test cases / folders.
   * @param api the FE ExtensionAPI (this of a custom action handler)
   * @param testCaseIds saved test cases and folders
   * @param label what the dialog title names ("Run <label>")
   */
  open: openRunDialog
};
