// Curriculum Brain
// Contains structured curriculum for Nigerian exams (JAMB, WAEC, NECO)

export interface CurriculumModule {
  subject: string;
  topics: Topic[];
  examBodies: string[];
}

export interface Topic {
  id: string;
  name: string;
  subtopics: string[];
  keyPoints: string[];
  formulas?: string[];
  pastQuestions?: string;
  commonMistakes: string[];
  realWorldApplications: string[];
  estimatedHours: number;
  difficulty: "easy" | "medium" | "hard";
}

/**
 * Get curriculum for a subject and exam
 */
export function getCurriculum(subject: string, exam: "jamb" | "waec" | "neco" | "all" = "all"): CurriculumModule {
  const curriculum: Record<string, CurriculumModule> = {
    mathematics: {
      subject: "Mathematics",
      topics: [
        {
          id: "math-001",
          name: "Quadratic Equations",
          subtopics: ["Factorization", "Completing the square", "Quadratic formula", "Roots of equations"],
          keyPoints: [
            "Standard form: ax² + bx + c = 0",
            "Discriminant: b² - 4ac",
            "Sum and product of roots",
            "Nature of roots based on discriminant",
          ],
          formulas: [
            "x = (-b ± √(b² - 4ac)) / 2a",
            "Sum of roots = -b/a",
            "Product of roots = c/a",
          ],
          commonMistakes: [
            "Forgetting to consider ± in quadratic formula",
            "Sign errors in completing the square",
            "Not simplifying radical expressions",
          ],
          realWorldApplications: [
            "Projectile motion in physics",
            "Area optimization in engineering",
            "Profit maximization in economics",
          ],
          estimatedHours: 4,
          difficulty: "medium",
        },
        {
          id: "math-002",
          name: "Algebra",
          subtopics: ["Sequences", "Series", "Surds", "Logarithms"],
          keyPoints: [
            "Arithmetic and geometric sequences",
            "Sum formulas for sequences",
            "Rationalization of surds",
            "Logarithm properties",
          ],
          formulas: [
            "aₙ = a₁ + (n-1)d",
            "Sₙ = n/2(2a₁ + (n-1)d)",
            "log(ab) = log(a) + log(b)",
          ],
          commonMistakes: [
            "Confusing arithmetic and geometric progressions",
            "Sign errors in surd operations",
          ],
          realWorldApplications: [
            "Compound interest calculations",
            "Population growth modeling",
            "Decibel measurements",
          ],
          estimatedHours: 6,
          difficulty: "hard",
        },
      ],
      examBodies: ["jamb", "waec", "neco"],
    },
    physics: {
      subject: "Physics",
      topics: [
        {
          id: "phys-001",
          name: "Mechanics",
          subtopics: ["Kinematics", "Dynamics", "Energy", "Work"],
          keyPoints: [
            "Newton's laws of motion",
            "Momentum and impulse",
            "Energy conservation",
            "Simple harmonic motion",
          ],
          formulas: [
            "F = ma",
            "v² = u² + 2as",
            "E = ½mv²",
            "P = F·v",
          ],
          commonMistakes: [
            "Forgetting to convert units",
            "Confusion between mass and weight",
            "Sign errors in vector addition",
          ],
          realWorldApplications: [
            "Vehicle motion analysis",
            "Sports mechanics",
            "Space exploration",
          ],
          estimatedHours: 8,
          difficulty: "hard",
        },
      ],
      examBodies: ["jamb", "waec", "neco"],
    },
    chemistry: {
      subject: "Chemistry",
      topics: [
        {
          id: "chem-001",
          name: "Chemical Bonding",
          subtopics: ["Ionic bonding", "Covalent bonding", "Metallic bonding", "Hydrogen bonding"],
          keyPoints: [
            "Types of chemical bonds",
            "Electronegativity",
            "Bond energy",
            "Molecular structure",
          ],
          commonMistakes: [
            "Misidentifying bond types",
            "Ignoring electronegativity differences",
            "Incorrect Lewis structures",
          ],
          realWorldApplications: [
            "Material science",
            "Drug design",
            "Polymer production",
          ],
          estimatedHours: 5,
          difficulty: "medium",
        },
      ],
      examBodies: ["jamb", "waec", "neco"],
    },
    biology: {
      subject: "Biology",
      topics: [
        {
          id: "bio-001",
          name: "Photosynthesis",
          subtopics: ["Light-dependent reactions", "Light-independent reactions", "Chloroplast structure"],
          keyPoints: [
            "Photosynthesis equation",
            "Role of chlorophyll",
            "ATP and NADPH production",
            "Calvin cycle steps",
          ],
          commonMistakes: [
            "Confusing photosynthesis with respiration",
            "Forgetting role of water",
            "Misplacing reactions in chloroplast",
          ],
          realWorldApplications: [
            "Agriculture and crop yield",
            "Biofuel production",
            "Climate change understanding",
          ],
          estimatedHours: 6,
          difficulty: "medium",
        },
      ],
      examBodies: ["jamb", "waec", "neco"],
    },
  };

  return curriculum[subject.toLowerCase()] || curriculum.mathematics;
}

/**
 * Get all topics for a subject
 */
export function getAllTopics(subject: string): Topic[] {
  const curriculum = getCurriculum(subject);
  return curriculum.topics;
}

/**
 * Get a specific topic with details
 */
export function getTopic(subject: string, topicId: string): Topic | null {
  const topics = getAllTopics(subject);
  return topics.find((t) => t.id === topicId) || null;
}

/**
 * Get topics by difficulty
 */
export function getTopicsByDifficulty(
  subject: string,
  difficulty: "easy" | "medium" | "hard"
): Topic[] {
  const topics = getAllTopics(subject);
  return topics.filter((t) => t.difficulty === difficulty);
}

/**
 * Calculate total hours for a subject
 */
export function getTotalCurriculumHours(subject: string): number {
  const topics = getAllTopics(subject);
  return topics.reduce((sum, t) => sum + t.estimatedHours, 0);
}

/**
 * Generate study path recommendation
 */
export function recommendStudyPath(
  subject: string,
  userStrength: "beginner" | "intermediate" | "advanced"
): Topic[] {
  const allTopics = getAllTopics(subject);

  if (userStrength === "beginner") {
    // Start with easy topics
    return allTopics
      .filter((t) => t.difficulty === "easy" || t.difficulty === "medium")
      .sort((a, b) => a.estimatedHours - b.estimatedHours);
  } else if (userStrength === "intermediate") {
    // Mix of all levels, medium-heavy on medium/hard
    return allTopics.sort((a, b) => {
      const diffScore = (a.difficulty === "hard" ? 2 : 1) - (b.difficulty === "hard" ? 2 : 1);
      return diffScore || a.estimatedHours - b.estimatedHours;
    });
  } else {
    // Prioritize advanced/hard topics
    return allTopics.sort((a, b) => {
      const diffScore = (b.difficulty === "hard" ? 2 : 1) - (a.difficulty === "hard" ? 2 : 1);
      return diffScore || b.estimatedHours - a.estimatedHours;
    });
  }
}
