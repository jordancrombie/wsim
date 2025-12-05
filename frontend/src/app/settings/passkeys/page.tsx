"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

interface PasskeyCredential {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003";

export default function PasskeysPage() {
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/passkey/credentials`, {
        credentials: "include",
      });

      if (res.status === 401) {
        setCredentials([]);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to fetch credentials");
      }

      const data = await res.json();
      setCredentials(data.credentials || []);
    } catch (err) {
      console.error("Failed to fetch credentials:", err);
      setError("Failed to load passkeys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsSupported(browserSupportsWebAuthn());
    fetchCredentials();
  }, [fetchCredentials]);

  async function handleRegister() {
    setError(null);
    setSuccess(null);
    setRegistering(true);

    try {
      // Get registration options from server
      const optionsRes = await fetch(`${API_URL}/api/passkey/register/options`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!optionsRes.ok) {
        const errorData = await optionsRes.json();
        throw new Error(errorData.error || "Failed to get registration options");
      }

      const options = await optionsRes.json();

      // Start WebAuthn registration
      const credential = await startRegistration({ optionsJSON: options });

      // Get device name
      const deviceName = getDeviceName();

      // Verify with server
      const verifyRes = await fetch(`${API_URL}/api/passkey/register/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: credential, deviceName }),
      });

      if (!verifyRes.ok) {
        const errorData = await verifyRes.json();
        throw new Error(errorData.error || "Registration verification failed");
      }

      setSuccess("Passkey registered successfully!");
      fetchCredentials();
    } catch (err) {
      console.error("Registration error:", err);
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          setError("Registration was cancelled or timed out");
        } else {
          setError(err.message);
        }
      } else {
        setError("Failed to register passkey");
      }
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this passkey?")) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`${API_URL}/api/passkey/credentials/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete passkey");
      }

      setSuccess("Passkey deleted successfully");
      fetchCredentials();
    } catch (err) {
      console.error("Delete error:", err);
      setError(err instanceof Error ? err.message : "Failed to delete passkey");
    }
  }

  function getDeviceName(): string {
    const ua = navigator.userAgent;
    if (ua.includes("iPhone")) return "iPhone";
    if (ua.includes("iPad")) return "iPad";
    if (ua.includes("Mac")) return "Mac";
    if (ua.includes("Windows")) return "Windows PC";
    if (ua.includes("Android")) return "Android";
    if (ua.includes("Linux")) return "Linux";
    return "Unknown device";
  }

  function formatDate(dateString: string | null): string {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading passkeys...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <Link
            href="/profile"
            className="text-indigo-100 text-sm hover:text-white mb-2 inline-block"
          >
            &larr; Back to Profile
          </Link>
          <h1 className="text-2xl font-bold">Passkeys</h1>
          <p className="text-indigo-100 text-sm">
            Secure sign-in with Face ID, Touch ID, or Windows Hello
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* WebAuthn Support Check */}
        {!isSupported && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">&#9888;</span>
              <div>
                <h3 className="font-semibold text-yellow-800">
                  Passkeys not supported
                </h3>
                <p className="text-yellow-700 text-sm">
                  Your browser or device doesn&apos;t support passkeys. Try using a
                  modern browser like Chrome, Safari, or Edge.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Alerts */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-green-700">
            {success}
          </div>
        )}

        {/* Info Card */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-start gap-4">
            <div className="text-4xl">&#128274;</div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-2">
                What are passkeys?
              </h2>
              <p className="text-gray-600 text-sm">
                Passkeys are a more secure and convenient way to sign in. Instead
                of a password, you use Face ID, Touch ID, or your device PIN.
                Passkeys are phishing-resistant and unique to each site.
              </p>
            </div>
          </div>
        </div>

        {/* Register Button */}
        {isSupported && (
          <button
            onClick={handleRegister}
            disabled={registering}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-4 rounded-xl font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {registering ? (
              <>
                <span className="animate-spin">&#8987;</span>
                Registering...
              </>
            ) : (
              <>
                <span>&#43;</span>
                Add a Passkey
              </>
            )}
          </button>
        )}

        {/* Credentials List */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Your Passkeys</h2>
          </div>

          {credentials.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <div className="text-4xl mb-3">&#128275;</div>
              <p className="text-gray-500">
                No passkeys registered yet. Add one to enable secure sign-in.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {credentials.map((cred) => (
                <li
                  key={cred.id}
                  className="px-6 py-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="text-2xl">&#128273;</div>
                    <div>
                      <p className="font-medium text-gray-800">
                        {cred.deviceName || "Unknown device"}
                      </p>
                      <p className="text-sm text-gray-500">
                        Added {formatDate(cred.createdAt)}
                      </p>
                      {cred.lastUsedAt && (
                        <p className="text-xs text-gray-400">
                          Last used {formatDate(cred.lastUsedAt)}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(cred.id)}
                    className="text-red-500 hover:text-red-700 p-2"
                    title="Delete passkey"
                  >
                    &#128465;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex justify-around">
          <Link
            href="/wallet"
            className="flex flex-col items-center text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">&#128179;</span>
            <span className="text-xs">Wallet</span>
          </Link>
          <Link
            href="/enroll"
            className="flex flex-col items-center text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">&#127974;</span>
            <span className="text-xs">Banks</span>
          </Link>
          <Link
            href="/profile"
            className="flex flex-col items-center text-indigo-600"
          >
            <span className="text-xl">&#128100;</span>
            <span className="text-xs">Profile</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
