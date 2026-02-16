
## Make the App Responsive for All Devices

### Overview
Adjust the Dashboard layout, sidebar, chat area, tables, modals, and viewer to work properly on phones, tablets, and desktops. The app already uses a `useIsMobile` hook (768px breakpoint) and has some mobile handling, but several areas need fixes.

### Changes by File

**1. `src/pages/Dashboard.tsx` -- Mobile Sidebar as Overlay**
- On mobile, convert the sidebar from a push layout to a slide-over overlay with a semi-transparent backdrop
- Auto-close sidebar when a project is tapped on mobile
- Reduce welcome section text sizes and padding on small screens
- Make the 4-step guide grid `grid-cols-2` on all small screens (already partly done)

**2. `src/components/chat/ChatArea.tsx` -- Input Bar and Suggestion Cards**
- Make suggestion idea cards scroll horizontally with smaller min-width on mobile
- Reduce input bar padding on small screens
- Ensure the "Powered by AI" footer text doesn't overflow

**3. `src/components/chat/BarListTable.tsx` -- Horizontal Scroll for Table**
- Wrap tables in a horizontal scroll container on small screens
- Stack filter input and import button vertically on very small screens (below ~400px)
- Reduce cell padding for compact display

**4. `src/components/chat/ShopDrawingModal.tsx` -- Full-Screen on Mobile**
- Change `max-w-3xl` to full width on mobile (`w-full sm:max-w-3xl`)
- Make the options grid single-column on mobile (`grid-cols-1 sm:grid-cols-2`)
- Ensure iframe preview takes available height

**5. `src/components/chat/BlueprintViewer.tsx` -- Toolbar Wrapping**
- Make toolbar buttons smaller on mobile and allow proper wrapping
- Hide the zoom percentage text on very small screens
- Ensure type filter chips in mobile toolbar don't overflow

**6. `src/components/chat/BendingScheduleTable.tsx`**
- Add horizontal scroll wrapper for the bending table on mobile

**7. `src/hooks/use-mobile.tsx`**
- No changes needed -- the existing 768px breakpoint is appropriate

### Technical Details

| Component | Issue | Fix |
|---|---|---|
| Dashboard sidebar | Pushes content off-screen on mobile | Overlay with backdrop, auto-close on selection |
| BarListTable | Table columns overflow on narrow screens | `overflow-x-auto` wrapper, reduced padding |
| ShopDrawingModal | Dialog too wide for phones | Full-width on mobile, single-column form grid |
| ChatArea input bar | Cards too wide, padding excessive | Smaller min-width cards, reduced padding |
| BlueprintViewer toolbar | Buttons wrap awkwardly | Flex-wrap with tighter spacing, hide non-essential items |
| Welcome screen | Text too large on small phones | Responsive text sizes (`text-2xl sm:text-3xl`) |

### What Stays the Same
- The split-panel (ResizablePanel) behavior already handles mobile by stacking vertically
- The auth page is already responsive with `max-w-md` and `p-4`
- Dark mode and RTL support remain unchanged
