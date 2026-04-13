"use client";

import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { API_BASE_URL, apiFetch } from "@/components/api";
import ChartEditor, { type Chart as StructuredChart } from "@/components/score/ChartEditor";

// OSMD touches the DOM — load client-side only
const ScoreViewer = dynamic(() => import("@/components/score/ScoreViewer"), { ssr: false });

type LegacyChart = {
  id: number;
  chart_data: string;
  version: number;
  chart_type: string;
};

type Stem = {
  id: number;
  stem_type: string;
  file_path: string;
  status: string;
};

type Song = {
  id: number;
  title: string;
  original_filename: string;
  stems: Stem[];
  chart: LegacyChart | null;
};

type Project = {
  id: number;
  name: string;
  description: string | null;
  songs: Song[];
};

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [project, setProject] = useState<Project | null>(null);

  // Upload form
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Legacy chart text editor
  const [chartText, setChartText] = useState("");

  // Structured chart + OSMD
  const [structuredChart, setStructuredChart] = useState<StructuredChart | null>(null);
  const [musicXml, setMusicXml] = useState<string | null>(null);
  const [generatingChart, setGeneratingChart] = useState(false);
  const [chartMessage, setChartMessage] = useState<string | null>(null);
  // Per-song harmonic stem selection (songId -> stem value)
  const [harmonicStemBySong, setHarmonicStemBySong] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const loadProject = useCallback(async () => {
    const data = await apiFetch<Project>(`/api/projects/${numericProjectId}`);
    setProject(data);
    const latestSong = data.songs[0];
    if (latestSong?.chart) {
      setChartText(latestSong.chart.chart_data);
    }
  }, [numericProjectId]);

  useEffect(() => {
    loadProject().catch(console.error);
  }, [loadProject]);

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;

    setUploading(true);
    setUploadMessage(null);

    const formData = new FormData();
    formData.append("title", title);
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${numericProjectId}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `Upload failed (${response.status})`);
      }

      setTitle("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadMessage({ type: "success", text: "Uploaded — stem processing started in the background." });
      await loadProject();
    } catch (err) {
      setUploadMessage({ type: "error", text: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setUploading(false);
    }
  }

  async function onSaveLegacyChart() {
    const chartId = project?.songs[0]?.chart?.id;
    if (!chartId) return;
    await apiFetch(`/api/charts/${chartId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart_data: chartText }),
    });
    await loadProject();
  }

  function startEditProject() {
    setEditName(project?.name ?? "");
    setEditDescription(project?.description ?? "");
    setEditing(true);
  }

  async function onUpdateProject(event: FormEvent) {
    event.preventDefault();
    await apiFetch(`/api/projects/${numericProjectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDescription }),
    });
    setEditing(false);
    await loadProject();
  }

  async function onDeleteProject() {
    if (!confirm("Delete this project and all its songs? This cannot be undone.")) return;
    await apiFetch(`/api/projects/${numericProjectId}`, { method: "DELETE" });
    router.push("/");
  }

  async function onGenerateChart(songId: number) {
    setGeneratingChart(true);
    setChartMessage(null);
    const stem = harmonicStemBySong[songId] ?? "preferred";
    try {
      const chart = await apiFetch<StructuredChart>(
        `/api/songs/${songId}/charts?harmonic_stem=${encodeURIComponent(stem)}`,
        { method: "POST" },
      );
      setStructuredChart(chart);
      await fetchMusicXml(chart.id);
    } catch (err) {
      setChartMessage(err instanceof Error ? err.message : "Chart generation failed");
    } finally {
      setGeneratingChart(false);
    }
  }

  async function fetchMusicXml(chartId: number) {
    const resp = await fetch(`${API_BASE_URL}/api/charts/${chartId}/musicxml`);
    if (!resp.ok) throw new Error(`MusicXML fetch failed (${resp.status})`);
    setMusicXml(await resp.text());
  }

  function onChartSaved(updated: StructuredChart) {
    setStructuredChart(updated);
    fetchMusicXml(updated.id).catch(console.error);
  }

  if (!project) return <p>Loading project…</p>;

  const firstSong = project.songs[0] ?? null;

  return (
    <div>
      {/* ---- Project header ---- */}
      {editing ? (
        <form
          onSubmit={onUpdateProject}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}
        >
          <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          <input
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Description"
          />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <h1>{project.name}</h1>
          <p>{project.description ?? "No description provided."}</p>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button type="button" onClick={startEditProject}>
              Edit project
            </button>
            <button type="button" onClick={onDeleteProject}>
              Delete project
            </button>
          </div>
        </>
      )}

      <section className="card">
        <h2>Upload audio</h2>
        <form onSubmit={onUpload}>
          <label>
            Song title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Audio file
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>
          <button type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Upload + create placeholder job"}
          </button>
        </form>
        {uploadMessage && (
          <p style={{ color: uploadMessage.type === "error" ? "red" : "green", marginTop: "0.5rem" }}>
            {uploadMessage.text}
          </p>
        )}
      </section>

      {/* ---- Songs + stems ---- */}
      <section className="card">
        <h2>Songs</h2>
        {project.songs.length === 0 && <p>No songs yet.</p>}
        <ul>
          {project.songs.map((song) => (
            <li key={song.id} style={{ marginBottom: "0.75rem" }}>
              <strong>{song.title}</strong> ({song.original_filename})
              {song.stems.length > 0 ? (
                <ul style={{ marginTop: "0.25rem" }}>
                  {song.stems.map((stem) => (
                    <li key={stem.id}>
                      {stem.stem_type} —{" "}
                      <span style={{ color: stem.status === "completed" ? "green" : "#888" }}>
                        {stem.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "0.25rem 0", color: "#888" }}>Stems pending…</p>
              )}
              <button
                type="button"
                disabled={generatingChart}
                onClick={() => onGenerateChart(song.id)}
                style={{ marginTop: "0.5rem" }}
              >
                {generatingChart ? "Generating…" : "Generate chart"}
              </button>
              <label style={{ marginLeft: "0.75rem", fontSize: "0.85rem" }}>
                Harmonic source:{" "}
                <select
                  value={harmonicStemBySong[song.id] ?? "preferred"}
                  onChange={(e) =>
                    setHarmonicStemBySong((prev) => ({ ...prev, [song.id]: e.target.value }))
                  }
                  disabled={generatingChart}
                  style={{ marginLeft: "0.25rem" }}
                >
                  <option value="preferred">auto (preferred stem)</option>
                  <option value="mix">full mix</option>
                  {song.stems
                    .filter((s) => s.status === "completed")
                    .map((s) => (
                      <option key={s.id} value={s.stem_type}>
                        {s.stem_type} stem
                      </option>
                    ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Structured chart + OSMD ---- */}
      {structuredChart && (
        <section className="card">
          <h2>Chart — {structuredChart.title}</h2>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            {structuredChart.tempo} BPM · Key {structuredChart.key_sig} · {structuredChart.time_sig} ·
            status: {structuredChart.status}
          </p>
          {chartMessage && <p style={{ color: "red" }}>{chartMessage}</p>}
          <ChartEditor chart={structuredChart} onSaved={onChartSaved} />
          <h3 style={{ marginTop: "1.5rem" }}>Score preview</h3>
          <ScoreViewer musicXml={musicXml} height="500px" />
        </section>
      )}

      {/* ---- Legacy JSON chart editor (backwards compatibility) ---- */}
      {firstSong?.chart && (
        <section className="card">
          <h2>Raw chart data (legacy editor)</h2>
          <textarea rows={10} value={chartText} onChange={(e) => setChartText(e.target.value)} />
          <button type="button" onClick={onSaveLegacyChart} style={{ marginTop: "0.5rem" }}>
            Save raw chart edits
          </button>
        </section>
      )}
    </div>
  );
}
