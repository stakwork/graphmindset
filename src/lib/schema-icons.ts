import {
  CircleDot,
  AtSign,
  Video,
  Mic,
  FileText,
  BookOpen,
  User,
  Calendar,
  Building2,
  Building,
  MapPin,
  MessageCircle,
  Radio,
  Target,
  Wrench,
  Home,
  Heart,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

/**
 * Maps jarvis schema icon names to lucide-react components.
 * Icon names come from the /schema/all API response (e.g. "TwitterIcon", "VideoIcon").
 */
const SCHEMA_ICON_MAP: Record<string, LucideIcon> = {
  NodesIcon: CircleDot,
  TwitterIcon: AtSign,
  VideoIcon: Video,
  AudioIcon: Mic,
  DocumentIcon: FileText,
  BookIcon: BookOpen,
  PersonIcon: User,
  EventIcon: Calendar,
  OrganizationIcon: Building2,
  CorporationIcon: Building,
  PlaceIcon: MapPin,
  MessageIcon: MessageCircle,
  EpisodeIcon: Radio,
  TargetIcon: Target,
  ConstructionIcon: Wrench,
  HomeIcon: Home,
  InterestsIcon: Heart,
}

/**
 * Vibrant accent colors per icon type — schema primary_colors are too dark/desaturated
 * for small UI elements, so we use these for icon tinting instead.
 */
const ICON_ACCENT_MAP: Record<string, string> = {
  TwitterIcon: "#38bdf8",   // sky
  VideoIcon: "#f43f5e",     // rose
  AudioIcon: "#a78bfa",     // violet
  DocumentIcon: "#f59e0b",  // amber
  BookIcon: "#34d399",      // emerald
  PersonIcon: "#ec4899",    // pink
  EventIcon: "#fb923c",     // orange
  OrganizationIcon: "#818cf8", // indigo
  CorporationIcon: "#818cf8",
  PlaceIcon: "#2dd4bf",     // teal
  MessageIcon: "#38bdf8",   // sky
  EpisodeIcon: "#a78bfa",   // violet
  TargetIcon: "#f43f5e",    // rose
  ConstructionIcon: "#fb923c", // orange
  HomeIcon: "#34d399",      // emerald
  InterestsIcon: "#f43f5e", // rose
  NodesIcon: "#94a3b8",     // slate
}

const DEFAULT_ICON: LucideIcon = CircleDot
const DEFAULT_ACCENT = "#94a3b8"

export interface SchemaIconInfo {
  icon: LucideIcon
  accent: string
}

export function getSchemaIcon(iconName?: string): LucideIcon {
  if (!iconName) return DEFAULT_ICON
  return SCHEMA_ICON_MAP[iconName] ?? DEFAULT_ICON
}

export function getSchemaIconInfo(iconName?: string): SchemaIconInfo {
  return {
    icon: iconName ? (SCHEMA_ICON_MAP[iconName] ?? DEFAULT_ICON) : DEFAULT_ICON,
    accent: iconName ? (ICON_ACCENT_MAP[iconName] ?? DEFAULT_ACCENT) : DEFAULT_ACCENT,
  }
}
