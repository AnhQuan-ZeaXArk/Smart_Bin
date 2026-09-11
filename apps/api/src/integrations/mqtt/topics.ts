export const mqttTopics = {
  telemetry: (binCode: string) => `smartbin/${binCode}/telemetry`,
  ultrasonic: (binCode: string) => `smartbin/${binCode}/sensor/ultrasonic`,
  nfcScan: (binCode: string) => `smartbin/${binCode}/nfc/scan`,
  nfcResult: (binCode: string) => `smartbin/${binCode}/nfc/result`,
  lockCommand: (binCode: string) => `smartbin/${binCode}/lock/command`,
  lockStatus: (binCode: string) => `smartbin/${binCode}/lock/status`,
  status: (binCode: string) => `smartbin/${binCode}/status`
};

export function parseSmartBinTopic(topic: string): { binCode: string; channel: string } | null {
  const match = /^smartbin\/([^/]+)\/(.+)$/.exec(topic);
  return match ? { binCode: match[1], channel: match[2] } : null;
}
