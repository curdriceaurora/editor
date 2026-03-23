'use client'

import { useScene } from '@pascal-app/core'
import { Calculator, ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  type DrywallEstimate,
  type EstimatorOptions,
  type SheetSize,
  SHEET_SIZES,
  estimateDrywall,
  formatArea,
  formatLength,
  sqmToSqft,
} from '../../../../../lib/estimator/drywall-estimator'

// -- Sub-components --

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between px-1 py-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="text-right">
        <span className="font-mono text-sm text-white">{value}</span>
        {sub && <span className="ml-1 text-muted-foreground text-xs">{sub}</span>}
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  open,
  onToggle,
}: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      className="flex w-full items-center gap-1.5 py-1.5 text-muted-foreground text-xs font-medium uppercase tracking-wider hover:text-white transition-colors"
      onClick={onToggle}
      type="button"
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {title}
    </button>
  )
}

function WallBreakdownRow({
  wall,
}: {
  wall: DrywallEstimate['walls'][number]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-border/30 border-b last:border-0">
      <button
        className="flex w-full items-center justify-between px-1 py-1 text-xs hover:bg-accent/30 transition-colors rounded"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="text-muted-foreground truncate max-w-[140px]">
          {wall.wallName}
        </span>
        <span className="font-mono text-white">{formatArea(wall.netArea)}</span>
      </button>
      {open && (
        <div className="pb-1.5 pl-3 space-y-0.5">
          <StatRow label="Length" value={formatLength(wall.length)} />
          <StatRow label="Height" value={formatLength(wall.height)} />
          <StatRow label="Gross area" value={formatArea(wall.grossArea)} />
          {wall.openings.length > 0 && (
            <>
              <StatRow
                label="Openings"
                value={`-${formatArea(wall.openingArea)}`}
              />
              {wall.openings.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between pl-2 text-[10px] text-muted-foreground/70"
                >
                  <span>
                    {o.type === 'door' ? String.fromCodePoint(0x1F6AA) : String.fromCodePoint(0x1FA9F)}{' '}
                    {formatLength(o.width)} x {formatLength(o.height)}
                  </span>
                  <span>{formatArea(o.area)}</span>
                </div>
              ))}
            </>
          )}
          <StatRow label="Net area" value={formatArea(wall.netArea)} />
        </div>
      )}
    </div>
  )
}

// -- Main Panel --

