import type { Project } from '../model/schema';

export interface ProjectSummary {
  id: string; name: string; updatedAt: string; durationUs: number;
  width: number; height: number; cover?: string;
}

export interface PickedFile { name: string; path: string; url: string; mime: string; size: number }

export interface Bridge {
  kind: 'electron' | 'web';
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Project | null>;
  saveProject(p: Project, cover?: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  pickFiles(accept: 'media' | 'audio' | 'srt' | 'font'): Promise<PickedFile[]>;
  /** Url the renderer can load for an asset path; null if the file is gone. */
  resolve(path: string): Promise<string | null>;
  readText(path: string): Promise<string>;
  saveExport(suggestedName: string, data: Uint8Array): Promise<string | null>;
  /** Write a generated file (matte, processed audio…) into the project's cache folder. */
  writeFile(projectId: string, name: string, data: Uint8Array): Promise<PickedFile>;
  reveal?(path: string): void;
  projectFolder?(id: string): Promise<string>;
}
