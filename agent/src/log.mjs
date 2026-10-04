/** JSON-lines logger; never logs tokens, cookies or page HTML (only sizes, hosts, codes). */
const SECRET_RE = /(bbmc_[A-Za-z0-9]{8})_[A-Za-z0-9]{40}/g;

function emit(level, msg, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }).replace(SECRET_RE, "$1_…");
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg, fields) => emit("info", msg, fields),
  warn: (msg, fields) => emit("warn", msg, fields),
  error: (msg, fields) => emit("error", msg, fields),
};

/** Plain-language line for the person watching the window (not JSON). */
export function say(text) {
  console.log(`\n>>> ${text}\n`);
}
