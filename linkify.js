/**
 * Detect http(s) and www. URLs in plain message text for display and search.
 */

const URL_RE =
  /\b(https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"{}|\\^`[\]]*)?)/gi;

/** Strip common trailing punctuation mistaken as part of the URL. */
function trimUrlTail(raw) {
  return raw.replace(/[.,;:!?)}\]]+$/g, "");
}

function safeLinkHref(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function normalizeHttpCandidate(raw) {
  if (!raw) return raw;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/**
 * Split plain text into text / link segments. Only http(s) hrefs become links.
 */
export function parseTextWithLinks(text) {
  if (text == null || text === "") return [];
  const s = String(text);
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ type: "text", text: s.slice(last, m.index) });
    const rawFull = m[0];
    const core = trimUrlTail(rawFull);
    const punctTail = rawFull.slice(core.length);
    if (core) {
      const hrefCandidate = normalizeHttpCandidate(core);
      const href = safeLinkHref(hrefCandidate);
      if (href) out.push({ type: "link", href, text: core });
      else out.push({ type: "text", text: rawFull });
    }
    if (punctTail) out.push({ type: "text", text: punctTail });
    last = m.index + rawFull.length;
  }
  if (last < s.length) out.push({ type: "text", text: s.slice(last) });
  return out.length ? out : [{ type: "text", text: s }];
}

/**
 * Augment message body for substring search: raw text plus URL hostname, path, etc.
 */
export function contentSearchHaystack(content) {
  const s = String(content ?? "");
  const lower = s.toLowerCase();
  const extras = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    const core = trimUrlTail(m[0]);
    if (!core) continue;
    const hrefNorm = normalizeHttpCandidate(core);
    extras.push(core.toLowerCase());
    extras.push(hrefNorm.toLowerCase());
    try {
      const u = new URL(hrefNorm);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const host = u.hostname.toLowerCase();
      extras.push(host);
      extras.push(host.replace(/^www\./, ""));
      const path = u.pathname || "";
      if (path && path !== "/") {
        extras.push(path.toLowerCase());
        extras.push((host + path).toLowerCase());
      }
      if (u.search) extras.push(u.search.toLowerCase());
      extras.push(u.href.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  return extras.length ? `${lower} ${extras.join(" ")}` : lower;
}
