'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface PaymentRequest {
  id: string;
  merchantName: string;
  merchantLogoUrl: string | null;
  amount: number;
  currency: string;
  orderDescription: string | null;
  status: 'pending' | 'approved' | 'completed' | 'cancelled' | 'expired';
  expiresAt: string;
}

type PageState = 'loading' | 'mobile' | 'desktop' | 'expired' | 'not_found' | 'error' | 'already_used';

export default function PaymentQRLandingPage() {
  const params = useParams();
  const requestId = params.requestId as string;

  const [pageState, setPageState] = useState<PageState>('loading');
  const [payment, setPayment] = useState<PaymentRequest | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Detect if user is on mobile device
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as unknown as { opera?: string }).opera || '';
      const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
      return mobileRegex.test(userAgent.toLowerCase());
    };

    setIsMobile(checkMobile());

    // Fetch payment request details
    const fetchPaymentDetails = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3003';
        const response = await fetch(`${apiUrl}/api/mobile/payment/${requestId}/public`);

        if (response.status === 404) {
          setPageState('not_found');
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch payment details');
        }

        const data = await response.json();
        setPayment(data);

        // Check payment status
        if (data.status === 'expired' || new Date(data.expiresAt) < new Date()) {
          setPageState('expired');
        } else if (data.status === 'approved' || data.status === 'completed') {
          setPageState('already_used');
        } else if (data.status === 'cancelled') {
          setPageState('expired'); // Treat cancelled as expired for UX
        } else {
          // Valid pending payment
          setPageState(checkMobile() ? 'mobile' : 'desktop');
        }
      } catch (err) {
        console.error('Error fetching payment:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPageState('error');
      }
    };

    fetchPaymentDetails();
  }, [requestId]);

  // On mobile, attempt to open the app
  useEffect(() => {
    if (pageState === 'mobile' && payment) {
      // Try to open mwsim app via deep link
      const deepLink = `mwsim://payment/${requestId}`;

      // Attempt to open the app
      window.location.href = deepLink;

      // If app doesn't open within 2 seconds, user probably doesn't have it
      // The page will remain visible as a fallback
    }
  }, [pageState, payment, requestId]);

  const qrCodeUrl = typeof window !== 'undefined' ? window.location.href : '';

  // Loading state
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading payment details...</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (pageState === 'not_found') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Not Found</h1>
          <p className="text-gray-600">
            This payment request doesn&apos;t exist or the link is invalid.
          </p>
        </div>
      </div>
    );
  }

  // Expired state
  if (pageState === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">⏰</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Expired</h1>
          <p className="text-gray-600 mb-4">
            This payment request has expired. Please return to the merchant and try again.
          </p>
          {payment && (
            <p className="text-sm text-gray-500">
              Merchant: {payment.merchantName}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Already used state
  if (pageState === 'already_used') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Already Processed</h1>
          <p className="text-gray-600">
            This payment has already been approved or completed.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">❌</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Something Went Wrong</h1>
          <p className="text-gray-600 mb-4">
            {error || 'Unable to load payment details. Please try again.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Mobile state - show download prompt (app open was attempted via useEffect)
  if (pageState === 'mobile') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">📱</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Open in mwsim</h1>

          {payment && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Payment to</p>
              <p className="font-semibold text-gray-900">{payment.merchantName}</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                ${payment.amount.toFixed(2)} {payment.currency}
              </p>
            </div>
          )}

          <p className="text-gray-600 mb-6">
            If the app didn&apos;t open automatically, tap the button below.
          </p>

          <a
            href={`mwsim://payment/${requestId}`}
            className="block w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 mb-4"
          >
            Open mwsim App
          </a>

          <div className="border-t pt-4 mt-4">
            <p className="text-sm text-gray-500 mb-3">Don&apos;t have mwsim?</p>
            <div className="flex gap-2 justify-center">
              <a
                href="https://apps.apple.com/app/mwsim" // TODO: Replace with actual App Store link
                className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800"
              >
                App Store
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.banksim.wsim" // TODO: Replace with actual Play Store link
                className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800"
              >
                Google Play
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Desktop state - show QR code
  if (pageState === 'desktop') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Scan to Pay</h1>

          {payment && (
            <div className="mb-6">
              <p className="text-gray-500">Pay {payment.merchantName}</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                ${payment.amount.toFixed(2)} {payment.currency}
              </p>
              {payment.orderDescription && (
                <p className="text-sm text-gray-500 mt-1">{payment.orderDescription}</p>
              )}
            </div>
          )}

          <div className="bg-white p-4 rounded-lg border-2 border-gray-200 inline-block mb-4">
            {/* QR Code - using a simple placeholder, real implementation would use qrcode library */}
            <div className="w-48 h-48 bg-gray-100 flex items-center justify-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(qrCodeUrl)}`}
                alt="Payment QR Code"
                className="w-48 h-48"
              />
            </div>
          </div>

          <p className="text-gray-600 mb-4">
            Scan this QR code with your phone&apos;s camera or the mwsim app
          </p>

          <div className="text-sm text-gray-500">
            <p>💡 Tip: Make sure you have mwsim installed on your phone</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
