import { useEffect, useRef } from 'react';
import './replay-tab.css';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

export default function ReplayTab({ accountId, active, onActivity }) {
  const frame = useRef(null);

  function initialize(event) {
    const terminal = event.currentTarget.contentWindow;
    for (const name of ACTIVITY_EVENTS) {
      terminal?.addEventListener(name, onActivity, { passive: true });
    }
    terminal?.postMessage({ type: 'pipstride:replay:init', accountId }, window.location.origin);
    terminal?.postMessage({ type: 'pipstride:replay:visibility', active }, window.location.origin);
  }

  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: 'pipstride:replay:visibility', active },
      window.location.origin,
    );
  }, [active]);

  return (
    <iframe
      ref={frame}
      className="replay-terminal-frame"
      src="/replay/terminal.html?v=2"
      title="XAUUSD Replay"
      allowFullScreen
      onLoad={initialize}
    />
  );
}
