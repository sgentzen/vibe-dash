import type { TaskComment } from "../../types";
import { sectionHeader, inputStyle } from "../../styles/shared.js";

const labelStyle: React.CSSProperties = { ...sectionHeader, display: "block", marginBottom: "5px" };

interface CommentsSectionProps {
  comments: TaskComment[];
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onSubmitComment: () => void;
}

export function CommentsSection({ comments, newComment, onNewCommentChange, onSubmitComment }: CommentsSectionProps) {
  return (
    <div>
      <label style={labelStyle}>Comments ({comments.length})</label>
      <div style={{
        maxHeight: "200px", overflowY: "auto",
        border: "1px solid var(--border)", borderRadius: "6px",
        marginBottom: "8px",
      }}>
        {comments.length === 0 ? (
          <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: "12px", textAlign: "center" }}>
            No comments yet
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} style={{
              padding: "8px 10px", borderBottom: "1px solid var(--border)",
              fontSize: "12px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{c.author_name}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div style={{ color: "var(--text-secondary)" }}>{c.message}</div>
            </div>
          ))
        )}
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          value={newComment}
          onChange={(e) => onNewCommentChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSubmitComment(); }}
          placeholder="Add a comment..."
          aria-label="Add a comment"
          style={inputStyle}
        />
        <button
          onClick={onSubmitComment}
          disabled={!newComment.trim()}
          style={{
            background: "transparent",
            border: "1px solid var(--accent-blue)",
            color: "var(--accent-blue)",
            borderRadius: "6px",
            padding: "4px 12px",
            fontSize: "12px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
