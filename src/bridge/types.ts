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
  /** Desktop only: convert a file the engine cannot read (ProRes, HEIC…) into H.264 / PNG. */
  transcode?(input: string, projectId: string, durationS: number | null, onProgress?: (r: number) => void): Promise<PickedFile>;
  /** Desktop only: remux the exported file (AAC audio for QuickTime, MOV container). */
  finalizeExport?(file: string, opts: { aac: boolean; mov: boolean }): Promise<string>;
  projectFolder?(id: string): Promise<string>;
}
