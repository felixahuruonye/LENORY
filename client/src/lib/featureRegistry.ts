/**
 * Centralized feature registry
 * Maps feature names, aliases, and keywords to their routes
 * Makes feature detection automatic and extensible for future features
 */

interface Feature {
  route: string;
  names: string[]; // Primary name and common references
  aliases: string[]; // Alternative names users might say
  keywords: string[]; // Keywords that trigger this feature
}

const FEATURES: Feature[] = [
  {
    route: "/cbt-mode",
    names: ["cbt mode", "cbt", "exam", "mock exam"],
    aliases: ["computer-based testing", "test", "quiz"],
    keywords: ["exam", "test", "cbt", "mock", "practice exam"],
  },
  {
    route: "/memory",
    names: ["memory", "learning memory", "brain"],
    aliases: ["notes", "knowledge", "recall", "retention"],
    keywords: ["memory", "remember", "brain", "knowledge"],
  },
  {
    route: "/dashboard",
    names: ["dashboard", "8d dashboard", "home"],
    aliases: ["main", "overview", "analytics", "stats"],
    keywords: ["dashboard", "analytics", "overview", "home"],
  },
  {
    route: "/live-ai",
    names: ["live ai", "voice", "audio", "speak", "talk"],
    aliases: ["conversation", "voice assistant", "ai chat"],
    keywords: ["live", "voice", "audio", "speak", "talk"],
  },
  {
    route: "/settings",
    names: ["settings", "preferences", "config"],
    aliases: ["options", "configuration", "setup"],
    keywords: ["settings", "preferences", "config"],
  },
  {
    route: "/chat",
    names: ["chat", "conversation", "message"],
    aliases: ["talk", "ask", "ai"],
    keywords: ["chat", "conversation", "message"],
  },
  {
    route: "/workspace",
    names: ["workspace", "projects", "project"],
    aliases: ["work", "files", "documents"],
    keywords: ["workspace", "project", "work"],
  },
  {
    route: "/website-generator",
    names: ["website generator", "create website", "web builder"],
    aliases: ["website", "site generator", "web design"],
    keywords: ["website", "web", "html", "build", "create"],
  },
  {
    route: "/courses",
    names: ["courses", "learning", "classes"],
    aliases: ["lessons", "training", "tutorials"],
    keywords: ["course", "learn", "class", "lesson"],
  },
  {
    route: "/marketplace",
    names: ["marketplace", "store", "shop"],
    aliases: ["buy", "sell", "products"],
    keywords: ["marketplace", "store", "shop", "buy"],
  },
  {
    route: "/exams",
    names: ["exams", "exam"],
    aliases: ["tests", "questions", "practice"],
    keywords: ["exam", "test", "questions"],
  },
  {
    route: "/live-session",
    names: ["live session", "session"],
    aliases: ["live class", "class", "meeting"],
    keywords: ["live", "session", "class", "meeting"],
  },
  {
    route: "/notifications",
    names: ["notifications", "alerts", "messages"],
    aliases: ["inbox", "news", "updates"],
    keywords: ["notification", "alert", "message"],
  },
  {
    route: "/agents",
    names: ["agents", "ai agents"],
    aliases: ["assistants", "bots"],
    keywords: ["agent", "assistant", "bot"],
  },
  {
    route: "/audio",
    names: ["audio", "sound"],
    aliases: ["music", "voice", "text-to-speech"],
    keywords: ["audio", "sound", "voice"],
  },
];

/**
 * Detect if user wants to open a feature
 * Works intelligently with any feature in the registry
 * Supports: "open [feature]", "show [feature]", "take me to [feature]", etc.
 */
export function detectFeatureOpen(text: string): string | null {
  const lowerText = text.toLowerCase();

  // Action words that indicate wanting to open something
  const actionWords = ["open", "show", "go to", "take me to", "launch", "start", "view", "access", "see"];

  // Check if the message contains an action word
  const hasAction = actionWords.some((action) => lowerText.includes(action));
  if (!hasAction) return null;

  // Search through all features to find a match
  for (const feature of FEATURES) {
    // Check against all feature names
    for (const name of feature.names) {
      if (lowerText.includes(name)) {
        return feature.route;
      }
    }

    // Check against aliases
    for (const alias of feature.aliases) {
      if (lowerText.includes(alias)) {
        return feature.route;
      }
    }

    // Check against keywords
    for (const keyword of feature.keywords) {
      if (lowerText.includes(keyword)) {
        // Extra validation: make sure this is a strong match
        // Look for the action word near the keyword
        const actionRegex = new RegExp(`(${actionWords.join("|")}).*${keyword}|(${keyword}).*?(${actionWords.join("|")})`, "i");
        if (actionRegex.test(lowerText)) {
          return feature.route;
        }
      }
    }
  }

  return null;
}

/**
 * Get all available features (useful for help/onboarding)
 */
export function getAllFeatures(): Feature[] {
  return FEATURES;
}

/**
 * Get feature info by route
 */
export function getFeatureByRoute(route: string): Feature | undefined {
  return FEATURES.find((f) => f.route === route);
}
