"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { apiFetch } from "@/components/api";

type Project = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
};

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  async function loadProjects() {
    const data = await apiFetch<Project[]>("/api/projects");
    setProjects(data);
  }

  useEffect(() => {
    loadProjects().catch(console.error);
  }, []);

  async function onCreateProject(event: FormEvent) {
    event.preventDefault();
    await apiFetch<Project>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    setName("");
    setDescription("");
    await loadProjects();
  }

  function startEdit(project: Project) {
    setEditingId(project.id);
    setEditName(project.name);
    setEditDescription(project.description ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function onUpdateProject(event: FormEvent, projectId: number) {
    event.preventDefault();
    await apiFetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDescription }),
    });
    setEditingId(null);
    await loadProjects();
  }

  async function onDeleteProject(projectId: number) {
    if (!confirm("Delete this project and all its songs? This cannot be undone.")) return;
    await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
    await loadProjects();
  }

  return (
    <div>
      <h1>Sheet Music MVP</h1>

      <section className="card">
        <h2>Create Project</h2>
        <form onSubmit={onCreateProject}>
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <button type="submit">Create project</button>
        </form>
      </section>

      <section className="card">
        <h2>Projects</h2>
        {projects.length === 0 && <p>No projects yet.</p>}
        <ul>
          {projects.map((project) =>
            editingId === project.id ? (
              <li key={project.id}>
                <form
                  onSubmit={(e) => onUpdateProject(e, project.id)}
                  style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}
                >
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
                  <input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </form>
              </li>
            ) : (
              <li key={project.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <Link href={`/projects/${project.id}`}>{project.name}</Link>
                {project.description && (
                  <span style={{ color: "var(--muted, #888)", fontSize: "0.9em" }}>{project.description}</span>
                )}
                <button type="button" onClick={() => startEdit(project)}>
                  Edit
                </button>
                <button type="button" onClick={() => onDeleteProject(project.id)}>
                  Delete
                </button>
              </li>
            )
          )}
        </ul>
      </section>
    </div>
  );
}
