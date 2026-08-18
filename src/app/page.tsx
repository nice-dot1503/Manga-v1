import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic"; // always show latest manga, not a stale build-time snapshot

interface MangaListItem {
  id: string;
  slug: string;
  title: string;
  status: string;
  viewCount: number;
}

export default async function HomePage() {
  const mangaList: MangaListItem[] = await prisma.manga
    .findMany({
      where: { isPublished: true },
      orderBy: { updatedAt: "desc" },
      take: 24,
      select: { id: true, slug: true, title: true, status: true, viewCount: true },
    })
    .catch(() => []); // DB may not be migrated yet in a fresh checkout — degrade gracefully

  return (
    <main>
      <nav className="navbar px-4 md:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg accent-gradient flex items-center justify-center text-white font-bold text-sm">
            M
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Manga<span className="accent-gradient-text">Verse</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm text-gray-400">
          <Link href="/" className="hover:text-white transition">
            Home
          </Link>
          <Link href="/admin/login" className="hover:text-white transition">
            Admin
          </Link>
        </div>
      </nav>

      <section className="px-4 md:px-8 py-8 max-w-7xl mx-auto">
        <h3 className="text-lg font-semibold mb-4">Latest Manga</h3>

        {mangaList.length === 0 ? (
          <div className="glass-card rounded-xl border border-white/5 p-10 text-center text-gray-500">
            <p>No manga published yet.</p>
            <p className="text-sm mt-1">
              Sign in as{" "}
              <Link href="/admin/login" className="text-purple-400 hover:text-purple-300">
                admin
              </Link>{" "}
              to add your first title.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {mangaList.map((manga: MangaListItem) => (
              <Link
                key={manga.id}
                href={`/manga/${manga.slug}`}
                className="manga-card group relative glass-card rounded-xl overflow-hidden block"
              >
                <div className="relative aspect-[2/3] bg-[#14141e] flex items-center justify-center text-4xl opacity-20">
                  <i className="fas fa-image" />
                </div>
                <div className="p-3">
                  <h4 className="font-medium text-sm truncate">{manga.title}</h4>
                  <span className={`status-badge ${manga.status === "ONGOING" ? "ongoing" : "draft"} mt-1 inline-block`}>
                    {manga.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
