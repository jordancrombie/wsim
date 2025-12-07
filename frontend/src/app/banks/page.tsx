"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Enrollment {
  id: string;
  bsimId: string;
  bankName: string;
  logoUrl?: string;
  cardCount: number;
  enrolledAt: string;
  credentialExpiry?: string;
}

export default function BanksPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEnrollments();
  }, []);

  async function fetchEnrollments() {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/enrollment/list`,
        { credentials: "include" }
      );

      if (res.status === 401) {
        window.location.href = "/login?redirect=/banks";
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to fetch enrollments");
      }

      const data = await res.json();
      setEnrollments(data.enrollments);
    } catch (err) {
      console.error("Failed to fetch enrollments:", err);
      setError("Failed to load connected banks");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(enrollmentId: string) {
    if (!confirm("Are you sure you want to disconnect this bank? All cards from this bank will be removed from your wallet.")) {
      return;
    }

    setRemoving(enrollmentId);
    setError(null);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/enrollment/${enrollmentId}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!res.ok) {
        throw new Error("Failed to disconnect bank");
      }

      // Remove from local state
      setEnrollments(enrollments.filter(e => e.id !== enrollmentId));
    } catch (err) {
      console.error("Failed to remove enrollment:", err);
      setError("Failed to disconnect bank. Please try again.");
    } finally {
      setRemoving(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading connected banks...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <Link href="/profile" className="text-indigo-100 hover:text-white text-sm mb-2 inline-block">
            &larr; Back to Profile
          </Link>
          <h1 className="text-2xl font-bold">Connected Banks</h1>
          <p className="text-indigo-100 text-sm">
            Manage your bank connections
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {enrollments.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <div className="text-6xl mb-4">🏦</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">
              No banks connected
            </h2>
            <p className="text-gray-600 mb-6">
              Connect a bank to import your cards into your wallet.
            </p>
            <Link
              href="/enroll"
              className="inline-block bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all"
            >
              Connect Your First Bank
            </Link>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100 mb-6">
              {enrollments.map((enrollment) => (
                <div key={enrollment.id} className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="text-3xl">🏦</div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-800">
                        {enrollment.bankName}
                      </div>
                      <div className="text-sm text-gray-500">
                        {enrollment.cardCount} card{enrollment.cardCount !== 1 ? "s" : ""} &bull; Connected {new Date(enrollment.enrolledAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(enrollment.id)}
                      disabled={removing !== null}
                      className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                        removing === enrollment.id
                          ? "bg-gray-100 text-gray-400"
                          : "text-red-600 hover:bg-red-50"
                      }`}
                    >
                      {removing === enrollment.id ? "Removing..." : "Disconnect"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/enroll"
              className="block w-full p-4 bg-white rounded-xl shadow-sm text-center text-indigo-600 font-semibold hover:bg-indigo-50 transition-colors"
            >
              + Connect Another Bank
            </Link>
          </>
        )}
      </main>

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
            href="/banks"
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
