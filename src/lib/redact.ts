import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js";

/**
 * Removes personal details and secrets from text before it is stored or
 * forwarded (M1 1.11). The default rules need no network; a host that needs
 * names and street addresses plugs in a managed service behind the same
 * interface (see the README).
 */
export type FindingType = "email" | "phone" | "card" | "iban" | "ssn" | "ip" | "secret";

export interface RedactResult {
  text: string;
  /** Counts by type only, never the matched text, so this is safe to log. */
  findings: Partial<Record<FindingType, number>>;
}

export interface Redactor {
  redact(text: string): RedactResult;
}

export interface DefaultRedactorOptions {
  /** Country assumed for phone numbers written without a country code. Default "US". */
  defaultCountry?: CountryCode;
}

type Rule = { type: FindingType; pattern: RegExp; keep?: (match: string, groups: string[]) => boolean; replace?: (match: string, groups: string[]) => string };

// Secrets first: they are long and would otherwise be split by later rules.
// Patterns follow gitleaks' rule set (github.com/gitleaks/gitleaks).
const SECRET_RULES: Rule[] = [
  { type: "secret", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { type: "secret", pattern: /\bsk-(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g }, // OpenAI, Anthropic
  { type: "secret", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g }, // Stripe
  { type: "secret", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g }, // AWS access key id
  { type: "secret", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}/g }, // GitHub
  { type: "secret", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g }, // Slack
  { type: "secret", pattern: /\bAIza[0-9A-Za-z_-]{35}/g }, // Google API key
  { type: "secret", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g }, // JWT
  // Credentials in a URL: keep the scheme, drop user and password.
  { type: "secret", pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/:@]+:[^\s/@]+@/gi, replace: (_m, g) => `${g[0]}[secret]@` },
];

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
};

const ibanValid = (raw: string) => {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
};

const LOCAL = /[A-Za-z0-9._%+-]/;
const DOMAIN = /[A-Za-z0-9.-]/;

/**
 * Emails, found from each "@" outward with bounded scans (64 characters of
 * local part, 255 of domain, the RFC limits). A regex with an unanchored
 * local part rescans from every starting position, which is quadratic on a
 * long run of letters.
 */
function redactEmails(text: string, count: () => void): string {
  let out = "";
  let from = 0;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (at < from) continue;
    let start = at;
    while (start > from && at - start < 64 && LOCAL.test(text[start - 1]!)) start--;
    let end = at + 1;
    while (end < text.length && end - at <= 255 && DOMAIN.test(text[end]!)) end++;
    // Trim trailing dots and dashes from the domain, then require a dotted
    // name ending in a letter-only top-level label of two or more.
    while (end > at + 1 && /[.-]/.test(text[end - 1]!)) end--;
    const domain = text.slice(at + 1, end);
    if (start === at || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(domain) || domain.length > 255) continue;
    out += text.slice(from, start) + PLACEHOLDER_EMAIL;
    count();
    from = end;
    at = end - 1;
  }
  return out + text.slice(from);
}

const PLACEHOLDER_EMAIL = "[email]";

