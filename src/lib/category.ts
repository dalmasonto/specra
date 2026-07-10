// Note: This file uses server-only APIs (fs, path) and should only be imported in Server Components
import fs from "fs"
import path from "path"
import type { BadgeInput } from "./badges.js"

export interface CategoryConfig {
  label?: string
  position?: number
  sidebar_position?: number  // Alternative naming for position
  link?: {
    type: "generated-index" | "doc"
    slug?: string
  }
  collapsed?: boolean
  collapsible?: boolean
  icon?: string  // Icon name for sidebar display (Lucide icon name)
  tab_group?: string  // Tab group ID for organizing categories into tabs
  badge?: BadgeInput  // Badge(s) shown on the group header in the sidebar
}

const DOCS_DIR = typeof process !== 'undefined' ? path.join(process.cwd(), "docs") : "docs"

/**
 * Read category.json from a folder
 */
export function getCategoryConfig(folderPath: string): CategoryConfig | null {
  try {
    const categoryPath = path.join(folderPath, "_category_.json")

    if (!fs.existsSync(categoryPath)) {
      return null
    }

    const content = fs.readFileSync(categoryPath, "utf8")
    return JSON.parse(content) as CategoryConfig
  } catch (error) {
    console.error(`Error reading category config from ${folderPath}:`, error)
    return null
  }
}

/**
 * Get all category configs for a version
 */
export function getAllCategoryConfigs(version: string, product?: string): Map<string, CategoryConfig> {
  const configs = new Map<string, CategoryConfig>()
  const versionDir = (product && product !== "_default_")
    ? path.join(DOCS_DIR, product, version)
    : path.join(DOCS_DIR, version)

  if (!fs.existsSync(versionDir)) {
    return configs
  }

  function scanDirectory(dir: string, relativePath: string = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name)
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

        const config = getCategoryConfig(fullPath)
        if (config) {
          configs.set(relPath, config)
        }

        // Recursively scan subdirectories
        scanDirectory(fullPath, relPath)
      }
    }
  }

  scanDirectory(versionDir)
  return configs
}
