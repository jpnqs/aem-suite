import cds from '@sap/cds'

/** The `cds.aemSuite` settings (see docs/technical-documentation.md, section "Configuration"). */
export interface AemSuiteConfig {
  /** connection test on save of destination brokers */
  autoTestConnection: boolean
  subscriptions: {
    /** parallel live subscriptions per user */
    maxPerUser: number
    /** close subscriptions without heartbeat */
    idleTimeoutMs: number
    /** forwarding limit per subscription */
    maxMessagesPerSecond: number
    /** truncation of payloads in the live view */
    maxPayloadBytes: number
  }
  help: {
    /** location of the user guide (relative to the project root) */
    file: string
  }
  /** limits for agents - the MCP adapter itself has no rate limiting or audit (see docs) */
  agent: {
    /** test cases x brokers of one run */
    maxRunResults: number
    /** runs of one user that may be RUNNING at the same time */
    maxActiveRuns: number
    /** runs one user may start through an agent within an hour (a runaway agent loop stops here) */
    maxRunsPerHour: number
  }
  runs: {
    /** upper limit of the repetitions in the Run dialog */
    maxRepetitions: number
    /** upper limit of the pause between two messages */
    maxDelayMs: number
    /** messages (test cases x brokers x repetitions) of one run */
    maxResults: number
    /** runs one user may have in progress at the same time */
    maxActivePerUser: number
    /** runs in progress on the server at the same time */
    maxActive: number
    /** size of a resolved payload that is still sent (and of a payload template that can be saved) */
    maxPayloadBytes: number
  }
  faker: {
    /** language of {{faker...}} test data: en, de, fr, es, en_GB, ... (the locales of faker.js) */
    locale: string
  }
  mcp: {
    /** public app URL for the OAuth discovery; default: from the approuter's forwarded headers */
    publicUrl?: string
    /** authorization server advertised to MCP clients; default: XSUAA credentials.url */
    authorizationServer?: string
    /** launchpad address for the links an agent hands out (e.g. a Work Zone site); default: the app's own launchpad */
    launchpadUrl?: string
  }
}

export const DEFAULTS: AemSuiteConfig = {
  autoTestConnection: true,
  subscriptions: { maxPerUser: 5, idleTimeoutMs: 5 * 60 * 1000, maxMessagesPerSecond: 100, maxPayloadBytes: 512 * 1024 },
  help: { file: 'docs/user-guide.md' },
  agent: { maxRunResults: 100, maxActiveRuns: 2, maxRunsPerHour: 30 },
  runs: { maxRepetitions: 1000, maxDelayMs: 60_000, maxResults: 5000, maxActivePerUser: 5, maxActive: 20, maxPayloadBytes: 1024 * 1024 },
  faker: { locale: 'en' },
  mcp: {}
}

type Overrides = { [K in keyof AemSuiteConfig]?: AemSuiteConfig[K] extends object ? Partial<AemSuiteConfig[K]> : AemSuiteConfig[K] }

/** The current settings: `cds.env.aemSuite` over the defaults (read on every call, so tests can change it). */
export function config(): AemSuiteConfig {
  const own = ((cds.env as { aemSuite?: Overrides }).aemSuite ?? {}) as Overrides
  return {
    autoTestConnection: own.autoTestConnection ?? DEFAULTS.autoTestConnection,
    subscriptions: { ...DEFAULTS.subscriptions, ...own.subscriptions },
    help: { ...DEFAULTS.help, ...own.help },
    agent: { ...DEFAULTS.agent, ...own.agent },
    runs: { ...DEFAULTS.runs, ...own.runs },
    faker: { ...DEFAULTS.faker, ...own.faker },
    mcp: { ...DEFAULTS.mcp, ...own.mcp }
  }
}
