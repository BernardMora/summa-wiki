// Shared types for the Berni's Wiki index.
// The index is the single artifact consumed by BOTH the app and the CLI/agent.

export type NoteType =
  | "moc" | "area" | "project" | "knowledge"
  | "journal" | "source" | "connection" | "system";

export type Author = "human" | "agent" | "mixed";

export interface BundleConfig {
  /** Stable id used in aios:// links. */
  id: string;
  /** Absolute path to the bundle root. */
  root: string;
  /** Whether this bundle is shared with other people. */
  shared: boolean;
}

export interface Link {
  /** Raw href as written in the markdown. */
  href: string;
  /** Visible link text. */
  text: string;
  /** Resolved note id, when the target is an indexed note. */
  target?: string;
  kind: "internal" | "cross-bundle" | "external" | "asset" | "broken";
}

export interface Provenance {
  /** Word counts attributable to each author, from <!-- ai --> markers. */
  humanWords: number;
  agentWords: number;
  /** True when markers are unbalanced or nested deeper than one level. */
  malformed: boolean;
}

export interface Note {
  /** "<bundle>:<path relative to bundle root>" — globally unique. */
  id: string;
  bundle: string;
  /** Path relative to the bundle root, POSIX separators. */
  path: string;
  /** Absolute path on disk. */
  abs: string;
  slug: string;

  title: string;
  type: NoteType | "";
  created: string;
  updated: string;
  author: Author | "";
  pillar?: string;
  status?: string;
  priority?: string;
  resource?: string;
  tags: string[];

  words: number;
  excerpt: string;
  headings: string[];

  links: Link[];
  /** Ids of notes linking TO this one. Computed after the first pass. */
  backlinks: string[];
  /** Relative paths of images/files embedded by this note. */
  assets: string[];

  provenance: Provenance;
}

export interface IndexStats {
  notes: number;
  words: number;
  internalLinks: number;
  brokenLinks: number;
  crossBundleLinks: number;
  isolated: number;
  orphans: number;
  byType: Record<string, number>;
  byAuthor: Record<string, number>;
  byBundle: Record<string, number>;
}

export interface WikiIndex {
  generatedAt: string;
  /** Bumped when the index shape changes in a way consumers must handle. */
  version: number;
  bundles: BundleConfig[];
  notes: Note[];
  stats: IndexStats;
}
