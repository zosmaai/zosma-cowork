# Phase 6: Custom Instructions / Persona

## Overview
Add a "Custom Instructions" section in Settings where users can define a system prompt/persona that's included with every prompt.

## Implementation
1. Add textarea in Settings panel for custom instructions
2. Persist instructions via save_settings IPC (as `persona` key)
3. Pass instructions with each prompt via sidecar

## Files
- `src/components/Sidebar.tsx` — add textarea in Settings panel
- Sidecar may need minor update to forward instructions
