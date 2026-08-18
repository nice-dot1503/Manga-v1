"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }
      router.push("/admin/upload");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-9 h-9 rounded-lg accent-gradient flex items-center justify-center text-white font-bold text-sm">
            M
          </div>
          <span className="text-xl font-semibold tracking-tight">
            Manga<span className="accent-gradient-text">Verse</span>
          </span>
        </div>

        <div className="glass-card rounded-2xl border border-white/5 p-6">
          <h1 className="text-lg font-semibold mb-1">Admin sign in</h1>
          <p className="text-sm text-gray-500 mb-6">Enter the admin password to manage manga and uploads.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs text-gray-500 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="search-input pl-4"
                placeholder="••••••••••••"
              />
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || password.length === 0} className="btn-primary w-full disabled:opacity-50">
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-xs text-gray-600 text-center mt-6">
          Forgot the password? Regenerate it with{" "}
          <code className="text-gray-500">node scripts/hash-admin-password.mjs</code>
        </p>
      </div>
    </main>
  );
}
