const FEED_SCROLL_SESSION_KEY = "manhwa-library-feed-scroll-v1";
const LAST_FEED_SESSION_KEY = "manhwa-library-last-feed-v1";
const RETURN_FEED_SCROLL_SESSION_KEY = "manhwa-library-return-feed-scroll-v1";

type ReturnScrollTarget = {
  feedId: string;
  y: number;
  expiresAt: number;
};

function readFeedScrollPositions() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(FEED_SCROLL_SESSION_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeFeedScrollPosition(feedId: string, y: number) {
  try {
    const positions = readFeedScrollPositions();
    positions[feedId] = Math.max(0, y);
    sessionStorage.setItem(FEED_SCROLL_SESSION_KEY, JSON.stringify(positions));
    sessionStorage.setItem(LAST_FEED_SESSION_KEY, feedId);
  } catch {
    // sessionStorage may be unavailable in private contexts.
  }
}

function writeReturnScrollTarget(feedId: string, y: number) {
  try {
    const target: ReturnScrollTarget = {
      feedId,
      y: Math.max(0, y),
      expiresAt: Date.now() + 60_000,
    };
    sessionStorage.setItem(RETURN_FEED_SCROLL_SESSION_KEY, JSON.stringify(target));
  } catch {
    // sessionStorage may be unavailable in private contexts.
  }
}

function readReturnScrollTarget() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RETURN_FEED_SCROLL_SESSION_KEY) ?? "null") as Partial<ReturnScrollTarget> | null;
    if (!parsed || typeof parsed.feedId !== "string" || typeof parsed.y !== "number" || typeof parsed.expiresAt !== "number") return null;
    if (!Number.isFinite(parsed.y) || parsed.expiresAt < Date.now()) return null;
    return parsed as ReturnScrollTarget;
  } catch {
    return null;
  }
}

function getActiveFeedPanel() {
  return document.querySelector<HTMLElement>(".feed-pager-panel[data-feed-id]:not(.inactive-panel)");
}

function saveActiveFeedScroll(asReturnTarget = false) {
  const panel = getActiveFeedPanel();
  const feedId = panel?.dataset.feedId;
  if (!panel || !feedId || feedId === "blank") return;

  const y = panel.scrollTop;
  writeFeedScrollPosition(feedId, y);
  if (asReturnTarget) writeReturnScrollTarget(feedId, y);
}

function getRestoreYForPanel(panel: HTMLElement) {
  const feedId = panel.dataset.feedId;
  const returnTarget = readReturnScrollTarget();

  if (returnTarget && (!feedId || returnTarget.feedId === feedId)) {
    return returnTarget.y;
  }

  const positions = readFeedScrollPositions();
  if (feedId && typeof positions[feedId] === "number") return positions[feedId];

  const lastFeedId = sessionStorage.getItem(LAST_FEED_SESSION_KEY);
  return lastFeedId ? positions[lastFeedId] ?? 0 : 0;
}

function restoreActiveFeedScroll(deadline = performance.now() + 4500) {
  const attempt = () => {
    const panel = getActiveFeedPanel();
    const y = panel ? getRestoreYForPanel(panel) : 0;

    if (panel && y > 0) {
      // Use direct scrollTop as well as scrollTo because this panel is the actual nested scroller,
      // and the virtual grid may briefly report a smaller height while it remounts after Back.
      panel.scrollTop = y;
      if (Math.abs(panel.scrollTop - y) > 2) {
        panel.scrollTo({ top: y, left: 0, behavior: "auto" });
      }

      const feedId = panel.dataset.feedId;
      if (feedId && feedId !== "blank") writeFeedScrollPosition(feedId, y);
    }

    if (performance.now() < deadline) requestAnimationFrame(attempt);
  };

  requestAnimationFrame(attempt);
}

function isTitleLink(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  return Boolean(link?.getAttribute("href")?.includes("/title/"));
}

function isTitleRoute() {
  return window.location.hash.startsWith("#/title/");
}

function isHomeRoute() {
  return window.location.hash === "" || window.location.hash === "#/";
}

function saveBeforeTitleNavigation(event: Event) {
  if (isTitleLink(event.target)) saveActiveFeedScroll(true);
}

let lastWasTitleRoute = isTitleRoute();

document.addEventListener("pointerdown", saveBeforeTitleNavigation, { capture: true, passive: true });
document.addEventListener("touchstart", saveBeforeTitleNavigation, { capture: true, passive: true });
document.addEventListener("click", saveBeforeTitleNavigation, { capture: true, passive: true });

document.addEventListener(
  "scroll",
  (event) => {
    const panel = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".feed-pager-panel[data-feed-id]:not(.inactive-panel)") : null;
    const feedId = panel?.dataset.feedId;
    if (!panel || !feedId || feedId === "blank") return;

    const returnTarget = readReturnScrollTarget();
    const isProtectingReturnTarget = returnTarget && returnTarget.feedId === feedId && returnTarget.y > panel.scrollTop;
    if (!isProtectingReturnTarget) writeFeedScrollPosition(feedId, panel.scrollTop);
  },
  { capture: true, passive: true },
);

window.addEventListener("hashchange", () => {
  const nowTitleRoute = isTitleRoute();
  if (lastWasTitleRoute && !nowTitleRoute) restoreActiveFeedScroll();
  lastWasTitleRoute = nowTitleRoute;
});

window.addEventListener("pageshow", () => {
  if (!isTitleRoute()) restoreActiveFeedScroll();
});

window.addEventListener("pagehide", () => saveActiveFeedScroll(isTitleRoute()));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveActiveFeedScroll(isTitleRoute());
});

try {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
} catch {
  // Some embedded browsers can reject scrollRestoration updates.
}

if (isHomeRoute()) restoreActiveFeedScroll();
