// Mock Exam Engine
// Generates auto-marked mock exams with performance tracking

export interface MockExamQuestion {
  id: string;
  subject: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  questionText: string;
  questionType: "mcq" | "theory" | "essay";
  options?: string[];
  correctAnswer: string | string[];
  explanation: string;
  difficultyScore: number; // 1-5
}

export interface MockExamResult {
  examId: string;
  userId: string;
  subject: string;
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  skipped: number;
  score: number; // percentage
  timeSpent: number; // minutes
  performance: {
    easyAccuracy: number;
    mediumAccuracy: number;
    hardAccuracy: number;
  };
  weakTopics: string[];
  strongTopics: string[];
  recommendations: string[];
}

/**
 * Generate a mock exam for a subject
 */
export function generateMockExam(
  subject: string,
  difficulty: "easy" | "medium" | "hard" = "medium",
  questionCount: number = 20
): MockExamQuestion[] {
  // This would be expanded with a full question bank in production
  const questionBank: Record<string, MockExamQuestion[]> = {
    mathematics: [
      {
        id: "math-001",
        subject: "mathematics",
        topic: "Quadratic Equations",
        difficulty: "medium",
        questionType: "mcq",
        questionText: "Solve the equation x² + 5x + 6 = 0",
        options: ["x = -2 or x = -3", "x = 2 or x = 3", "x = 1 or x = -6", "x = -1 or x = 6"],
        correctAnswer: "x = -2 or x = -3",
        explanation: "Using factorization: (x + 2)(x + 3) = 0, so x = -2 or x = -3",
        difficultyScore: 2,
      },
      {
        id: "math-002",
        subject: "mathematics",
        topic: "Algebra",
        difficulty: "hard",
        questionType: "theory",
        questionText: "Prove that for any integer n, n² + n is always even",
        options: [],
        correctAnswer: "Case 1: If n is even, n = 2k, then n² + n = 4k² + 2k = 2(2k² + k), which is even.\nCase 2: If n is odd, n = 2k+1, then n² + n = (2k+1)² + (2k+1) = 4k² + 4k + 1 + 2k + 1 = 4k² + 6k + 2 = 2(2k² + 3k + 1), which is even.",
        explanation: "Proof by cases - covers both even and odd integers.",
        difficultyScore: 4,
      },
    ],
    physics: [
      {
        id: "phys-001",
        subject: "physics",
        topic: "Motion",
        difficulty: "medium",
        questionType: "mcq",
        questionText: "An object is thrown upward with velocity 20 m/s. What is its maximum height? (g = 10 m/s²)",
        options: ["10 m", "20 m", "30 m", "40 m"],
        correctAnswer: "20 m",
        explanation: "Using v² = u² - 2gs, at max height v = 0, so 0 = 400 - 2(10)s, giving s = 20 m",
        difficultyScore: 3,
      },
    ],
    chemistry: [
      {
        id: "chem-001",
        subject: "chemistry",
        topic: "Chemical Bonding",
        difficulty: "medium",
        questionType: "mcq",
        questionText: "Which of these molecules is non-polar?",
        options: ["CO₂", "HCl", "H₂O", "NH₃"],
        correctAnswer: "CO₂",
        explanation: "CO₂ is linear and symmetric, so dipoles cancel out. HCl, H₂O, NH₃ are all polar.",
        difficultyScore: 2,
      },
    ],
  };

  const subjectQuestions = questionBank[subject.toLowerCase()] || [];
  return subjectQuestions.slice(0, questionCount);
}

/**
 * Auto-mark an exam
 */
export function markExam(
  userAnswers: Record<string, string>,
  questions: MockExamQuestion[]
): MockExamResult {
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  const topicPerformance: Record<string, { correct: number; total: number }> = {};
  const weakTopics: string[] = [];
  const strongTopics: string[] = [];

  questions.forEach((q) => {
    const userAnswer = userAnswers[q.id];
    
    if (!userAnswer) {
      skippedCount++;
      return;
    }

    // Initialize topic tracking
    if (!topicPerformance[q.topic]) {
      topicPerformance[q.topic] = { correct: 0, total: 0 };
    }
    topicPerformance[q.topic].total++;

    const isCorrect = userAnswer.toLowerCase() === String(q.correctAnswer).toLowerCase();
    if (isCorrect) {
      correctCount++;
      topicPerformance[q.topic].correct++;
    } else {
      wrongCount++;
    }
  });

  // Analyze weak and strong topics
  Object.entries(topicPerformance).forEach(([topic, perf]) => {
    const accuracy = (perf.correct / perf.total) * 100;
    if (accuracy < 60) {
      weakTopics.push(topic);
    } else if (accuracy >= 80) {
      strongTopics.push(topic);
    }
  });

  const score = (correctCount / (questions.length - skippedCount)) * 100;

  // Calculate performance by difficulty
  const byDifficulty = {
    easy: questions.filter((q) => q.difficulty === "easy").length,
    medium: questions.filter((q) => q.difficulty === "medium").length,
    hard: questions.filter((q) => q.difficulty === "hard").length,
  };

  return {
    examId: "exam-" + Date.now(),
    userId: "user-placeholder",
    subject: questions[0]?.subject || "general",
    totalQuestions: questions.length,
    correctAnswers: correctCount,
    wrongAnswers: wrongCount,
    skipped: skippedCount,
    score,
    timeSpent: 0, // Would be calculated from timestamps
    performance: {
      easyAccuracy: 95, // Placeholder - would calculate from actual answers
      mediumAccuracy: score,
      hardAccuracy: score > 50 ? score - 20 : 30,
    },
    weakTopics,
    strongTopics,
    recommendations: generateRecommendations(weakTopics, score),
  };
}

/**
 * Generate personalized recommendations based on exam performance
 */
export function generateRecommendations(weakTopics: string[], score: number): string[] {
  const recommendations: string[] = [];

  if (score >= 90) {
    recommendations.push("Excellent performance! Maintain this standard and tackle advanced problems.");
  } else if (score >= 75) {
    recommendations.push("Good job! Focus on solidifying weak areas to reach 90%+");
  } else if (score >= 60) {
    recommendations.push("Decent progress. Increase practice on weak topics to improve score.");
  } else {
    recommendations.push("You need more practice. Revisit fundamentals and practice daily.");
  }

  weakTopics.forEach((topic) => {
    recommendations.push(`Master "${topic}" - this is critical for your exam success`);
  });

  return recommendations;
}

/**
 * Calculate prediction for final exam score
 */
export function predictFinalScore(
  currentMockScores: number[],
  daysUntilExam: number
): { prediction: number; range: [number, number] } {
  if (currentMockScores.length === 0) {
    return { prediction: 50, range: [40, 60] };
  }

  const average = currentMockScores.reduce((a, b) => a + b) / currentMockScores.length;
  const trend = currentMockScores.length > 1 
    ? (currentMockScores[currentMockScores.length - 1] - currentMockScores[0]) / (currentMockScores.length - 1)
    : 0;

  // Project based on trend
  const projectedScore = average + trend * (daysUntilExam / 7);
  const cappedScore = Math.min(100, Math.max(0, projectedScore));

  return {
    prediction: Math.round(cappedScore),
    range: [Math.max(0, Math.round(cappedScore - 10)), Math.min(100, Math.round(cappedScore + 10))],
  };
}
