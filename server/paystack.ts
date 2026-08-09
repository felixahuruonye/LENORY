// Paystack payment integration for Nigerian market
// CRITICAL: User explicitly requested Paystack (NOT Stripe) for Nigerian market

if (!process.env.PAYSTACK_SECRET_KEY) {
  console.warn("PAYSTACK_SECRET_KEY not found. Payments will not work.");
}

const PAYSTACK_API_BASE = "https://api.paystack.co";

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: string;
    reference: string;
    amount: number;
    metadata: any;
    customer: {
      email: string;
    };
  };
}

export async function initializePayment(
  email: string,
  amount: number, // In kobo (smallest currency unit)
  reference: string,
  metadata?: any,
  // Previously hardcoded to /marketplace for every caller — correct for the
  // course-purchase flow (Marketplace.tsx has the matching verify logic
  // there) but wrong for subscription upgrades, which land on Pricing.tsx
  // instead. Callers now say where their user should land after checkout.
  callbackPath: string = "/marketplace?payment=success"
): Promise<PaystackInitializeResponse> {
  const response = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount, // Amount in kobo
      reference,
      metadata,
      callback_url: `${process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || process.env.REPLIT_DOMAINS?.split(",")[0] || "http://localhost:5000"}${callbackPath}`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Paystack API error: ${error}`);
  }

  return await response.json();
}

export async function verifyPayment(reference: string): Promise<PaystackVerifyResponse> {
  const response = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${reference}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Paystack verification error: ${error}`);
  }

  return await response.json();
}

export async function convertNairaToKobo(nairaAmount: number): Promise<number> {
  // 1 Naira = 100 Kobo
  return Math.round(nairaAmount * 100);
}
