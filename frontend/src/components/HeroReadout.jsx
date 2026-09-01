import { useEffect, useState } from "react";

const DEMO_SEQUENCE = [
  { service: "Signal", number: "+1 (628) 401-7734", from: "Signal", code: "482 910" },
  { service: "Discord", number: "+44 7700 900123", from: "Discord", code: "091 335" },
  { service: "Uber", number: "+1 (415) 552-0199", from: "Uber", code: "664 208" },
];

const WAIT_MS = 1600;
const SHOW_MS = 2600;

export default function HeroReadout() {
  const [index, setIndex] = useState(0);
  const [received, setReceived] = useState(false);

  useEffect(() => {
    setReceived(false);
    const waitTimer = setTimeout(() => setReceived(true), WAIT_MS);
    const nextTimer = setTimeout(() => {
      setIndex((i) => (i + 1) % DEMO_SEQUENCE.length);
    }, WAIT_MS + SHOW_MS);
    return () => {
      clearTimeout(waitTimer);
      clearTimeout(nextTimer);
    };
  }, [index]);

  const current = DEMO_SEQUENCE[index];

  return (
    <div className="readout" aria-hidden="true">
      <div className="readout-top">
        <span className="readout-service">
          <IconDot /> {current.service}
        </span>
        <span className={`readout-status ${received ? "received" : ""}`}>
          <span className="pulse" />
          {received ? "code received" : "waiting for sms"}
        </span>
      </div>
      <div className="readout-number mono">{current.number}</div>
      <div className="readout-msg">
        {received ? (
          <>
            <div className="from">from {current.from}</div>
            <div key={index} className="code mono">
              {current.code}
            </div>
          </>
        ) : (
          <div className="waiting">listening on this line&hellip;</div>
        )}
      </div>
    </div>
  );
}

function IconDot() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" style={{ marginRight: 4 }}>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}
