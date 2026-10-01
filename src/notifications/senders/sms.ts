// Stubbed until a provider (Twilio, Unifonic, ...) is chosen -- same
// send() shape every real sender uses, so wiring one in later doesn't
// touch any call site, only this file.
export async function sendSms(to: string, message: string): Promise<void> {
  console.log(`[notifications] SMS channel not configured, skipping send to ${to}: ${message}`);
}
