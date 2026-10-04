import { describe, expect, it } from "vitest";
import { createDefaultRedactor, defaultRedactor, MAX_CHARS, redactDeep } from "./redact";

const r = (text: string) => defaultRedactor.redact(text);

describe("defaultRedactor", () => {
  it.each([
    ["email", "Write to jane.doe+work@example.co.uk today", "Write to [email] today"],
    ["US phone", "Call (415) 555-0132 tomorrow", "Call [phone] tomorrow"],
    ["international phone", "My number is +44 20 7946 0958.", "My number is [phone]."],
    ["valid card", "Card 4111 1111 1111 1111 expires", "Card [card] expires"],
    ["IBAN", "IBAN GB82 WEST 1234 5698 7654 32 please", "IBAN [iban] please"],
    ["SSN", "SSN 123-45-6789 on file", "SSN [ssn] on file"],
    ["IPv4", "from 203.0.113.42 at noon", "from [ip] at noon"],
    ["IPv6", "host 2001:db8::8a2e:370:7334 down", "host [ip] down"],
    ["OpenAI key", "key sk-proj-abcdefghijklmnopqrstuvwx123", "key [secret]"],
    ["Anthropic key", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "[secret]"],
    ["AWS key", "AKIAIOSFODNN7EXAMPLE leaked", "[secret] leaked"],
    ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[secret]"],
    ["JWT", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N", "Bearer [secret]"],
    ["URL credentials", "postgres://admin:hunter2@db.internal/prod", "postgres://[secret]@db.internal/prod"],
  ])("removes %s", (_name, input, expected) => {
    expect(r(input).text).toBe(expected);
  });

  it("sees through invisible characters that split an address", () => {
    expect(r("jane\u200b@exa\u00admple.com and +1\u2060 415 555 0132").text).toBe("[email] and [phone]");
    expect(r("line one\n\tline two").text).toBe("line one\n\tline two");
  });

  it("removes a PEM private key block whole", () => {
    expect(r("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY----- done").text).toBe("[secret] done");
  });

  it.each([
    ["years", "Shipped 2019-2024 across three teams"],
    ["money", "Raised $120,000 in 2023"],
    ["an invalid card number", "Order 4111 1111 1111 1112 shipped"],
    ["a version string", "Upgraded to version 1.2.3.4 and v10.0.0.1"],
    ["clock times", "Meet at 10:30:00 or 14:05"],
    ["a decimal", "Latency fell 3.5 ms"],
    ["prose", "I led the redesign of the onboarding flow at Lennar."],
  ])("keeps %s", (_name, input) => {
    expect(r(input).text).toBe(input);
  });

  it("counts findings by type and never includes the matched text", () => {
    const result = r("a@b.io and c@d.io, call +1 415 555 0132");
    expect(result.findings).toEqual({ email: 2, phone: 1 });
    expect(JSON.stringify(result.findings)).not.toMatch(/@|415/);
  });

  it("is idempotent: redacting twice changes nothing more", () => {
    const once = r("jane@example.com +44 20 7946 0958 4111111111111111 sk-ant-abcdefghijklmnopqrstuv").text;
    expect(r(once)).toEqual({ text: once, findings: {} });
  });

  it("uses the configured country for national phone formats", () => {
    expect(createDefaultRedactor({ defaultCountry: "GB" }).redact("Ring 020 7946 0958").text).toBe("Ring [phone]");
  });
});

describe("defaultRedactor on hostile input", () => {
  // Every rule must stay linear in V8 (gitleaks writes for Go's linear RE2;
  // the same patterns can backtrack in JavaScript). A quadratic rule takes
  // seconds on these; a linear one takes milliseconds.
  const n = MAX_CHARS;
  it.each([
    ["letters before an @", "a".repeat(n) + "@"],
    ["dotted labels after an @", "x@" + "a.".repeat(n / 2)],
    ["a long digit run", "1".repeat(n)],
    ["digits and punctuation", "1(".repeat(n / 2)],
    ["dashed digits", "1-".repeat(n / 2)],
    ["dotted digits", "1.".repeat(n / 2)],
    ["colons", "a:".repeat(n / 2)],
    ["a token prefix", "eyJ" + "a".repeat(n)],
    ["version strings", "v1.2.3.".repeat(n / 7)],
    ["phone-like words", "call 415 ".repeat(n / 9)],
  ])("handles %s in linear time", (_name, input) => {
    const started = performance.now();
    defaultRedactor.redact(input);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("cuts a string past the limit before matching, with a marker", () => {
    const { text } = defaultRedactor.redact("a".repeat(MAX_CHARS) + " jane@example.com");
    expect(text).not.toContain("jane@");
    expect(text).toMatch(/\[truncated 17 characters\]$/);
  });
});

describe("redactDeep", () => {
  it("redacts keys as well as values", () => {
    expect(redactDeep({ "jane@example.com": { visits: 3 } }).value).toEqual({ "[email]": { visits: 3 } });
  });

  it("redacts every string in a JSON value and keeps its shape", () => {
    const input = { role: "user", content: [{ type: "text", text: "I'm jane@example.com" }], meta: { n: 3, ok: true, ip: "203.0.113.9" } };
    const { value, findings } = redactDeep(input);
    expect(value).toEqual({ role: "user", content: [{ type: "text", text: "I'm [email]" }], meta: { n: 3, ok: true, ip: "[ip]" } });
    expect(findings).toEqual({ email: 1, ip: 1 });
    expect(input.content[0]!.text).toBe("I'm jane@example.com"); // not mutated
  });
});
