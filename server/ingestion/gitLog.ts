import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runGit = promisify(execFile);

export interface RawCommit {
  sha: string;
  subject: string;
  author_email: string | null;
  authored_at: string;
}

const GIT_LOG_FORMAT = "%H%x00%s%x00%ae%x00%aI";
const NUL = "\x00";

export function parseGitLogOutput(raw: string): RawCommit[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, subject, author_email, authored_at] = line.split(NUL);
      return {
        sha,
        subject,
        author_email: author_email === "" ? null : author_email,
        authored_at,
      };
    });
}

export type GitLogFn = (sinceIso: string, repoPath: string) => Promise<RawCommit[]>;

// Default implementation — invokes `git log` via execFile (no shell, array args).
export const realGitLog: GitLogFn = async (sinceIso, repoPath) => {
  const { stdout } = await runGit(
    "git",
    ["log", `--since=${sinceIso}`, `--format=${GIT_LOG_FORMAT}`],
    { cwd: repoPath, maxBuffer: 50 * 1024 * 1024 }
  );
  return parseGitLogOutput(stdout);
};

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await runGit("git", ["rev-parse", "--git-dir"], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}
