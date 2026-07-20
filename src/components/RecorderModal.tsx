import type { GeoFix } from "../hooks/useGeoWatch";
import type { NoiseRecorder as Recorder, Recording } from "../hooks/useNoiseRecorder";
import { Modal } from "./Modal";
import { NoiseRecorder, type RecorderCandidate } from "./NoiseRecorder";

/** The microphone controls + level meter in their own modal (opened from the header). */
export function RecorderModal({
  recorder,
  primaryCallsign,
  candidates,
  primaryHex,
  onPickPrimary,
  position,
  onManualStop,
  onClose,
}: {
  recorder: Recorder;
  /** Callsign of the aircraft the clip is currently attributed to (nearest, or the pick). */
  primaryCallsign: string | null;
  /** Nearby aircraft, nearest-first, with live distance to the observer. */
  candidates: RecorderCandidate[];
  /** Hex of the current primary (highlighted; may be the user's pick). */
  primaryHex: string | null;
  onPickPrimary: (hex: string) => void;
  position: GeoFix | null;
  onManualStop: (rec: Recording) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Microphone" onClose={onClose} maxWidth="max-w-sm">
      <NoiseRecorder
        recorder={recorder}
        primaryCallsign={primaryCallsign}
        candidates={candidates}
        primaryHex={primaryHex}
        onPickPrimary={onPickPrimary}
        position={position}
        onManualStop={onManualStop}
      />
    </Modal>
  );
}
