// Stand-in for @toon-format/toon (mapped in jest.config.js). @cap-js/mcp require()s it to format tool results as
// TOON text, but the package is ESM-only: plain Node 22.12+ can require it, Jest cannot. Still needed with
// @cap-js/mcp 1.5. The tests read the structured result (structuredContent) - so the TOON text channel of successful
// tool results is not covered by any test.
module.exports = { encode: (value) => JSON.stringify(value) }
