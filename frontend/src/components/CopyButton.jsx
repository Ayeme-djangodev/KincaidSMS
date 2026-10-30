import { useState } from "react";

// Small "Copy" button used wherever a number or code is shown. Falls back
// quietly if the browser blocks clipboard access (the text is still on
// screen to select by hand).
export default function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; nothing else to do.
    }
  }

  return (
    <button type="button" className="copy-btn" onClick={copy} aria-label={label}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