const STRUCTURED_RULES: Rule[] = [
  { type: "iban", pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, keep: (m) => !ibanValid(m) },
  { type: "card", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, keep: (m) => !luhn(m.replace(/\D/g, "")) },
  { type: "ssn", pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  // IPv4, but not a version string ("v1.2.3.4", "version 1.2.3.4").
  {
    type: "ip",
    pattern: /(\bv(?:ersion)?\s?)?\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gi,
    keep: (_m, g) => Boolean(g[0]),
  },
  // IPv6: all eight groups, or a compressed form with "::" and a hex digit;
  // clock times ("10:30:00") have too few groups to match.
  { type: "ip", pattern: /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|(?:\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?\b(?=[^:]|$)/gi, keep: (m) => !/[0-9a-f]/i.test(m.replace(/:/g, "")) },
];

// A run of 9 to 15 digits (the E.164 maximum) with phone punctuation, for
// numbers the phone library rejects; shorter runs ("2019-2024", "$120,000")
// and longer ones (order numbers) survive. Bounded, so it stays linear.
const DIGIT_RUN = /\+?\d[\d\s().-]{6,30}\d/g;

const PLACEHOLDER: Record<FindingType, string> = {
  email: "[email]",
  phone: "[phone]",
  card: "[card]",
  iban: "[iban]",
  ssn: "[ssn]",
  ip: "[ip]",
  secret: "[secret]",
};

/** Characters of one string that are matched; the rest is dropped with a marker. */
export const MAX_CHARS = 100_000;

const INVISIBLE = /(?![\t\n\r])[\p{Cc}\p{Cf}]/gu;

function applyRule(rule: Rule, text: string, count: (type: FindingType) => void): string {
  return text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
    const groups = rest.slice(0, -2).map((g) => (typeof g === "string" ? g : ""));
    if (rule.keep?.(match, groups)) return match;
    count(rule.type);
    return rule.replace ? rule.replace(match, groups) : PLACEHOLDER[rule.type];
  });
}

/** The built-in rules: emails, phones, payment cards, IBANs, US SSNs, IP addresses and common secrets. */
export function createDefaultRedactor({ defaultCountry = "US" }: DefaultRedactorOptions = {}): Redactor {
  return {
    redact(input) {
      const findings: RedactResult["findings"] = {};
      const count = (type: FindingType) => (findings[type] = (findings[type] ?? 0) + 1);
      // Longer strings are cut after the limit, so every rule's cost stays
      // bounded; the cut happens before matching, so nothing past it is kept.
      let text = input.length > MAX_CHARS ? `${input.slice(0, MAX_CHARS)}[truncated ${input.length - MAX_CHARS} characters]` : input;
      // Control and invisible format characters (zero-width spaces and
      // joiners, soft hyphens, BOMs) can split an address past every rule
      // while it still looks whole; they go first. Tab and newlines stay.
      text = text.replace(INVISIBLE, "");
      for (const rule of SECRET_RULES) text = applyRule(rule, text, count);
      text = redactEmails(text, () => count("email"));
      for (const rule of STRUCTURED_RULES) {
        text = applyRule(rule, text, count);
      }
      // Phones: the library finds international and national formats; replace
      // from the end so earlier offsets stay valid.
      const phones = findPhoneNumbersInText(text, defaultCountry);
      for (let i = phones.length - 1; i >= 0; i--) {
        const p = phones[i]!;
        text = text.slice(0, p.startsAt) + PLACEHOLDER.phone + text.slice(p.endsAt);
        count("phone");
      }
      text = text.replace(DIGIT_RUN, (match) => {
        const digits = match.replace(/\D/g, "").length;
        if (digits < 9 || digits > 15) return match;
        count("phone");
        return PLACEHOLDER.phone;
      });
      return { text, findings };
    },
  };
}

/** The default redactor with US as the phone country. */
export const defaultRedactor: Redactor = createDefaultRedactor();

/**
 * Redacts every string and key in a JSON value (trace columns, event
 * payloads); the structure is kept. Findings are summed across the value.
 * Callers that truncate must do it after this, never before.
 */
export function redactDeep<T>(value: T, redactor: Redactor = defaultRedactor): { value: T; findings: RedactResult["findings"] } {
  const findings: RedactResult["findings"] = {};
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") {
      const r = redactor.redact(v);
      for (const [k, n] of Object.entries(r.findings)) findings[k as FindingType] = (findings[k as FindingType] ?? 0) + (n ?? 0);
      return r.text;
    }
    if (v === null || typeof v !== "object") return v;
    // Past the depth limit the subtree is flattened to text and redacted,
    // never stored as it came.
    if (depth > 40) return walk(JSON.stringify(v), depth);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    // Keys too: a tool result can be keyed by an address or a number.
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[walk(k, depth + 1) as string] = walk(x, depth + 1);
    return out;
  };
  return { value: walk(value, 0) as T, findings };
}

/** The text alone, for callers that do not need the finding counts. */
export function redactText(text: string): string {
  return defaultRedactor.redact(text).text;
}
