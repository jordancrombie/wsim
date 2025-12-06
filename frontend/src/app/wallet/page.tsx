"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Card {
  id: string;
  cardType: string;
  lastFour: string;
  cardholderName: string;
  expiryMonth: number;
  expiryYear: number;
  bsimId: string;
  isDefault: boolean;
}

export default function WalletPage() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCards();
  }, []);

  async function fetchCards() {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/wallet/cards`,
        { credentials: "include" }
      );

      if (res.status === 401) {
        // Not authenticated - redirect to login
        router.push("/login?redirect=/wallet");
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to fetch cards");
      }

      const data = await res.json();
      setCards(data.cards);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cards");
    } finally {
      setLoading(false);
    }
  }

  async function setDefaultCard(cardId: string) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/wallet/cards/${cardId}/default`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      if (res.ok) {
        fetchCards();
      }
    } catch (err) {
      console.error("Failed to set default card:", err);
    }
  }

  async function removeCard(cardId: string) {
    if (!confirm("Remove this card from your wallet?")) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003"}/api/wallet/cards/${cardId}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (res.ok) {
        fetchCards();
      }
    } catch (err) {
      console.error("Failed to remove card:", err);
    }
  }

  function getCardIcon(cardType: string) {
    if (cardType.includes("VISA")) return "💳";
    if (cardType.includes("MC") || cardType.includes("MASTERCARD")) return "💳";
    if (cardType.includes("AMEX")) return "💳";
    return "💳";
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading wallet...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">My Wallet</h1>
              <p className="text-indigo-100 text-sm">
                Manage your payment cards
              </p>
            </div>
            <Link
              href="/enroll"
              className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Bank
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {cards.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <div className="text-6xl mb-4">💳</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">
              No cards yet
            </h2>
            <p className="text-gray-600 mb-6">
              Add a bank to import your payment cards into your wallet.
            </p>
            <Link
              href="/enroll"
              className="inline-block bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all"
            >
              Add Your First Bank
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {cards.map((card) => (
              <div
                key={card.id}
                className={`bg-white rounded-xl shadow-sm p-4 border-2 transition-all ${
                  card.isDefault
                    ? "border-indigo-500"
                    : "border-transparent hover:border-gray-200"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-3xl">{getCardIcon(card.cardType)}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">
                          {card.cardType}
                        </span>
                        <span className="font-mono text-gray-600">
                          ****{card.lastFour}
                        </span>
                        {card.isDefault && (
                          <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {card.cardholderName}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Expires {card.expiryMonth}/{card.expiryYear} &bull; via{" "}
                        {card.bsimId}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {!card.isDefault && (
                      <button
                        onClick={() => setDefaultCard(card.id)}
                        className="text-sm text-indigo-600 hover:text-indigo-800"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      onClick={() => removeCard(card.id)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex justify-around">
          <Link
            href="/wallet"
            className="flex flex-col items-center text-indigo-600"
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
