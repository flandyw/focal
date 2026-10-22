import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useTheme } from "next-themes"
import { ArrowDown, ArrowUp, Check, Monitor, Moon, RotateCcw, Sun } from "lucide-react"
import { AccentPicker } from "./accent-picker"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Slider } from "./ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { NAVIGATION_GROUPS } from "../lib/navigation"
import { ACCENT_THEMES } from "../lib/accent-theme"
import { DEFAULT_APPEARANCE, FONT_FAMILIES, SURFACE_THEMES, selectAccent, updateAppearance, useAccent, useAppearance, type Appearance } from "../lib/appearance"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"

function Setting({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="appearance-row">
    <div className="min-w-0"><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
    <div className="appearance-control">{children}</div>
  </div>
}

function RangeSetting({ title, description, field, min, max, step = 1, unit = "" }: { title: string; description: string; field: "fontSize" | "readingSpacing" | "radius" | "sidebarWidth"; min: number; max: number; step?: number; unit?: string }) {
  const appearance = useAppearance()
  return <Setting title={title} description={description}>
    <div className="flex w-full items-center gap-3 sm:w-64">
      <Slider className="min-h-11" min={min} max={max} step={step} value={appearance[field]} aria-label={title} onValueChange={(value) => updateAppearance({ [field]: Number(value) })} />
      <output className="w-14 shrink-0 text-right text-sm tabular-nums">{appearance[field]}{unit}</output>
    </div>
  </Setting>
}

function ChoiceSetting<K extends keyof Appearance>({ title, description, field, options }: { title: string; description: string; field: K; options: { value: Appearance[K] & string; label: string }[] }) {
  const appearance = useAppearance()
  return <Setting title={title} description={description}>
    <div role="group" aria-label={title} className="flex flex-wrap gap-1">
      {options.map((option) => <Button key={option.value} size="sm" variant={appearance[field] === option.value ? "secondary" : "outline"} aria-pressed={appearance[field] === option.value} onClick={() => updateAppearance({ [field]: option.value })}>{option.label}</Button>)}
    </div>
  </Setting>
}

function ColourSetting({ title, description, value, fallback, onChange }: { title: string; description: string; value: string | null; fallback: string; onChange: (colour: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return <Setting title={title} description={description}>
    <Input type="color" aria-label={`${title} picker`} className="h-9 w-12 shrink-0 cursor-pointer p-1" value={value ?? fallback} onChange={(event) => { setDraft(null); onChange(event.target.value) }} />
    <Input aria-label={`${title} hex code`} placeholder={fallback} className="w-28 font-mono text-sm" maxLength={7} value={draft ?? value ?? ""} onChange={(event) => {
      const next = event.target.value
      setDraft(next)
      if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next)
      else if (next === "") onChange(null)
    }} onBlur={() => setDraft(null)} />
    <Button variant="ghost" size="sm" disabled={!value} onClick={() => { setDraft(null); onChange(null) }}>Clear</Button>
  </Setting>
}

export function AppearanceSettings() {
  const appearance = useAppearance()
  const accent = useAccent()
  const { theme, setTheme } = useTheme()
  const [tab, setTab] = useState("themes")
  const accentColour = appearance.customAccent ?? ACCENT_THEMES.find((item) => item.id === accent)!.swatch

  function reset() {
    updateAppearance(DEFAULT_APPEARANCE)
    selectAccent("sage")
    setTheme("light")
    toast("Appearance reset", { action: { label: "Undo", onClick: () => {
      selectAccent(accent)
      updateAppearance(appearance)
      setTheme(theme ?? "system")
    } } })
  }

  return <section className="min-w-0" aria-labelledby="appearance-heading">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div><h2 id="appearance-heading" className="focal-section-title">Make Focal yours</h2><p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">Changes apply instantly and are saved on this device.</p></div>
      <Button variant="ghost" size="sm" onClick={reset}><RotateCcw />Reset appearance</Button>
    </header>

    <div className="appearance-preview my-6" aria-label="Live appearance preview">
      <div className="appearance-preview-sidebar" aria-hidden="true"><div className="font-heading text-2xl text-primary">focal.</div><div className="mt-4 rounded-sm bg-sidebar-accent px-2 py-1.5 text-xs text-sidebar-accent-foreground">Your workspace</div><div className="mt-2 px-2 text-xs text-sidebar-foreground">Made for you</div></div>
      <div className="min-w-0 flex-1 p-5 sm:p-7"><h3 className="font-heading text-3xl leading-tight">A space to think.</h3><p className="mt-2 max-w-[42ch] text-sm text-muted-foreground" style={{ lineHeight: appearance.readingSpacing }}>Your notes, your plans, your next idea. Shape a workspace that feels right for the way you study.</p><div className="mt-4 flex flex-wrap items-center gap-3"><span className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">Your accent</span><span className="text-xs text-muted-foreground">Live preview</span></div></div>
    </div>

    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-2 max-w-full justify-start overflow-x-auto" aria-label="Appearance categories">
        <TabsTrigger value="themes">Themes & colours</TabsTrigger><TabsTrigger value="type">Typography</TabsTrigger><TabsTrigger value="layout">Layout</TabsTrigger><TabsTrigger value="sidebar">Sidebar</TabsTrigger>
      </TabsList>
      <TabsContent value="themes">
        <Setting title="Colour mode" description="Choose a mode or follow your device’s appearance.">
          <div role="group" aria-label="Colour mode" className="flex flex-wrap gap-1">{[{ value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }, { value: "system", label: "System", icon: Monitor }].map(({ value, label, icon: Icon }) => <Button key={value} size="sm" variant={theme === value ? "secondary" : "outline"} aria-pressed={theme === value} onClick={() => setTheme(value)}><Icon />{label}</Button>)}</div>
        </Setting>
        <div className="border-b py-5"><h3 className="text-sm font-medium">Workspace theme</h3><p className="mt-1 text-sm text-muted-foreground">Each palette includes light and dark surfaces. Keep your favourite accent.</p>
          <div role="group" aria-label="Workspace theme" className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-3">{SURFACE_THEMES.map((surface) => <Button variant="ghost" key={surface.id} className="appearance-swatch h-auto flex-col items-stretch justify-start font-normal whitespace-normal" aria-pressed={appearance.surface === surface.id} onClick={() => updateAppearance({ surface: surface.id })}>
            <span className="appearance-swatch-sample" aria-hidden="true" style={{ background: `light-dark(${surface.background}, ${surface.darkBackground})` }}><span style={{ background: `light-dark(${surface.sidebar}, ${surface.darkSidebar})` }} /><span className="min-w-0 flex-1 space-y-2 p-3"><span className="block h-1.5 w-2/3 rounded" style={{ background: accentColour }} /><span className="block h-1 w-full rounded bg-foreground/15" /><span className="block h-1 w-4/5 rounded bg-foreground/15" /></span></span>
            <span className="mt-2 flex items-center justify-between gap-2 text-sm font-medium">{surface.label}{appearance.surface === surface.id ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}</span><span className="mt-0.5 block text-xs text-muted-foreground">{surface.description}</span>
          </Button>)}</div>
        </div>
        <Setting title="Accent colour" description="For actions, selected items, and focus indicators."><AccentPicker /></Setting>
        <ColourSetting title="Custom accent" description="Choose any colour. Focal adjusts its contrast for readable text in both modes." value={appearance.customAccent} fallback={accentColour} onChange={(customAccent) => updateAppearance({ customAccent })} />
        <ColourSetting title="Sidebar tint" description="Give the sidebar its own colour, independent of your accent." value={appearance.sidebarTint} fallback="#315647" onChange={(sidebarTint) => updateAppearance({ sidebarTint })} />
      </TabsContent>
      <TabsContent value="type">
        {([['bodyFont', 'Interface font', 'The font used for navigation, controls, and body text.'], ['headingFont', 'Heading font', 'Choose a separate voice for page titles and headings.']] as const).map(([field, title, description]) => <Setting key={field} title={title} description={description}>
          <Select items={Object.fromEntries(FONT_FAMILIES.map((font) => [font.id, font.label]))} value={appearance[field]} onValueChange={(value) => { if (value && FONT_FAMILIES.some((font) => font.id === value)) updateAppearance({ [field]: value }) }}>
            <SelectTrigger aria-label={title} className="w-full sm:w-56"><SelectValue /></SelectTrigger><SelectContent>{FONT_FAMILIES.map((font) => <SelectItem key={font.id} value={font.id} style={{ fontFamily: font.value }}>{font.label}</SelectItem>)}</SelectContent>
          </Select>
        </Setting>)}
        <RangeSetting title="Text size" description="Scale the interface, including navigation and controls." field="fontSize" min={14} max={20} unit="px" />
        <RangeSetting title="Reading line spacing" description="Give mistake explanations and the preview more room to breathe." field="readingSpacing" min={1.4} max={2} step={0.1} unit="×" />
        <p className="py-4 text-xs text-muted-foreground">Instrument Sans and Newsreader are included. Other fonts use the closest available font on your device. Equations keep their mathematical typeface.</p>
      </TabsContent>
      <TabsContent value="layout">
        <ChoiceSetting title="Page width" description="Use all available space or keep content centred." field="contentWidth" options={[{ value: "full", label: "Full width" }, { value: "wide", label: "Wide" }, { value: "reading", label: "Focused" }]} />
        <ChoiceSetting title="Interface density" description="Adjust spacing throughout the app." field="density" options={[{ value: "compact", label: "Compact" }, { value: "default", label: "Default" }, { value: "comfortable", label: "Comfortable" }]} />
        <RangeSetting title="Corner radius" description="From crisp square corners to softer rounded controls." field="radius" min={0} max={16} unit="px" />
        <Setting title="Reduced motion" description="Keep transitions and animations to a minimum."><Label className="flex items-center gap-2 text-sm"><Checkbox checked={appearance.reduceMotion} onCheckedChange={(checked) => updateAppearance({ reduceMotion: checked })} />Reduce motion</Label></Setting>
        <Setting title="Saved pane sizes" description="Drag the dividers in Calendar, the mistake library, and editors. Use arrow keys when a divider is focused."><Button variant="outline" size="sm" onClick={() => updateAppearance({ calendarPane: DEFAULT_APPEARANCE.calendarPane, mistakePane: DEFAULT_APPEARANCE.mistakePane, editorPane: DEFAULT_APPEARANCE.editorPane, sidebarWidth: DEFAULT_APPEARANCE.sidebarWidth })}><RotateCcw />Reset pane sizes</Button></Setting>
      </TabsContent>
      <TabsContent value="sidebar">
        <ChoiceSetting title="Sidebar position" description="Put navigation on the side that suits you." field="sidebarSide" options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} />
        <RangeSetting title="Sidebar width" description="Drag the sidebar edge to resize it, or use this slider. Collapse it with Ctrl/⌘ B." field="sidebarWidth" min={200} max={400} unit="px" />
        <Setting title="Section labels" description="Show the Study, Assessments, and Analysis headings."><Label className="flex items-center gap-2 text-sm"><Checkbox checked={appearance.sidebarLabels} onCheckedChange={(checked) => updateAppearance({ sidebarLabels: checked })} />Show section labels</Label></Setting>
        <div className="py-5"><h3 className="text-sm font-medium">Navigation links</h3><p className="mt-1 text-sm text-muted-foreground">Show what you use and reorder links within each section. Hidden pages remain available in Search. Settings always stays available.</p>
          {NAVIGATION_GROUPS.map((group) => {
            const ordered = [...group.items].sort((a, b) => (appearance.linkOrder.indexOf(a.id) + 1 || 100) - (appearance.linkOrder.indexOf(b.id) + 1 || 100))
            function move(index: number, direction: number) {
              const next = ordered.map((item) => item.id)
              ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
              updateAppearance({ linkOrder: [...appearance.linkOrder.filter((id) => !next.some((item) => item === id)), ...next] })
            }
            return <fieldset key={group.label} className="mt-5"><legend className="mb-2 text-sm font-medium">{group.label}</legend><div className="divide-y border-y">{ordered.map((item, index) => <div key={item.id} className="flex items-center gap-2 py-2"><Label className="flex min-w-0 flex-1 items-center gap-3 text-sm"><Checkbox checked={!appearance.hiddenLinks.includes(item.id)} onCheckedChange={(checked) => updateAppearance({ hiddenLinks: checked ? appearance.hiddenLinks.filter((id) => id !== item.id) : [...appearance.hiddenLinks, item.id] })} />{item.label}</Label><Button variant="ghost" size="icon-sm" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button><Button variant="ghost" size="icon-sm" aria-label={`Move ${item.label} down`} disabled={index === ordered.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button></div>)}</div></fieldset>
          })}
          <Button className="mt-4" variant="outline" size="sm" onClick={() => updateAppearance({ hiddenLinks: [], linkOrder: [], sidebarLabels: true })}>Restore navigation defaults</Button>
        </div>
      </TabsContent>
    </Tabs>
  </section>
}
