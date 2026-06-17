const FEED_SCROLL_SESSION_KEY = "manhwa-library-feed-scroll-v1";
const LAST_FEED_SESSION_KEY = "manhwa-library-last-feed-v1";
const RETURN_FEED_SCROLL_SESSION_KEY = "manhwa-library-return-feed-scroll-v1";

type ReturnScrollTarget = {
  feedId: string;
  y: number;
  expiresAt: number;
};

let restoreProtectionUntil = 0;
let storageGuardInstalled = false;

function installFeedSpacingOverride() {
  if (document.getElementById("feed-spacing-regression-fix")) return;

  const style = document.createElement("style");
  style.id = "feed-spacing-regression-fix";
  style.textContent = `
    .home-page > .feed-tabs {
      margin-bottom: 0 !important;
    }

    .feed-pager-panel {
      padding-top: 0 !important;
    }

    .feed-pager-panel > .section:first-child {
      margin-top: 6px !important;
      margin-bottom: 10px !important;
    }

    .feed-pager-panel > .section:first-child .feed-action-row {
      margin-bottom: 0 !important;
    }

    .feed-pager-panel .feed-view-header {
      margin-top: 0 !important;
    }

    .feed-pager-panel .single-line-title {
      margin-top: 0 !important;
    }

    .feed-pager-panel .virtual-title-grid {
      margin-top: 4px !important;
    }
  `;
  document.head.appendChild(style);
}

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

function isTitleRoute() {
  return window.location.hash.startsWith("#/title/");
}

function isHomeRoute() {
  return window.location.hash === "" || window.location.hash === "#/";
}

function shouldProtectReturnTarget(target = readReturnScrollTarget()) {
  return Boolean(target && (isTitleRoute() || performance.now() < restoreProtectionUntil));
}

function guardedFeedScrollValue(value: string) {
  const target = readReturnScrollTarget();
  if (!target || !shouldProtectReturnTarget(target)) return value;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const savedValue = parsed[target.feedId];
    const incoming = typeof savedValue === "number" && Number.isFinite(savedValue) ? savedValue : 0;

    if (incoming < target.y) {
      parsed[target.feedId] = target.y;
      return JSON.stringify(parsed);
    }
  } catch {
    return value;
  }

  return value;
}

function installSessionStorageGuard() {
  if (storageGuardInstalled) return;
  storageGuardInstalled = true;

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patchedSetItem(key: string, value: string) {
    const guardedValue = this === sessionStorage && key === FEED_SCROLL_SESSION_KEY ? guardedFeedScrollValue(value) : value;
    return originalSetItem.call(this, key, guardedValue);
  };
}

function getActiveFeedPanel() {
  return document.querySelector<HTMLElement>(".feed-pager-panel[data-feed-id]:not(.inactive-panel)");
}

function getPanelFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return getActiveFeedPanel();
  return target.closest<HTMLElement>(".feed-pager-panel[data-feed-id]") ?? getActiveFeedPanel();
}

function parseTranslateY(transform: string) {
  const translateMatch = transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
  if (translateMatch) return Number(translateMatch[1]);

  const matrixMatch = transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*(-?\d+(?:\.\d+)?)\)/);
  if (matrixMatch) return Number(matrixMatch[1]);

  return 0;
}

function getClickedCardScrollTarget(panel: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return panel.scrollTop;

  const titleCard = target.closest<HTMLElement>(".title-card");
  const row = target.closest<HTMLElement>(".virtual-title-row");
  const panelRect = panel.getBoundingClientRect();
  const titleCardRect = titleCard?.getBoundingClientRect();
  const rowY = row ? parseTranslateY(row.style.transform) : 0;

  const directPanelY = panel.scrollTop;
  const cardPanelY = titleCardRect ? directPanelY + titleCardRect.top - panelRect.top - 90 : 0;
  const rowPanelY = rowY > 0 ? rowY - 110 : 0;

  // Keep the largest reliable candidate. The old regression path saved 0 during unmount;
  // the clicked card/row position survives that and gives us a real target to restore.
  return Math.max(directPanelY, cardPanelY, rowPanelY, 0);
}

