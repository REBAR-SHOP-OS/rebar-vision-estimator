# Select Sentinel Pattern

Radix UI's `<Select.Item>` throws if its `value` is the empty string. Use
the literal string `"__none__"` as a sentinel for "no selection":

```tsx
<Select value={value ?? "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
  <SelectContent>
    <SelectItem value="__none__">— None —</SelectItem>
    {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
  </SelectContent>
</Select>
```

Never use `""` as the value — Radix will crash at runtime.