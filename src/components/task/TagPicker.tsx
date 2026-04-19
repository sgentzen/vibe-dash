import { useAppDispatch } from "../../store";
import { useApi } from "../../hooks/useApi";
import { sectionHeader, inputStyle } from "../../styles/shared.js";
import type { Tag } from "../../types";

const labelStyle: React.CSSProperties = { ...sectionHeader, display: "block", marginBottom: "5px" };

interface TagPickerProps {
  taskId: string;
  currentTags: Tag[];
  availableTags: Tag[];
  projectTagCount: number;
}

export function TagPicker({ taskId, currentTags, availableTags, projectTagCount }: TagPickerProps) {
  const dispatch = useAppDispatch();
  const api = useApi();

  async function handleRemoveTag(tagId: string) {
    await api.removeTagFromTask(taskId, tagId);
    dispatch({
      type: "WS_EVENT",
      payload: { type: "tag_removed", payload: { id: "", task_id: taskId, tag_id: tagId } },
    });
  }

  async function handleAddTag(tagId: string) {
    if (!tagId) return;
    const taskTag = await api.addTagToTask(taskId, tagId);
    dispatch({ type: "WS_EVENT", payload: { type: "tag_added", payload: taskTag } });
  }

  return (
    <div>
      <label htmlFor="task-tags" style={labelStyle}>Tags</label>
      {currentTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
          {currentTags.map((tag) => (
            <span
              key={tag.id}
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "4px",
                background: `${tag.color}20`,
                color: tag.color,
                border: `1px solid ${tag.color}40`,
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              {tag.name}
              <button
                onClick={() => handleRemoveTag(tag.id)}
                style={{
                  background: "none", border: "none", color: tag.color,
                  cursor: "pointer", padding: "0", fontSize: "13px", lineHeight: 1,
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      {availableTags.length > 0 && (
        <select
          id="task-tags"
          value=""
          onChange={(e) => handleAddTag(e.target.value)}
          style={inputStyle}
        >
          <option value="">Add tag...</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.name}</option>
          ))}
        </select>
      )}
      {projectTagCount === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: "11px", fontStyle: "italic" }}>
          No tags in this project yet
        </div>
      )}
    </div>
  );
}
