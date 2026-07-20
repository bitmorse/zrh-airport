import type { GeoFix } from "../hooks/useGeoWatch";
import type { NoiseRecorder as Recorder, Recording } from "../hooks/useNoiseRecorder";
import { Modal } from "./Modal";
import { NoiseRecorder } from "./NoiseRecorder";

/** The microphone controls + level meter in their own modal (opened from the header). */
export function RecorderModal({
  recorder,
  activeCallsign,
  position,
  onManualStop,
  onClose,
}: {
  recorder: Recorder;
  activeCallsign: string | null;
  position: GeoFix | null;
  onManualStop: (rec: Recording) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Microphone" onClose={onClose} maxWidth="max-w-sm">
      <NoiseRecorder
        recorder={recorder}
        activeCallsign={activeCallsign}
        position={position}
        onManualStop={onManualStop}
      />
    </Modal>
  );
}
