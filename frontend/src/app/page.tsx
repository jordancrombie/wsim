import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center p-4">
      <main className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">&#x1F4B3;</div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">WSIM</h1>
          <p className="text-gray-600">Wallet Simulator</p>
        </div>

        <p className="text-gray-600 text-center mb-8">
          Your centralized digital wallet for managing payment credentials
          across multiple banks.
        </p>

        <div className="space-y-4">
          <Link
            href="/wallet"
            className="block w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-center font-semibold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl"
          >
            Open Wallet
          </Link>

          <Link
            href="/enroll"
            className="block w-full py-3 px-4 bg-gray-100 text-gray-700 text-center font-semibold rounded-lg hover:bg-gray-200 transition-all"
          >
            Add a Bank
          </Link>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-400 text-center">
            Part of the payment simulation ecosystem
          </p>
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-500">
            <span>BSIM</span>
            <span>&bull;</span>
            <span>SSIM</span>
            <span>&bull;</span>
            <span>NSIM</span>
          </div>
        </div>
      </main>
    </div>
  );
}
