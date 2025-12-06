"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/wallet";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    // Check if WebAuthn is available
    if (window.PublicKeyCredential) {
      setPasskeyAvailable(true);
    }
  }, []);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Invalid credentials");
      }

      // Login successful - redirect
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    setPasskeyLoading(true);
    setError(null);

    try {
      // Load SimpleWebAuthn browser dynamically
      const { startAuthentication } = await import("@simplewebauthn/browser");

      // Get authentication options from backend
      const optionsRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/passkey/authenticate/options`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}), // Empty body for discoverable credentials
        }
      );

      if (!optionsRes.ok) {
        throw new Error("Failed to get passkey options");
      }

      const options = await optionsRes.json();
      const tempKey = options._tempKey;

      // Start passkey authentication
      const credential = await startAuthentication({ optionsJSON: options });

      // Verify with backend
      const verifyRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/passkey/authenticate/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            response: credential,
            _tempKey: tempKey,
          }),
        }
      );

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || "Passkey verification failed");
      }

      // Login successful - redirect
      router.push(redirect);
    } catch (err) {
      // Handle user cancellation gracefully
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey authentication was cancelled");
      } else {
        setError(err instanceof Error ? err.message : "Passkey login failed");
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  return (
    <main className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
      <div className="text-center mb-8">
        <div className="text-6xl mb-4">&#x1F4B3;</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          Sign in to WSIM
        </h1>
        <p className="text-gray-600 text-sm">
          Access your digital wallet
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Passkey Login Button */}
      {passkeyAvailable && (
        <>
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={passkeyLoading}
            className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {passkeyLoading ? (
              <>
                <span className="animate-spin">&#8987;</span>
                Authenticating...
              </>
            ) : (
              <>
                <span>&#128274;</span>
                Sign in with Passkey
              </>
            )}
          </button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-500">or</span>
            </div>
          </div>
        </>
      )}

      {/* Email/Password Login Form */}
      <form onSubmit={handlePasswordLogin} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-gray-900 bg-white"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Password
          </label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Enter your password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-gray-900 bg-white"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-gray-800 text-white font-semibold rounded-lg hover:bg-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in..." : "Sign in with Password"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-gray-600 text-sm">
          Don&apos;t have a wallet?{" "}
          <Link
            href="/enroll"
            className="text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Enroll now
          </Link>
        </p>
      </div>

      <div className="mt-4 text-center">
        <Link
          href="/"
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          &larr; Back to home
        </Link>
      </div>
    </main>
  );
}

function LoginLoading() {
  return (
    <main className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
      <div className="text-center">
        <div className="text-6xl mb-4">&#x1F4B3;</div>
        <div className="text-gray-500">Loading...</div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center p-4">
      <Suspense fallback={<LoginLoading />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
