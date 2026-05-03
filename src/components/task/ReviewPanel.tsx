import { useEffect, useState } from "react";
import type { TaskReview, ReviewStatus } from "../../types";
import { useApi } from "../../hooks/useApi";
import { sectionHeader, inputStyle } from "../../styles/shared.js";

const labelStyle: React.CSSProperties = { ...sectionHeader, display: "block", marginBottom: "5px" };

const STATUS_COLORS: Record<ReviewStatus, string> = {
  pending: "var(--accent-yellow, #eab308)",
  approved: "var(--accent-green, #16a34a)",
  changes_requested: "var(--accent-red, #dc2626)",
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  changes_requested: "Changes requested",
};

interface ReviewPanelProps {
  taskId: string;
  reviewerName?: string;
}

export function ReviewPanel({ taskId, reviewerName = "User" }: ReviewPanelProps) {
  const api = useApi();
  const [reviews, setReviews] = useState<TaskReview[]>([]);
  const [diffSummary, setDiffSummary] = useState("");
  const [comments, setComments] = useState("");
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getReviews(taskId).then(setReviews).catch(() => setReviews([]));
  }, [taskId, api]);

  function submit() {
    if (submitting) return;
    setSubmitting(true);
    api
      .createReview(taskId, {
        reviewer_name: reviewerName,
        status,
        comments: comments.trim() || null,
        diff_summary: diffSummary.trim() || null,
      })
      .then((r) => {
        setReviews((prev) => [r, ...prev]);
        setDiffSummary("");
        setComments("");
        setStatus("pending");
      })
      .catch(() => {})
      .finally(() => setSubmitting(false));
  }

  function updateStatus(reviewId: string, next: ReviewStatus) {
    api.updateReview(reviewId, { status: next }).then((r) => {
      setReviews((prev) => prev.map((x) => (x.id === reviewId ? r : x)));
    }).catch(() => {});
  }

  return (
    <div data-testid="review-panel">
      <div style={labelStyle}>Reviews ({reviews.length})</div>

      <div style={{
        border: "1px solid var(--border)", borderRadius: "6px",
        padding: "8px", marginBottom: "10px", display: "flex",
        flexDirection: "column", gap: "6px",
      }}>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ReviewStatus)}
          aria-label="Review status"
          style={inputStyle}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approve</option>
          <option value="changes_requested">Request changes</option>
        </select>
        <textarea
          value={diffSummary}
          onChange={(e) => setDiffSummary(e.target.value)}
          placeholder="Diff summary (paste `git diff --stat` or notes)…"
          aria-label="Diff summary"
          rows={3}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: "11px", resize: "vertical" }}
        />
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Review comments…"
          aria-label="Review comments"
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <button
          onClick={submit}
          disabled={submitting}
          style={{
            background: "transparent",
            border: "1px solid var(--accent-blue)",
            color: "var(--accent-blue)",
            borderRadius: "6px",
            padding: "4px 12px",
            fontSize: "12px",
            cursor: submitting ? "not-allowed" : "pointer",
            alignSelf: "flex-start",
          }}
        >
          Submit review
        </button>
      </div>

      <div style={{
        maxHeight: "260px", overflowY: "auto",
        border: "1px solid var(--border)", borderRadius: "6px",
      }}>
        {reviews.length === 0 ? (
          <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: "12px", textAlign: "center" }}>
            No reviews yet
          </div>
        ) : (
          reviews.map((r) => (
            <div key={r.id} style={{
              padding: "8px 10px", borderBottom: "1px solid var(--border)",
              fontSize: "12px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.reviewer_name}</span>
                <span style={{
                  color: STATUS_COLORS[r.status],
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              {r.diff_summary && (
                <pre style={{
                  background: "var(--bg-secondary)",
                  color: "var(--text-secondary)",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  margin: "4px 0",
                  fontSize: "11px",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>{r.diff_summary}</pre>
              )}
              {r.comments && (
                <div style={{ color: "var(--text-secondary)", marginTop: "2px" }}>{r.comments}</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {r.status === "pending" && (
                  <span style={{ display: "flex", gap: "4px" }}>
                    <button
                      onClick={() => updateStatus(r.id, "approved")}
                      style={miniBtn("var(--accent-green, #16a34a)")}
                      aria-label="Approve review"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => updateStatus(r.id, "changes_requested")}
                      style={miniBtn("var(--accent-red, #dc2626)")}
                      aria-label="Request changes"
                    >
                      Request changes
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function miniBtn(color: string): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${color}`,
    color,
    borderRadius: "4px",
    padding: "2px 8px",
    fontSize: "10px",
    cursor: "pointer",
  };
}
