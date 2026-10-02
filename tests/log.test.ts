import { afterEach, describe, expect, it } from "vitest";
import { createLogger, redactString, redactValue, requestIdFrom, requestLogger, setLogSink, type LogLevel } from "@/lib/log";

function capture() {
  const lines: Array<{ level: LogLevel; record: Record<string, unknown>; line: string }> = [];
  setLogSink((level, line) => lines.push({ level, line, record: JSON.parse(line) as Record<string, unknown> }));
  return lines;
}

afterEach(() => setLogSink(null));

describe("redaction", () => {
  it("masks bearer tokens, e-mails and phone numbers inside strings", () => {
    expect(redactString("Authorization: Bearer abcDEF123456.token-value")).toBe("Authorization: Bearer [redacted]");
    expect(redactString("bearer short")).toBe("bearer short");
    expect(redactString("mail photographer@example.com now")).toBe("mail [email] now");
    expect(redactString("call +974 5555 1234 today")).toBe("call [phone] today");
    expect(redactString("call 555 123-4567 now")).toBe("call [phone] now");
    expect(redactString("match 12 at 10:40 on mat 3")).toBe("match 12 at 10:40 on mat 3");
    expect(redactString("ray 8c1f2e3d")).toBe("ray 8c1f2e3d");
  });

  it("truncates long strings", () => {
    const out = redactString("x".repeat(1000));
    expect(out.startsWith("x".repeat(400))).toBe(true);
    expect(out.endsWith("…[600 more]")).toBe(true);
  });

  it("masks secret-named keys whatever their value, recursively", () => {
    const out = redactValue({
      token: "abc",
      WATCHER_WORKER_TOKEN: "abc",
      apiKey: "k",
      api_key: "k",
      Authorization: "Bearer x",
      cookie: "a=b",
      email: "x@y.co",
      phone: "123",
      html: "<html>",
      body: "...",
      password: "p",
      session: { id: 1 },
      nested: { secretThing: "s", fine: "ok", list: ["a@b.co", { signature: "sig" }] },
      count: 3,
      flag: true,
      none: null,
      emptyToken: "",
      numericToken: 42,
    }) as Record<string, unknown>;
    expect(out).toEqual({
      token: "[redacted]",
      WATCHER_WORKER_TOKEN: "[redacted]",
      apiKey: "[redacted]",
      api_key: "[redacted]",
      Authorization: "[redacted]",
      cookie: "[redacted]",
      email: "[redacted]",
      phone: "[redacted]",
      html: "[redacted]",
      body: "[redacted]",
      password: "[redacted]",
      session: "[redacted]",
      nested: { secretThing: "[redacted]", fine: "ok", list: ["[email]", { signature: "[redacted]" }] },
      count: 3,
      flag: true,
      none: null,
      emptyToken: "",
      numericToken: 42,
    });
  });

  it("handles errors, arrays, depth and odd values", () => {
    expect(redactValue(new Error("failed for a@b.co"))).toEqual({ name: "Error", message: "failed for [email]" });
    expect(redactValue(Array.from({ length: 60 }, (_, i) => i))).toHaveLength(50);
    let deep: unknown = "leaf";
    for (let i = 0; i < 9; i++) deep = { d: deep };
    expect(JSON.stringify(redactValue(deep))).toContain("[depth]");
    expect(redactValue(undefined)).toBeUndefined();
    expect(redactValue(Symbol("s"))).toBe("Symbol(s)");
  });
});

describe("createLogger", () => {
  it("emits one JSON line per call with ts/level/msg and redacted fields", () => {
    const lines = capture();
    const log = createLogger({ route: "api/watch", requestId: "req-1" });
    log.info("hello", { token: "secret-token-value", contact: "a@b.co" });
    log.warn("careful");
    log.error("boom", { error: new Error("Bearer abcdefghijklmnop") });
    expect(lines.map((l) => l.level)).toEqual(["info", "warn", "error"]);
    expect(lines[0].record).toMatchObject({ level: "info", msg: "hello", route: "api/watch", requestId: "req-1", token: "[redacted]", contact: "[email]" });
    expect(typeof lines[0].record.ts).toBe("string");
    expect(lines[2].record.error).toEqual({ name: "Error", message: "Bearer [redacted]" });
    expect(lines.some((l) => l.line.includes("secret-token-value") || l.line.includes("a@b.co"))).toBe(false);
  });

  it("child loggers inherit and extend fields; debug is gated by LOG_LEVEL", () => {
    const lines = capture();
    const previous = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    const child = createLogger({ route: "r" }).child({ athleteId: "a1" });
    expect(child.fields).toEqual({ route: "r", athleteId: "a1" });
    child.debug("hidden");
    child.info("shown", { route: "override" });
    process.env.LOG_LEVEL = "debug";
    child.debug("visible");
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
    expect(lines.map((l) => l.record.msg)).toEqual(["shown", "visible"]);
    expect(lines[0].record).toMatchObject({ route: "override", athleteId: "a1" });
  });
});

describe("request ids", () => {
  it("uses a well-formed supplied id, then Vercel's, else a fresh uuid", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "abc-123_x:y" }))).toBe("abc-123_x:y");
    expect(requestIdFrom(new Headers({ "x-request-id": "bad id!", "x-vercel-id": "fra1::abcd" }))).toBe("fra1::abcd");
    expect(requestIdFrom(new Headers({ "x-request-id": "abc" }))).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(new Headers())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requestLogger binds the id and route", () => {
    const lines = capture();
    const { log, requestId } = requestLogger(new Request("http://localhost/api/watch", { headers: { "x-request-id": "req-42" } }), "api/watch");
    expect(requestId).toBe("req-42");
    log.info("x");
    expect(lines[0].record).toMatchObject({ requestId: "req-42", route: "api/watch" });
  });
});
