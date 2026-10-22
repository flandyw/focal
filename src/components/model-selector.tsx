import { useState } from "react"
import { ChevronDown, SlidersHorizontal, Star } from "lucide-react"
import type { GatewayCatalog, GatewayModel } from "../lib/gateway-client"
import { Button } from "./ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command"
import { NativeSelect } from "./ui/native-select"
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "./ui/popover"

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 })
const context = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

export function ModelSelector({ catalog, value, onValueChange, favourites, onToggleFavourite, disabled }: {
  catalog: GatewayCatalog
  value: string
  onValueChange: (value: string) => void
  favourites: string[]
  onToggleFavourite: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"suggested" | "favourites" | "all">("suggested")
  const [price, setPrice] = useState("")
  const [capability, setCapability] = useState("")
  const [sort, setSort] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const selected = catalog.models.find((model) => model.id === value)
  const hasIntelligence = catalog.models.some((model) => model.intelligence != null)
  const hasSpeed = catalog.models.some((model) => model.outputSpeed != null)
  const searching = Boolean(query.trim())
  const filtered = Boolean(price || capability || sort)
  const showAll = view === "all" || searching || filtered
  const favouriteModels = catalog.models.filter((model) => favourites.includes(model.id))
  const ranked = [...catalog.models].sort((a, b) =>
    (b.intelligence ?? -Infinity) - (a.intelligence ?? -Infinity) || (b.released ?? 0) - (a.released ?? 0) || a.name.localeCompare(b.name))
  const suggestions: GatewayModel[] = favouriteModels.slice(0, 5)
  const defaultModel = catalog.models.find((model) => model.id === catalog.defaultModel)
  if (defaultModel && suggestions.length < 5 && !suggestions.some((entry) => entry.id === defaultModel.id)) suggestions.push(defaultModel)
  // ponytail: one pick per creator keeps the shortlist varied; use task-specific rankings if study outcomes justify them.
  for (const model of ranked) {
    if (suggestions.length === 5) break
    if (!suggestions.some((entry) => entry.id.split("/")[0] === model.id.split("/")[0])) suggestions.push(model)
  }
  const terms = query.trim().toLowerCase().split(/\s+/)
  const models = (view === "favourites" ? favouriteModels : showAll ? catalog.models : suggestions).filter((model) =>
    terms.every((term) => `${model.name} ${model.id}`.toLowerCase().includes(term))
    && (!price || (model.outputPrice != null && model.outputPrice <= Number(price)))
    && (!capability || (capability === "reasoning" ? model.tags.includes("reasoning") : (model.contextWindow ?? 0) >= 128_000))
    && (sort !== "intelligence" || model.intelligence != null)
    && (sort !== "speed" || model.outputSpeed != null))
  if (sort) models.sort((a, b) =>
    (sort === "price" ? (a.outputPrice ?? Infinity) - (b.outputPrice ?? Infinity)
      : sort === "intelligence" ? (b.intelligence ?? -1) - (a.intelligence ?? -1)
        : (b.outputSpeed ?? -1) - (a.outputSpeed ?? -1)) || a.name.localeCompare(b.name))

  function reset() {
    setQuery("")
    setPrice("")
    setCapability("")
    setSort("")
    setView("suggested")
    setFiltersOpen(false)
  }

  return <Popover open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (!next) reset() }}>
    <PopoverTrigger render={<Button variant="ghost" disabled={disabled} className="max-w-full justify-start px-2" />} aria-label={`Chat model: ${selected?.name ?? "Choose a model"}`}>
      <span className="truncate">{selected?.name ?? "Choose a model"}</span><ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
    </PopoverTrigger>
    <PopoverContent align="start" side="top" sideOffset={8} className="max-h-(--available-height) w-[min(26rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-0">
      <div className="px-4 pt-4 pb-2">
        <PopoverTitle>Choose a model</PopoverTitle>
        <PopoverDescription className="mt-1 text-xs">{favouriteModels.length ? "Your favourites, then a few suggestions." : hasIntelligence ? "Default and benchmark leaders, one per creator." : "Your default and recent releases, one per creator."}</PopoverDescription>
      </div>
      <Command shouldFilter={false} className="h-auto shrink-0 rounded-none! p-0">
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search all models…" aria-label="Search all models" className="px-2" />
        <div role="group" aria-label="Model browsing options" onKeyDown={(event) => {
          // Keep native controls' navigation keys out of the command list.
          if (["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key) || event.ctrlKey) event.stopPropagation()
        }}>
        <div className="flex flex-wrap items-center justify-between gap-1 px-3 py-2">
          <div className="flex gap-1" role="group" aria-label="Model list">
            <Button size="sm" variant={view !== "favourites" && !showAll ? "secondary" : "ghost"} aria-pressed={view !== "favourites" && !showAll} onClick={reset}>Suggested</Button>
            <Button size="sm" variant={view === "favourites" ? "secondary" : "ghost"} aria-pressed={view === "favourites"} onClick={() => setView("favourites")}>Favourites</Button>
            <Button size="sm" variant={view !== "favourites" && showAll ? "secondary" : "ghost"} aria-pressed={view !== "favourites" && showAll} onClick={() => setView("all")}>All models</Button>
          </div>
          <Button size="icon-sm" variant={filtersOpen || filtered ? "secondary" : "ghost"} aria-label={filtered ? "Model filters (active)" : "Model filters"} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            <SlidersHorizontal aria-hidden className="size-3.5" />
          </Button>
        </div>
        {filtersOpen ? <div className="grid gap-3 border-y px-4 py-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs">Output price · USD / 1M tokens
            <NativeSelect value={price} onChange={(event) => setPrice(event.target.value)} className="w-full">
              <option value="">Any price</option><option value="1">Up to $1</option><option value="5">Up to $5</option>
            </NativeSelect>
          </label>
          <label className="grid gap-1.5 text-xs">Capability
            <NativeSelect value={capability} onChange={(event) => setCapability(event.target.value)} className="w-full">
              <option value="">Any capability</option><option value="reasoning">Reasoning</option><option value="context">128K+ context</option>
            </NativeSelect>
          </label>
          <label className="grid gap-1.5 text-xs sm:col-span-2">Sort by
            <NativeSelect value={sort} onChange={(event) => setSort(event.target.value)} className="w-full">
              <option value="">Default order</option><option value="price">Lowest output price</option>
              {hasIntelligence ? <option value="intelligence">Highest intelligence · AA</option> : null}
              {hasSpeed ? <option value="speed">Fastest output · AA</option> : null}
            </NativeSelect>
          </label>
          {filtered ? <Button size="sm" variant="ghost" className="justify-self-start" onClick={reset}>Reset filters</Button> : null}
        </div> : null}
        </div>
        <div className="flex justify-between gap-3 px-4 pb-1 text-xs text-muted-foreground" aria-live="polite">
          <span>{view === "favourites" ? `${models.length} favourites` : showAll ? `${models.length} models` : "Suggested"}</span>
          <span>{sort === "speed" ? "AA tokens / sec" : sort === "intelligence" ? "AA Intelligence Index" : "Output / 1M"}</span>
        </div>
        <CommandList className="min-h-0 max-h-80 scroll-py-1 px-1 pb-1">
          <CommandEmpty>{view === "favourites" && !favouriteModels.length ? "Star a model in All models to keep it here." : "No models match. Try another search or reset filters."}</CommandEmpty>
          <CommandGroup>
            {models.map((model) => <div key={model.id} className="flex items-center">
            <CommandItem value={model.id} data-checked={model.id === value} onSelect={() => { onValueChange(model.id); setOpen(false); reset() }} className="min-w-0 flex-1 gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{model.name}{model.id === value ? <span className="sr-only"> (selected)</span> : null}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {model.id.split("/")[0]}{model.contextWindow ? ` · ${context.format(model.contextWindow)} context` : ""}{model.id === catalog.defaultModel ? " · Default" : ""}
                </div>
                {model.latencySeconds != null || model.outputSpeed != null ? <p className="mt-0.5 text-xs text-muted-foreground">AA: {model.latencySeconds != null ? `${model.latencySeconds.toFixed(2)}s latency` : ""}{model.latencySeconds != null && model.outputSpeed != null ? " · " : ""}{model.outputSpeed != null ? `${Math.round(model.outputSpeed)} tok/s` : ""}</p> : null}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {sort === "speed" ? Math.round(model.outputSpeed!) : sort === "intelligence" ? model.intelligence!.toFixed(1) : model.outputPrice == null ? "—" : dollars.format(model.outputPrice)}
              </span>
            </CommandItem>
            <Button size="icon-sm" variant="ghost" className="mr-1 shrink-0" aria-label={`${favourites.includes(model.id) ? "Unfavourite" : "Favourite"} ${model.name}`} aria-pressed={favourites.includes(model.id)} onClick={() => onToggleFavourite(model.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation() }}><Star aria-hidden className={favourites.includes(model.id) ? "fill-current" : undefined} /></Button>
            </div>)}
          </CommandGroup>
        </CommandList>
      </Command>
      <details className="border-t px-4 py-2.5 text-xs text-muted-foreground">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">Pricing & data sources</summary>
        <div className="space-y-2 pt-2 leading-relaxed">
          <p>Base USD prices per million tokens from <a className="underline underline-offset-2" href="https://vercel.com/ai-gateway/models" target="_blank" rel="noreferrer">Vercel AI Gateway</a>. Context, caching, and routing can change the final cost. All models support tools.</p>
          {selected ? <p className="break-words">{selected.id}<br />Input: {selected.inputPrice == null ? "Unavailable" : dollars.format(selected.inputPrice)} · Output: {selected.outputPrice == null ? "Unavailable" : dollars.format(selected.outputPrice)}</p> : null}
          <p>Benchmarks: <a className="underline underline-offset-2" href="https://artificialanalysis.ai/" target="_blank" rel="noreferrer">Artificial Analysis</a>. {catalog.benchmarksUpdatedAt && (hasIntelligence || hasSpeed) ? `Retrieved ${new Date(catalog.benchmarksUpdatedAt).toLocaleDateString()}. Only exact model variants are included; speed varies by provider.` : "Unavailable for this catalogue. Price and capability filters still work."}</p>
        </div>
      </details>
    </PopoverContent>
  </Popover>
}
