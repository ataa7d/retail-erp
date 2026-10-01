// Stubbed until a provider (WhatsApp Cloud API, Twilio, ...) is chosen --
// same send() shape every real sender uses, so wiring one in later
// doesn't touch any call site, only this file.
export async function sendWhatsapp(to: string, message: string): Promise<void> {
  console.log(`[notifications] WhatsApp channel not configured, skipping send to ${to}: ${message}`);
}
