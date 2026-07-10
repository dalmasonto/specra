/**
 * MDX/mdsvex component map for Specra documentation.
 *
 * In mdsvex, custom components are imported directly in .svx files.
 * This file exports the component map for programmatic use.
 *
 * Usage in .svx files:
 * ```svelte
 * <script>
 *   import { Callout, CodeBlock, Tabs, Tab } from 'specra/components'
 * </script>
 *
 * <Callout type="info">This is a callout</Callout>
 * ```
 */

import type { Component } from 'svelte';
import {
  Callout,
  Accordion,
  AccordionItem,
  Tabs,
  Tab,
  Image,
  Video,
  Card,
  CardGrid,
  ImageCard,
  ImageCardGrid,
  Steps,
  Step,
  Icon,
  Mermaid,
  Math,
  Columns,
  Column,
  DocBadge,
  Tooltip,
  Frame,
  CodeBlock,
  Timeline,
  TimelineItem,
  ApiEndpoint,
  ApiParams,
  ApiResponse,
  ApiPlayground,
  ApiReference,
  Changelog,
  Update,
} from './components/docs'

// Re-export all MDX-usable components
export {
  Callout,
  Accordion,
  AccordionItem,
  Tabs,
  Tab,
  Image,
  Video,
  Card,
  CardGrid,
  ImageCard,
  ImageCardGrid,
  Steps,
  Step,
  Icon,
  Mermaid,
  Math,
  Columns,
  Column,
  DocBadge,
  Tooltip,
  Frame,
  CodeBlock,
  Timeline,
  TimelineItem,
  ApiEndpoint,
  ApiParams,
  ApiResponse,
  ApiPlayground,
  ApiReference,
  Changelog,
  Update,
}

/**
 * Component map for passing to layout components that render MDX content.
 */
export const mdxComponents: Record<string, Component> = {
  Callout,
  Accordion,
  AccordionItem,
  Tabs,
  Tab,
  Image,
  Video,
  Card,
  CardGrid,
  ImageCard,
  ImageCardGrid,
  Steps,
  Step,
  Icon,
  Mermaid,
  Math,
  Columns,
  Column,
  Badge: DocBadge,
  DocBadge,
  Tooltip,
  Frame,
  CodeBlock,
  Timeline,
  TimelineItem,
  ApiEndpoint,
  ApiParams,
  ApiResponse,
  ApiPlayground,
  ApiReference,
  Changelog,
  Update,
}
