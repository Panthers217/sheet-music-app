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

  return (
    <div>
      <h1>Sheet Music MVP</h1>

      <section className="card">
        <h2>Create Project</h2>
        <form onSubmit={onCreateProject}>
          <label>
            Project name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
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
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`}>{project.name}</Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