function saveActiveFeedScroll(asReturnTarget = false, sourceTarget: EventTarget | null = null) {
  const panel = getPanelFromTarget(sourceTarget);
  const feedId = panel?.dataset.feedId;
  if (!panel || !feedId || feedId === "blank") return;

  const y = asReturnTarget ? getClickedCardScrollTarget(panel, sourceTarget) : panel.scrollTop;
  writeFeedScrollPosition(feedId, y);
  if (asReturnTarget) {
    writeReturnScrollTarget(feedId, y);
    restoreProtectionUntil = Math.max(restoreProtectionUntil, performance.now() + 10_000);
  }
}

function getRestoreYForPanel(panel: HTMLElement) {
  const feedId = panel.dataset.feedId;
  const returnTarget = readReturnScrollTarget();

  if (returnTarget && shouldProtectReturnTarget(returnTarget) && (!feedId || returnTarget.feedId === feedId)) {
    return returnTarget.y;
  }

  const positions = readFeedScrollPositions();
  if (feedId && typeof positions[feedId] === "number") return positions[feedId];

  const lastFeedId = sessionStorage.getItem(LAST_FEED_SESSION_KEY);
  return lastFeedId ? positions[lastFeedId] ?? 0 : 0;
}

function restoreActiveFeedScroll(deadline = performance.now() + 4500) {
  restoreProtectionUntil = Math.max(restoreProtectionUntil, deadline);

  const attempt = () => {
    const panel = getActiveFeedPanel();
    const y = panel ? getRestoreYForPanel(panel) : 0;

    if (panel && y > 0) {
      panel.scrollTop = y;
      panel.scrollTo({ top: y, left: 0, behavior: "auto" });

      const feedId = panel.dataset.feedId;
      if (feedId && feedId !== "blank") writeFeedScrollPosition(feedId, y);
    }

    if (performance.now() < deadline) requestAnimationFrame(attempt);
  };

  requestAnimationFrame(attempt);
}

function isTitleLink(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const link = target.closest<HTMLAnchorElement>("a[href], .title-card");
  if (link instanceof HTMLAnchorElement) return Boolean(link.getAttribute("href")?.includes("/title/"));
  return Boolean(target.closest(".title-card"));
}

function saveBeforeTitleNavigation(event: Event) {
  if (isTitleLink(event.target)) saveActiveFeedScroll(true, event.target);
}

installFeedSpacingOverride();
installSessionStorageGuard();

let lastHash = window.location.hash;
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

    const target = readReturnScrollTarget();
    const protectingTarget = target && target.feedId === feedId && shouldProtectReturnTarget(target) && target.y > panel.scrollTop;
    if (!protectingTarget) writeFeedScrollPosition(feedId, panel.scrollTop);
  },
  { capture: true, passive: true },
);

function handleRouteMaybeChanged() {
  const currentHash = window.location.hash;
  if (currentHash === lastHash) return;

  const nowTitleRoute = isTitleRoute();
  if (lastWasTitleRoute && !nowTitleRoute) restoreActiveFeedScroll();
  lastWasTitleRoute = nowTitleRoute;
  lastHash = currentHash;
}

window.addEventListener("hashchange", handleRouteMaybeChanged);
window.addEventListener("popstate", () => {
  handleRouteMaybeChanged();
  if (!isTitleRoute()) restoreActiveFeedScroll();
});

window.addEventListener("pageshow", () => {
  if (!isTitleRoute()) restoreActiveFeedScroll();
});

window.addEventListener("pagehide", () => saveActiveFeedScroll(isTitleRoute()));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveActiveFeedScroll(isTitleRoute());
});

window.setInterval(() => {
  handleRouteMaybeChanged();
  if (isHomeRoute() && shouldProtectReturnTarget()) restoreActiveFeedScroll(performance.now() + 800);
}, 250);

try {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
} catch {
  // Some embedded browsers can reject scrollRestoration updates.
}

if (isHomeRoute()) restoreActiveFeedScroll();
