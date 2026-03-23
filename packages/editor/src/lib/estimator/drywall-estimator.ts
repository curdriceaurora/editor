/**
 * Drywall Material Estimator
 *
 * Computes full material estimates for drywall installation based on
 * Pascal Editor scene data (walls, doors, windows).
 *
 * All dimensions in the scene are stored in meters.
 * Output quantities are in imperial units (4Ã8 ft or 4Ã12 ft sheets).
 */

import type { AnyNode, AnyNodeId } from '@pascal-app/core'

// ââ Constants ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/** Standard drywall sheet sizes (width Ã height in meters) */
export const SHEET_SIZES = {
  '4x8': { width: 1.2192, height: 2.4384, label: '4\' Ã 8\'' },
  '4x12': { width: 1.2192, height: 3.6576, label: '4\' Ã 12\'' },
} as const

export type SheetSize = keyof typeof SHEET_SIZES

/** Waste factor â industry standard 10-15% for cuts, breakage, mistakes */
const DEFAULT_WASTE_FACTOR = 0.10

/** Material coverage rates */
const MATERIAL_RATES = {
  /** Joint compound (mud) â ~0.053 liters per sq ft â ~0.57 L/mÂ² for 3 coats */
  mudLitersPerSqM: 0.57,
  /** Joint tape â ~1 roll (75 ft / 22.86m) per 100 sq ft (9.29 mÂ²) */
  tapeMetersPerSqM: 22.86 / 9.29,
  /** Screws â ~1 per sq ft â ~10.76 per mÂ² */
  screwsPerSqM: 10.76,
  /** Corner bead â 1 piece (8 ft / 2.44m) per inside/outside corner */
  cornerBeadLengthM: 2.4384,
}

// ââ Types ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export interface WallEstimate {
  wallId: string
  wallName: string
  length: number // meters
  height: number // meters
  grossArea: number // mÂ² (both sides)
  openingArea: number // mÂ² (doors + windows, both sides)
  netArea: number // mÂ²
  openings: OpeningInfo[]
}

export interface OpeningInfo {
  type: 'door' | 'window'
  id: string
  width: number
  height: number
  area: number // mÂ² (single side)
}

export interface DrywallEstimate {
  // Per-wall breakdown
  walls: WallEstimate[]

  // Totals
  totalGrossArea: number // mÂ²
  totalOpeningArea: number // mÂ²
  totalNetArea: number // mÂ² (after subtracting openings)
  totalNetAreaWithWaste: number // mÂ² (with waste factor)

  // Materials
  sheetSize: SheetSize
  sheetCount: number
  mudLiters: number
  tapeMeters: number
  screwCount: number
  cornerBeadPieces: number

  // Settings used
  wasteFactor: number
  coveredSides: 1 | 2 // 1 = single side, 2 = both sides
}

export interface EstimatorOptions {
  sheetSize?: SheetSize
  wasteFactor?: number
  /** 1 = drywall one side only, 2 = both sides of each wall */
  coveredSides?: 1 | 2
  /** Only estimate walls in this level. If undefined, estimate all walls. */
  levelId?: string
}

// ââ Core Logic âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Get wall length from start/end coordinates.
 */
function getWallLength(wall: any): number {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  return Math.sqrt(dx * dx + dz * dz)
}

/**
 * Find all door/window openings that belong to a given wall.
 */
function getOpeningsForWall(
  wallId: string,
  nodes: Record<string, AnyNode>,
): OpeningInfo[] {
  const openings: OpeningInfo[] = []

  for (const node of Object.values(nodes)) {
    if (node.type === 'door') {
      const door = node as any
      if (door.wallId === wallId || door.parentId === wallId) {
        openings.push({
          type: 'door',
          id: door.id,
          width: door.width ?? 0.9,
          height: door.height ?? 2.1,
          area: (door.width ?? 0.9) * (door.height ?? 2.1),
        })
      }
    }
    if (node.type === 'window') {
      const win = node as any
      if (win.wallId === wallId || win.parentId === wallId) {
        openings.push({
          type: 'window',
          id: win.id,
          width: win.width ?? 1.5,
          height: win.height ?? 1.5,
          area: (win.width ?? 1.5) * (win.height ?? 1.5),
        })
      }
    }
  }

  return openings
}

/**
 * Count inside/outside corners formed by walls meeting at endpoints.
 * Each shared endpoint between two walls = 1 corner.
 */
function countCorners(walls: any[]): number {
  const EPSILON = 0.05 // 5cm snap tolerance
  const endpoints: [number, number][] = []

  for (const wall of walls) {
    endpoints.push(wall.start)
    endpoints.push(wall.end)
  }

  // Group endpoints that are within EPSILON of each other
  const visited = new Set<number>()
  let cornerCount = 0

  for (let i = 0; i < endpoints.length; i++) {
    if (visited.has(i)) continue
    let cluster = 1
    visited.add(i)

    for (let j = i + 1; j < endpoints.length; j++) {
      if (visited.has(j)) continue
      const dx = endpoints[i][0] - endpoints[j][0]
      const dz = endpoints[i][1] - endpoints[j][1]
      if (Math.sqrt(dx * dx + dz * dz) < EPSILON) {
        cluster++
        visited.add(j)
      }
    }

    // A corner is formed when 2+ wall endpoints meet
    if (cluster >= 2) {
      // Each pair of walls meeting = 1 corner
      // For T-junctions (3 walls) = 2 corners, etc.
      cornerCount += cluster - 1
    }
  }

  return cornerCount
}

