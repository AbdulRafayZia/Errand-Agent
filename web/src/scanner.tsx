// In-app QR scanner. Needed because on iOS a Home Screen app has its own storage:
// pairing has to happen inside it, and the system camera would open Safari instead.

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "preact/hooks";

export function canScan(): boolean {
  return isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stream: MediaStream | undefined;
    let frame = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const tick = () => {
      const v = video.current;
      if (done || !v) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
        // Scan a downscaled frame: plenty for a QR on a laptop screen, and fast.
        const scale = Math.min(1, 640 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) {
          done = true;
          onResult(code.data);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        void video.current.play();
        frame = requestAnimationFrame(tick);
      })
      .catch(() => setError("Errand can't use the camera. Allow camera access for this app in Settings, or paste the link instead."));

    return () => {
      done = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div class="scanner">
      {error ? (
        <div class="banner banner-bad">{error}</div>
      ) : (
        <div class="scanner-view">
          <video ref={video} playsInline muted />
          <div class="scanner-frame" aria-hidden="true" />
          <span class="scanner-hint">Point at the QR code on your Mac</span>
        </div>
      )}
      <button class="btn btn-secondary" onClick={onClose}>Cancel</button>
    </div>
  );
}
