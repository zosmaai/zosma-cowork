# Phase 3: Inline Response Feedback

## Overview
Add thumbs up/down buttons to each assistant message so users can rate responses. On thumbs down, collect optional text feedback. All feedback is tracked as telemetry events.

## Implementation

### 1. FeedbackButtons component
- Renders thumbs up/down buttons below each assistant message
- Hover to reveal (desktop pattern), or always visible
- Selected state (filled icon) when clicked
- On thumbs down -> show inline feedback textarea
- Submit text feedback or just rating

### 2. Feedback state
- Local state per message (stored in ChatMessage or parent)
- Not persisted to sessions (optional future enhancement)

### 3. Telemetry integration
- `trackEvent("feedback", { rating: "up"|"down", message?: string })` on submit
- Track which model/provider generated the rated response

### 4. ChatMessage integration
- Add FeedbackButtons below message content for assistant messages
- Wire into existing ChatMessage component

## Files
- `src/components/FeedbackButtons.tsx` — component + styles
- `src/components/FeedbackButtons.test.tsx` — tests
- `src/components/ChatMessage.tsx` — integration (minor changes)
