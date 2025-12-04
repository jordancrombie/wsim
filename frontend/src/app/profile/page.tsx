"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Profile {
  id: string;
  walletId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  cardCount: number;
  enrollmentCount: number;
  createdAt: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/wallet/profile`,
        { credentials: "include" }
      );

      if (res.status === 401) {
        setProfile(null);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to fetch profile");
      }

      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/auth/logout`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      window.location.href = "/";
    } catch (err) {
      console.error("Logout failed:", err);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading profile...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <h1 className="text-2xl font-bold">Profile</h1>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <div className="text-6xl mb-4">👤</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">
              Not signed in
            </h2>
            <p className="text-gray-600 mb-6">
              Add a bank to create your wallet profile.
            </p>
            <Link
              href="/enroll"
              className="inline-block bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all"
            >
              Add Your First Bank
            </Link>
          </div>
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
              href="/enroll"
              className="flex flex-col items-center text-gray-400 hover:text-gray-600"
            >
              <span className="text-xl">🏦</span>
              <span className="text-xs">Banks</span>
            </Link>
            <Link
              href="/profile"
              className="flex flex-col items-center text-indigo-600"
            >
              <span className="text-xl">👤</span>
              <span className="text-xs">Profile</span>
            </Link>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="text-indigo-100 text-sm">Manage your wallet account</p>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* User Info */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
              {profile.firstName?.[0] || profile.email[0].toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-800">
                {profile.firstName && profile.lastName
                  ? `${profile.firstName} ${profile.lastName}`
                  : profile.email}
              </h2>
              <p className="text-gray-500">{profile.email}</p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Wallet ID</span>
                <p className="font-mono text-gray-800 truncate">
                  {profile.walletId}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Member since</span>
                <p className="text-gray-800">
                  {new Date(profile.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <div className="text-3xl font-bold text-indigo-600">
              {profile.cardCount}
            </div>
            <div className="text-gray-500 text-sm">Cards</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <div className="text-3xl font-bold text-purple-600">
              {profile.enrollmentCount}
            </div>
            <div className="text-gray-500 text-sm">Banks</div>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          <Link
            href="/wallet"
            className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">💳</span>
              <span className="text-gray-800">Manage Cards</span>
            </div>
            <span className="text-gray-400">&rarr;</span>
          </Link>
          <Link
            href="/enroll"
            className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🏦</span>
              <span className="text-gray-800">Connected Banks</span>
            </div>
            <span className="text-gray-400">&rarr;</span>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-between p-4 hover:bg-red-50 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🚪</span>
              <span className="text-red-600">Sign Out</span>
            </div>
          </button>
        </div>
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
            href="/enroll"
            className="flex flex-col items-center text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">🏦</span>
            <span className="text-xs">Banks</span>
          </Link>
          <Link
            href="/profile"
            className="flex flex-col items-center text-indigo-600"
          >
            <span className="text-xl">👤</span>
            <span className="text-xs">Profile</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