export function EstimatePanel() {
  const nodes = useScene((s) => s.nodes)

  // Settings
  const [sheetSize, setSheetSize] = useState<SheetSize>('4x8')
  const [wasteFactor, setWasteFactor] = useState(0.1)
  const [coveredSides, setCoveredSides] = useState<1 | 2>(2)
  const [selectedLevel, setSelectedLevel] = useState<string | undefined>(undefined)

  // Section visibility
  const [showWalls, setShowWalls] = useState(false)
  const [showMaterials, setShowMaterials] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  // Find all levels for the dropdown
  const levels = useMemo(() => {
    return Object.values(nodes)
      .filter((n) => n.type === 'level')
      .map((n) => ({
        id: n.id,
        name: n.name || `Level ${(n as any).level ?? 0}`,
      }))
  }, [nodes])

  // Run estimate
  const estimate = useMemo<DrywallEstimate | null>(() => {
    const walls = Object.values(nodes).filter((n) => n.type === 'wall')
    if (walls.length === 0) return null

    const options: EstimatorOptions = {
      sheetSize,
      wasteFactor,
      coveredSides,
      levelId: selectedLevel,
    }

    return estimateDrywall(nodes as any, options)
  }, [nodes, sheetSize, wasteFactor, coveredSides, selectedLevel])

  if (!estimate || estimate.walls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
        <Calculator className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-white">No walls found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Draw some walls first, then come back here to estimate drywall materials.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto no-scrollbar">
      {/* Header */}
      <div className="flex items-center gap-2 pb-1">
        <Calculator className="h-4 w-4 text-orange-400" />
        <span className="font-medium text-sm text-white">Drywall Estimate</span>
      </div>

      {/* Level selector */}
      {levels.length > 1 && (
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            className="flex-1 rounded bg-accent/50 border border-border/50 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-orange-400/50"
            onChange={(e) => setSelectedLevel(e.target.value || undefined)}
            value={selectedLevel ?? ''}
          >
            <option value="">All levels</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary card */}
      <div className="rounded-lg border border-border/50 bg-accent/20 p-3 space-y-1">
        <StatRow
          label="Total wall area"
          value={formatArea(estimate.totalNetArea)}
          sub={`(${estimate.totalNetArea.toFixed(1)} m²)`}
        />
        <StatRow
          label="Openings deducted"
          value={formatArea(estimate.totalOpeningArea)}
        />
        <StatRow
          label={`Waste (${Math.round(wasteFactor * 100)}%)`}
          value={`+${formatArea(estimate.totalNetAreaWithWaste - estimate.totalNetArea)}`}
        />
        <div className="border-t border-border/30 pt-1 mt-1">
          <StatRow
            label="Area to cover"
            value={formatArea(estimate.totalNetAreaWithWaste)}
          />
        </div>
      </div>

      {/* Materials */}
      <SectionHeader title="Materials" open={showMaterials} onToggle={() => setShowMaterials(!showMaterials)} />
      {showMaterials && (
        <div className="rounded-lg border border-border/50 bg-accent/20 p-3 space-y-1">
          <StatRow
            label={`Drywall sheets (${SHEET_SIZES[sheetSize].label})`}
            value={`${estimate.sheetCount}`}
            sub="sheets"
          />
          <StatRow
            label="Joint compound (mud)"
            value={`${estimate.mudLiters.toFixed(1)}`}
            sub="liters"
          />
          <StatRow
            label="Joint tape"
            value={`${estimate.tapeMeters.toFixed(1)}`}
            sub="meters"
          />
          <StatRow
            label="Drywall screws"
            value={`${estimate.screwCount}`}
            sub="pcs"
          />
          <StatRow
            label="Corner bead"
            value={`${estimate.cornerBeadPieces}`}
            sub="pcs"
          />
        </div>
      )}

      {/* Wall breakdown */}
      <SectionHeader title={`Walls (${estimate.walls.length})`} open={showWalls} onToggle={() => setShowWalls(!showWalls)} />
      {showWalls && (
        <div className="rounded-lg border border-border/50 bg-accent/20 p-2">
          {estimate.walls.map((wall) => (
            <WallBreakdownRow key={wall.wallId} wall={wall} />
          ))}
        </div>
      )}

      {/* Settings */}
      <SectionHeader title="Settings" open={showSettings} onToggle={() => setShowSettings(!showSettings)} />
      {showSettings && (
        <div className="rounded-lg border border-border/50 bg-accent/20 p-3 space-y-3">
          {/* Sheet size */}
          <div>
            <label className="text-muted-foreground text-xs">Sheet size</label>
            <div className="flex gap-1 mt-1">
              {(Object.keys(SHEET_SIZES) as SheetSize[]).map((size) => (
                <button
                  key={size}
                  className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                    sheetSize === size
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                      : 'bg-accent/50 text-muted-foreground border border-border/50 hover:text-white'
                  }`}
                  onClick={() => setSheetSize(size)}
                  type="button"
                >
                  {SHEET_SIZES[size].label}
                </button>
              ))}
            </div>
          </div>

          {/* Covered sides */}
          <div>
            <label className="text-muted-foreground text-xs">Covered sides</label>
            <div className="flex gap-1 mt-1">
              {([1, 2] as const).map((sides) => (
                <button
                  key={sides}
                  className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                    coveredSides === sides
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                      : 'bg-accent/50 text-muted-foreground border border-border/50 hover:text-white'
                  }`}
                  onClick={() => setCoveredSides(sides)}
                  type="button"
                >
                  {sides === 1 ? 'One side' : 'Both sides'}
                </button>
              ))}
            </div>
          </div>

          {/* Waste factor */}
          <div>
            <label className="text-muted-foreground text-xs">
              Waste factor: {Math.round(wasteFactor * 100)}%
            </label>
            <input
              className="mt-1 w-full accent-orange-400"
              max={0.25}
              min={0.05}
              onChange={(e) => setWasteFactor(Number(e.target.value))}
              step={0.01}
              type="range"
              value={wasteFactor}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/50">
              <span>5%</span>
              <span>25%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
