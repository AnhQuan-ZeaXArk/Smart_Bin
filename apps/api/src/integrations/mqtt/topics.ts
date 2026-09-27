/**
 * SmartBin MQTT Topic Definitions & Helpers
 *
 * Naming Conventions:
 * - Direct IoT Device Heartbeat: smartbin/device/heartbeat
 * - Bin Compartment Telemetry:   smartbin/{binCode}/sensor/ultrasonic
 * - Bin Telemetry Alias:        smartbin/{binCode}/telemetry
 * - Bin Compartment Heartbeat:   smartbin/{binCode}/device/heartbeat
 * - Bin Compartment Status:      smartbin/{binCode}/status
 */
export const mqttTopics = {
  /** Telemetry channel alias for a bin compartment */
  telemetry: (binCode: string) => `smartbin/${binCode}/telemetry`,
  /** Ultrasonic distance & fill level measurements for a bin compartment */
  ultrasonic: (binCode: string) => `smartbin/${binCode}/sensor/ultrasonic`,
  /** Heartbeat for a specific bin compartment device */
  heartbeat: (binCode: string) => `smartbin/${binCode}/device/heartbeat`,
  /** System-wide broadcast/direct heartbeat for gateways (RPi 5, Camera AI) */
  systemHeartbeat: 'smartbin/device/heartbeat',
  /** Status changes for a bin compartment (ONLINE, OFFLINE, MAINTENANCE) */
  status: (binCode: string) => `smartbin/${binCode}/status`
} as const;

/**
 * Parses a SmartBin topic formatted as `smartbin/{binCode}/{channel}`.
 * Returns null if the topic does not match the pattern.
 */
export function parseSmartBinTopic(topic: string): { binCode: string; channel: string } | null {
  const match = /^smartbin\/([^/]+)\/(.+)$/.exec(topic);
  return match ? { binCode: match[1], channel: match[2] } : null;
}
