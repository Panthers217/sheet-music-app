"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

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
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const [project, setProject] = useState<Project | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [chartText, setChartText] = useState("");

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
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("file", file);

    await fetch(`${API_BASE_URL}/api/projects/${numericProjectId}/upload`, {
      method: "POST",
      body: formData,
    });

    setTitle("");
    setFile(null);
    await loadProject();
  }

  async function onSaveChart() {
    const chartId = project?.songs[0]?.chart?.id;
    if (!chartId) {
      return;
    }

    await apiFetch(`/api/charts/${chartId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart_data: chartText }),
    });

    await loadProject();
  }

  if (!project) {
    return <p>Loading project…</p>;
  }

  return (
    <div>
      <h1>{project.name}</h1>
      <p>{project.description ?? "No description provided."}</p>

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
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>
          <button type="submit">Upload + create placeholder job</button>
        </form>
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