/**
 * Get all wall IDs that belong to a specific level.
 */
function getWallIdsForLevel(
  levelId: string,
  nodes: Record<string, AnyNode>,
): string[] {
  const level = nodes[levelId as AnyNodeId]
  if (!level || level.type !== 'level') return []

  const children = (level as any).children ?? []
  return children.filter((id: string) => {
    const node = nodes[id as AnyNodeId]
    return node?.type === 'wall'
  })
}

/**
 * Main estimation function.
 *
 * Iterates all walls (or walls in a specific level), computes surface area,
 * subtracts door/window openings, and derives material quantities.
 */
export function estimateDrywall(
  nodes: Record<string, AnyNode>,
  options: EstimatorOptions = {},
): DrywallEstimate {
  const {
    sheetSize = '4x8',
    wasteFactor = DEFAULT_WASTE_FACTOR,
    coveredSides = 2,
    levelId,
  } = options

  // Collect walls
  let wallNodes: AnyNode[]

  if (levelId) {
    const wallIds = getWallIdsForLevel(levelId, nodes)
    wallNodes = wallIds
      .map((id) => nodes[id as AnyNodeId])
      .filter((n): n is AnyNode => !!n && n.type === 'wall')
  } else {
    wallNodes = Object.values(nodes).filter((n) => n.type === 'wall')
  }

  // Per-wall estimates
  const walls: WallEstimate[] = wallNodes.map((wall: any) => {
    const length = getWallLength(wall)
    const height = wall.height ?? 2.5
    const singleSideArea = length * height
    const grossArea = singleSideArea * coveredSides

    const openings = getOpeningsForWall(wall.id, nodes)
    const openingArea =
      openings.reduce((sum, o) => sum + o.area, 0) * coveredSides

    return {
      wallId: wall.id,
      wallName: wall.name || `Wall`,
      length,
      height,
      grossArea,
      openingArea,
      netArea: Math.max(0, grossArea - openingArea),
      openings,
    }
  })

  // Totals
  const totalGrossArea = walls.reduce((s, w) => s + w.grossArea, 0)
  const totalOpeningArea = walls.reduce((s, w) => s + w.openingArea, 0)
  const totalNetArea = Math.max(0, totalGrossArea - totalOpeningArea)
  const totalNetAreaWithWaste = totalNetArea * (1 + wasteFactor)

  // Sheet calculation
  const sheet = SHEET_SIZES[sheetSize]
  const sheetArea = sheet.width * sheet.height
  const sheetCount = Math.ceil(totalNetAreaWithWaste / sheetArea)

  // Material quantities (based on net area with waste)
  const mudLiters = totalNetAreaWithWaste * MATERIAL_RATES.mudLitersPerSqM
  const tapeMeters = totalNetAreaWithWaste * MATERIAL_RATES.tapeMetersPerSqM
  const screwCount = Math.ceil(
    totalNetAreaWithWaste * MATERIAL_RATES.screwsPerSqM,
  )

  // Corner bead
  const corners = countCorners(wallNodes as any[])
  const avgWallHeight =
    walls.length > 0
      ? walls.reduce((s, w) => s + w.height, 0) / walls.length
      : 2.5
  const cornerBeadPieces = Math.ceil(
    (corners * avgWallHeight) / MATERIAL_RATES.cornerBeadLengthM,
  )

  return {
    walls,
    totalGrossArea,
    totalOpeningArea,
    totalNetArea,
    totalNetAreaWithWaste,
    sheetSize,
    sheetCount,
    mudLiters,
    tapeMeters,
    screwCount,
    cornerBeadPieces,
    wasteFactor,
    coveredSides,
  }
}

// ââ Formatting Helpers âââââââââââââââââââââââââââââââââââââââââââââââââ

/** Convert mÂ² to ftÂ² */
export function sqmToSqft(sqm: number): number {
  return sqm * 10.7639
}

/** Format area for display */
export function formatArea(sqm: number, unit: 'metric' | 'imperial' = 'imperial'): string {
  if (unit === 'imperial') {
    return `${sqmToSqft(sqm).toFixed(0)} ftÂ²`
  }
  return `${sqm.toFixed(1)} mÂ²`
}

/** Format length for display */
export function formatLength(meters: number, unit: 'metric' | 'imperial' = 'imperial'): string {
  if (unit === 'imperial') {
    const feet = meters * 3.28084
    return `${feet.toFixed(1)} ft`
  }
  return `${meters.toFixed(2)} m`
}
