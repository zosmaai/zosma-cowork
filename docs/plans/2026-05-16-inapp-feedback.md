# Phase 4: In-app Feedback Submission

## Overview
Add a general feedback submission form accessible from the sidebar so users can report issues, suggest features, or send general feedback.

## Implementation

### 1. FeedbackDialog component
- Modal dialog triggered from sidebar
- Textarea for user feedback
- Optional email field for follow-up
- Category selector (Bug Report, Feature Request, General)
- Submit button

### 2. Telemetry integration
- `trackEvent("app_feedback", { category: "...", message: "..." })`

### 3. Sidebar integration
- "Send Feedback" link/button at bottom of settings panel

## Files
- `src/components/FeedbackDialog.tsx` — component
- `src/components/FeedbackDialog.test.tsx` — tests
- `src/components/Sidebar.tsx` — integration
