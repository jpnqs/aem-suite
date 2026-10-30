/**
 * Counters of this server process since its start - for the System section of the Home app (administrators).
 * In memory like runs and live subscriptions: the backend runs as one instance (mta.yaml).
 */
const counters = {
  startedAt: new Date(),
  runsStarted: 0,
  messagesPassed: 0,
  messagesFailed: 0
}

export type Counter = Exclude<keyof typeof counters, 'startedAt'>

export function count(counter: Counter, by = 1): void {
  counters[counter] += by
}

export function metrics() {
  return { ...counters, startedAt: counters.startedAt.toISOString(), uptimeSeconds: Math.round((Date.now() - counters.startedAt.getTime()) / 1000) }
}
