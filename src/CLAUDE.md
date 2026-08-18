# Client

Patterns for `src/` — the React dashboard.

## Frontend Patterns

- **State**: Context API + `useReducer` in `store.tsx` (no Redux library)
- **Data fetching**: `useApi()` hook wraps fetch for REST calls
- **Real-time**: `useWebSocket()` with auto-reconnect (2s delay)
- **Styling**: CSS variables for dark/light theming, inline styles, no CSS modules
