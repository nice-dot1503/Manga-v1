"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface MangaOption {
  id: string;
  title: string;
  slug: string;
}

interface PreviewReport {
  totalFiles: number;
  resolvedPageCount: number;
  missingPages: number[];
  duplicatePageNumbers: { pageNumber: number; filenames: string[] }[];
  exactDuplicates: { sha256: string; files: { filename: string; pageNumber: number | null; sizeBytes: number }[] }[];
  visualDuplicates: { filenameA: string; filenameB: string; similarity: number }[];
  totalSizeBytes: number;
  readyToPublish: boolean;
}

interface PreviewResponse {
  chapterId: string;
  filenameParsing: { needsAdminReview: { filename: string; reason: string }[]; allResolved: boolean };
  invalidFiles: { filename: string; errors: string[] }[];
  preview: PreviewReport;
}

type Stage = "setup" | "files-selected" | "analyzing" | "reviewed" | "publishing" | "published";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadClient() {
  const router = useRouter();

  // Manga/chapter selection
  const [mangaList, setMangaList] = useState<MangaOption[]>([]);
  const [mangaMode, setMangaMode] = useState<"existing" | "new">("new");
  const [selectedMangaId, setSelectedMangaId] = useState("");
  const [newMangaTitle, setNewMangaTitle] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");

  // Files
  const [files, setFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Flow state
  const [stage, setStage] = useState<Stage>("setup");
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<{ pageCount: number } | null>(null);

  useEffect(() => {
    fetch("/api/admin/manga")
      .then((r) => (r.ok ? r.json() : { manga: [] }))
      .then((data) => setMangaList(data.manga ?? []))
      .catch(() => setMangaList([]));
  }, []);

  const canSetUpChapter =
    (mangaMode === "existing" ? selectedMangaId.length > 0 : newMangaTitle.trim().length > 0) &&
    chapterNumber.trim().length > 0 &&
    !Number.isNaN(Number(chapterNumber)) &&
    Number(chapterNumber) > 0;

  async function ensureMangaAndChapter(): Promise<string> {
    let mangaId = selectedMangaId;

    if (mangaMode === "new") {
      const res = await fetch("/api/admin/manga", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newMangaTitle.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create manga.");
      const data = await res.json();
      mangaId = data.manga.id;
    }

    const chapterRes = await fetch(`/api/admin/manga/${mangaId}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterNumber: Number(chapterNumber) }),
    });
    if (!chapterRes.ok) throw new Error((await chapterRes.json()).error ?? "Failed to create chapter.");
    const chapterData = await chapterRes.json();
    return chapterData.chapter.id as string;
  }

  function handleFileList(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) => f.type.startsWith("image/") || f.name.toLowerCase().endsWith(".zip"));
    setFiles(arr);
    setStage(arr.length > 0 ? "files-selected" : "setup");
    setPreview(null);
    setError(null);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files?.length) handleFileList(e.dataTransfer.files);
  }, []);

  async function handleAnalyze() {
    setError(null);
    setStage("analyzing");
    try {
      const id = chapterId ?? (await ensureMangaAndChapter());
      setChapterId(id);

      const formData = new FormData();
      formData.set("chapterId", id);
      files.forEach((f) => formData.append("files", f));

      const res = await fetch("/api/admin/upload/preview", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed.");
        setStage("files-selected");
        return;
      }
      setPreview(data);
      setStage("reviewed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setStage("files-selected");
    }
  }

  async function handlePublish() {
    if (!chapterId) return;
    setError(null);
    setStage("publishing");
    try {
      const formData = new FormData();
      formData.set("chapterId", chapterId);
      formData.set("confirmedReview", "true");
      files.forEach((f) => formData.append("files", f));

      const res = await fetch("/api/admin/upload/publish", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Publish failed.");
        setStage("reviewed");
        return;
      }
      setPublishResult({ pageCount: data.pageCount });
      setStage("published");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
      setStage("reviewed");
    }
  }

  function resetAll() {
    setFiles([]);
    setPreview(null);
    setError(null);
    setChapterId(null);
    setPublishResult(null);
    setStage("setup");
    setChapterNumber("");
    setNewMangaTitle("");
  }

  async function handleLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <main className="min-h-screen">
      <nav className="navbar px-4 md:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg accent-gradient flex items-center justify-center text-white font-bold text-sm">
            M
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Manga<span className="accent-gradient-text">Verse</span> <span className="text-gray-500 font-normal">Admin</span>
          </span>
        </div>
        <button onClick={handleLogout} className="btn-secondary text-sm">
          <i className="fas fa-sign-out-alt mr-2" />
          Sign out
        </button>
      </nav>

      <section className="px-4 md:px-8 py-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <span className="px-3 py-1 rounded text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/20">
              Admin
            </span>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <i className="fas fa-cloud-upload-alt text-purple-400" />
              Upload Chapter
            </h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {/* Manga + chapter setup */}
              <div className="glass-card rounded-xl border border-white/5 p-6">
                <h4 className="font-semibold text-sm mb-4">1. Manga & chapter</h4>

                <div className="flex gap-2 mb-4 text-sm">
                  <button
                    className={mangaMode === "new" ? "btn-primary" : "btn-secondary"}
                    onClick={() => setMangaMode("new")}
                    disabled={stage !== "setup" && stage !== "files-selected"}
                  >
                    New manga
                  </button>
                  <button
                    className={mangaMode === "existing" ? "btn-primary" : "btn-secondary"}
                    onClick={() => setMangaMode("existing")}
                    disabled={stage !== "setup" && stage !== "files-selected"}
                  >
                    Existing manga
                  </button>
                </div>

                {mangaMode === "new" ? (
                  <input
                    type="text"
                    placeholder="Manga title"
                    value={newMangaTitle}
                    onChange={(e) => setNewMangaTitle(e.target.value)}
                    disabled={stage !== "setup" && stage !== "files-selected"}
                    className="search-input mb-3"
                  />
                ) : (
                  <select
                    value={selectedMangaId}
                    onChange={(e) => setSelectedMangaId(e.target.value)}
                    disabled={stage !== "setup" && stage !== "files-selected"}
                    className="search-input mb-3"
                  >
                    <option value="">Select a manga...</option>
                    {mangaList.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Chapter number (e.g. 189)"
                  value={chapterNumber}
                  onChange={(e) => setChapterNumber(e.target.value)}
                  disabled={stage !== "setup" && stage !== "files-selected"}
                  className="search-input"
                />
              </div>

              {/* Dropzone */}
              <div className="glass-card rounded-xl border border-white/5 p-6">
                <h4 className="font-semibold text-sm mb-4">2. Pages</h4>

                <div
                  className={`dropzone p-8 text-center cursor-pointer ${isDragActive ? "dropzone-active" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragActive(true);
                  }}
                  onDragLeave={() => setIsDragActive(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-4xl text-gray-600 mb-3">
                    <i className="fas fa-cloud-upload-alt" />
                  </div>
                  <p className="font-medium">Drop images or a ZIP here</p>
                  <p className="text-sm text-gray-500 mt-1">or click to browse — order doesn't matter</p>
                  <p className="text-xs text-gray-600 mt-3">Supports: JPG, PNG, WEBP, ZIP</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.zip"
                    className="hidden"
                    onChange={(e) => e.target.files && handleFileList(e.target.files)}
                  />
                </div>

                {files.length > 0 && (
                  <div className="mt-4 space-y-2 max-h-72 overflow-y-auto">
                    {files.map((f) => {
                      const invalid = preview?.invalidFiles.find((x) => x.filename === f.name);
                      const needsReview = preview?.filenameParsing.needsAdminReview.find((x) => x.filename === f.name);
                      return (
                        <div key={f.name} className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-2.5 text-sm">
                          <div className="flex items-center gap-3 min-w-0">
                            <i className={f.name.toLowerCase().endsWith(".zip") ? "fas fa-file-archive text-yellow-400/60" : "fas fa-file-image text-blue-400/60"} />
                            <span className="font-mono text-xs truncate">{f.name}</span>
                            <span className="text-xs text-gray-500 flex-shrink-0">({formatBytes(f.size)})</span>
                          </div>
                          {invalid ? (
                            <span className="text-xs text-red-400 flex-shrink-0" title={invalid.errors.join("; ")}>
                              <i className="fas fa-times-circle" /> Invalid
                            </span>
                          ) : needsReview ? (
                            <span className="text-xs text-yellow-400 flex-shrink-0" title={needsReview.reason}>
                              <i className="fas fa-exclamation-triangle" /> Needs review
                            </span>
                          ) : preview ? (
                            <span className="text-xs text-green-400 flex-shrink-0">
                              <i className="fas fa-check-circle" /> OK
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500 flex-shrink-0">Pending</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {preview && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className="text-lg font-medium text-green-400">{preview.preview.totalFiles}</div>
                      <div className="text-gray-500">Files</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className={`text-lg font-medium ${preview.preview.visualDuplicates.length > 0 ? "text-yellow-400" : "text-gray-400"}`}>
                        {preview.preview.visualDuplicates.length}
                      </div>
                      <div className="text-gray-500">Visual dup</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className={`text-lg font-medium ${preview.preview.missingPages.length > 0 ? "text-red-400" : "text-gray-400"}`}>
                        {preview.preview.missingPages.length}
                      </div>
                      <div className="text-gray-500">Missing</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className={`text-lg font-medium ${preview.invalidFiles.length > 0 ? "text-red-400" : "text-blue-400"}`}>
                        {preview.invalidFiles.length}
                      </div>
                      <div className="text-gray-500">Errors</div>
                    </div>
                  </div>
                )}

                {preview && preview.preview.missingPages.length > 0 && (
                  <p className="text-xs text-red-400 mt-3">Missing pages: {preview.preview.missingPages.join(", ")}</p>
                )}
                {preview && preview.preview.duplicatePageNumbers.length > 0 && (
                  <p className="text-xs text-red-400 mt-1">
                    Duplicate page numbers: {preview.preview.duplicatePageNumbers.map((d) => d.pageNumber).join(", ")}
                  </p>
                )}
                {preview && preview.preview.visualDuplicates.length > 0 && (
                  <div className="text-xs text-yellow-400 mt-1">
                    {preview.preview.visualDuplicates.map((v, i) => (
                      <p key={i}>
                        {v.filenameA} ↔ {v.filenameB}: {v.similarity}% similar
                      </p>
                    ))}
                  </div>
                )}

                {error && (
                  <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-4">{error}</div>
                )}

                {stage === "published" ? (
                  <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 mt-4">
                    <i className="fas fa-check-circle mr-2" />
                    Published {publishResult?.pageCount} pages successfully.
                  </div>
                ) : (
                  <div className="flex items-center gap-3 mt-4">
                    {!preview ? (
                      <button
                        className="btn-primary disabled:opacity-50"
                        onClick={handleAnalyze}
                        disabled={!canSetUpChapter || files.length === 0 || stage === "analyzing"}
                      >
                        {stage === "analyzing" ? "Analyzing..." : "Analyze"}
                      </button>
                    ) : (
                      <button
                        className="btn-primary disabled:opacity-50"
                        onClick={handlePublish}
                        disabled={!preview.preview.readyToPublish || preview.invalidFiles.length > 0 || stage === "publishing"}
                      >
                        {stage === "publishing" ? "Publishing..." : "Publish Chapter"}
                      </button>
                    )}
                    <button className="btn-secondary" onClick={resetAll}>
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Info sidebar */}
            <div className="lg:col-span-1">
              <div className="glass-card rounded-xl border border-white/5 p-5 space-y-4">
                <h4 className="font-semibold text-sm">Upload Information</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Chapter</span>
                    <span className="text-white">{chapterNumber || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Manga</span>
                    <span className="text-white truncate max-w-[140px]">
                      {mangaMode === "new" ? newMangaTitle || "—" : mangaList.find((m) => m.id === selectedMangaId)?.title ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total size</span>
                    <span className="text-white">{formatBytes(totalSize)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Files selected</span>
                    <span className="text-white">{files.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <span className="text-yellow-400 capitalize">{stage.replace("-", " ")}</span>
                  </div>
                </div>
                <hr className="border-white/5" />
                <div className="text-xs text-gray-500 space-y-1">
                  <p>Files can be dropped in any order — filenames are parsed and re-sorted automatically.</p>
                  <p>Nothing is written to storage or the database until you click Publish.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
