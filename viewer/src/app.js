// Shared client state. One object so modules can read the latest server state without import cycles.
export const app = {
  state: null,      // the server's publicState(): file, parts, params, overrides, builtAt, ...
  selected: null,   // selected part name, or null
};
