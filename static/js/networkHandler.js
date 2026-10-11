import { selectNetworkDialogue } from "./dialogues.js";

// Call once after the UI is ready. The callbacks keep profile/settings/TTS
// ownership in app.js and make this module easy to reuse or test.
export function setupNetworkHandler({
  getUserName,
  getVoiceGender,
  onDialogue,
  onStatusChange = () => {},
}) {
  const handleOffline = () => {
    onStatusChange("offline");
    const userName = getUserName()?.trim() || "Sadashiv";
    const text = selectNetworkDialogue("offline", userName, getVoiceGender());
    onDialogue({ type: "offline", text, language: "hi-IN" });
  };

  const handleOnline = () => {
    onStatusChange("online");
    const userName = getUserName()?.trim() || "Sadashiv";
    const text = selectNetworkDialogue("online", userName, getVoiceGender());
    onDialogue({ type: "online", text, language: "hi-IN" });
  };

  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);
  onStatusChange(navigator.onLine ? "online" : "offline");

  return () => {
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("online", handleOnline);
  };
}
