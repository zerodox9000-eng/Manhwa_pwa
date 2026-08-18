import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode, type SyntheticEvent } from "react";

const COVER_CACHE_NAME = "manhwa-covers";
const RETRY_DELAYS_MS = [250, 800] as const;
const COVER_RESPONSE_TIMEOUT_MS = 4000;
const coverResponseCache = new Map<string, Promise<boolean>>();

type ResilientCoverImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fallback?: ReactNode;
  onPermanentError?: () => void;
};

export function coverRetryUrl(src: string, token: string) {
  const url = new URL(src, window.location.href);
  url.searchParams.set("aeonCoverRetry", token);
  return url.href;
}

export async function evictFailedCover(src: string) {
  if (!("caches" in globalThis)) return;
  try {
    const cache = await globalThis.caches.open(COVER_CACHE_NAME);
    await cache.delete(src, { ignoreSearch: true });
  } catch {
    // A cache cleanup failure must never prevent the network retry.
  }
}

export function checkCoverResponse(src: string) {
  const cached = coverResponseCache.get(src);
  if (cached) return cached;

  const result = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    const timer = globalThis.setTimeout(() => finish(true), COVER_RESPONSE_TIMEOUT_MS);
    void fetch(src, { cache: "force-cache", credentials: "omit", mode: "cors" })
      .then((response) => {
        globalThis.clearTimeout(timer);
        void response.body?.cancel();
        finish(response.ok);
      })
      .catch(() => {
        globalThis.clearTimeout(timer);
        // A blocked or offline validation request must not hide a real cover.
        finish(true);
      });
  });
  coverResponseCache.set(src, result);
  if (coverResponseCache.size > 256) {
    const oldest = coverResponseCache.keys().next().value;
    if (oldest) coverResponseCache.delete(oldest);
  }
  return result;
}

export function ResilientCoverImage({ src, fallback = null, onPermanentError, onError, onLoad, ...imageProps }: ResilientCoverImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [failed, setFailed] = useState(false);
  const attemptsRef = useRef(0);
  const retryPendingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    attemptsRef.current = 0;
    retryPendingRef.current = false;
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    setCurrentSrc(src);
    setFailed(false);
    return () => {
      generationRef.current += 1;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      retryPendingRef.current = false;
    };
  }, [src]);

  const retry = useCallback(() => {
    if (retryPendingRef.current) return;
    const nextAttempt = attemptsRef.current + 1;
    if (nextAttempt > RETRY_DELAYS_MS.length) {
      onPermanentError?.();
      setFailed(true);
      return;
    }

    attemptsRef.current = nextAttempt;
    retryPendingRef.current = true;
    const generation = generationRef.current;
    const token = `${Date.now().toString(36)}-${nextAttempt}`;
    void evictFailedCover(src);
    retryTimerRef.current = window.setTimeout(() => {
      if (generationRef.current !== generation) return;
      retryTimerRef.current = null;
      retryPendingRef.current = false;
      setFailed(false);
      setCurrentSrc(coverRetryUrl(src, token));
    }, RETRY_DELAYS_MS[nextAttempt - 1]);
  }, [onPermanentError, src]);

  useEffect(() => {
    if (!failed) return;
    const retryAfterReconnect = () => {
      attemptsRef.current = 0;
      retry();
    };
    window.addEventListener("online", retryAfterReconnect, { once: true });
    return () => window.removeEventListener("online", retryAfterReconnect);
  }, [failed, retry]);

  if (!src || failed) return fallback;

  return (
    <img
      {...imageProps}
      src={currentSrc}
      onError={(event: SyntheticEvent<HTMLImageElement>) => {
        onError?.(event);
        retry();
      }}
      onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
        onLoad?.(event);
      }}
    />
  );
}
