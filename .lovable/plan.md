

## Plan: Open Blueprint Viewer in a Dedicated Full-Screen Page

The user wants the Blueprint Viewer (circled in red in the screenshot) to open as a **separate, full-screen page** instead of being embedded in a split panel alongside the chat. This gives the viewer more screen space for inspecting blueprints and detected elements.

### Changes

**1. Create `src/pages/BlueprintViewerPage.tsx`** — New dedicated page
- Reads viewer state (image URL, elements, selected element, review statuses) from URL query params or a shared context/state store
- Since React Router doesn't support passing complex objects via navigation, we'll use `sessionStorage` to pass the data
- Renders `BlueprintViewer` full-screen (100vw × 100vh)
- The "Close" button navigates back to the dashboard instead of toggling a boolean

**2. Add route in `src/App.tsx`**
- Add `/blueprint-viewer` as a protected route pointing to the new page

**3. Update `src/components/chat/ChatArea.tsx`**
- When `showBlueprintViewer` is triggered, instead of rendering the split panel inline:
  - Store viewer data (imageUrl, overlayElements, selectedElementId, reviewStatuses) in `sessionStorage`
  - Navigate to `/blueprint-viewer` using `useNavigate()`
- Remove the inline `ResizablePanelGroup` rendering of BlueprintViewer (lines ~1448-1487)
- Keep the mobile stacked view as a fallback option or also redirect to the full page

**4. Update `BlueprintViewer` `onClose` behavior**
- In the new page context, `onClose` will call `navigate(-1)` to go back to the chat

### Data Flow
```text
ChatArea (triggers viewer)
  → saves elements + imageUrl + selectedId to sessionStorage
  → navigates to /blueprint-viewer

BlueprintViewerPage
  → reads from sessionStorage
  → renders BlueprintViewer full-screen
  → onClose → navigate back to /
```

This approach avoids complex state management libraries and keeps the data transfer simple via `sessionStorage`.

