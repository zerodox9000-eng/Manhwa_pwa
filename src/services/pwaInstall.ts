import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let promptEvent: InstallPrompt | null = null;
let installed = false;
let initialized = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function initializePwaInstall() {
  if (initialized) return;
  initialized = true;
  const standalone = window.matchMedia("(display-mode: standalone)");
  installed = standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    promptEvent = event as InstallPrompt;
    emit();
  });
  window.addEventListener("appinstalled", () => { installed = true; promptEvent = null; emit(); });
  standalone.addEventListener("change", event => { installed = event.matches; emit(); });
}

export function usePwaInstall() {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => installed ? "installed" : promptEvent ? "available" : "manual");
}

export async function requestPwaInstall() {
  const event = promptEvent;
  if (!event) return "manual";
  promptEvent = null;
  emit();
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "manual";
  }
}

export function pwaInstallInstructions() {
  if (!window.isSecureContext) return "This local Wi-Fi preview can be viewed normally, but app installation needs the live HTTPS site. On the live site, use Install Aeon here or your browser's Install app / Add to Home screen option.";
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return "Open Aeon in Safari, tap Share, then Add to Home Screen.";
  return "Open your browser menu and choose Install app or Add to Home screen. If that option isn't available, try Chrome, Edge, or Safari.";
}
