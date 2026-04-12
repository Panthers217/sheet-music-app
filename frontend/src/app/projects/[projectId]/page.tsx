"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { API_BASE_URL, apiFetch } from "@/components/api";

type Chart = {
  id: number;
  chart_data: string;
  version: number;
  chart_type: string;
};

type Song = {
  id: number;
  title: string;
  original_filename: string;
  stems: {
    id: number;
    stem_type: string;
    file_path: string;
    status: string;
  }[];
  chart: Chart | null;
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
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [chartText, setChartText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  async function loadProject() {
    const data = await apiFetch<Project>(`/api/projects/${numericProjectId}`);
    setProject(data);
    const latestSong = data.songs[0];
    if (latestSong?.chart) {
      setChartText(latestSong.chart.chart_data);
    }
  }

  useEffect(() => {
    loadProject().catch(console.error);
  }, [numericProjectId]);

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
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setUploadMessage({ type: "success", text: "File uploaded — stem processing started in the background." });
      await loadProject();
    } catch (err) {
      setUploadMessage({ type: "error", text: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setUploading(false);
    }
  }

  async function onSaveChart() {
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

  if (!project) {
    return <p>Loading project…</p>;
  }

  return (
    <div>
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

      <section className="card">
        <h2>Songs</h2>
        <ul>
          {project.songs.map((song) => (
            <li key={song.id}>
              {song.title} ({song.original_filename})
              {song.stems.length > 0 ? (
                <ul>
                  {song.stems.map((stem) => (
                    <li key={stem.id}>
                      Stem: {stem.stem_type} | Status: {stem.status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No stems yet.</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Editable chart (latest song)</h2>
        <textarea rows={12} value={chartText} onChange={(event) => setChartText(event.target.value)} />
        <button type="button" onClick={onSaveChart}>
          Save chart edits
        </button>
      </section>
    </div>
  );
}
