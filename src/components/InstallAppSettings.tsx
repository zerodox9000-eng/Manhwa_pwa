import { Download } from "lucide-react";
import { useState } from "react";
import { pwaInstallInstructions, requestPwaInstall, usePwaInstall } from "../services/pwaInstall";

export function InstallAppSettings() {
  const availability = usePwaInstall();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="setting-row">
        <div><strong>Use Aeon as an app</strong><div className="muted tiny">Add Aeon to your home screen. No app store download needed.</div></div>
        <button className="button" type="button" disabled={availability === "installed" || busy} onClick={async () => {
          setBusy(true);
          const result = await requestPwaInstall();
          setBusy(false);
          setMessage(result === "manual" ? pwaInstallInstructions() : result === "accepted" ? "Installation requested. Your browser will finish adding Aeon." : "Installation cancelled. You can try again from your browser menu.");
        }}><Download size={16} /> {availability === "installed" ? "Installed" : "Install Aeon"}</button>
      </div>
      {message ? <div className="settings-status" role="status">{message}</div> : null}
    </>
  );
}
