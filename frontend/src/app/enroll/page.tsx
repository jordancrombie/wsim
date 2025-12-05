"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface Bank {
  bsimId: string;
  name: string;
  logoUrl?: string;
}

function EnrollContent() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    fetchBanks();
  }, []);

  async function fetchBanks() {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/enrollment/banks`
      );

      if (!res.ok) {
        throw new Error("Failed to fetch banks");
      }

      const data = await res.json();
      setBanks(data.banks);
    } catch (err) {
      console.error("Failed to fetch banks:", err);
    } finally {
      setLoading(false);
    }
  }

  async function enrollWithBank(bsimId: string) {
    setEnrolling(bsimId);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/enrollment/start/${bsimId}`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await res.json();

      if (data.authUrl) {
        // Redirect to bank's authorization page
        window.location.href = data.authUrl;
      } else if (data.error === "not_available") {
        alert(data.message);
        setEnrolling(null);
      } else {
        throw new Error(data.message || "Enrollment failed");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start enrollment");
      setEnrolling(null);
    }
  }

  function getErrorMessage(errorCode: string): string {
    switch (errorCode) {
      case "invalid_state":
        return "Session expired. Please try again.";
      case "enrollment_failed":
        return "Failed to connect to bank. Please try again.";
      case "access_denied":
        return "You cancelled the enrollment.";
      case "not_implemented":
        return "Bank enrollment is not yet available.";
      default:
        return errorCode;
    }
  }

  return (
    <>
      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6">
            {getErrorMessage(error)}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-gray-600 mb-6">
            Select a bank to connect. You&apos;ll be redirected to your bank to
            authorize access to your card information.
          </p>

          {loading ? (
            <div className="text-center py-8 text-gray-500">
              Loading available banks...
            </div>
          ) : banks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">
                No banks are currently configured.
              </p>
              <p className="text-sm text-gray-400">
                Bank integration requires BSIM configuration. Check the backend
                BSIM_PROVIDERS environment variable.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {banks.map((bank) => (
                <button
                  key={bank.bsimId}
                  onClick={() => enrollWithBank(bank.bsimId)}
                  disabled={enrolling !== null}
                  className={`w-full p-4 border-2 rounded-xl text-left transition-all flex items-center gap-4 ${
                    enrolling === bank.bsimId
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-indigo-500 hover:bg-indigo-50"
                  } ${enrolling !== null && enrolling !== bank.bsimId ? "opacity-50" : ""}`}
                >
                  <div className="text-3xl">🏦</div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-800">
                      {bank.name}
                    </div>
                    <div className="text-sm text-gray-500">{bank.bsimId}</div>
                  </div>
                  {enrolling === bank.bsimId && (
                    <div className="text-indigo-600">Connecting...</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-indigo-50 rounded-xl">
          <h3 className="font-semibold text-indigo-800 mb-2">
            How it works
          </h3>
          <ol className="text-sm text-indigo-700 space-y-2">
            <li>1. Select your bank from the list above</li>
            <li>2. Sign in to your bank account</li>
            <li>3. Authorize WSIM to access your card information</li>
            <li>4. Your cards will be imported to your wallet</li>
          </ol>
        </div>
      </main>
    </>
  );
}

export default function EnrollPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <Link href="/wallet" className="text-indigo-100 hover:text-white text-sm mb-2 inline-block">
            &larr; Back to Wallet
          </Link>
          <h1 className="text-2xl font-bold">Add a Bank</h1>
          <p className="text-indigo-100 text-sm">
            Connect your bank to import your cards
          </p>
        </div>
      </header>

      <Suspense fallback={
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="text-center py-8 text-gray-500">
              Loading...
            </div>
          </div>
        </main>
      }>
        <EnrollContent />
      </Suspense>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex justify-around">
          <Link
            href="/wallet"
            className="flex flex-col items-center text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">💳</span>
            <span className="text-xs">Wallet</span>
          </Link>
          <Link
            href="/enroll"
            className="flex flex-col items-center text-indigo-600"
          >
            <span className="text-xl">🏦</span>
            <span className="text-xs">Banks</span>
          </Link>
          <Link
            href="/profile"
            className="flex flex-col items-center text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">👤</span>
            <span className="text-xs">Profile</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
