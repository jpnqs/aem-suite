// Jest cannot load the ESM-only @toon-format/toon that @cap-js/mcp uses to format tool results
// (plain Node can). Tests only need the result as readable JSON.
module.exports = { encode: (value) => JSON.stringify(value) }
